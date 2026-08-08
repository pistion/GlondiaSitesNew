import renderApiService from './renderApiService.js';
import { makeId, mutateHostingStore, nowIso, readHostingStore } from './hostingStore.js';
import { vpsHostingConfigured, vpsHostingSettings } from '../glondia-engines/01-HOSTING-DEPLOY-ENGINE/06-VPS-HOSTING-MOUNTAIN/vpsHostingPublisher.stage.js';

class DomainService {
  async add(deploymentId, input = {}) {
    const deployment = await findDeployment(deploymentId);
    const name = cleanDomain(input.domain || input.name || input.hostname);
    let renderDomain = null;
    let providerSyncStatus = 'synced';
    let providerError = null;
    const mainServer = isMainServerHosting(deployment);
    if (mainServer) {
      providerSyncStatus = 'pending_dns';
    } else {
      try {
        renderDomain = await renderApiService.addCustomDomain(deployment.renderServiceId, name);
      } catch (error) {
        providerSyncStatus = 'pending_provider';
        providerError = error.message || 'Provider sync failed.';
      }
    }
    return mutateHostingStore((store) => {
      if (!store.domains || typeof store.domains !== 'object' || Array.isArray(store.domains)) store.domains = {};
      const domain = {
        domainId: renderDomain?.customDomain?.id || renderDomain?.id || makeId('domain'),
        name,
        provider: mainServer ? 'glondia-main-server' : 'render',
        status: mainServer ? 'pending_dns' : providerSyncStatus === 'synced' ? (renderDomain?.status || 'pending_verification') : 'pending_provider',
        verificationStatus: mainServer ? 'waiting_for_dns' : renderDomain?.verificationStatus || renderDomain?.status || 'pending',
        sslStatus: mainServer ? 'pending_certificate' : renderDomain?.certificateStatus || renderDomain?.sslStatus || 'pending',
        dnsRecords: mainServer ? mainServerDnsRecords(name) : extractDnsRecords(renderDomain, name, deployment.liveUrl),
        providerSyncStatus,
        providerError,
        renderDomain,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.domains[deployment.deploymentId] = [domain, ...(store.domains[deployment.deploymentId] || [])];
      updateDeploymentDomains(store, deployment.deploymentId);
      return domain;
    });
  }

  async list(deploymentId) {
    const deployment = await findDeployment(deploymentId, false);
    const store = await readHostingStore();
    if (!store.domains || typeof store.domains !== 'object' || Array.isArray(store.domains)) return [];
    return store.domains[deployment.deploymentId] || [];
  }

  async status(deploymentId, domainId) {
    const deployment = await findDeployment(deploymentId);
    const store = await readHostingStore();
    const domain = (store.domains[deployment.deploymentId] || []).find((item) => item.domainId === domainId);
    if (!domain) throw notFound('Domain not found.');
    if (isMainServerHosting(deployment) || domain.provider === 'glondia-main-server') {
      return mutateHostingStore((nextStore) => {
        if (!nextStore.domains || typeof nextStore.domains !== 'object' || Array.isArray(nextStore.domains)) nextStore.domains = {};
        const item = (nextStore.domains[deployment.deploymentId] || []).find((row) => row.domainId === domainId);
        if (!item) return domain;
        item.dnsRecords = mainServerDnsRecords(item.name);
        item.provider = 'glondia-main-server';
        item.providerSyncStatus = 'pending_dns';
        item.verificationStatus = 'waiting_for_dns';
        item.sslStatus = item.sslStatus || 'pending_certificate';
        item.status = 'pending_dns';
        item.updatedAt = nowIso();
        updateDeploymentDomains(nextStore, deployment.deploymentId);
        return item;
      });
    }
    let renderDomain = null;
    let providerError = null;
    try {
      renderDomain = await renderApiService.getCustomDomain(deployment.renderServiceId, domainId);
    } catch (error) {
      providerError = error.message || 'Provider verification failed.';
    }
    return mutateHostingStore((nextStore) => {
      if (!nextStore.domains || typeof nextStore.domains !== 'object' || Array.isArray(nextStore.domains)) nextStore.domains = {};
      const item = (nextStore.domains[deployment.deploymentId] || []).find((row) => row.domainId === domainId);
      if (renderDomain && item) {
        item.renderDomain = renderDomain;
        item.verificationStatus = renderDomain.verificationStatus || renderDomain.status || item.verificationStatus;
        item.sslStatus = renderDomain.certificateStatus || renderDomain.sslStatus || item.sslStatus;
        item.status = normalizeDomainStatus(item.verificationStatus, item.sslStatus);
        item.dnsRecords = extractDnsRecords(renderDomain, item.name, deployment.liveUrl);
        item.updatedAt = nowIso();
        updateDeploymentDomains(nextStore, deployment.deploymentId);
      } else if (item && providerError) {
        item.providerError = providerError;
        item.providerSyncStatus = 'pending_provider';
        item.updatedAt = nowIso();
      }
      return item || domain;
    });
  }

  async remove(deploymentId, domainId) {
    const deployment = await findDeployment(deploymentId);
    try {
      await renderApiService.deleteCustomDomain(deployment.renderServiceId, domainId);
    } catch { /* remove local record even when provider sync fails */ }
    return mutateHostingStore((store) => {
      if (!store.domains || typeof store.domains !== 'object' || Array.isArray(store.domains)) store.domains = {};
      store.domains[deployment.deploymentId] = (store.domains[deployment.deploymentId] || []).filter((item) => item.domainId !== domainId);
      updateDeploymentDomains(store, deployment.deploymentId);
      return { deleted: true, domainId };
    });
  }
}

async function findDeployment(deploymentId, requireRender = true) {
  const store = await readHostingStore();
  const deployment = store.deployments.find((item) => item.deploymentId === deploymentId || item.id === deploymentId || item.renderServiceId === deploymentId);
  if (!deployment) throw notFound('Hosting deployment not found.');
  if (requireRender && !deployment.renderServiceId && !isMainServerHosting(deployment)) {
    const error = new Error('Deployment has not started. A real hosting service ID is required.');
    error.status = 409;
    throw error;
  }
  return deployment;
}

function cleanDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || domain.includes('..')) {
    const error = new Error('Enter a valid domain name, such as example.com.');
    error.status = 400;
    throw error;
  }
  return domain;
}

