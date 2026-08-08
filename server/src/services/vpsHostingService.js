/**
 * vpsHostingService.js — VPS Services business logic.
 *
 * Layering:
 *   controller → this service → repositories (Prisma) / provider adapter / billing
 *
 * This file contains NO direct database access. It sequences validation,
 * pricing, provider calls, repository transactions, billing updates, audit
 * records, notifications and compensation. Provider and PayPal calls always
 * run OUTSIDE database transactions.
 *
 * Creation flow (both direct deploy and paid checkout):
 *   1. one short transaction: pending VpsService + pending ServiceAccess +
 *      pending action record,
 *   2. provider call (outside any transaction),
 *   3. success → one short transaction: provider state + access activation +
 *      action success,
 *   4. provider failure → failed state stays visible (review state for paid
 *      flows) and admins are alerted,
 *   5. provider success + DB failure → provider cleanup, compensation result
 *      recorded, orphan alert if cleanup fails.
 */

import * as vultr from './vultrApiService.js';
import { calcPricing } from './vpsPricingService.js';
import { captureOrder as paypalCapture, updateOrderStatus } from './paypalBillingService.js';
import { createAdminNotification, safeNotify } from './notificationService.js';
import { listCachedOperatingSystems, listCachedPlans } from './vpsCatalogService.js';
import { syncVpsInstance, syncOrganizationVps } from './vpsSyncService.js';
import { toCustomerVpsDto, toCredentialsDto, isDummyRecord } from './vpsDto.js';
import * as vpsRepo from '../repositories/vps.repository.js';
import * as actionRepo from '../repositories/vpsAction.repository.js';
import {
  recordResource,
  listOwnedResources,
  listOwnedServiceResources,
  findByProviderResourceId,
  requireOwnedResource,
  markResourceDeleted,
} from '../repositories/providerResource.repository.js';
import { randomBytes } from 'node:crypto';

const DIRECT_DEPLOY_ENABLED =
  String(process.env.VPS_DIRECT_DEPLOY_ENABLED ?? 'false').toLowerCase() === 'true';

function makeRootPassword() {
  return `Glo-${randomBytes(9).toString('base64url')}`;
}

