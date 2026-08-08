export {
  AUTH_CHANGED_EVENT,
  clearAuthSession,
  getStoredAuth,
  login,
  register,
  storeAuthSession,
  updateStoredAuthUser,
} from './api/auth.js';
import { makeSession } from './api/auth.js';
import { createBuilderActions } from './api/builder.js';
import { createDomainActions, ttlToSeconds } from './api/domains.js';
export { ttlToSeconds } from './api/domains.js';
import { isLiveMode } from './app/config.js';
import { authFetch, authHeaders } from './api/auth.js';
import {
  buildGithubSandbox,
  disconnectGitHub as disconnectGitHubBase,
  fetchGithubSnapshot,
  parseGithubRepo,
} from './api/github.js';
export {
  connectGitHubUrl,
  getGitHubStatus,
  listGitHubBranches,
  listGitHubRepos,
  parseGithubRepo,
} from './api/github.js';
import {
  mapApiActivity,
  mapApiDeployment,
  mapApiDnsRecord,
  mapApiDomain,
  mapApiEnvVar,
  mapApiProject,
} from './api/mappers.js';
export {
  mapApiActivity,
  mapApiArtifact,
  mapApiDeployment,
  mapApiDeploymentLog,
  mapApiDnsRecord,
  mapApiDomain,
  mapApiEnvVar,
  mapApiProject,
  mapApiTemplate,
} from './api/mappers.js';
import { createLocalDbRuntime } from './api/localDb.js';
import { createProjectActions } from './api/projects.js';
import { triggerRenderDeploy } from './api/render.js';
import { getActiveServiceSandbox } from './features/sandbox/sandboxState.js';
import {
  sandboxDomainAvailability,
  sandboxDomainDnsRecords,
  sandboxDomains,
  sandboxHostingDeployHistory,
  sandboxHostingDisks,
  sandboxHostingDomains,
  sandboxHostingEnvVars,
  sandboxHostingEvents,
  sandboxHostingList,
  sandboxHostingLogs,
  sandboxHostingMetrics,
  sandboxHostingService,
  sandboxHostingStatus,
} from './features/sandbox/sandboxFixtures.js';
export {
  activateRenderRepo,
  getRenderSettings,
  listLiveRenderServices,
  listRenderDeploys,
  testRenderDeploy,
  triggerRenderDeploy,
} from './api/render.js';

const localDb = createLocalDbRuntime({ makeSession, ttlToSeconds });
const {
  createId,
  handleLocalApi,
  makeActivity,
  makeBuilderSite,
  makeProject,
  readLocalDb,
  slugify,
  writeLocalDb,
} = localDb;

const domainApi = createDomainActions({
  apiRequest: isLiveMode() ? liveApiRequest : apiRequest,
  createId,
  mapApiDnsRecord,
  mapApiDomain,
  notifyDataChanged,
  readLocalDb,
  registrarRequest: isLiveMode() ? registrarRequest : null,
});

const builderApi = createBuilderActions({
  apiRequest,
  buildGithubSandbox,
  createId,
  fetchGithubSnapshot,
  makeActivity,
  makeBuilderSite,
  makeProject,
  notifyDataChanged,
  parseGithubRepo,
  readLocalDb,
  slugify,
  triggerRenderDeploy,
  writeLocalDb,
});

const projectApi = createProjectActions({
  // Projects are durable workspace records in every environment. Never route
  // them through the browser-only demo database.
  apiRequest: liveApiRequest,
  mapApiDeployment,
  mapApiEnvVar,
  mapApiProject,
  notifyDataChanged,
  readLocalDb,
});

export async function apiRequest(path, options = {}) {
  return handleLocalApi(path, options);
}

async function registrarRequest(path, options = {}) {
  const response = await authFetch(liveApiUrl(`/registrar${path}`), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || result?.message || `Registrar request failed with ${response.status}.`);
  }
  return result?.data ?? result;
}

async function hostingRequest(path, options = {}) {
  if (!isLiveMode()) return apiRequest(path, options);
  const response = await authFetch(liveApiUrl(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || result?.message || `Hosting request failed with ${response.status}.`);
  }
  return result?.data ?? result;
}

