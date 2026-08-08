/**
 * hosting.repository.js
 *
 * Canonical database gateway for WebHostingService — the Render-backed hosting
 * record. This is the hosting analogue of vps.repository.js: all Prisma access
 * for the hosting feature belongs here, and the service layer sequences
 * provider/billing calls around these short, local transactions.
 *
 * ── Canonical service ownership contract (shared with VPS) ───────────────────
 * Client/User → ServiceAccess → local service record → provider adapter →
 * provider response → local DB update → dashboard reads local DB.
 *
 * The DATABASE is the source of truth for the dashboard; provider APIs (Render)
 * are sources of RECONCILIATION only. A missing provider resource marks the
 * local row `provider_missing` — it is never deleted. Local history is
 * preserved on destroy (soft delete), never purged.
 *
 * Canonical lifecycle (status column):
 *   pending          local intent recorded before the provider call
 *   provisioning     provider accepted the work / build queued
 *   building         provider is building
 *   live             provider reports a usable state
 *   failed / error   provider failed, or hand-off after payment failed
 *   provider_missing provider no longer has the resource, no confirmed destroy
 *   destroy_pending  delete requested, provider delete in progress
 *   destroyed        provider delete confirmed, local history preserved
 *   review_required  paid / customer-impacting failure needing admin action
 *
 * Stable identity: hosting's public route identifier is `deploymentId`. When a
 * caller supplies an explicit `id`, the WebHostingService primary key and the
 * ServiceAccess.serviceId are both pinned to it, so the route ID, the DB row,
 * and the access row line up (matching the legacy hostingStore deploymentId).
 *
 * Transactions here are short and local; Render and PayPal calls always happen
 * OUTSIDE these bundles (the service sequences that).
 */

import { prisma, withTransaction } from '../services/db.js';
import {
  upsertAccess,
  updateByService as updateAccessByService,
} from './serviceAccess.repository.js';

const HOSTING = 'hosting';