function actorUserId(actor) {
  return actor.userId === 'local-user' ? null : actor.userId;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function resolveOsName(osId) {
  try {
    const osList = await listCachedOperatingSystems();
    return osList.find((o) => o.id === osId)?.name ?? null;
  } catch { return null; }
}

async function registerSshKey(label, dto, actor) {
  if (dto.sshPublicKey) {
    const keyName = dto.sshKeyName || `glondia-${label}`;
    try {
      const newKey = await vultr.createSshKey(keyName, dto.sshPublicKey);
      await recordResource({
        organizationId: actor.organizationId,
        userId: actorUserId(actor),
        resourceType: 'ssh_key',
        providerResourceId: newKey.id,
        name: keyName,
      }).catch((e) => console.warn('[vps] Failed to record SSH key ownership:', e.message));
      return newKey.id;
    } catch (e) {
      console.warn('[vps] SSH key creation failed, continuing without it:', e.message);
    }
    return undefined;
  }
  if (dto.sshKeyId) {
    // Reusing an existing key: a key mapped to another org is rejected; an
    // unmapped (legacy) key is claimed for this org on first use.
    const mapped = await findByProviderResourceId('ssh_key', dto.sshKeyId);
    if (mapped && !mapped.deletedAt && mapped.organizationId !== actor.organizationId) {
      throw Object.assign(new Error('SSH key not found.'), { status: 404, code: 'VPS_RESOURCE_OWNERSHIP_MISMATCH' });
    }
    if (!mapped) {
      await recordResource({
        organizationId: actor.organizationId,
        userId: actorUserId(actor),
        resourceType: 'ssh_key',
        providerResourceId: dto.sshKeyId,
        metadata: { claimedVia: 'legacy_use' },
      }).catch((e) => console.warn('[vps] Failed to record SSH key ownership:', e.message));
    }
    return dto.sshKeyId;
  }
  return undefined;
}

function buildVultrPayload(dto, resolvedSshKeyId, organizationId) {
  return {
    region:   dto.region,
    plan:     dto.plan,
    os_id:    dto.osId,
    label:    dto.label,
    hostname: dto.hostname ?? dto.label,
    tags:     [`org:${organizationId}`],
    ...(resolvedSshKeyId  ? { sshkey_id:      [resolvedSshKeyId] }                          : {}),
    ...(dto.userData       ? { user_data:       Buffer.from(dto.userData).toString('base64') } : {}),
    ...(dto.enableIpv6     ? { enable_ipv6:     true }                                         : {}),
    ...(dto.backups        ? { backups:          'enabled' }                                    : {}),
    ...(dto.ddosProtection ? { ddos_protection:  true }                                         : {}),
  };
}

function providerFieldsFromInstance(instance) {
  return {
    providerInstanceId: instance.id,
    status: instance.status ?? 'pending',
    mainIp: instance.main_ip ?? null,
    vcpuCount: instance.vcpu_count ?? null,
    ramMb: instance.ram ?? null,
    diskGb: instance.disk ?? null,
  };
}

// ─── Catalog / settings ───────────────────────────────────────────────────────

export function getSettings() {
  return {
    vultrConfigured:     vultr.isConfigured(),
    testMode:            vultr.isTestMode() && !vultr.isConfigured(),
    paypalConfigured:    Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    // Deprecated: only kept while the deploy form computes plan prices
    // client-side. New consumers must use POST /quote.
    markupPercent:       Number(process.env.PLATFORM_MARKUP_PERCENT ?? 30),
    sandbox:             String(process.env.PAYPAL_SANDBOX ?? 'true').toLowerCase() !== 'false',
    directDeployEnabled: DIRECT_DEPLOY_ENABLED,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listServices(organizationId) {
  const services = await vpsRepo.listByOrganization(organizationId);
  // Controlled, throttled refresh — reads still succeed on provider outage.
  return services.map(toCustomerVpsDto);
}

export async function getService(id, organizationId) {
  const record = await vpsRepo.requireOwnedById(id, organizationId);
  return toCustomerVpsDto(record);
}

/**
 * Protected credentials reveal — behind auth + ownership + active access.
 * Every reveal is recorded in the action log.
 */
export async function getServiceCredentials(id, actor) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'credentials_reveal',
  });
  return toCredentialsDto(record);
}

export async function updateServiceSettings(id, actor, body = {}) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  const label = body.label != null ? String(body.label).trim().slice(0, 64) : undefined;
  const hostname = body.hostname != null ? String(body.hostname).trim().slice(0, 255) : undefined;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 16)
    : undefined;

  if (label === '' || hostname === '') {
    throw Object.assign(new Error('Label and hostname cannot be empty.'), { status: 400 });
  }

  const providerPatch = {};
  if (label !== undefined) providerPatch.label = label;
  if (hostname !== undefined) providerPatch.hostname = hostname;
  if (tags !== undefined) providerPatch.tags = tags;

  if (Object.keys(providerPatch).length > 0 && !isDummyRecord(record)) {
    await vultr.updateInstanceSettings(record.providerInstanceId, providerPatch);
  }

  let next = record;
  if (label !== undefined || hostname !== undefined) {
    next = await vpsRepo.updateProviderState(record.id, {
      ...(label !== undefined ? { label } : {}),
      ...(hostname !== undefined ? { hostname } : {}),
    });
  }
  if (tags !== undefined) {
    next = await vpsRepo.mergeMetadata(record.id, { tags });
  }

  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'settings_update',
    request: {
      ...(label !== undefined ? { label } : {}),
      ...(hostname !== undefined ? { hostname } : {}),
      ...(tags !== undefined ? { tags } : {}),
    },
  });
  return toCustomerVpsDto(next);
}

// ─── Creation engine ──────────────────────────────────────────────────────────

