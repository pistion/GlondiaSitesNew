import { prisma } from '../services/db.js';

const take = 500;

export function listClients() {
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, clientId: true, name: true, email: true, role: true, planId: true, accountStatus: true, createdAt: true, updatedAt: true },
  });
}

export function listHosting() {
  return prisma.webHostingService.findMany({ orderBy: { updatedAt: 'desc' }, take });
}

export function listVps() {
  return prisma.vpsService.findMany({
    orderBy: { updatedAt: 'desc' },
    take,
    include: { actionLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });
}

export function listCloudStorage() {
  return prisma.cloudStorageService.findMany({
    orderBy: { updatedAt: 'desc' },
    take,
    include: {
      actions: { orderBy: { createdAt: 'desc' }, take: 10 },
      usageSamples: { orderBy: { sampledAt: 'desc' }, take: 3 },
      repoLinks: true,
    },
  });
}

export function listCloudStorageCatalogSnapshots() {
  return prisma.cloudStorageCatalogSnapshot.findMany({ orderBy: { lastSyncedAt: 'desc' }, take: 20 });
}

export function listDomains() {
  return prisma.businessService.findMany({ where: { type: 'domain' }, orderBy: { updatedAt: 'desc' }, take });
}

export function listEmail() {
  return prisma.businessService.findMany({ where: { type: 'email' }, orderBy: { updatedAt: 'desc' }, take });
}

export async function listSecurity() {
  const [audit, analytics, incidents, watchdog] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take }),
    prisma.analyticsEvent.findMany({ orderBy: { createdAt: 'desc' }, take }),
    prisma.incident.findMany({ orderBy: { createdAt: 'desc' }, take }),
    prisma.watchdogEvent.findMany({ orderBy: { createdAt: 'desc' }, take }),
  ]);
  return { audit, analytics, incidents, watchdog };
}

export function listServiceAccess(serviceTypes) {
  return prisma.serviceAccess.findMany({
    where: serviceTypes?.length ? { serviceType: { in: serviceTypes } } : undefined,
    orderBy: { updatedAt: 'desc' },
    take,
  });
}

export function listOrders() {
  return prisma.checkoutOrder.findMany({ orderBy: { createdAt: 'desc' }, take });
}
