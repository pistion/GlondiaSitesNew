import renderApiService from './renderApiService.js';
import { makeId, mutateHostingStore, nowIso, readHostingStore } from './hostingStore.js';
import { prisma } from './db.js';

const ALLOWED_DISK_SIZES_GB = new Set([10, 50, 100]);

class DiskService {
  async list(deploymentId) {
    const deployment = await findDeployment(deploymentId);
    const tableRows = await listDiskTableRows(deployment);
    if (tableRows?.length) return tableRows.map(publicDisk);

    const store = await readHostingStore();
    normalizeDiskStore(store);
    return (store.disks[deployment.deploymentId] || []).map(publicDisk);
  }

  async attach(deploymentId, input = {}) {
    const disk = validateDisk(input);
    const deployment = await findDeployment(deploymentId);
    if (deployment.serviceType !== 'web_service') {
      const error = new Error('Persistent disks are supported only for Render web services in this flow.');
      error.status = 400;
      throw error;
    }
    let renderDisk = null;
    let providerSyncStatus = 'synced';
    let providerError = null;
    if (hasRealRenderId(deployment.renderServiceId) && renderApiService.configured()) {
      try {
        renderDisk = await renderApiService.createDisk(deployment.renderServiceId, disk);
      } catch (error) {
        providerSyncStatus = 'pending_provider';
        providerError = error.message || 'Provider sync failed.';
      }
    } else {
      providerSyncStatus = 'pending_provider';
      providerError = hasRealRenderId(deployment.renderServiceId) ? 'Provider API is not configured.' : 'Provider service is not ready yet.';
    }
    const item = {
      diskId: renderDisk?.disk?.id || renderDisk?.id || makeId('disk'),
      name: disk.name,
      mountPath: disk.mountPath,
      sizeGB: disk.sizeGB,
      status: providerSyncStatus === 'synced' ? 'attached' : 'pending_provider',
      providerSyncStatus,
      providerError,
      renderDisk,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await upsertDiskTableRow(deployment, item);
    return mutateHostingStore((store) => {
      normalizeDiskStore(store);
      store.disks[deployment.deploymentId] = [item, ...(store.disks[deployment.deploymentId] || [])];
      updateDeploymentDisks(store, deployment.deploymentId);
      return publicDisk(item);
    });
  }

  async update(deploymentId, diskId, input = {}) {
    const deployment = await findDeployment(deploymentId);
    const disk = validateDisk(input, false);
    let renderDisk = null;
    let providerSyncStatus = 'synced';
    let providerError = null;
    if (hasRealRenderId(deployment.renderServiceId) && renderApiService.configured()) {
      try {
        renderDisk = await renderApiService.updateDisk(deployment.renderServiceId, diskId, disk);
      } catch (error) {
        providerSyncStatus = 'pending_provider';
        providerError = error.message || 'Provider sync failed.';
      }
    } else {
      providerSyncStatus = 'pending_provider';
      providerError = hasRealRenderId(deployment.renderServiceId) ? 'Provider API is not configured.' : 'Provider service is not ready yet.';
    }
    const tableExisting = await getDiskTableRow(deployment, diskId);
    if (!tableExisting) {
      const store = await readHostingStore();
      normalizeDiskStore(store);
      if (!(store.disks[deployment.deploymentId] || []).some((row) => row.diskId === diskId)) throw notFound('Disk not found.');
    }
    const nextDisk = {
      ...(tableExisting || {}),
      diskId,
      name: disk.name || tableExisting?.name || input.name,
      mountPath: disk.mountPath || tableExisting?.mountPath || input.mountPath,
      sizeGB: disk.sizeGB || tableExisting?.sizeGB || input.sizeGB || input.size || 1,
      status: providerSyncStatus === 'synced' ? 'attached' : 'pending_provider',
      providerSyncStatus,
      providerError,
      renderDisk,
      updatedAt: nowIso(),
    };
    await upsertDiskTableRow(deployment, nextDisk);
    return mutateHostingStore((store) => {
      normalizeDiskStore(store);
      const item = (store.disks[deployment.deploymentId] || []).find((row) => row.diskId === diskId);
      if (item) Object.assign(item, nextDisk);
      else store.disks[deployment.deploymentId] = [nextDisk, ...(store.disks[deployment.deploymentId] || [])];
      updateDeploymentDisks(store, deployment.deploymentId);
      return publicDisk(nextDisk);
    });
  }

  async remove(deploymentId, diskId) {
    const deployment = await findDeployment(deploymentId);
    if (hasRealRenderId(deployment.renderServiceId) && renderApiService.configured()) {
      try {
        await renderApiService.deleteDisk(deployment.renderServiceId, diskId);
      } catch { /* remove local record even when provider sync fails */ }
    }
    await deleteDiskTableRow(deployment, diskId);
    return mutateHostingStore((store) => {
      normalizeDiskStore(store);
      store.disks[deployment.deploymentId] = (store.disks[deployment.deploymentId] || []).filter((row) => row.diskId !== diskId);
      updateDeploymentDisks(store, deployment.deploymentId);
      return { deleted: true, diskId };
    });
  }
}

function validateDisk(input = {}, requireAll = true) {
  const name = String(input.name || input.diskName || '').trim();
  const mountPath = String(input.mountPath || '').trim();
  const sizeGB = Number(input.sizeGB || input.size || 1);
  if (requireAll && !name) throw validationError('Disk name is required.');
  if (name && !/^[a-zA-Z0-9][a-zA-Z0-9-_]{1,62}$/.test(name)) throw validationError('Disk name must be 2-63 letters, numbers, hyphens, or underscores.');
  if (requireAll && !mountPath) throw validationError('Mount path is required.');
  if (mountPath && (!mountPath.startsWith('/') || mountPath.includes('..'))) throw validationError('Mount path must be an absolute path and cannot contain "..".');
  if (!Number.isFinite(sizeGB) || !ALLOWED_DISK_SIZES_GB.has(sizeGB)) throw validationError('Disk size must be 10GB, 50GB, or 100GB.');
  return { name, mountPath, sizeGB };
}

async function findDeployment(deploymentId) {
  const store = await readHostingStore();
  const deployment = store.deployments.find((item) => item.deploymentId === deploymentId || item.renderServiceId === deploymentId);
  if (!deployment) throw notFound('Hosting service not found.');
  if (!deployment.renderServiceId) throw validationError('Deployment has not started. A real hosting service ID is required.');
  return deployment;
}

async function listDiskTableRows(deployment) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "disk_id" AS "diskId", "hosting_service_id" AS "hostingServiceId",
              "render_service_id" AS "renderServiceId", "deployment_id" AS "deploymentId",
              "organization_id" AS "organizationId", "created_by_user_id" AS "createdByUserId",
              "name", "mount_path" AS "mountPath", "size_gb" AS "sizeGB", "status",
              "provider_sync_status" AS "providerSyncStatus", "provider_error" AS "providerError",
              "render_disk_json" AS "renderDiskJson", "created_at" AS "createdAt", "updated_at" AS "updatedAt"
         FROM "hosting_disks"
        WHERE "hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?
        ORDER BY "created_at" DESC`,
      deployment.deploymentId,
      deployment.deploymentId,
      deployment.renderServiceId || '',
    );
    return Array.isArray(rows) ? rows.map(parseDiskRow) : [];
  } catch (error) {
    if (isMissingDisksTable(error)) return null;
    throw error;
  }
}

async function getDiskTableRow(deployment, diskId) {
  const rows = await listDiskTableRows(deployment);
  return rows?.find((row) => row.diskId === diskId) || null;
}

async function upsertDiskTableRow(deployment, disk) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "hosting_disks" (
         "id", "disk_id", "hosting_service_id", "render_service_id", "deployment_id",
         "organization_id", "created_by_user_id", "name", "mount_path", "size_gb",
         "status", "provider_sync_status", "provider_error", "render_disk_json",
         "created_at", "updated_at"
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT("hosting_service_id", "disk_id") DO UPDATE SET
         "name" = excluded."name",
         "mount_path" = excluded."mount_path",
         "size_gb" = excluded."size_gb",
         "status" = excluded."status",
         "provider_sync_status" = excluded."provider_sync_status",
         "provider_error" = excluded."provider_error",
         "render_disk_json" = excluded."render_disk_json",
         "updated_at" = CURRENT_TIMESTAMP`,
      disk.id || makeId('disk_row'),
      disk.diskId,
      deployment.deploymentId,
      deployment.renderServiceId || null,
      deployment.deploymentId,
      deployment.organizationId || deployment.clientId || null,
      deployment.createdByUserId || deployment.userId || null,
      disk.name,
      disk.mountPath,
      Number(disk.sizeGB || 1),
      disk.status || 'pending_provider',
      disk.providerSyncStatus || 'pending_provider',
      disk.providerError || null,
      disk.renderDisk ? JSON.stringify(disk.renderDisk) : disk.renderDiskJson || null,
    );
  } catch (error) {
    if (isMissingDisksTable(error)) return;
    throw error;
  }
}