function json(value) {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

function slugify(value) {
  return String(value || 'hosting')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'hosting';
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function findById(id) {
  return prisma.webHostingService.findUnique({ where: { id } });
}

/** Owned, non-deleted record or null. */
export async function findOwnedHostingService(id, organizationId) {
  return prisma.webHostingService.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

/** Owned, non-deleted record or a 404 domain error. */
export async function requireOwnedHostingService(id, organizationId) {
  const record = await findOwnedHostingService(id, organizationId);
  if (!record) throw Object.assign(new Error('Hosting service not found.'), { status: 404 });
  return record;
}

export async function listByOrganization(organizationId) {
  return prisma.webHostingService.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Every non-deleted hosting row owned by a user or one of their orgs. */
export async function listByUserScope(userId, organizationIds = []) {
  const orgs = [...new Set((organizationIds ?? []).filter(Boolean))];
  const or = [];
  if (userId) or.push({ createdByUserId: userId });
  if (orgs.length) or.push({ organizationId: { in: orgs } });
  if (!or.length) return [];
  return prisma.webHostingService.findMany({
    where: { deletedAt: null, OR: or },
    orderBy: { createdAt: 'desc' },
  });
}

/** Admin listing: every hosting row, including failed/destroyed, for audit. */
export async function listAllForAdmin() {
  return prisma.webHostingService.findMany({ orderBy: { createdAt: 'desc' } });
}

/** Records by id (including soft-deleted), for admin resolvers. */
export async function findManyByIds(ids) {
  if (!ids?.length) return [];
  return prisma.webHostingService.findMany({ where: { id: { in: ids } } });
}

/** First non-deleted hosting row mapped to a provider service id, or null. */
export async function findByProviderServiceId(providerServiceId) {
  if (!providerServiceId) return null;
  return prisma.webHostingService.findFirst({
    where: { providerServiceId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Any live (non-deleted) hosting row linked to a checkout order. */
export async function findByCheckoutOrderId(checkoutOrderId) {
  if (!checkoutOrderId) return null;
  return prisma.webHostingService.findFirst({
    where: { checkoutOrderId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Simple state updates ─────────────────────────────────────────────────────

export async function updateProviderState(id, fields, tx = prisma) {
  const normalizedFields = {
    ...fields,
    ...(fields?.metadata !== undefined
      ? { metadata: typeof fields.metadata === 'string' ? fields.metadata : json(fields.metadata) }
      : {}),
  };
  return tx.webHostingService.update({
    where: { id },
    data: { ...normalizedFields, updatedAt: new Date() },
  });
}

export async function setStatus(id, status, tx = prisma) {
  return tx.webHostingService.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });
}

/** Provider resource is gone with no confirmed destroy — flag, never delete. */
export async function markProviderMissing(id) {
  return setStatus(id, 'provider_missing');
}

export async function markDestroyPending(id) {
  return setStatus(id, 'destroy_pending');
}

export async function markDestroyFailed(id) {
  return setStatus(id, 'destroy_failed');
}

/** Merge keys into the JSON metadata column (invalid JSON resets to {}). */
export async function mergeMetadata(id, patch) {
  const record = await prisma.webHostingService.findUnique({ where: { id } });
  if (!record) return null;
  let meta = {};
  try { meta = JSON.parse(record.metadata || '{}'); } catch { /* reset invalid JSON */ }
  return prisma.webHostingService.update({
    where: { id },
    data: { metadata: json({ ...meta, ...patch }), updatedAt: new Date() },
  });
}

// ─── Transaction bundles ──────────────────────────────────────────────────────

/**
 * Step 1 of every creation flow: one short transaction that records intent
 * BEFORE any provider call — a pending WebHostingService row plus a pending
 * ServiceAccess row keyed on the same service id.
 *
 * Pass `service.id` (e.g. the legacy deploymentId) to pin the primary key and
 * the ServiceAccess.serviceId to a stable, route-facing identifier.
 */
export async function createPendingBundle({ service, access = {} }) {
  return withTransaction(async (tx) => {
    const record = await tx.webHostingService.create({
      data: {
        ...service,
        name: service.name,
        slug: service.slug ?? slugify(service.name),
        status: service.status ?? 'pending',
        metadata: json(service.metadata ?? {}),
      },
    });
    await upsertAccess(HOSTING, record.id, {
      create: {
        userId: access.userId ?? record.createdByUserId ?? null,
        organizationId: access.organizationId ?? record.organizationId,
        serviceName: access.serviceName ?? record.name,
        planId: access.planId ?? record.plan ?? null,
        checkoutOrderId: access.checkoutOrderId ?? record.checkoutOrderId ?? null,
        accessStatus: access.accessStatus ?? 'pending',
        billingStatus: access.billingStatus ?? 'pending',
        adminStatus: access.adminStatus ?? 'allowed',
        metadata: json(access.metadata ?? {}),
      },
      update: {
        serviceName: access.serviceName ?? record.name,
        accessStatus: access.accessStatus ?? 'pending',
        ...(access.billingStatus ? { billingStatus: access.billingStatus } : {}),
        ...(access.metadata !== undefined ? { metadata: json(access.metadata) } : {}),
      },
    }, tx);
    return { record };
  });
}

/**
 * Step 3 of the creation flow: the provider accepted — persist provider result,
 * activate access. One short transaction, run only AFTER the provider returned.
 */
export async function activateProvisionedBundle({
  serviceId, providerFields = {}, metadata, access,
}) {
  return withTransaction(async (tx) => {
    const record = await tx.webHostingService.update({
      where: { id: serviceId },
      data: {
        ...providerFields,
        ...(metadata !== undefined ? { metadata: json(metadata) } : {}),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService(HOSTING, serviceId, {
      accessStatus: 'active',
      startsAt: new Date(),
      ...(access ?? {}),
    }, tx);
    return record;
  });
}

/**
 * Step 4 of the creation flow: the provider refused — keep the local record
 * visible as failed for support/audit, and put access into an explicit
 * non-active state (review for paid flows, cancelled for unpaid ones).
 */
export async function markProvisionFailedBundle({
  serviceId, error, access, serviceFields, extraState,
}) {
  return withTransaction(async (tx) => {
    const record = await tx.webHostingService.update({
      where: { id: serviceId },
      data: {
        status: 'error',
        ...(serviceFields ?? {}),
        ...(extraState ?? {}),
        metadata: json({ error: String(error ?? 'unknown') }),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService(HOSTING, serviceId, access ?? { accessStatus: 'cancelled' }, tx);
    return record;
  });
}

/**
 * Confirmed destroy: provider deletion succeeded (or the service was already
 * gone) — soft-delete the row (history preserved), deactivate access, stop
 * billing. Only ever call after provider deletion is confirmed.
 */
export async function finalizeDestroyBundle({ serviceId, reason } = {}) {
  return withTransaction(async (tx) => {
    const record = await tx.webHostingService.update({
      where: { id: serviceId },
      data: {
        deletedAt: new Date(),
        status: 'destroyed',
        ...(reason ? { deletedReason: reason } : {}),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService(HOSTING, serviceId, {
      accessStatus: 'deleted',
      billingStatus: 'cancelled',
      lastActivityAt: new Date(),
    }, tx);
    return record;
  });
}

/**
 * Idempotent payment sync (Phase 8). Marks the hosting row paid and activates
 * its access in one short transaction. Keyed by the stable id (= deploymentId),
 * so it is a safe no-op when no relational row exists yet. A row already marked
 * paid short-circuits — repeated captures/webhooks never double-apply.
 */
export async function markHostingPaid(id, { checkoutOrderId, paidAt = new Date() } = {}) {
  const existing = await prisma.webHostingService.findUnique({ where: { id } });
  if (!existing) return null;                       // not backfilled yet — no-op
  if (existing.paymentStatus === 'paid') return existing; // idempotent

  return withTransaction(async (tx) => {
    const record = await tx.webHostingService.update({
      where: { id },
      data: {
        paymentStatus: 'paid',
        paidAt,
        ...(checkoutOrderId && !existing.checkoutOrderId ? { checkoutOrderId } : {}),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService(HOSTING, id, {
      billingStatus: 'paid',
      accessStatus: 'active',
      startsAt: new Date(),
    }, tx);
    return record;
  });
}

// ─── Convenience single-row wrappers (no access-row coupling) ─────────────────

export async function activateProvisionedHostingService(id, providerFields = {}, metadata, tx = prisma) {
  return tx.webHostingService.update({
    where: { id },
    data: {
      ...providerFields,
      ...(metadata !== undefined ? { metadata: json(metadata) } : {}),
      updatedAt: new Date(),
    },
  });
}

export async function markProvisionFailedHostingService(id, error, extraState = {}, tx = prisma) {
  return tx.webHostingService.update({
    where: { id },
    data: {
      status: 'error',
      ...extraState,
      metadata: json({ error: String(error ?? 'unknown') }),
      updatedAt: new Date(),
    },
  });
}

export async function markProviderMissingService(id) {
  return markProviderMissing(id);
}

export async function finalizeDestroy(id, reason) {
  return finalizeDestroyBundle({ serviceId: id, reason });
}
