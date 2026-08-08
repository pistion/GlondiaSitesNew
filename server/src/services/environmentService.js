import crypto from 'node:crypto';
import renderApiService from './renderApiService.js';
import { mutateHostingStore, nowIso, redactEnvValue, readHostingStore } from './hostingStore.js';
import { prisma } from './db.js';

class EnvironmentService {
  async list(deploymentId) {
    const deployment = await resolveDeployment(deploymentId);
    const dbRows = await listTableRows(deployment);
    if (dbRows.length > 0) return dbRows.map(publicEnvVar);
    return (await this.listRaw(deployment.deploymentId)).map(publicEnvVar);
  }

  async listRaw(deploymentId) {
    const store = await readHostingStore();
    return store.env[deploymentId] || [];
  }

  async sync(deploymentId) {
    const deployment = await resolveDeployment(deploymentId);
    const rows = await this.listRaw(deployment.deploymentId);
    const tableRows = await listTableRows(deployment);
    const sourceRows = tableRows.length ? tableRows : rows;
    const envVars = sourceRows.map((item) => ({ key: item.key, value: readStoredValue(item) }));
    await renderApiService.upsertEnvVars(deployment.renderServiceId, envVars);
    await markTableRowsSynced(deployment);
    return mutateHostingStore((store) => {
      const nextRows = (store.env[deployment.deploymentId] || []).map((item) => ({
        ...item,
        renderSynced: true,
        requiresRedeploy: true,
        updatedAt: nowIso(),
      }));
      store.env[deployment.deploymentId] = nextRows;
      updateDeploymentEnv(store, deployment.deploymentId, nextRows);
      return { synced: nextRows.length, requiresRedeploy: nextRows.some((item) => item.requiresRedeploy) };
    });
  }

  async upsert(deploymentId, input = {}) {
    const deployment = await resolveDeployment(deploymentId);
    const envVar = validateEnvVar(input);
    let renderSynced = false;
    if (renderApiService.configured() && deployment.renderServiceId) {
      try {
        await renderApiService.upsertEnvVars(deployment.renderServiceId, [{ key: envVar.key, value: envVar.value }]);
        renderSynced = true;
      } catch { /* store locally even if Render sync fails */ }
    }
    return mutateHostingStore(async (store) => {
      const rows = store.env[deployment.deploymentId] || [];
      const existing = rows.find((item) => item.key === envVar.key);
      const metadata = toMetadata(envVar, null);
      if (renderSynced) metadata.renderSynced = true;
      if (existing) Object.assign(existing, metadata);
      else rows.unshift(metadata);
      store.env[deployment.deploymentId] = rows;
      updateDeploymentEnv(store, deployment.deploymentId, rows);
      await upsertTableRow(deployment, existing || metadata);
      return publicEnvVar(existing || metadata);
    });
  }

  async patch(deploymentId, key, input = {}) {
    return this.upsert(deploymentId, { ...input, key });
  }

  async remove(deploymentId, key) {
    const deployment = await resolveDeployment(deploymentId);
    if (renderApiService.configured() && deployment.renderServiceId) {
      try {
        await renderApiService.deleteEnvVar(deployment.renderServiceId, key);
      } catch { /* remove locally even if Render delete fails */ }
    }
    return mutateHostingStore(async (store) => {
      store.env[deployment.deploymentId] = (store.env[deployment.deploymentId] || []).filter((item) => item.key !== key);
      updateDeploymentEnv(store, deployment.deploymentId, store.env[deployment.deploymentId]);
      await deleteTableRow(deployment, key);
      return { deleted: true, key };
    });
  }
}

async function resolveDeployment(deploymentId) {
  const store = await readHostingStore();
  const deployment = store.deployments.find((item) => item.deploymentId === deploymentId || item.renderServiceId === deploymentId);
  if (!deployment) throw notFound('Hosting deployment not found.');
  if (!deployment.renderServiceId) {
    const error = new Error('Deployment has not started. A real hosting service ID is required.');
    error.status = 409;
    throw error;
  }
  return deployment;
}

function validateEnvVar(input = {}) {
  const key = String(input.key || '').trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]{1,127}$/.test(key)) {
    const error = new Error('Environment variable keys must use uppercase letters, numbers, and underscores, and start with a letter or underscore.');
    error.status = 400;
    throw error;
  }
  const value = String(input.value ?? '');
  if (value.length > 8192) {
    const error = new Error('Environment variable values must be 8 KB or smaller.');
    error.status = 400;
    throw error;
  }
  return { key, value, environment: input.environment || 'production', secret: input.secret !== false };
}

