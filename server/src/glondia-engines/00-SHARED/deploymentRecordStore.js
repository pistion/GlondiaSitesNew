/**
 * deploymentRecordStore.js — 00-SHARED
 *
 * Create, update, and query deployment records in the hosting store.
 * Both engines write records here — single source of truth for all
 * deployment state that flows to the client dashboard.
 *
 * Moved from: server/src/services/deploymentRecordStore.js
 * Original kept as a thin re-export for backward compatibility.
 */

import { makeId, mutateHostingStore, nowIso } from '../../services/hostingStore.js';
import * as hostingRepo from '../../repositories/hosting.repository.js';
import { writeAuditLog } from '../../services/auditLogService.js';

// ── Record creation ──────────────────────────────────────────────────────────

export async function createDeploymentRecord(input = {}) {
  const now = nowIso();
  const deploymentId       = makeId('dep');
  const deploymentSessionId = makeId('session');

  const deployment = {
    deploymentId,
    id: deploymentId,
    deploymentSessionId,
    userId:         input.userId      || null,
    siteId:         input.siteId      || null,
    projectId:      input.projectId   || input.siteId || null,
    renderServiceId: null,
    renderDeployId:  null,
    serviceName:    input.serviceName || 'glondia-site',
    serviceType:    input.serviceType || 'static_site',
    provider:       input.provider || 'render',
    providerServiceId: null,
    providerDeployId: null,
    // Render-specific aliases remain during the compatibility migration.
    providerStatus: 'accepted',
    status:         input.status      || 'preparing',
    buildStatus:    input.buildStatus || 'queued',
    currentStep:    input.currentStep || 'Preparing',
    liveUrl:        null,
    verifiedUrl:    null,
    urlReachable:   false,
    errorMessage:   null,
    repoUrl:        input.repoUrl     || null,
    githubRepo:     input.repoUrl     || null,
    githubBranch:   input.githubBranch || 'main',
    source:         input.source      || 'deployment',
    sourceReference: input.sourceReference || null,
    // Marks this record as platform-deployed — required for payment enforcement
    platformDeployed: true,
    generatedSite:  input.generatedSite || null,
    environmentVariablesMetadata: [],
    diskMetadata:   [],
    domainMetadata: [],
    deploymentLogsReference: deploymentId,
    render:         null,
    createdAt:      now,
    updatedAt:      now,
    lastDeployedAt: null,
    environmentConfiguration: input.environmentConfiguration || {},
  };

  const session = {
    deploymentSessionId,
    deploymentId,
    userId:    input.userId   || null,
    projectId: input.projectId || input.siteId || null,
    status:    'started',
    animationState: 'deploying',
    createdAt: now,
    updatedAt: now,
  };

  const organizationId = input.organizationId
    || (input.userId && input.userId !== 'local-user' ? input.userId : 'personal');
  await hostingRepo.createPendingBundle({
    service: {
      id: deploymentId,
      organizationId,
      createdByUserId: input.userId && input.userId !== 'local-user' ? input.userId : null,
      provider: deployment.provider,
      name: deployment.serviceName,
      slug: `${renderSafeName(input.slug || deployment.serviceName).slice(0, 36)}-${deploymentId.slice(-8)}`,
      serviceType: deployment.serviceType,
      status: deployment.status,
      region: input.region || null,
      plan: input.plan || input.dedicatedTier || null,
      paymentStatus: input.paymentStatus || 'pending',
      metadata: canonicalMetadata(deployment, { deploymentSessionId }),
    },
    access: {
      userId: input.userId && input.userId !== 'local-user' ? input.userId : null,
      organizationId,
      serviceName: deployment.serviceName,
      planId: input.plan || input.dedicatedTier || null,
      accessStatus: 'pending',
      billingStatus: 'pending',
      metadata: { source: deployment.source, deploymentSessionId },
    },
  });
  await writeAuditLog({
    organizationId,
    actorUserId: input.userId && input.userId !== 'local-user' ? input.userId : null,
    action: 'hosting.deployment.created',
    entityType: 'hosting_service',
    entityId: deploymentId,
    result: { provider: deployment.provider, source: deployment.source, status: deployment.status },
  });

  return mutateHostingStore((store) => {
    normalizeDeploymentStore(store);
    store.sessions.unshift(session);
    store.deployments.unshift(deployment);
    store.logs[deploymentId] = [makeLog('Deployment session created.', 'info')];
    return deployment;
  });
}