/**
 * Shared provisioning engine (steps 1–5 in the header). `billing` carries the
 * flow-specific service fields, access states and failure hooks.
 */
async function provisionInstance(dto, actor, billing) {
  const testMode = vultr.isTestMode() && !vultr.isConfigured();

  const plans = await listCachedPlans(undefined, { region: dto.region });
  const plan  = plans.find((p) => p.id === dto.plan);
  if (!plan) {
    throw Object.assign(
      new Error(`Plan "${dto.plan}" is not available in region "${dto.region}". Choose one of the available plans for this location.`),
      { status: 400 },
    );
  }

  const { baseCents, mkupCents, totalCents, markup } = calcPricing(plan.monthly_cost);
  const osName = await resolveOsName(dto.osId);

  // Step 1 — record intent before any provider call (one short transaction).
  const { record, actionRecord } = await vpsRepo.createPendingBundle({
    service: {
      clientProjectId: dto.clientProjectId || null,
      organizationId: actor.organizationId,
      createdByUserId: actorUserId(actor),
      label: dto.label,
      hostname: dto.hostname ?? dto.label,
      region: dto.region,
      plan: dto.plan,
      osId: dto.osId,
      osName,
      monthlyCostCents: baseCents,
      markupPercent: markup,
      markupAmountCents: mkupCents,
      totalPriceCents: totalCents,
      currency: 'USD',
      ...billing.serviceFields,
    },
    access: {
      clientProjectId: dto.clientProjectId || null,
      userId: actorUserId(actor),
      organizationId: actor.organizationId,
      adminStatus: 'allowed',
      ...billing.accessFields,
    },
    action: {
      actorUserId: actorUserId(actor),
      action: 'create',
      // Never persist key material or cloud-init contents in the action log.
      request: { plan: dto.plan, region: dto.region, osId: dto.osId, label: dto.label },
    },
  });

  // Step 2 — provider calls, outside any transaction.
  let instance;
  let sshKeyId = null;
  try {
    sshKeyId = await registerSshKey(dto.label, dto, actor);
    instance = await vultr.createInstance(buildVultrPayload(dto, sshKeyId, actor.organizationId));
  } catch (err) {
    // Step 4 — provider refused: keep the record visible as failed.
    console.error('[vps] Provider createInstance failed:', err.message);
    await vpsRepo.markProvisionFailedBundle({
      serviceId: record.id,
      actionId: actionRecord.id,
      error: err.message,
      access: billing.failedAccessState,
    }).catch((e) => console.error('[vps] Failed to persist provision failure:', e.message));
    if (billing.onProviderFailure) await billing.onProviderFailure(err, record);
    throw billing.providerFailureError(err);
  }

  // Step 3 — persist provider result + activate access (one short transaction).
  try {
    const activated = await vpsRepo.activateProvisionedBundle({
      serviceId: record.id,
      actionId: actionRecord.id,
      providerFields: providerFieldsFromInstance(instance),
      metadata: {
        ...billing.metadata(instance, testMode),
        connectionUsername: 'root',
        connectionPassword: instance.default_password || (testMode ? makeRootPassword() : null),
        backupsEnabled: Boolean(dto.backups),
        ddosProtectionEnabled: Boolean(dto.ddosProtection),
        ipv6Enabled: Boolean(dto.enableIpv6),
        userDataPresent: Boolean(dto.userData),
        tags: [`org:${actor.organizationId}`],
        sshKeyId,
      },
      actionResponse: { providerInstanceId: instance.id },
    });
    console.log(`[vps] Provisioned ${record.id} — Vultr ${instance.id} in ${dto.region}`);
    return toCustomerVpsDto(activated);
  } catch (dbErr) {
    // Step 5 — provider succeeded but persistence failed: compensate.
    console.error('[vps] DB save failed after provider provision:', dbErr.message);
    if (billing.onDbFailure) await billing.onDbFailure(dbErr, record, instance);
    // Preserve the provider id even if the activation transaction failed.
    await vpsRepo.updateProviderState(record.id, { providerInstanceId: instance.id, status: 'error' }).catch(() => {});
    let compensated = false;
    let cleanupError = null;
    try {
      await vultr.deleteInstance(instance.id);
      compensated = true;
      console.warn(`[vps] Compensated — deleted Vultr instance ${instance.id}`);
    } catch (cleanErr) {
      cleanupError = cleanErr.message;
      console.error(`[vps] Compensation failed — Vultr ${instance.id} may be orphaned:`, cleanErr.message);
      safeNotify('vps-orphan-instance', () => createAdminNotification({
        type: 'error',
        title: 'Orphaned Vultr instance',
        message: `DB save failed after provisioning and cleanup also failed. Vultr instance ${instance.id} (service ${record.id}, org ${actor.organizationId}) may be live and unbilled — manual cleanup required.`,
        entityType: 'vps_service',
        entityId: record.id,
      }));
    }
    await actionRepo.recordCompensationResult(actionRecord.id, {
      compensated,
      providerInstanceId: instance.id,
      error: cleanupError,
    });
    throw Object.assign(new Error('Server created but record save failed. Contact support.'), { status: 500 });
  }
}

