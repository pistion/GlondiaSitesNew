/**
 * audit.repository.js
 *
 * Database gateway for the admin activity view of one customer: audit logs
 * where the customer acted or was acted upon, plus admin commands that
 * targeted them. Read-only — writes stay in auditLogService.
 */

import { prisma } from '../services/db.js';

export async function listAuditForCustomer(userId, organizationIds = [], {
  limit = 50,
  offset = 0,
  action = null,
  entityType = null,
  dateFrom = null,
  dateTo = null,
} = {}) {
  const where = {
    OR: [
      { actorUserId: userId },
      { entityId: userId },
      ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
    ],
  };
  if (action) where.action = { contains: String(action) };
  if (entityType) where.entityType = String(entityType);
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    };
  }
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, limit: Number(limit), offset: Number(offset) };
}

/** Admin commands whose metadata references the customer (best-effort match). */
export async function listAdminCommandsForCustomer(userId, { limit = 50 } = {}) {
  return prisma.adminCommand.findMany({
    where: {
      OR: [
        { metadata: { contains: userId } },
        { beforeState: { contains: userId } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}

export function listAdminActivity({ limit = 100, offset = 0, action = null, userId = null } = {}) {
  const where = {};
  if (action) where.action = { contains: action };
  if (userId) where.actorUserId = userId;
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Number(limit) || 100,
    skip: Number(offset) || 0,
    select: {
      id: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      status: true,
      createdAt: true,
    },
  });
}