function assertLiveHostingServiceFeature(feature) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting' || !isLiveMode()) {
    throw new Error(`${feature} are live hosting features. Disable sandbox/testing mode and run the app in live mode to use the real backend/provider flow.`);
  }
}

export async function liveApiRequest(path, options = {}) {
  const response = await authFetch(liveApiUrl(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Backends return errors as { error: { message } }, { error: 'string' },
    // or { message }. Preserve status/code/body so callers can branch on them
    // (e.g. ANSWER_SHEET_INCOMPLETE carries a `missing` field list).
    const message =
      result?.error?.message ||
      (typeof result?.error === 'string' ? result.error : null) ||
      result?.message ||
      `API request failed with ${response.status}.`;
    const details = result?.details || result?.error?.details || null;
    const alreadyHasDebugId = details?.paypalDebugId && message.includes(details.paypalDebugId);
    const diagnostic = details?.paypalDebugId && !alreadyHasDebugId
      ? `${message} PayPal debug ID: ${details.paypalDebugId}.`
      : message;
    const err = new Error(diagnostic);
    err.status = response.status;
    err.code = result?.code || result?.error?.code || undefined;
    err.body = result;
    err.details = details;
    throw err;
  }
  return result?.data ?? result;
}

export function liveApiUrl(path) {
  const configured = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  if (!configured) return `/api${path}`;
  return `${configured}${path}`;
}

export const DATA_CHANGED_EVENT = "glondia:data-changed";
export const HOSTING_CHECKOUT_KEY = 'glondia:pending-hosting-checkout';

export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

export async function listProjectServiceTypes() { return projectApi.listProjectServiceTypes(); }
export async function listProjects() { return projectApi.listProjects(); }
export async function createProject(input) { return projectApi.createProject(input); }
export async function getProject(projectId) { return projectApi.getProject(projectId); }
export async function getProjectSummary(projectId) { return projectApi.getProjectSummary(projectId); }
export async function manageProjectService(projectId, serviceType, serviceId, action, input) { return projectApi.manageProjectService(projectId, serviceType, serviceId, action, input); }
export async function updateProject(projectId, input) { return projectApi.updateProject(projectId, input); }
export async function archiveProject(projectId) { return projectApi.archiveProject(projectId); }
export async function createDeployment(projectId, input) { return projectApi.createDeployment(projectId, input); }

// Hosting Deploy handoff helpers are migrating to src/api/hosting-deploy.js.
// Keep this export for older callers while new builder flows use the gateway.
export async function createRenderDeployment(input) {
  const path = isLiveMode()
    ? (isDirectGithubDeployment(input) ? '/deployments/github' : '/deployments/render')
    : '/deployments';
  const deployment = await hostingRequest(path, { method: 'POST', body: JSON.stringify(input) });
  notifyDataChanged();
  return deployment;
}

function isDirectGithubDeployment(input = {}) {
  if (input.githubRepo || input.repositoryProvider === 'github' || input.source === 'github' || input.source === 'github-link') return true;
  const repoUrl = String(input.repoUrl || input.repositoryUrl || input.sourceRepository || '').trim();
  if (!/github\.com[:/][^/]+\/[^/.#?]+/i.test(repoUrl)) return false;
  const sourceReference = String(input.sourceReference || '').trim();
  return !sourceReference || sourceReference === repoUrl;
}

export async function getRenderDeploymentStatus(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingStatus(sandbox, deploymentId);
  return hostingRequest(`/deployments/${deploymentId}/status`);
}
export const getDeploymentStatus = getRenderDeploymentStatus;
export async function verifyRenderDeploymentUrl(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingService(sandbox, deploymentId);
  const deployment = await hostingRequest(`/deployments/${deploymentId}/verify-url`, { method: 'POST' });
  notifyDataChanged();
  return deployment;
}
export const verifyDeploymentUrl = verifyRenderDeploymentUrl;
export async function redeployRenderDeployment(deploymentId, input = {}) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingService(sandbox, deploymentId);
  const deployment = await hostingRequest(`/deployments/${deploymentId}/redeploy`, { method: 'POST', body: JSON.stringify(input) });
  notifyDataChanged();
  return deployment;
}
export const redeployDeployment = redeployRenderDeployment;
export async function getRenderDeploymentLogs(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingLogs(deploymentId);
  return hostingRequest(`/deployments/${deploymentId}/logs`);
}
export function getDeploymentLogStreamUrl(deploymentId) { return liveApiUrl(`/deployments/${encodeURIComponent(deploymentId)}/logs/stream`); }

// Hosting Control helpers below manage live services after a deploymentId exists.
// These belong to Render Hosting Hub screens, not Site Builder handoff screens.
export async function listHostingDeployments() {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingList(sandbox);
  return hostingRequest('/hosting');
}
export const listHostingApps = listHostingDeployments;
export async function getHostingService(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingService(sandbox, deploymentId);
  return hostingRequest(`/hosting/${deploymentId}`);
}
export const getHostingApp = getHostingService;
export async function syncHostingDeployment(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingService(sandbox, deploymentId);
  const service = await hostingRequest(`/hosting/${deploymentId}/sync`, { method: 'POST' });
  notifyDataChanged();
  return service;
}
export async function updateHostingSettings(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), ...(input || {}) };
  const service = await hostingRequest(`/hosting/${deploymentId}/settings`, { method: 'PATCH', body: JSON.stringify(input) });
  notifyDataChanged();
  return service;
}
export async function updateHostingDeploySettings(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), deploySettings: input };
  const service = await hostingRequest(`/hosting/${deploymentId}/deploy-settings`, { method: 'PATCH', body: JSON.stringify(input) });
  notifyDataChanged();
  return service;
}
export async function updateHostingBuildSettings(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), buildSettings: input };
  const service = await hostingRequest(`/hosting/${deploymentId}/build-settings`, { method: 'PATCH', body: JSON.stringify(input) });
  notifyDataChanged();
  return service;
}
export async function updateHostingSourceSettings(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), sourceSettings: input };
  const service = await hostingRequest(`/hosting/${deploymentId}/source-settings`, { method: 'PATCH', body: JSON.stringify(input) });
  notifyDataChanged();
  return service;
}
export async function redeployHostingWithSettings(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), redeployInput: input };
  const service = await hostingRequest(`/hosting/${deploymentId}/redeploy-with-settings`, { method: 'POST', body: JSON.stringify(input) });
  notifyDataChanged();
  return service;
}
export async function suspendHostingDeployment(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), status: 'suspended' };
  const service = await hostingRequest(`/hosting/${deploymentId}/suspend`, { method: 'POST' });
  notifyDataChanged();
  return service;
}
export const suspendHostingApp = suspendHostingDeployment;
export async function resumeHostingDeployment(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingService(sandbox, deploymentId), status: 'live' };
  const service = await hostingRequest(`/hosting/${deploymentId}/resume`, { method: 'POST' });
  notifyDataChanged();
  return service;
}
export async function restartHostingDeployment(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingService(sandbox, deploymentId);
  const service = await hostingRequest(`/hosting/${deploymentId}/restart`, { method: 'POST' });
  notifyDataChanged();
  return service;
}
export async function cancelHostingDeploy(deploymentId, deployId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ok: true, deploymentId, deployId, sandbox: true };
  const result = await hostingRequest(`/hosting/${deploymentId}/cancel-deploy`, { method: 'POST', body: JSON.stringify({ deployId }) });
  notifyDataChanged();
  return result;
}
export async function rollbackHostingDeploy(deploymentId, deployId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ok: true, deploymentId, deployId, sandbox: true };
  const result = await hostingRequest(`/hosting/${deploymentId}/rollback`, { method: 'POST', body: JSON.stringify({ deployId }) });
  notifyDataChanged();
  return result;
}
export async function listHostingDeployHistory(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingDeployHistory(deploymentId);
  return hostingRequest(`/hosting/${deploymentId}/deploys`);
}
export async function purgeHostingCache(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ok: true, deploymentId, sandbox: true };
  const result = await hostingRequest(`/hosting/${deploymentId}/purge-cache`, { method: 'POST' });
  notifyDataChanged();
  return result;
}
export async function listHostingEvents(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingEvents(deploymentId);
  return hostingRequest(`/hosting/${deploymentId}/events`);
}
export async function listHostingSecretFiles(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return [];
  return hostingRequest(`/hosting/${deploymentId}/secret-files`);
}
export async function upsertHostingSecretFiles(deploymentId, files) {
  const result = await hostingRequest(`/hosting/${deploymentId}/secret-files`, { method: 'PUT', body: JSON.stringify(files) });
  notifyDataChanged();
  return result;
}
export async function listHostingHeaders(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return [];
  return hostingRequest(`/hosting/${deploymentId}/headers`);
}
export async function updateHostingHeaders(deploymentId, headers) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return headers || [];
  const result = await hostingRequest(`/hosting/${deploymentId}/headers`, { method: 'PUT', body: JSON.stringify(headers) });
  notifyDataChanged();
  return result;
}
export async function listHostingRoutes(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return [];
  return hostingRequest(`/hosting/${deploymentId}/routes`);
}
export async function updateHostingRoutes(deploymentId, routes) {
  const result = await hostingRequest(`/hosting/${deploymentId}/routes`, { method: 'PUT', body: JSON.stringify(routes) });
  notifyDataChanged();
  return result;
}
export async function listHostingWebhooks(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return [];
  return hostingRequest(`/hosting/${deploymentId}/webhooks`);
}
export async function createHostingWebhook(deploymentId, input) {
  const result = await hostingRequest(`/hosting/${deploymentId}/webhooks`, { method: 'POST', body: JSON.stringify(input) });
  notifyDataChanged();
  return result;
}
export async function updateHostingWebhook(deploymentId, webhookId, input) {
  const result = await hostingRequest(`/hosting/${deploymentId}/webhooks/${encodeURIComponent(webhookId)}`, { method: 'PATCH', body: JSON.stringify(input) });
  notifyDataChanged();
  return result;
}
export async function deleteHostingWebhook(deploymentId, webhookId) {
  const result = await hostingRequest(`/hosting/${deploymentId}/webhooks/${encodeURIComponent(webhookId)}`, { method: 'DELETE' });
  notifyDataChanged();
  return result;
}
export async function getHostingMetrics(deploymentId, type, options = {}) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingMetrics(type, options);
  const params = new URLSearchParams({ type: type || 'cpu' });
  if (options.range) params.set('range', options.range);
  return hostingRequest(`/hosting/${deploymentId}/metrics?${params.toString()}`);
}
export async function deleteHostingDeployment(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ok: true, deploymentId, sandbox: true };
  const result = await hostingRequest(`/hosting/${deploymentId}`, { method: 'DELETE' });
  notifyDataChanged();
  return result;
}
export const deleteHostingApp = deleteHostingDeployment;
export const redeployHostingApp = redeployRenderDeployment;

