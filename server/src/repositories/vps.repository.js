/**
 * vps.repository.js
 *
 * Database gateway for VpsService and the multi-row transaction bundles the
 * VPS command flows need. All Prisma access for the VPS feature lives here —
 * the service layer coordinates provider/billing calls and calls in.
 *
 * Transactions are short and local; provider and PayPal calls always happen
 * OUTSIDE these bundles (the service sequences that).
 */

import { prisma, withTransaction } from '../services/db.js';
import { createAction, markActionSuccess, markActionFailed } from './vpsAction.repository.js';
import { upsertAccess, updateByService as updateAccessByService } from './serviceAccess.repository.js';

function json(value) {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Owned, non-deleted record or null. */
export async function findOwnedById(id, organizationId) {
  return prisma.vpsService.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
}

/** Owned, non-deleted record or a 404 domain error. */
export async function requireOwnedById(id, organizationId) {
  const record = await findOwnedById(id, organizationId);
  if (!record) throw Object.assign(new Error('VPS service not found.'), { status: 404 });
  return record;
}

export async function listByOrganization(organizationId) {
  return prisma.vpsService.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Admin listing: every VPS record, including failed/destroyed rows for audit. */
export async function listAllForAdmin() {
  return prisma.vpsService.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/** Admin resolver lookup: records by id, including soft-deleted ones. */
export async function findManyByIds(ids) {
  if (!ids?.length) return [];
  return prisma.vpsService.findMany({ where: { id: { in: ids } } });
}

/** Any live (non-deleted) service already linked to a checkout order. */
export async function findByCheckoutOrderId(checkoutOrderId) {
  return prisma.vpsService.findFirst({
    where: { checkoutOrderId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Simple state updates ─────────────────────────────────────────────────────

export async function updateProviderState(id, fields, tx = prisma) {
  return tx.vpsService.update({
    where: { id },
    data: { ...fields, updatedAt: new Date() },
  });
}

export async function setStatus(id, status, tx = prisma) {
  return tx.vpsService.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });
}

export async function markProviderMissing(id) {
  return setStatus(id, 'provider_missing');
}

export async function markDestroyPending(id) {
  return setStatus(id, 'destroy_pending');
}

export async function markDestroyFailed(id) {
  return setStatus(id, 'destroy_failed');
}

export async function updatePlanAndPrice(id, {
  plan, monthlyCostCents, markupPercent, markupAmountCents, totalPriceCents,
  vcpuCount, ramMb, diskGb,
}) {
  return prisma.vpsService.update({
    where: { id },
    data: {
      plan,
      monthlyCostCents,
      markupPercent,
      markupAmountCents,
      totalPriceCents,
      ...(vcpuCount != null ? { vcpuCount } : {}),
      ...(ramMb != null ? { ramMb } : {}),
      ...(diskGb != null ? { diskGb } : {}),
      updatedAt: new Date(),
    },
  });
}

export async function updateOperatingSystem(id, { osId, osName }) {
  return prisma.vpsService.update({
    where: { id },
    data: { osId, ...(osName ? { osName } : {}), updatedAt: new Date() },
  });
}

/** Merge keys into the JSON metadata column. */
export async function mergeMetadata(id, patch) {
  const record = await prisma.vpsService.findUnique({ where: { id } });
  if (!record) return null;
  let meta = {};
  try { meta = JSON.parse(record.metadata || '{}'); } catch { /* reset invalid JSON */ }
  return prisma.vpsService.update({
    where: { id },
    data: { metadata: json({ ...meta, ...patch }), updatedAt: new Date() },
  });
}

// ─── Transaction bundles ──────────────────────────────────────────────────────

/**
 * Step 1 of every creation flow: one short transaction that records intent
 * BEFORE any provider call — pending VpsService + ServiceAccess row in a
 * pending state + pending action record.
 */
export async function createPendingBundle({ service, access, action }) {
  return withTransaction(async (tx) => {
    const record = await tx.vpsService.create({
      data: {
        ...service,
        providerInstanceId: service.providerInstanceId ?? 'pending',
        status: service.status ?? 'pending',
        metadata: json(service.metadata ?? {}),
      },
    });
    await upsertAccess('vps', record.id, {
      create: {
        ...access,
        serviceName: record.label,
        planId: record.plan,
        accessStatus: access.accessStatus ?? 'pending',
        metadata: json(access.metadata ?? {}),
      },
      update: {
        ...access,
        serviceName: record.label,
        accessStatus: access.accessStatus ?? 'pending',
        metadata: json(access.metadata ?? {}),
      },
    }, tx);
    const actionRecord = await createAction({
      vpsServiceId: record.id,
      organizationId: record.organizationId,
      actorUserId: action.actorUserId,
      action: action.action ?? 'create',
      request: action.request ?? {},
    }, tx);
    return { record, actionRecord };
  });
}

/**
 * Step 3 of the creation flow: the provider accepted — persist the provider
 * result, activate access and billing, complete the action. One short
 * transaction, run only AFTER the provider call returned.
 */
export async function activateProvisionedBundle({
  serviceId, actionId, providerFields, metadata, access, actionResponse,
}) {
  return withTransaction(async (tx) => {
    const record = await tx.vpsService.update({
      where: { id: serviceId },
      data: {
        ...providerFields,
        ...(metadata !== undefined ? { metadata: json(metadata) } : {}),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService('vps', serviceId, {
      accessStatus: 'active',
      startsAt: new Date(),
      ...(access ?? {}),
    }, tx);
    await markActionSuccess(actionId, actionResponse ?? {}, tx);
    return record;
  });
}

/**
 * Step 4 of the creation flow: the provider refused — keep the pending record
 * visible as failed for support/audit, fail the action, and put the access
 * row into an explicit non-active state (review for paid flows, cancelled for
 * unpaid ones).
 */
export async function markProvisionFailedBundle({
  serviceId, actionId, error, access, serviceFields,
}) {
  return withTransaction(async (tx) => {
    const record = await tx.vpsService.update({
      where: { id: serviceId },
      data: {
        status: 'error',
        providerInstanceId: 'FAILED',
        metadata: json({ error: String(error ?? 'unknown') }),
        ...(serviceFields ?? {}),
        updatedAt: new Date(),
      },
    });
    await updateAccessByService('vps', serviceId, access ?? { accessStatus: 'cancelled' }, tx);
    await markActionFailed(actionId, error, {}, tx);
    return record;
  });
}

/**
 * Confirmed destroy: provider deletion succeeded (or the instance was already
 * gone) — soft-delete the service, deactivate access, stop billing, complete
 * the action. Only ever call this after provider deletion is confirmed.
 */
export async function finalizeDestroyBundle({ serviceId, actionId }) {
  return withTransaction(async (tx) => {
    const record = await tx.vpsService.update({
      where: { id: serviceId },
      data: { deletedAt: new Date(), status: 'destroyed', updatedAt: new Date() },
    });
    await updateAccessByService('vps', serviceId, {
      accessStatus: 'deleted',
      billingStatus: 'cancelled',
      lastActivityAt: new Date(),
    }, tx);
    if (actionId) await markActionSuccess(actionId, {}, tx);
    return record;
  });
}
