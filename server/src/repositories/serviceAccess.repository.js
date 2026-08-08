/**
 * serviceAccess.repository.js
 *
 * Database gateway for ServiceAccess rows — the central monthly access pass
 * (one row per user-owned service). All Prisma access for the model lives
 * here; the access rules themselves live in serviceAccessService.js.
 *
 * Writes accept an optional `tx` (Prisma transaction client) so services can
 * compose multi-row bundles through the vps repository's transactions.
 */

import { prisma } from '../services/db.js';

/** The access row for one service, or null. */
export async function findByService(serviceType, serviceId, tx = prisma) {
  return tx.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType, serviceId } },
  });
}

/** Every access row owned by one user — the customer's service index. */
export async function listByUser(userId) {
  return prisma.serviceAccess.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Every access row owned by a customer user or one of their organization ids. */
export async function listByCustomerScope({ userId, organizationIds = [] } = {}) {
  const or = [];
  if (userId) or.push({ userId });
  const orgs = [...new Set((organizationIds ?? []).filter(Boolean))];
  if (orgs.length) or.push({ organizationId: { in: orgs } });
  if (!or.length) return [];

  const rows = await prisma.serviceAccess.findMany({
    where: { OR: or },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/** Access rows for a known set of service ids. */
export async function listByServiceIds(serviceType, serviceIds = []) {
  const ids = [...new Set((serviceIds ?? []).filter(Boolean))];
  if (!ids.length) return [];
  return prisma.serviceAccess.findMany({
    where: { serviceType, serviceId: { in: ids } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

/** Admin listing with owner info. */
export async function listAccess({ where = {}, limit = 30, offset = 0 } = {}) {
  const [items, total] = await Promise.all([
    prisma.serviceAccess.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: { user: { select: { id: true, email: true, name: true } } },
    }),
    prisma.serviceAccess.count({ where }),
  ]);
  return { items, total };
}

export async function findById(id, { includeUser = false } = {}) {
  return prisma.serviceAccess.findUnique({
    where: { id },
    ...(includeUser ? { include: { user: { select: { id: true, email: true, name: true } } } } : {}),
  });
}

export async function updateById(id, data, tx = prisma) {
  return tx.serviceAccess.update({ where: { id }, data });
}

export async function updateManyByUser(userId, data, where = {}) {
  return prisma.serviceAccess.updateMany({
    where: { userId, ...where },
    data,
  });
}

/** Update access rows owned directly by a user or through their organization scope. */
export async function updateManyByCustomerScope({ userId, organizationIds = [] } = {}, data, where = {}) {
  const owners = [];
  if (userId) owners.push({ userId });
  const orgs = [...new Set((organizationIds ?? []).filter(Boolean))];
  if (orgs.length) owners.push({ organizationId: { in: orgs } });
  if (!owners.length) return { count: 0 };
  return prisma.serviceAccess.updateMany({
    where: { AND: [{ OR: owners }, where] },
    data,
  });
}

/** Create-or-update the access row for a service. */
export async function upsertAccess(serviceType, serviceId, { create, update }, tx = prisma) {
  return tx.serviceAccess.upsert({
    where: { serviceType_serviceId: { serviceType, serviceId } },
    create: { serviceType, serviceId, ...create },
    update,
  });
}

/** Update the access row for a service if it exists (no-op otherwise). */
export async function updateByService(serviceType, serviceId, data, tx = prisma) {
  return tx.serviceAccess.updateMany({
    where: { serviceType, serviceId },
    data,
  });
}

/** Non-blocking activity timestamp update. */
export function touchActivity(id) {
  prisma.serviceAccess.update({
    where: { id },
    data: { lastActivityAt: new Date() },
  }).catch(() => {});
}

export async function activateAccess(serviceType, serviceId, extra = {}, tx = prisma) {
  return updateByService(serviceType, serviceId, {
    accessStatus: 'active',
    startsAt: new Date(),
    ...extra,
  }, tx);
}

export async function suspendAccess(serviceType, serviceId, reason = null, tx = prisma) {
  return updateByService(serviceType, serviceId, {
    accessStatus: 'suspended',
    suspendedAt: new Date(),
    ...(reason ? { suspendedReason: reason } : {}),
  }, tx);
}

export async function updateBillingState(serviceType, serviceId, billingStatus, tx = prisma) {
  return updateByService(serviceType, serviceId, { billingStatus }, tx);
}

export async function expireAccess(serviceType, serviceId, tx = prisma) {
  return updateByService(serviceType, serviceId, { accessStatus: 'expired' }, tx);
}