export async function getPayPalClientSettings() {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy' || sandbox?.service === 'billing') return { configured: true, sandbox: true, clientId: 'sandbox' };
  return hostingRequest('/payments/paypal-client');
}
export async function listCustomerDomains() {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine' || sandbox?.service === 'domains-buy') return { items: sandboxDomains() };
  return liveApiRequest('/domains');
}
export async function listCustomerDomainDnsRecords(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine' || sandbox?.service === 'domains-buy') return sandboxDomainDnsRecords(domainId);
  return liveApiRequest(`/domains/${encodeURIComponent(domainId)}/dns-records`);
}
export async function getCustomerDomainSettings(domainId) {
  return liveApiRequest(`/domains/${encodeURIComponent(domainId)}/settings`);
}
export async function activateCustomerDomainAddon(domainId, addonId) {
  const result = await liveApiRequest(`/domains/${encodeURIComponent(domainId)}/addons/${encodeURIComponent(addonId)}/activate`, { method: 'POST' });
  notifyDataChanged();
  return result;
}
export async function getCustomerDomainProviderAccess() {
  return liveApiRequest('/domains/provider-access');
}
export async function syncCustomerDomains(service) {
  const normalized = String(service || '').trim().toLowerCase();
  if (!['domains', 'protection'].includes(normalized)) throw new Error('Unsupported Glondia domain service.');
  const result = await liveApiRequest(`/domains/sync/${normalized}`, { method: 'POST' });
  notifyDataChanged();
  return result;
}
export async function validateDomainCart(input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy') return { ok: true, domains: input?.domains || [], totalAmountCents: 1299, currency: 'USD', sandbox: true };
  return hostingRequest('/payments/domain/validate-cart', { method: 'POST', body: JSON.stringify(input) });
}
export async function createDomainPayPalOrder(input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy') return { id: 'sandbox-domain-order', status: 'CREATED', input, sandbox: true };
  return hostingRequest('/payments/domain/create-order', { method: 'POST', body: JSON.stringify(input) });
}
export async function captureDomainPayPalOrder(input) { const result = await hostingRequest('/payments/domain/capture', { method: 'POST', body: JSON.stringify(input) }); notifyDataChanged(); return result; }
export async function createDomainAddonPayPalOrder(addonServiceId) {
  return hostingRequest('/payments/domain-addon/create-order', { method: 'POST', body: JSON.stringify({ addonServiceId }) });
}
export async function captureDomainAddonPayPalOrder(input) {
  const result = await hostingRequest('/payments/domain-addon/capture', { method: 'POST', body: JSON.stringify(input) });
  notifyDataChanged();
  return result;
}
export async function createHostingPayPalOrder(input) { return hostingRequest('/payments/hosting/create-order', { method: 'POST', body: JSON.stringify(input) }); }
export async function captureHostingPayPalOrder(input) { const result = await hostingRequest('/payments/hosting/capture', { method: 'POST', body: JSON.stringify(input) }); notifyDataChanged(); return result; }
export async function getHostingPaymentStatus(deploymentId) { return hostingRequest(`/payments/hosting/status/${encodeURIComponent(deploymentId)}`); }