// ─── Direct deploy (usage-billed) ─────────────────────────────────────────────

export async function createDirect(dto, actor) {
  const testMode = vultr.isTestMode() && !vultr.isConfigured();
  if (!DIRECT_DEPLOY_ENABLED && !testMode) {
    throw Object.assign(new Error('Direct deploy is disabled. Use PayPal checkout.'), { status: 403 });
  }
  if (!dto.plan || !dto.region || dto.osId == null || !dto.label) {
    throw Object.assign(new Error('plan, region, osId and label are required.'), { status: 400 });
  }

  return provisionInstance(dto, actor, {
    serviceFields: { paymentStatus: testMode ? 'free' : 'active' },
    accessFields: {
      accessStatus: 'pending',
      billingStatus: testMode ? 'free' : 'paid',
      metadata: { createdVia: testMode ? 'vps_test_mode' : 'direct_deploy' },
    },
    metadata: (instance, isTest) => ({
      billingModel: isTest ? 'test' : 'usage',
      vultrId: instance.id,
      testMode: isTest,
    }),
    // Unpaid flow: a provider failure simply cancels the pending access.
    failedAccessState: { accessStatus: 'cancelled' },
    providerFailureError: (err) =>
      Object.assign(new Error(`Server provisioning failed: ${err.message}`), { status: 502 }),
  });
}

// ─── PayPal capture + provision ───────────────────────────────────────────────

export async function captureAndProvision(orderId, actor) {
  // Capture payment and verify; loads provisionDetails from server-side storage.
  const { checkoutOrder, captureRecord, provisionDetails: dto } =
    await paypalCapture(actor.organizationId, orderId);

  if (!dto) throw Object.assign(new Error('Order provision details missing. Contact support.'), { status: 500 });

  // Idempotency: capture can legitimately be retried, but one order must never
  // provision two servers.
  const existing = await vpsRepo.findByCheckoutOrderId(checkoutOrder.id);
  if (existing) {
    if (existing.providerInstanceId !== 'FAILED' && existing.status !== 'error') {
      return toCustomerVpsDto(existing);
    }
    throw Object.assign(
      new Error(`Provisioning for this order previously failed and is under review. Contact support with order ID: ${orderId}`),
      { status: 409 },
    );
  }

  return provisionInstance(dto, actor, {
    serviceFields: {
      checkoutOrderId: checkoutOrder.id,
      paypalOrderId: orderId,
      paypalCaptureId: captureRecord.id,
      paymentStatus: 'completed',
    },
    accessFields: {
      accessStatus: 'pending',
      billingStatus: 'paid',
      checkoutOrderId: checkoutOrder.id,
      metadata: { createdVia: 'paypal_checkout' },
    },
    metadata: (instance) => ({ vultrId: instance.id }),
    // Paid flow: money was captured, so a provider failure enters a
    // recoverable review state instead of being cancelled or hidden.
    failedAccessState: { adminStatus: 'review_required', billingStatus: 'paid' },
    onProviderFailure: async (err, record) => {
      await updateOrderStatus(checkoutOrder.id, 'provision_failed');
      safeNotify('vps-paid-provision-failed', () => createAdminNotification({
        type: 'error',
        title: 'VPS payment captured but provisioning failed',
        message: `PayPal order ${orderId} was captured but provisioning failed for "${dto.label}": ${err.message}. Needs refund or manual provisioning.`,
        entityType: 'vps_service',
        entityId: record.id,
      }));
    },
    onDbFailure: async () => {
      await updateOrderStatus(checkoutOrder.id, 'db_error');
    },
    providerFailureError: () =>
      Object.assign(
        new Error(`Payment was captured but server provisioning failed. Contact support with order ID: ${orderId}`),
        { status: 409 },
      ),
  });
}