async function listTableRows(deployment) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT
         "id",
         "hosting_service_id" AS "hostingServiceId",
         "render_service_id" AS "renderServiceId",
         "deployment_id" AS "deploymentId",
         "organization_id" AS "organizationId",
         "created_by_user_id" AS "createdByUserId",
         "key",
         "environment",
         "encrypted",
         "value_preview" AS "valuePreview",
         "value_ciphertext" AS "valueCiphertext",
         "value_plaintext" AS "valuePlaintext",
         "render_synced" AS "renderSynced",
         "requires_redeploy" AS "requiresRedeploy",
         "created_at" AS "createdAt",
         "updated_at" AS "updatedAt"
       FROM "hosting_environment_variables"
       WHERE "hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?
       ORDER BY "updated_at" DESC`,
      deployment.deploymentId,
      deployment.deploymentId,
      deployment.renderServiceId || '',
    );
    return Array.isArray(rows) ? rows.map(normalizeTableRow) : [];
  } catch (error) {
    if (!isMissingEnvTable(error)) console.error('[env] table list failed:', error.message);
    return [];
  }
}

async function upsertTableRow(deployment, item = {}) {
  const id = item.id || `env_${crypto.randomUUID()}`;
  const hostingServiceId = deployment.deploymentId;
  const renderServiceId = deployment.renderServiceId || null;
  const organizationId = deployment.organizationId || deployment.workspaceId || null;
  const createdByUserId = deployment.createdByUserId || deployment.userId || null;
  const environment = item.environment || 'production';
  const updatedAt = nowIso();
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "hosting_environment_variables"
     WHERE "hosting_service_id" = ? AND "key" = ? AND "environment" = ?
     LIMIT 1`,
    hostingServiceId,
    item.key,
    environment,
  ).catch((error) => {
    if (!isMissingEnvTable(error)) throw error;
    return [];
  });
  if (Array.isArray(existing) && existing[0]?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE "hosting_environment_variables"
       SET "render_service_id" = ?, "deployment_id" = ?, "organization_id" = ?, "created_by_user_id" = ?,
           "encrypted" = ?, "value_preview" = ?, "value_ciphertext" = ?, "value_plaintext" = ?,
           "render_synced" = ?, "requires_redeploy" = ?, "updated_at" = ?
       WHERE "id" = ?`,
      renderServiceId,
      deployment.deploymentId,
      organizationId,
      createdByUserId,
      Boolean(item.encrypted),
      item.valuePreview || '',
      item.valueCiphertext || null,
      item.valuePlaintext ?? null,
      Boolean(item.renderSynced),
      Boolean(item.requiresRedeploy),
      updatedAt,
      existing[0].id,
    ).catch((error) => {
      if (!isMissingEnvTable(error)) throw error;
    });
    return;
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "hosting_environment_variables" (
       "id", "hosting_service_id", "render_service_id", "deployment_id", "organization_id", "created_by_user_id",
       "key", "environment", "encrypted", "value_preview", "value_ciphertext", "value_plaintext",
       "render_synced", "requires_redeploy", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    hostingServiceId,
    renderServiceId,
    deployment.deploymentId,
    organizationId,
    createdByUserId,
    item.key,
    environment,
    Boolean(item.encrypted),
    item.valuePreview || '',
    item.valueCiphertext || null,
    item.valuePlaintext ?? null,
    Boolean(item.renderSynced),
    Boolean(item.requiresRedeploy),
    updatedAt,
    updatedAt,
  ).catch((error) => {
    if (!isMissingEnvTable(error)) throw error;
  });
}

async function deleteTableRow(deployment, key) {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "hosting_environment_variables"
     WHERE ("hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?) AND "key" = ?`,
    deployment.deploymentId,
    deployment.deploymentId,
    deployment.renderServiceId || '',
    key,
  ).catch((error) => {
    if (!isMissingEnvTable(error)) throw error;
  });
}

async function markTableRowsSynced(deployment) {
  await prisma.$executeRawUnsafe(
    `UPDATE "hosting_environment_variables"
     SET "render_synced" = 1, "requires_redeploy" = 1, "updated_at" = ?
     WHERE "hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?`,
    nowIso(),
    deployment.deploymentId,
    deployment.deploymentId,
    deployment.renderServiceId || '',
  ).catch((error) => {
    if (!isMissingEnvTable(error)) throw error;
  });
}

function normalizeTableRow(row = {}) {
  return {
    ...row,
    encrypted: Boolean(row.encrypted),
    renderSynced: Boolean(row.renderSynced),
    requiresRedeploy: Boolean(row.requiresRedeploy),
  };
}

function isMissingEnvTable(error) {
  return /hosting_environment_variables|no such table|does not exist/i.test(error?.message || '');
}

function toMetadata(envVar, renderResult) {
  return {
    key: envVar.key,
    environment: envVar.environment,
    encrypted: envVar.secret,
    valuePreview: redactEnvValue(envVar.value),
    valueCiphertext: envVar.secret ? encryptValue(envVar.value) : undefined,
    valuePlaintext: envVar.secret ? undefined : envVar.value,
    renderSynced: Boolean(renderResult && renderResult.status !== 'configuration_required'),
    requiresRedeploy: true,
    updatedAt: nowIso(),
  };
}

function encryptValue(value) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptValue(payload) {
  const [version, ivText, tagText, ciphertextText] = String(payload || '').split(':');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64')), decipher.final()]).toString('utf8');
}

function encryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || 'local-render-hosting-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

function readStoredValue(item = {}) {
  if (item.valuePlaintext !== undefined) return item.valuePlaintext;
  if (item.valueCiphertext) return decryptValue(item.valueCiphertext);
  return '';
}

function updateDeploymentEnv(store, serviceId, rows) {
  const deployment = store.deployments.find((item) => item.deploymentId === serviceId);
  if (!deployment) return;
  deployment.environmentVariablesMetadata = rows.map(publicEnvVar);
  deployment.updatedAt = nowIso();
}

function publicEnvVar(item = {}) {
  const { valueCiphertext, valuePlaintext, ...safe } = item;
  return safe;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export default new EnvironmentService();
