/**
 * operations.repository.js
 *
 * Database gateway for the admin operations view of one customer: health
 * checks, incidents and watchdog events keyed by the customer's resolved
 * services, plus their notifications. Read-only.
 */

import { prisma } from '../services/db.js';

/**
 * Latest health checks for a set of resolved services.
 * @param {Array<{serviceType: string, serviceId: string}>} services
 */
export async function listHealthChecksForServices(services, { limit = 100 } = {}) {
  if (!services?.length) return [];
  const ids = services.map((s) => s.serviceId);
  return prisma.serviceHealthCheck.findMany({
    where: { serviceId: { in: ids } },
    orderBy: { checkedAt: 'desc' },
    take: Number(limit),
  });
}

export async function listIncidentsForServices(services, { limit = 50 } = {}) {
  if (!services?.length) return [];
  const ids = services.map((s) => s.serviceId);
  return prisma.incident.findMany({
    where: { serviceId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}

export async function listWatchdogEventsForCustomer(userId, organizationIds = [], serviceIds = [], { limit = 100 } = {}) {
  const or = [{ userId }];
  if (organizationIds.length) or.push({ organizationId: { in: organizationIds } });
  if (serviceIds.length) or.push({ serviceId: { in: serviceIds } });
  return prisma.watchdogEvent.findMany({
    where: { OR: or },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}

export async function listNotificationsForCustomer(userId, { limit = 50 } = {}) {
  return prisma.notification.findMany({
    where: { userId, deletedAt: null, audience: { not: 'admin' } },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}