async function deleteDiskTableRow(deployment, diskId) {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "hosting_disks"
        WHERE "disk_id" = ?
          AND ("hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?)`,
      diskId,
      deployment.deploymentId,
      deployment.deploymentId,
      deployment.renderServiceId || '',
    );
  } catch (error) {
    if (isMissingDisksTable(error)) return;
    throw error;
  }
}

function updateDeploymentDisks(store, serviceId) {
  normalizeDiskStore(store);
  const deployment = store.deployments.find((item) => item.deploymentId === serviceId);
  if (!deployment) return;
  deployment.diskMetadata = store.disks[serviceId] || [];
  deployment.updatedAt = nowIso();
}

function normalizeDiskStore(store) {
  if (!Array.isArray(store.deployments)) store.deployments = [];
  if (!store.disks || typeof store.disks !== 'object' || Array.isArray(store.disks)) store.disks = {};
  return store;
}

function publicDisk(disk = {}) {
  return {
    diskId: disk.diskId || disk.id,
    name: disk.name,
    mountPath: disk.mountPath,
    sizeGB: Number(disk.sizeGB || disk.sizeGb || disk.size || 1),
    status: disk.status || (disk.providerSyncStatus === 'synced' ? 'attached' : 'pending_provider'),
    providerSyncStatus: disk.providerSyncStatus || 'pending_provider',
    providerError: disk.providerError || null,
    createdAt: disk.createdAt || null,
    updatedAt: disk.updatedAt || null,
  };
}

function parseDiskRow(row = {}) {
  return {
    ...row,
    sizeGB: Number(row.sizeGB || 1),
    providerSyncStatus: row.providerSyncStatus || 'pending_provider',
    providerError: row.providerError || null,
    renderDisk: safeJson(row.renderDiskJson),
  };
}

function safeJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hasRealRenderId(id) {
  return Boolean(id && !String(id).includes('_pending'));
}

function isMissingDisksTable(error) {
  return /hosting_disks|no such table|does not exist/i.test(error?.message || '');
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export default new DiskService();