// ─── Lifecycle actions ────────────────────────────────────────────────────────

async function lifecycleAction(id, actor, { action, providerCall, nextStatus, dummyStatus }) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  if (isDummyRecord(record)) {
    if (dummyStatus) await vpsRepo.setStatus(record.id, dummyStatus);
    await actionRepo.recordCompletedAction({
      vpsServiceId: record.id,
      organizationId: actor.organizationId,
      actorUserId: actorUserId(actor),
      action,
      request: { testMode: true },
    });
    return;
  }
  await providerCall(record.providerInstanceId);
  if (nextStatus) await vpsRepo.setStatus(record.id, nextStatus);
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action,
  });
}

export async function startService(id, actor) {
  return lifecycleAction(id, actor, {
    action: 'start',
    providerCall: (pid) => vultr.startInstance(pid),
    nextStatus: 'running',
    dummyStatus: 'running',
  });
}

export async function haltService(id, actor) {
  return lifecycleAction(id, actor, {
    action: 'halt',
    providerCall: (pid) => vultr.haltInstance(pid),
    nextStatus: 'stopped',
    dummyStatus: 'stopped',
  });
}

export async function rebootService(id, actor) {
  return lifecycleAction(id, actor, {
    action: 'reboot',
    providerCall: (pid) => vultr.rebootInstance(pid),
    nextStatus: null,       // power state unchanged after reboot completes
    dummyStatus: 'running',
  });
}

// ─── Destroy ──────────────────────────────────────────────────────────────────

export async function destroyService(id, actor) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  const action = await actionRepo.createAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'destroy',
  });

  const hasProviderInstance = record.providerInstanceId
    && record.providerInstanceId !== 'FAILED'
    && record.providerInstanceId !== 'pending'
    && !isDummyRecord(record);

  if (hasProviderInstance) {
    await vpsRepo.markDestroyPending(record.id);
    try {
      await vultr.deleteInstance(record.providerInstanceId);
    } catch (err) {
      if (err.status !== 404) {
        // Provider deletion failed → the server may still be live and billing.
        // Keep the record visible as destroy_failed instead of hiding it.
        await vpsRepo.markDestroyFailed(record.id).catch(() => {});
        await actionRepo.markActionFailed(action.id, err.message).catch(() => {});
        safeNotify('vps-destroy-failed', () => createAdminNotification({
          type: 'error',
          title: 'VPS destroy failed',
          message: `Provider deletion failed for VPS ${record.label} (${record.id}, Vultr ${record.providerInstanceId}): ${err.message}. The instance may still be live and billing.`,
          entityType: 'vps_service',
          entityId: record.id,
        }));
        throw Object.assign(
          new Error('The provider could not delete this server yet. It remains visible — please retry shortly.'),
          { status: 502, code: 'VPS_DESTROY_FAILED' },
        );
      }
      // 404 → already gone at the provider; safe to finalize.
    }
  }

  // Deletion confirmed (or nothing live at the provider): soft-delete, close
  // access + billing and complete the action in one transaction.
  await vpsRepo.finalizeDestroyBundle({ serviceId: record.id, actionId: action.id });
  console.log(`[vps] Destroyed service ${record.id} (Vultr: ${record.providerInstanceId})`);
}