// ── Record updates ────────────────────────────────────────────────────────────

export async function updateDeploymentRecord(deploymentId, patch = {}) {
  const existing = await hostingRepo.findById(deploymentId);
  if (existing) {
    const providerServiceId = patch.providerServiceId || patch.renderServiceId;
    await hostingRepo.updateProviderState(deploymentId, {
      ...(patch.provider ? { provider: patch.provider } : {}),
      ...(providerServiceId ? { providerServiceId } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.serviceType ? { serviceType: patch.serviceType } : {}),
      ...(patch.liveUrl !== undefined ? { url: patch.liveUrl } : {}),
      ...(patch.region ? { region: patch.region } : {}),
      ...(patch.plan ? { plan: patch.plan } : {}),
      ...(patch.paymentStatus ? { paymentStatus: patch.paymentStatus } : {}),
      ...(patch.checkoutOrderId ? { checkoutOrderId: patch.checkoutOrderId } : {}),
      metadata: canonicalMetadata(existing, patch),
    });
  }
  return mutateHostingStore((store) => {
    normalizeDeploymentStore(store);
    const deployment = store.deployments.find(
      (d) => d.deploymentId === deploymentId || d.id === deploymentId,
    );
    if (!deployment) return null;
    Object.assign(deployment, patch, { updatedAt: nowIso() });
    return deployment;
  });
}

// ── Log helpers ───────────────────────────────────────────────────────────────

export async function addDeploymentLog(deploymentId, message, level = 'info', details = null) {
  const service = await hostingRepo.findById(deploymentId);
  await writeAuditLog({
    organizationId: service?.organizationId || null,
    actorUserId: service?.createdByUserId || null,
    action: `hosting.deployment.${details?.stage || 'log'}`,
    entityType: 'hosting_service',
    entityId: deploymentId,
    status: level === 'error' ? 'error' : 'success',
    result: { level, message, details: details || null },
  });
  return mutateHostingStore((store) => {
    normalizeDeploymentStore(store);
    store.logs[deploymentId] = [
      makeLog(message, level, details),
      ...(store.logs[deploymentId] || []),
    ];
    return store.logs[deploymentId][0];
  });
}

function canonicalMetadata(existing, patch = {}) {
  let current = {};
  try { current = typeof existing?.metadata === 'string' ? JSON.parse(existing.metadata) : existing || {}; } catch { current = {}; }
  return {
    ...current,
    deployment: {
      ...(current.deployment || {}),
      ...patch,
      updatedAt: nowIso(),
    },
  };
}

export function makeLog(message, level = 'info', details = null) {
  return {
    id:        makeId('log'),
    level,
    message,
    details:   details || undefined,
    timestamp: nowIso(),
    createdAt: nowIso(),
  };
}

// ── Name/URL helpers ──────────────────────────────────────────────────────────

export function renderSafeName(value) {
  return String(value || 'glondia-site')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'glondia-site';
}

export function serviceUrl(serviceResponse) {
  return (
    serviceResponse?.service?.serviceDetails?.url ||
    serviceResponse?.serviceDetails?.url ||
    serviceResponse?.service?.url ||
    serviceResponse?.url ||
    null
  );
}

function normalizeDeploymentStore(store) {
  if (!Array.isArray(store.deployments)) store.deployments = [];
  if (!Array.isArray(store.sessions)) store.sessions = [];
  if (!store.logs || typeof store.logs !== 'object' || Array.isArray(store.logs)) store.logs = {};
  if (!store.env || typeof store.env !== 'object' || Array.isArray(store.env)) store.env = {};
  if (!store.disks || typeof store.disks !== 'object' || Array.isArray(store.disks)) store.disks = {};
  if (!store.domains || typeof store.domains !== 'object' || Array.isArray(store.domains)) store.domains = {};
  if (!Array.isArray(store.checkoutOrders)) store.checkoutOrders = [];
  if (!Array.isArray(store.payments)) store.payments = [];
  return store;
}
