/**
 * hostingReadService.js — DB-first customer hosting reads with legacy fallback.
 *
 * Phase 5 of the ownership migration. The customer dashboard must read from our
 * own database (WebHostingService) as the source of truth. During the
 * transition the legacy JSON hostingStore is still consulted, but only as a
 * fallback / detail cache:
 *
 *   1. read WebHostingService rows for the customer (DB-first, authoritative
 *      for ownership + status + payment),
 *   2. throttled Render reconciliation of those rows (reads still succeed if
 *      Render is down — cached DB state is returned),
 *   3. merge legacy hostingStore summaries: matched rows keep the DB's
 *      ownership/status/payment but borrow the store's rich Render operational
 *      detail; store-only rows are included as `source: 'legacy'`,
 *   4. every row is tagged with `source` and `drift` so admin views can flag
 *      DB/JSON disagreement while customers still see all of their own services.
 *
 * No Prisma access here — DB access is delegated to hosting.repository and
 * customer.repository. Legacy reads reuse the existing hostingService list so
 * behaviour is preserved.
 */

import hostingService from './hostingService.js';
import * as hostingRepo from '../repositories/hosting.repository.js';
import { syncOrganizationHosting } from './hostingSyncService.js';
import { listOrganizationIdsForCustomer } from '../repositories/customer.repository.js';

/** Map a WebHostingService row into the customer summary shape. */
export function toDbHostingSummary(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata || '{}'); } catch { /* ignore */ }
  return {
    serviceId: row.providerServiceId || row.id,
    deploymentId: row.id,
    serviceName: row.name,
    serviceType: row.serviceType,
    status: row.status,
    paymentStatus: row.paymentStatus || null,
    checkoutOrderId: row.checkoutOrderId || null,
    billingDueAt: row.billingDueAt || null,
    paidAt: row.paidAt || null,
    liveUrl: row.url || null,
    provider: row.provider,
    renderServiceId: row.providerServiceId || metadata.renderServiceId || null,
    plan: row.plan || null,
    deletedReason: row.deletedReason || null,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    source: 'relational',
    drift: null,
  };
}

/** Stable key for matching a DB row and a legacy summary. */
function keyOf(summary) {
  return summary.deploymentId || summary.serviceId || null;
}

/**
 * Pure merge of DB-first rows and legacy store summaries.
 *
 * DB rows are authoritative for ownership/status/payment. When a legacy summary
 * matches (by deploymentId or renderServiceId) its rich Render operational
 * fields are layered UNDER the DB row (DB wins on conflict) and the merged row
 * is tagged `source: 'relational'`. Legacy-only rows pass through tagged
 * `source: 'legacy'`. DB-only rows are tagged `drift: 'missing_in_legacy'`.
 */
export function mergeHostingSources(dbSummaries = [], legacySummaries = []) {
  const legacyByKey = new Map();
  const legacyByRender = new Map();
  for (const l of legacySummaries) {
    if (l.deploymentId) legacyByKey.set(l.deploymentId, l);
    if (l.renderServiceId) legacyByRender.set(l.renderServiceId, l);
  }

  const merged = [];
  const consumedLegacy = new Set();

  for (const db of dbSummaries) {
    const legacy = legacyByKey.get(db.deploymentId)
      || (db.renderServiceId ? legacyByRender.get(db.renderServiceId) : null)
      || null;
    if (legacy) {
      consumedLegacy.add(keyOf(legacy));
      // Legacy operational detail under the DB's authoritative fields.
      merged.push({
        ...legacy,
        ...db,
        // Preserve legacy Render detail the DB row doesn't carry.
        liveUrl: db.liveUrl || legacy.liveUrl || null,
        source: 'relational',
        drift: null,
      });
    } else {
      merged.push({ ...db, drift: 'missing_in_legacy' });
    }
  }

  // Legacy rows with no DB counterpart — still show to the customer, but flag.
  for (const l of legacySummaries) {
    if (consumedLegacy.has(keyOf(l))) continue;
    merged.push({ ...l, source: 'legacy', drift: 'missing_in_db' });
  }

  return merged;
}

/**
 * Customer-facing hosting list — DB-first with legacy fallback.
 *
 * @param {string} userId
 * @param {{ isAdmin?: boolean }} [options]
 */
export async function listForCustomer(userId, options = {}) {
  const isAdmin = options.isAdmin === true;

  // 1. DB-first rows (authoritative). Resolve org scope so org-owned rows are
  //    included even when createdByUserId is null (e.g. backfilled records).
  const orgIds = await listOrganizationIdsForCustomer(userId).catch(() => []);
  let dbRows = await hostingRepo.listByUserScope(userId, orgIds).catch(() => []);

  // 2. Throttled reconciliation per organization, then re-read if it changed.
  const byOrg = new Map();
  for (const row of dbRows) {
    if (!byOrg.has(row.organizationId)) byOrg.set(row.organizationId, []);
    byOrg.get(row.organizationId).push(row);
  }
  let changed = false;
  for (const [orgId, rows] of byOrg) {
    changed = (await syncOrganizationHosting(orgId, rows)) || changed;
  }
  if (changed) dbRows = await hostingRepo.listByUserScope(userId, orgIds).catch(() => dbRows);

  const dbSummaries = dbRows.map(toDbHostingSummary);

  // 3. Legacy fallback via the existing store-backed list (behaviour preserved).
  const legacySummaries = await hostingService.listHosting(userId, { isAdmin }).catch(() => []);

  return mergeHostingSources(dbSummaries, legacySummaries);
}

export default { listForCustomer, mergeHostingSources, toDbHostingSummary };