export async function listHostingEnvVars(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingEnvVars(deploymentId);
  return hostingRequest(`/hosting/${deploymentId}/env`);
}
export async function upsertHostingEnvVar(deploymentId, input) { const envVar = await hostingRequest(`/hosting/${deploymentId}/env`, { method: 'POST', body: JSON.stringify(input) }); notifyDataChanged(); return envVar; }
export const createHostingEnvVar = upsertHostingEnvVar;
export async function updateHostingEnvVar(deploymentId, key, input) { const envVar = await hostingRequest(`/hosting/${deploymentId}/env/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(input) }); notifyDataChanged(); return envVar; }
export async function deleteHostingEnvVar(deploymentId, key) { const result = await hostingRequest(`/hosting/${deploymentId}/env/${encodeURIComponent(key)}`, { method: 'DELETE' }); notifyDataChanged(); return result; }
export async function syncHostingEnvVars(deploymentId) { const result = await hostingRequest(`/hosting/${deploymentId}/env/sync`, { method: 'POST' }); notifyDataChanged(); return result; }

export async function listHostingDisks(deploymentId) {
  assertLiveHostingServiceFeature('Persistent disks');
  return hostingRequest(`/hosting/${deploymentId}/disk`);
}
export const getHostingDisk = listHostingDisks;
export async function attachHostingDisk(deploymentId, input) {
  assertLiveHostingServiceFeature('Persistent disks');
  const disk = await hostingRequest(`/hosting/${deploymentId}/disk`, { method: 'POST', body: JSON.stringify(input) }); notifyDataChanged(); return disk;
}
export const createHostingDisk = attachHostingDisk;
export async function updateHostingDisk(deploymentId, diskId, input) {
  assertLiveHostingServiceFeature('Persistent disks');
  const disk = await hostingRequest(`/hosting/${deploymentId}/disk/${diskId}`, { method: 'PATCH', body: JSON.stringify(input) }); notifyDataChanged(); return disk;
}
export async function deleteHostingDisk(deploymentId, diskId) {
  assertLiveHostingServiceFeature('Persistent disks');
  const result = await hostingRequest(`/hosting/${deploymentId}/disk/${diskId}`, { method: 'DELETE' }); notifyDataChanged(); return result;
}

export async function addHostingDomain(deploymentId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingDomain(input?.domain || input?.name || 'www.glondia.com');
  assertLiveHostingServiceFeature('Hosting domains');
  const domain = await hostingRequest(`/hosting/${deploymentId}/domains`, { method: 'POST', body: JSON.stringify(input) }); notifyDataChanged(); return domain;
}
export const createHostingDomain = addHostingDomain;
export async function listHostingDomains(deploymentId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingDomains(deploymentId);
  assertLiveHostingServiceFeature('Hosting domains');
  return hostingRequest(`/hosting/${deploymentId}/domains`);
}
export async function getHostingDomainStatus(deploymentId, domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return sandboxHostingDomain(domainId === 'domain_sandbox_1' ? 'www.glondia.com' : domainId);
  assertLiveHostingServiceFeature('Hosting domains');
  return hostingRequest(`/hosting/${deploymentId}/domains/${domainId}/status`);
}
export async function verifyHostingDomain(deploymentId, domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { ...sandboxHostingDomain(domainId === 'domain_sandbox_1' ? 'www.glondia.com' : domainId), verificationStatus: 'waiting_for_dns', sslStatus: 'pending_certificate' };
  assertLiveHostingServiceFeature('Hosting domains');
  const domain = await hostingRequest(`/hosting/${deploymentId}/domains/${domainId}/verify`, { method: 'POST' }); notifyDataChanged(); return domain;
}
export async function deleteHostingDomain(deploymentId, domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'hosting') return { deleted: true, domainId, sandbox: true };
  assertLiveHostingServiceFeature('Hosting domains');
  const result = await hostingRequest(`/hosting/${deploymentId}/domains/${domainId}`, { method: 'DELETE' }); notifyDataChanged(); return result;
}

function sandboxHostingDomain(name = 'www.glondia.com') {
  const clean = String(name || 'www.glondia.com').trim().toLowerCase() || 'www.glondia.com';
  return {
    domainId: clean === 'www.glondia.com' ? 'domain_sandbox_1' : `sandbox-domain-${clean.replace(/[^a-z0-9]+/g, '-')}`,
    name: clean,
    status: 'pending_dns',
    verificationStatus: 'waiting_for_dns',
    sslStatus: 'pending_certificate',
    provider: 'glondia-main-server',
    providerSyncStatus: 'sandbox_main_server',
    dnsRecords: [
      { id: 'www-cname', type: 'CNAME', name: clean.startsWith('www.') ? 'www' : clean, host: clean.startsWith('www.') ? 'www' : clean, value: '45.77.236.52', ttl: 300, status: 'pending' },
      { id: 'apex-a', type: 'A', name: '@', host: '@', value: '45.77.236.52', ttl: 300, status: 'optional' },
    ],
    sandbox: true,
  };
}

export async function cancelDeployment(deploymentId) { return projectApi.cancelDeployment(deploymentId); }
export async function rollbackDeployment(deploymentId) { return projectApi.rollbackDeployment(deploymentId); }
export async function createEnvVar(projectId, input) { return projectApi.createEnvVar(projectId, input); }
export async function updateEnvVar(projectId, envVarId, input) { return projectApi.updateEnvVar(projectId, envVarId, input); }
export async function deleteEnvVar(projectId, envVarId) { return projectApi.deleteEnvVar(projectId, envVarId); }
export async function exportEnvVars(projectId, environment) { return projectApi.exportEnvVars(projectId, environment); }
export async function linkProjectRepo(projectId, input) { return projectApi.linkProjectRepo(projectId, input, updateProject); }
export function parseGitHubRepository(value) { return parseGithubRepo(value); }
export async function listRenderServices() { return projectApi.listRenderServices(); }
export async function linkRenderService(projectId, renderServiceId) { return projectApi.linkRenderService(projectId, renderServiceId); }

export async function createDomain(input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy' || sandbox?.service === 'domains-mine') return { id: 'sandbox-domain-created', ...input, sandbox: true };
  return domainApi.createDomain(input);
}
export async function updateDomain(domainId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { id: domainId, ...input, sandbox: true };
  return domainApi.updateDomain(domainId, input);
}
export async function deleteDomain(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, sandbox: true };
  return domainApi.deleteDomain(domainId);
}
export async function createDnsRecord(domainId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { id: `sandbox-dns-${Date.now()}`, ...input, sandbox: true };
  return domainApi.createDnsRecord(domainId, input);
}
export async function updateDnsRecord(domainId, recordId, input) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { id: recordId, ...input, sandbox: true };
  return domainApi.updateDnsRecord(domainId, recordId, input);
}
export async function deleteDnsRecord(domainId, recordId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, recordId, sandbox: true };
  return domainApi.deleteDnsRecord(domainId, recordId);
}
export async function listSslCertificates(domainId) { return domainApi.listSslCertificates(domainId); }
export async function aiEditBuilderPage(html, prompt, pagePath) {
  return apiRequest('/template-ai/edit-page', { method: 'POST', body: JSON.stringify({ html, prompt, pagePath }) });
}
export async function verifyDomain(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, verified: true, sandbox: true };
  return domainApi.verifyDomain(domainId);
}
export async function exportZoneFile(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return sandboxDomainDnsRecords(domainId).map((record) => `${record.name || record.host} ${record.type} ${record.value}`).join('\n');
  return domainApi.exportZoneFile(domainId);
}
export async function importZoneFile(domainId, content, overwrite) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, imported: true, overwrite, contentLength: String(content || '').length, sandbox: true };
  return domainApi.importZoneFile(domainId, content, overwrite);
}
export async function bulkDeleteDnsRecords(domainId, recordIds) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, recordIds, sandbox: true };
  return domainApi.bulkDeleteDnsRecords(domainId, recordIds);
}
export async function updateNameservers(name, provider, hosts) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, name, provider, hosts, sandbox: true };
  return domainApi.updateNameservers(name, provider, hosts);
}
export async function pushDnsToSpaceship(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return { ok: true, domainId, sandbox: true };
  return domainApi.pushDnsToSpaceship(domainId);
}
export async function pullDnsFromSpaceship(domainId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-mine') return sandboxDomainDnsRecords(domainId);
  return domainApi.pullDnsFromSpaceship(domainId);
}
export async function getRegistrarOperation(operationId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy' || sandbox?.service === 'domains-mine') return { id: operationId, status: 'completed', sandbox: true };
  return domainApi.getRegistrarOperation(operationId);
}

export const {
  createProject: createBuilderProject,
  updateProject: updateBuilderProject,
  deleteProject: deleteBuilderProject,
  createBuilderSite,
  getBuilderSite,
  updateBuilderSite,
  deleteBuilderSite,
  listBuilderSites,
  listTemplates,
  getTemplate,
  saveBuilderDraft,
  publishBuilderSite,
  importBuilderSiteFromGithub,
  getBuilderPreviewUrl,
  saveBuilderPage,
  createBuilderPage,
  deleteBuilderPage,
  listBuilderPages,
} = builderApi;

export const {
  listRegisteredDomains,
  registerDomain,
  renewDomain,
  updateDomainNameservers,
  updateDomainAutoRenew,
  saveDomainContact,
  listDomainContacts,
  getDomain,
  listDnsRecords,
  saveDnsRecords,
} = domainApi;

export async function getRegistrarSettings() {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy' || sandbox?.service === 'domains-mine') {
    return { provider: 'sandbox', configured: true, sandbox: true };
  }
  return domainApi.getRegistrarSettings();
}

export async function checkDomainAvailability(domains) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'domains-buy') return sandboxDomainAvailability(domains);
  return domainApi.checkDomainAvailability(domains);
}

export async function disconnectGitHub() {
  const result = await disconnectGitHubBase();
  notifyDataChanged();
  return result;
}