// ─── SSH keys ─────────────────────────────────────────────────────────────────

export async function listSshKeys(organizationId) {
  const owned = await listOwnedResources(organizationId, 'ssh_key');
  return owned.map((resource) => ({
    id: resource.providerResourceId,
    name: resource.name || resource.providerResourceId,
    status: resource.status,
    date_created: resource.createdAt,
  }));
}

export async function createSshKey(actor, body = {}) {
  const name = String(body.name || '').trim();
  const publicKey = String(body.publicKey || body.ssh_key || '').trim();
  if (!name || !publicKey) {
    throw Object.assign(new Error('name and publicKey are required.'), { status: 400 });
  }
  const key = await vultr.createSshKey(name, publicKey);
  await recordResource({
    organizationId: actor.organizationId,
    userId: actorUserId(actor),
    resourceType: 'ssh_key',
    providerResourceId: key.id,
    name,
  });
  return key;
}

export async function deleteSshKey(keyId, actor) {
  const resource = await requireOwnedResource(actor.organizationId, 'ssh_key', keyId);
  try {
    await vultr.deleteSshKey(keyId);
  } catch (err) {
    if (err.status !== 404) throw err; // already gone at the provider → finalize locally
  }
  await markResourceDeleted(resource.id);
}

// ─── Bandwidth ────────────────────────────────────────────────────────────────

export async function getBandwidth(id, organizationId) {
  const record = await vpsRepo.requireOwnedById(id, organizationId);
  let metadata = {};
  try { metadata = JSON.parse(record.metadata || '{}'); } catch { /* use empty snapshot */ }
  const usedGb = Number(metadata.bandwidthUsedGb || 0);
  const includedGb = Number(metadata.bandwidthIncludedGb || 0);
  return {
    usedGb,
    includedGb,
    percentUsed: includedGb > 0 ? Math.min(100, (usedGb / includedGb) * 100) : 0,
    updatedAt: metadata.bandwidthUpdatedAt || null,
  };
}

function bytesToGb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024 / 1024) * 100) / 100;
}

function summarizeBandwidth(raw) {
  let bytes = 0;
  for (const value of Object.values(raw || {})) {
    if (!value || typeof value !== 'object') continue;
    bytes += Number(value.incoming_bytes || value.in_bytes || value.rx_bytes || 0);
    bytes += Number(value.outgoing_bytes || value.out_bytes || value.tx_bytes || 0);
  }
  return { raw, usedGb: bytesToGb(bytes), totalBytes: bytes };
}

const SUMMARY_REFRESH_MIN_INTERVAL_MS = Number(process.env.VPS_SUMMARY_REFRESH_MIN_INTERVAL_MS ?? 30000);
const lastSummaryRefreshAt = new Map();

function shouldRefreshSummary(id) {
  const last = lastSummaryRefreshAt.get(id) ?? 0;
  if (SUMMARY_REFRESH_MIN_INTERVAL_MS > 0 && Date.now() - last < SUMMARY_REFRESH_MIN_INTERVAL_MS) return false;
  lastSummaryRefreshAt.set(id, Date.now());
  return true;
}

