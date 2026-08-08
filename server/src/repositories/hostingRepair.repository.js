import { prisma } from '../services/db.js';

export function listWebHostingServices() {
  return prisma.webHostingService.findMany({ orderBy: { createdAt: 'desc' } });
}

export function findWebHostingById(id) {
  return prisma.webHostingService.findUnique({ where: { id } });
}

export function findWebHostingByProviderServiceId(providerServiceId) {
  if (!providerServiceId) return Promise.resolve([]);
  return prisma.webHostingService.findMany({ where: { providerServiceId } });
}

export function createWebHostingService(data) {
  return prisma.webHostingService.create({ data });
}

export function updateWebHostingService(id, data) {
  return prisma.webHostingService.update({ where: { id }, data });
}

export function listHostingAccessRows() {
  return prisma.serviceAccess.findMany({
    where: { serviceType: 'hosting' },
    orderBy: { createdAt: 'desc' },
  });
}

export function findHostingAccessByServiceId(serviceId) {
  return prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'hosting', serviceId } },
  });
}

export function createHostingAccess(data) {
  return prisma.serviceAccess.create({
    data: { serviceType: 'hosting', ...data },
  });
}
