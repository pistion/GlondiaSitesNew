import { prisma, withTransaction } from '../services/db.js';
import { upsertAccess, updateByService } from './serviceAccess.repository.js';

const SERVICE_TYPE = 'cloud_storage';
const json = (value) => {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
};

export function listOwned(organizationId) {
  return prisma.cloudStorageService.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export function findOwned(id, organizationId) {
  return prisma.cloudStorageService.findFirst({ where: { id, organizationId, deletedAt: null } });
}

export async function requireOwned(id, organizationId) {
  const record = await findOwned(id, organizationId);
  if (!record) throw Object.assign(new Error('Cloud Storage service not found.'), { status: 404, code: 'CLOUD_STORAGE_NOT_FOUND' });
  return record;
}

export function findByCheckoutOrderId(checkoutOrderId) {
  return prisma.cloudStorageService.findFirst({ where: { checkoutOrderId } });
}

export async function createPending({ service, access }) {
  return withTransaction(async (tx) => {
    const record = await tx.cloudStorageService.create({
      data: { ...service, metadata: json(service.metadata) },
    });
    await upsertAccess(SERVICE_TYPE, record.id, {
      create: {
        clientProjectId: record.clientProjectId,
        userId: access.userId,
        organizationId: record.organizationId,
        serviceName: record.name,
        planId: record.planKey,
        checkoutOrderId: record.checkoutOrderId,
        accessStatus: access.accessStatus || 'pending',
        billingStatus: access.billingStatus || 'pending',
        adminStatus: 'allowed',
        metadata: json({ serviceKind: record.serviceKind, tenancy: record.tenancy }),
      },
      update: {
        clientProjectId: record.clientProjectId,
        serviceName: record.name,
        planId: record.planKey,
        accessStatus: access.accessStatus || 'pending',
        billingStatus: access.billingStatus || 'pending',
      },
    }, tx);
    return record;
  });
}

export async function activate(id, fields = {}) {
  return withTransaction(async (tx) => {
    const record = await tx.cloudStorageService.update({
      where: { id },
      data: {
        ...fields,
        status: 'active',
        provisioningStage: 'ready',
        syncStatus: 'synced',
        paymentStatus: fields.paymentStatus || 'paid',
        activatedAt: fields.activatedAt || new Date(),
        lastSyncedAt: new Date(),
        ...(fields.metadata !== undefined ? { metadata: json(fields.metadata) } : {}),
      },
    });
    await updateByService(SERVICE_TYPE, id, {
      accessStatus: 'active',
      billingStatus: record.paymentStatus === 'free' ? 'free' : 'paid',
      startsAt: new Date(),
    }, tx);
    return record;
  });
}

export async function markFailed(id, error, paid = false) {
  const record = await prisma.cloudStorageService.update({
    where: { id },
    data: {
      status: paid ? 'review_required' : 'failed',
      provisioningStage: 'failed',
      syncStatus: 'error',
      adminStatus: paid ? 'review_required' : 'allowed',
      metadata: json({ error: String(error?.message || error) }),
    },
  });
  await updateByService(SERVICE_TYPE, id, paid
    ? { adminStatus: 'review_required', billingStatus: 'paid' }
    : { accessStatus: 'cancelled', billingStatus: 'failed' });
  return record;
}

export function updateSettings(id, data) {
  return prisma.cloudStorageService.update({ where: { id }, data });
}

export function appendAction(data) {
  return prisma.cloudStorageActionLog.create({
    data: {
      ...data,
      request: json(data.request),
      response: json(data.response),
    },
  });
}

export function listActions(serviceId) {
  return prisma.cloudStorageActionLog.findMany({
    where: { serviceId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export function listUsage(serviceId) {
  return prisma.cloudStorageUsageSample.findMany({
    where: { serviceId },
    orderBy: { sampledAt: 'desc' },
    take: 120,
  });
}

export function listRestorePoints(serviceId) {
  return prisma.cloudStorageRestorePoint.findMany({
    where: { serviceId },
    orderBy: { createdAt: 'desc' },
  });
}

export function createRestorePoint(data) {
  return prisma.cloudStorageRestorePoint.create({ data });
}

export async function restorePoint(id, serviceId) {
  const point = await prisma.cloudStorageRestorePoint.findFirst({ where: { id, serviceId } });
  if (!point) throw Object.assign(new Error('Restore point not found.'), { status: 404 });
  return prisma.cloudStorageRestorePoint.update({
    where: { id: point.id },
    data: { status: 'restored', restoredAt: new Date() },
  });
}

export function listObjects(serviceId, includeDeleted = false) {
  return prisma.cloudStorageObject.findMany({
    where: { serviceId, ...(includeDeleted ? {} : { deletedAt: null }) },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function createObjectVersion(serviceId, object) {
  const latest = await prisma.cloudStorageObject.findFirst({
    where: { serviceId, objectKey: object.objectKey },
    orderBy: { version: 'desc' },
  });
  return prisma.cloudStorageObject.create({
    data: { serviceId, ...object, version: Number(latest?.version || 0) + 1 },
  });
}

export function softDeleteObject(id, serviceId) {
  return prisma.cloudStorageObject.updateMany({
    where: { id, serviceId },
    data: { status: 'deleted', deletedAt: new Date() },
  });
}

export function restoreObject(id, serviceId) {
  return prisma.cloudStorageObject.updateMany({
    where: { id, serviceId, deletedAt: { not: null } },
    data: { status: 'active', deletedAt: null },
  });
}

export function permanentlyDeleteObject(id, serviceId) {
  return prisma.cloudStorageObject.deleteMany({
    where: { id, serviceId, deletedAt: { not: null } },
  });
}

export function getRepoLink(serviceId) {
  return prisma.cloudStorageRepositoryLink.findFirst({ where: { serviceId } });
}

export function upsertRepoLink(serviceId, data) {
  return prisma.cloudStorageRepositoryLink.upsert({
    where: { serviceId_repositoryName: { serviceId, repositoryName: data.repositoryName } },
    create: { serviceId, ...data },
    update: data,
  });
}

export function updateRepoLink(id, data) {
  return prisma.cloudStorageRepositoryLink.update({ where: { id }, data });
}

export function getCatalogSnapshot(catalogKey) {
  return prisma.cloudStorageCatalogSnapshot.findUnique({ where: { catalogKey } });
}

export function putCatalogSnapshot(catalogKey, payload, syncStatus = 'synced', errorMessage = null) {
  return prisma.cloudStorageCatalogSnapshot.upsert({
    where: { catalogKey },
    create: { catalogKey, payload: json(payload), syncStatus, errorMessage, lastSyncedAt: new Date() },
    update: { payload: json(payload), syncStatus, errorMessage, lastSyncedAt: new Date() },
  });
}