export async function refreshServiceSummarySnapshot(record) {
  if (!shouldRefreshSummary(record.id)) return;

  try {
    record = await syncVpsInstance(record);

    const snapshot = {};
    const isDummy = isDummyRecord(record);
    const canCallProvider = vultr.isConfigured() || isDummy;

    if (canCallProvider && record.providerInstanceId && record.providerInstanceId !== 'FAILED' && record.providerInstanceId !== 'pending') {
      const [bandwidthResult, backupResult] = await Promise.allSettled([
        vultr.getInstanceBandwidth(record.providerInstanceId),
        vultr.getBackupSchedule(record.providerInstanceId),
      ]);

      if (bandwidthResult.status === 'fulfilled') {
        const bandwidth = summarizeBandwidth(bandwidthResult.value);
        snapshot.bandwidthUsedGb = bandwidth.usedGb;
        snapshot.bandwidthTotalBytes = bandwidth.totalBytes;
        snapshot.bandwidthUpdatedAt = new Date().toISOString();
      }

      if (backupResult.status === 'fulfilled') {
        const schedule = backupResult.value || {};
        snapshot.backupSchedule = schedule;
        snapshot.backupsEnabled = Boolean(schedule.enabled ?? schedule.type ?? schedule.hour);
      }
    }

    if (Object.keys(snapshot).length > 0) {
      await vpsRepo.mergeMetadata(record.id, {
        ...snapshot,
        providerSyncedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(`[vps:summary] Background refresh failed for ${record.id}:`, err.message);
  }
}

export function startVpsServiceSyncScheduler() {
  const intervalMs = Math.max(60_000, Number(process.env.VPS_SERVICE_SYNC_INTERVAL_MS || 5 * 60 * 1000));
  const run = async () => {
    if (!vultr.isConfigured()) return;
    const services = (await vpsRepo.listAllForAdmin()).filter((service) => !service.deletedAt);
    const byOrganization = new Map();
    for (const service of services) {
      const rows = byOrganization.get(service.organizationId) || [];
      rows.push(service);
      byOrganization.set(service.organizationId, rows);
    }
    for (const [organizationId, rows] of byOrganization) {
      await syncOrganizationVps(organizationId, rows);
    }
    await Promise.allSettled(services.map(refreshServiceSummarySnapshot));
  };
  const initial = setTimeout(() => run().catch((error) => console.warn('[vps:sync] Initial backend sync failed:', error.message)), 2_000);
  initial.unref?.();
  const timer = setInterval(() => run().catch((error) => console.warn('[vps:sync] Scheduled backend sync failed:', error.message)), intervalMs);
  timer.unref?.();
  return {
    close() {
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}

/**
 * Customer-safe provider summary used by the VPS detail toolbar and overview.
 * Provider data is persisted into the service metadata as a cached snapshot so
 * the UI still has sensible values when a later provider refresh fails.
 */
export async function getServiceSummary(id, actor) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);

  return {
    service: toCustomerVpsDto(record),
    toolbar: {
      canOpenConsole: false,
      consoleMessage: 'Console launch is not wired to the provider yet.',
      canPowerOn: ['stopped', 'halted'].includes(record.status),
      canPowerOff: ['active', 'running'].includes(record.status),
      canReboot: !['pending', 'provisioning', 'destroyed', 'destroy_pending'].includes(record.status),
      canDestroy: !['destroyed', 'destroy_pending'].includes(record.status),
    },
  };
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export async function listSnapshots(organizationId) {
  const owned = await listOwnedResources(organizationId, 'snapshot');
  return owned.map((resource) => ({
    id: resource.providerResourceId,
    description: resource.name || 'Snapshot',
    status: resource.status,
    date_created: resource.createdAt,
  }));
}

export async function listServiceSnapshots(id, actor) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  const owned = await listOwnedServiceResources(actor.organizationId, record.id, 'snapshot');
  return owned.map((resource) => ({
    id: resource.providerResourceId,
    description: resource.name || 'Snapshot',
    status: resource.status,
    date_created: resource.createdAt,
  }));
}

export async function createSnapshot(id, actor, description) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  const snapshot = await vultr.createSnapshot(record.providerInstanceId, description || '');
  if (snapshot?.id) {
    await recordResource({
      organizationId: actor.organizationId,
      userId: actorUserId(actor),
      serviceId: record.id,
      resourceType: 'snapshot',
      providerResourceId: snapshot.id,
      name: description || null,
    }).catch((e) => console.warn('[vps] Failed to record snapshot ownership:', e.message));
  }
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'snapshot_create',
    request: { description: description || '' },
  });
  return snapshot;
}

