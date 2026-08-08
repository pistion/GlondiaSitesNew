/**
 * hostingSyncService.js — Render provider-state reconciliation for hosting.
 *
 * The hosting analogue of vpsSyncService. Commands change provider state; sync
 * brings provider truth back into the WebHostingService table. Customer reads
 * call these explicitly (throttled) instead of interleaving reconciliation with
 * serialization, and reads still succeed when Render is down (cached DB state).
 *
 * Rules (see the ownership contract in hosting.repository.js):
 *  - persistence goes through hosting.repository (no Prisma here),
 *  - provider access goes through the Render adapter only,
 *  - sync touches ONLY known local rows — Render inventory is never listed and
 *    treated as customer-owned,
 *  - a missing provider service is flagged `provider_missing`, never silently
 *    deleted; only a confirmed destroy may hide a record.
 */

import renderApiService from './renderApiService.js';
import * as hostingRepo from '../repositories/hosting.repository.js';

// Per-organization throttle so bursts of list requests don't hammer Render.
// 0 disables sync entirely.
const SYNC_MIN_INTERVAL_MS = Number(process.env.HOSTING_SYNC_MIN_INTERVAL_MS ?? 15000);
const lastOrgSyncAt = new Map();

// A row is syncable once it carries a real provider service id (not a pending
// placeholder or a failed marker) and has not been destroyed.
function syncable(record) {
  const id = record?.providerServiceId;
  return Boolean(
    id
    && id !== 'FAILED'
    && id !== 'pending'
    && !String(id).includes('_pending')
    && !record.deletedAt
    && record.status !== 'destroyed',
  );
}

function isRenderGone(error) {
  return error?.status === 404 || error?.status === 410;
}

function extractRenderUrl(service) {
  return service?.serviceDetails?.url || service?.url || null;
}

/**
 * Normalize a Render service/deploy snapshot into the canonical hosting status.
 * Suspended wins; otherwise the latest deploy status maps to building/live/error.
 */
function statusFromSnapshot(snapshot) {
  const service = snapshot?.service?.service || snapshot?.service || null;
  const suspended = service?.suspended && service.suspended !== 'not_suspended';
  if (suspended) return 'suspended';

  const deployStatus = String(snapshot?.latestDeploy?.status || '').toLowerCase();
  if (['created', 'queued', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress'].includes(deployStatus)) return 'building';
  if (['live', 'deployed', 'succeeded'].includes(deployStatus)) return 'live';
  if (['failed', 'build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'].includes(deployStatus)) return 'failed';
  return null; // unknown — leave the stored status untouched
}

/**
 * Compute the field patch to apply from a live Render snapshot. Pure — exported
 * for unit testing. Only returns keys that actually changed.
 */
export function diffRenderState(record, snapshot) {
  const fields = {};
  const service = snapshot?.service?.service || snapshot?.service || null;

  const nextStatus = statusFromSnapshot(snapshot);
  if (nextStatus && nextStatus !== record.status) fields.status = nextStatus;

  const url = extractRenderUrl(service);
  if (url && url !== record.url) fields.url = url;

  return fields;
}

/**
 * One controlled refresh of a single hosting record from Render.
 * Returns the (possibly updated) record; never throws — reads must still
 * succeed on provider outage, returning cached DB state.
 */
export async function syncHostingService(record) {
  if (!renderApiService.configured() || !syncable(record)) return record;
  try {
    const snapshot = await renderApiService.getServiceSnapshot(record.providerServiceId);
    const fields = diffRenderState(record, snapshot);
    if (Object.keys(fields).length === 0) return record;
    return await hostingRepo.updateProviderState(record.id, fields);
  } catch (err) {
    if (isRenderGone(err) && record.status !== 'provider_missing') {
      // Service gone at Render with no confirmed destroy → flag it, never delete.
      return hostingRepo.markProviderMissing(record.id).catch(() => record);
    }
    console.warn(`[hosting:sync] Refresh failed for ${record.id}:`, err.message);
    return record;
  }
}

/**
 * Sync every syncable hosting row of one organization against Render.
 * Throttled per organization. Never throws.
 *
 * @returns {boolean} true when a sync actually ran and changed at least one row.
 */
export async function syncOrganizationHosting(organizationId, records) {
  if (!renderApiService.configured()) return false;
  const candidates = (records ?? []).filter(syncable);
  if (candidates.length === 0) return false;

  const last = lastOrgSyncAt.get(organizationId) ?? 0;
  if (SYNC_MIN_INTERVAL_MS <= 0 || Date.now() - last < SYNC_MIN_INTERVAL_MS) return false;
  lastOrgSyncAt.set(organizationId, Date.now());

  try {
    const results = await Promise.all(candidates.map(async (record) => {
      const before = record.status;
      const after = await syncHostingService(record);
      return after?.status !== before || after?.url !== record.url;
    }));
    return results.some(Boolean);
  } catch (err) {
    console.warn('[hosting:sync] Organization sync failed, keeping cached data:', err.message);
    return false;
  }
}

// Test seam: reset the throttle between test cases.
export function __resetThrottle() {
  lastOrgSyncAt.clear();
}