function extractDnsRecords(renderDomain, domain, liveUrl) {
  const records = renderDomain?.dnsRecords || renderDomain?.verification?.dnsRecords || renderDomain?.customDomain?.dnsRecords;
  if (Array.isArray(records) && records.length) return records;
  return [
    { type: 'CNAME', name: domain.startsWith('www.') ? domain : `www.${domain}`, value: liveUrl ? liveUrl.replace(/^https?:\/\//, '') : 'your-service.onrender.com', ttl: 300 },
    { type: 'A', name: domain.replace(/^www\./, '@'), value: '216.24.57.1', ttl: 300 },
  ];
}

function isMainServerHosting(deployment = {}) {
  const provider = String(deployment.provider || deployment.providerTarget || '').toLowerCase();
  return provider === 'vps'
    || String(deployment.renderServiceId || '').startsWith('vps_')
    || Boolean(deployment.generatedSite?.publicDir)
    || vpsHostingConfigured();
}

function mainServerDnsRecords(domain) {
  const target = mainServerDnsTarget();
  const host = domain.startsWith('www.') ? 'www' : '@';
  const valueType = isIpAddress(target) ? 'A' : 'CNAME';
  return [
    {
      type: valueType,
      name: host,
      host,
      value: target,
      ttl: 300,
      status: 'required',
      purpose: 'Points this domain at the main Glondia cloud hosting server.',
    },
    ...(domain.startsWith('www.') ? [{
      type: isIpAddress(target) ? 'A' : 'CNAME',
      name: '@',
      host: '@',
      value: target,
      ttl: 300,
      status: 'optional',
      purpose: 'Optional apex/root domain record if you also want the bare domain to work.',
    }] : []),
  ];
}

function mainServerDnsTarget() {
  const explicit = String(process.env.HOSTING_DOMAIN_TARGET || process.env.HOSTING_VPS_PUBLIC_HOST || '').trim();
  if (explicit) return explicit.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  try {
    return new URL(vpsHostingSettings().publicBaseUrl).hostname;
  } catch {
    return '45.77.236.52';
  }
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || ''));
}

function normalizeDomainStatus(verificationStatus, sslStatus) {
  if (String(verificationStatus).toLowerCase().includes('verified') && String(sslStatus).toLowerCase().includes('issued')) return 'active';
  return 'pending_verification';
}

function updateDeploymentDomains(store, serviceId) {
  const deployment = store.deployments.find((item) => item.deploymentId === serviceId);
  if (!deployment) return;
  deployment.domainMetadata = store.domains[serviceId] || [];
  deployment.updatedAt = nowIso();
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export default new DomainService();