export async function deleteSnapshot(snapshotId, actor) {
  const resource = await requireOwnedResource(actor.organizationId, 'snapshot', snapshotId);
  try {
    await vultr.deleteSnapshot(snapshotId);
  } catch (err) {
    if (err.status !== 404) throw err; // already gone at the provider → finalize locally
  }
  await markResourceDeleted(resource.id);
}

export async function restoreService(id, actor, snapshotId) {
  if (!snapshotId) throw Object.assign(new Error('snapshotId is required.'), { status: 400 });
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  await requireOwnedResource(actor.organizationId, 'snapshot', snapshotId);
  await vultr.restoreInstance(record.providerInstanceId, snapshotId);
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'snapshot_restore',
    request: { snapshotId },
  });
}

// ─── Backup schedule ──────────────────────────────────────────────────────────

export async function getBackupSchedule(id, organizationId) {
  const record = await vpsRepo.requireOwnedById(id, organizationId);
  let metadata = {};
  try { metadata = JSON.parse(record.metadata || '{}'); } catch { /* use empty snapshot */ }
  return metadata.backupSchedule || { enabled: Boolean(metadata.backupsEnabled) };
}

export async function setBackupSchedule(id, organizationId, body) {
  const record = await vpsRepo.requireOwnedById(id, organizationId);
  const schedule = await vultr.setBackupSchedule(record.providerInstanceId, body || {});
  await vpsRepo.mergeMetadata(record.id, {
    backupSchedule: schedule,
    backupsEnabled: Boolean(schedule?.enabled ?? schedule?.type ?? schedule?.hour),
  });
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId,
    action: 'backup_schedule_update',
    request: body || {},
    response: schedule || {},
  });
  return schedule;
}

// ─── Resize / reinstall ───────────────────────────────────────────────────────

export async function resizeService(id, actor, plan) {
  if (!plan) throw Object.assign(new Error('plan is required.'), { status: 400 });
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);

  // Validate the target plan and price the change BEFORE touching the provider
  // so a resized server never keeps its old plan's price.
  const plans = await listCachedPlans(undefined, { region: record.region });
  const targetPlan = plans.find((p) => p.id === plan);
  if (!targetPlan) {
    throw Object.assign(
      new Error(`Plan "${plan}" is not available in region "${record.region}". Choose an available plan for this server location.`),
      { status: 400 },
    );
  }
  const { baseCents, mkupCents, totalCents, markup } = calcPricing(targetPlan.monthly_cost);

  await vultr.resizeInstance(record.providerInstanceId, plan);
  await vpsRepo.updatePlanAndPrice(record.id, {
    plan,
    monthlyCostCents: baseCents,
    markupPercent: markup,
    markupAmountCents: mkupCents,
    totalPriceCents: totalCents,
    vcpuCount: targetPlan.vcpu_count ?? record.vcpuCount,
    ramMb: targetPlan.ram ?? record.ramMb,
    diskGb: targetPlan.disk ?? record.diskGb,
  });
  // Price snapshot: the action log keeps the old→new price transition.
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'resize',
    request: {
      plan,
      previousPlan: record.plan,
      previousTotalPriceCents: record.totalPriceCents,
      newTotalPriceCents: totalCents,
    },
  });
}

export async function reinstallService(id, actor, body) {
  const record = await vpsRepo.requireOwnedById(id, actor.organizationId);
  await vultr.reinstallInstance(record.providerInstanceId, body?.osId);
  if (body?.osId) {
    // Refresh the display name alongside the id so the UI shows the new OS.
    const osName = await resolveOsName(body.osId);
    await vpsRepo.updateOperatingSystem(record.id, { osId: body.osId, osName });
  }
  await actionRepo.recordCompletedAction({
    vpsServiceId: record.id,
    organizationId: actor.organizationId,
    actorUserId: actorUserId(actor),
    action: 'reinstall',
    request: { osId: body?.osId ?? null },
  });
}
