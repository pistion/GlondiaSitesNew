import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "./db.js";
import * as repo from "../repositories/cloudStorage.repository.js";
import * as vultr from "./vultrApiService.js";
import { getCloudStorageCatalog } from "./cloudStorageCatalogService.js";
import hostingService from "./hostingService.js";
import {
  createPaypalOrderWithOptionalVault,
  capturePaypalOrderRaw,
} from "./paymentMethodService.js";
import { recordPaymentTransaction } from "./billingRecordsService.js";
import { buildPostgresBootstrap } from "./cloudStoragePostgresBootstrapService.js";
import { createInitialDriveCredential } from "./cloudDriveAuthService.js";

const VALID_KINDS = new Set([
  "postgres",
  "ssh_backup",
  "private_vault",
  "private_repository",
]);
const VALID_TENANCY = new Set(["shared", "dedicated"]);
const STORAGE_PLAN_SIZES = new Set(["smallest", "largest"]);
const POSTGRES_PLAN_SIZES = new Set(["10gb", "50gb", "100gb"]);
const FRONTEND = process.env.FRONTEND_URL || "http://localhost:3001";

function buildDriveTransferAccess(service) {
  const username = `drive_${service.id.replace(/-/g, "").slice(0, 12)}`;
  const configured = Boolean(process.env.GLONDIA_DRIVE_SFTP_HOST);
  const host = process.env.GLONDIA_DRIVE_SFTP_HOST || "pending.glondia.internal";
  const port = Number(process.env.GLONDIA_DRIVE_SFTP_PORT || 22);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    host,
    port,
    username,
    password: randomBytes(18).toString("base64url"),
    privateKey,
    publicKey,
    protocol: "sftp/ssh",
    root: "/drive",
    scope: "cloud-drive-container",
    configured,
    sshCommand: `ssh -p ${port} ${username}@${host}`,
    sftpCommand: `sftp -P ${port} ${username}@${host}`,
  };
}

function actorScope(user) {
  if (!user?.id)
    throw Object.assign(new Error("Authentication required."), { status: 401 });
  return {
    userId: user.id,
    organizationId:
      user.organizationId || (user.id === "local-user" ? "local-org" : user.id),
    role: user.role || "owner",
  };
}

function safeJson(value, fallback = {}) {
  try {
    return typeof value === "string"
      ? JSON.parse(value || "{}")
      : value || fallback;
  } catch {
    return fallback;
  }
}

function encryptionKey() {
  return createHash("sha256")
    .update(
      String(
        process.env.CLOUD_STORAGE_CREDENTIAL_KEY ||
          process.env.JWT_SECRET ||
          "glondia-local-cloud-storage-key",
      ),
    )
    .digest();
}

function encryptCredentials(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

function decryptCredentials(value) {
  if (!value) return null;
  const payload = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function toClient(record) {
  const metadata = safeJson(record.metadata);
  return {
    id: record.id,
    name: record.name,
    serviceKind: record.serviceKind,
    tenancy: record.tenancy,
    planKey: record.planKey,
    planSize: record.planSize,
    region: record.region,
    postgresVersion: record.postgresVersion,
    status: record.status,
    provisioningStage: record.provisioningStage,
    syncStatus: record.syncStatus,
    adminStatus: record.adminStatus,
    paymentStatus: record.paymentStatus,
    capacityBytes: record.capacityBytes,
    transferIncludedBytes: record.transferIncludedBytes,
    storageUsedBytes: record.storageUsedBytes,
    transferUsedBytes: record.transferUsedBytes,
    overageStorageBytes: record.overageStorageBytes,
    overageTransferBytes: record.overageTransferBytes,
    totalPriceCents: record.totalPriceCents,
    currency: record.currency,
    deploymentBranch: record.deploymentBranch,
    publicAccess: record.publicAccess,
    corsOrigins: safeJson(record.corsOrigins, []),
    trustedNetworks: safeJson(record.trustedNetworks, []),
    externalAccessEnabled: record.externalAccessEnabled,
    privateNetworkAttached: record.privateNetworkAttached,
    retentionDaily: record.retentionDaily,
    retentionWeekly: record.retentionWeekly,
    credentialsAvailable:
      record.status === "active" && Boolean(record.credentialsCiphertext),
    credentialsPreview: record.credentialsPreview,
    endpoint: metadata.endpoint || null,
    repositoryUrl: metadata.repositoryUrl || null,
    lastSyncedAt: record.lastSyncedAt,
    activatedAt: record.activatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function catalogPlan(serviceKind, tenancy, planSize, region) {
  const catalog = await getCloudStorageCatalog();
  const plan = catalog.plans.find(
    (item) =>
      item.serviceKind === serviceKind &&
      item.tenancy === tenancy &&
      item.size === planSize,
  );
  if (!plan)
    throw Object.assign(
      new Error("The selected Cloud Storage plan is unavailable."),
      { status: 400 },
    );
  const validRegion = catalog.regions.some((item) => item.id === region);
  if (!validRegion)
    throw Object.assign(new Error("The selected region is unavailable."), {
      status: 400,
    });
  return plan;
}

export async function quote(input = {}) {
  const { serviceKind, tenancy, region = "syd", postgresVersion } = input;
  const planSize =
    input.planSize || (serviceKind === "postgres" ? "10gb" : "smallest");
  const validPlanSize =
    serviceKind === "postgres"
      ? POSTGRES_PLAN_SIZES.has(planSize)
      : STORAGE_PLAN_SIZES.has(planSize);
  if (
    !VALID_KINDS.has(serviceKind) ||
    !VALID_TENANCY.has(tenancy) ||
    !validPlanSize
  ) {
    throw Object.assign(
      new Error("A valid service, tenancy and plan size are required."),
      { status: 400 },
    );
  }
  if (
    serviceKind === "postgres" &&
    !["15", "16"].includes(String(postgresVersion))
  ) {
    throw Object.assign(new Error("PostgreSQL version 15 or 16 is required."), {
      status: 400,
    });
  }
  const plan = await catalogPlan(serviceKind, tenancy, planSize, region);
  return {
    planId: plan.id,
    serviceKind,
    tenancy,
    planSize,
    region,
    postgresVersion:
      serviceKind === "postgres" ? String(postgresVersion) : null,
    capacityBytes: plan.capacityBytes,
    transferIncludedBytes: plan.transferIncludedBytes,
    totalPriceCents: plan.totalPriceCents,
    currency: plan.currency,
    billingModel: "monthly_plus_overage",
  };
}

async function log(
  service,
  action,
  stage,
  status,
  request = {},
  response = {},
  errorMessage = null,
) {
  return repo.appendAction({
    serviceId: service.id,
    organizationId: service.organizationId,
    actorUserId: service.createdByUserId,
    action,
    stage,
    status,
    request,
    response,
    errorMessage,
  });
}

async function provisionProvider(service, plan) {
  const label = `glondia-${service.serviceKind}-${service.id.slice(0, 8)}`;
  const provisioningSecret =
    decryptCredentials(service.provisioningSecretCiphertext) || {};
  if (service.tenancy === "shared") {
    const postgresBootstrap =
      service.serviceKind === "postgres"
        ? buildPostgresBootstrap(service, {
            internalHost:
              process.env.GLONDIA_POSTGRES_INTERNAL_HOST ||
              "shared-db.glondia.internal",
            externalHost:
              process.env.GLONDIA_POSTGRES_EXTERNAL_HOST || "db.glondia.com",
            externalPassword: provisioningSecret.externalPassword,
          })
        : null;
    const credentials =
      service.serviceKind === "postgres"
        ? postgresBootstrap.credentials
        : service.serviceKind === "ssh_backup"
          ? {
              host: "backup.glondia.internal",
              port: 22,
              username: `backup_${service.id.slice(0, 8)}`,
              protocol: "sftp/rsync",
              sshPrivateKey: randomBytes(48).toString("base64url"),
            }
          : service.serviceKind === "private_repository"
            ? {
                repositoryUrl: `ssh://git@repos.glondia.internal/${service.id}.git`,
                deployKey: randomBytes(48).toString("base64url"),
              }
            : {
                endpoint: "https://storage.glondia.internal",
                bucket: `client-${service.id}`,
                accessKey: randomBytes(12).toString("hex"),
                secretKey: randomBytes(32).toString("base64url"),
                transferAccess: buildDriveTransferAccess(service),
              };
    return {
      primary: `shared-${service.serviceKind}-${service.id}`,
      secondary: null,
      credentials,
      metadata: {
        endpoint:
          credentials.endpoint ||
          credentials.host ||
          credentials.internal?.host ||
          null,
        repositoryUrl: credentials.repositoryUrl || null,
        sharedPool: true,
        ...(postgresBootstrap
          ? {
              database: postgresBootstrap.database,
              bootstrapStatus: "prepared",
              connectionModes: service.externalAccessEnabled
                ? ["internal", "external"]
                : ["internal"],
            }
          : {}),
      },
    };
  }

  if (service.serviceKind === "postgres") {
    const database = await vultr.createManagedDatabase({
      region: service.region,
      plan: plan.providerPlan,
      version: service.postgresVersion,
      label,
    });
    const internalHost = service.privateNetworkAttached
      ? database.private_host || database.host || null
      : null;
    const bootstrap = buildPostgresBootstrap(service, {
      internalHost,
      externalHost: database.host || null,
      externalPassword: provisioningSecret.externalPassword,
    });
    return {
      primary: database.id,
      credentials: bootstrap.credentials,
      metadata: {
        endpoint: database.host || null,
        database: bootstrap.database,
        bootstrapStatus: "prepared",
        connectionModes: [
          ...(internalHost ? ["internal"] : []),
          ...(service.externalAccessEnabled ? ["external"] : []),
        ],
      },
    };
  }

  if (service.serviceKind === "private_vault") {
    const catalog = await getCloudStorageCatalog();
    const cluster = catalog.providerCatalog?.objectClusters?.find(
      (item) => item.region === service.region,
    ) || { id: 1, hostname: `${service.region}1.vultrobjects.com` };
    const storage = await vultr.createObjectStorage({
      clusterId: cluster.id,
      tierId: plan.providerTier || 1,
      label,
    });
    return {
      primary: storage.id,
      credentials: {
        endpoint: storage.s3_hostname || cluster.hostname,
        bucket: label,
        credentialsPending: true,
        transferAccess: buildDriveTransferAccess(service),
      },
      metadata: { endpoint: storage.s3_hostname || cluster.hostname },
    };
  }

  const instance = await vultr.createInstance({
    region: service.region,
    plan: plan.computePlan,
    os_id: 2284,
    label,
    hostname: label,
    user_data: "#!/bin/sh\nset -eu\n# Glondia managed storage bootstrap\n",
  });
  const block = await vultr.createBlockStorage({
    region: service.region,
    sizeGb: Number(plan.blockSizeGb || 80),
    label: `${label}-data`,
    highPerf: service.serviceKind === "private_repository",
  });
  await vultr.attachBlockStorage(block.id, instance.id);
  const credentials =
    service.serviceKind === "ssh_backup"
      ? {
          host: instance.main_ip || null,
          port: 22,
          username: `backup_${service.id.slice(0, 8)}`,
          protocol: "sftp/rsync",
          sshKeyPending: true,
        }
      : {
          repositoryUrl: `ssh://git@${instance.main_ip || "pending"}/${service.id}.git`,
          deployKeyPending: true,
        };
  return {
    primary: instance.id,
    secondary: block.id,
    credentials,
    metadata: {
      endpoint: instance.main_ip || null,
      repositoryUrl: credentials.repositoryUrl || null,
    },
  };
}

async function provision(service, paid = false) {
  const plan = await catalogPlan(
    service.serviceKind,
    service.tenancy,
    service.planSize,
    service.region,
  );
  await log(service, "provision", "provider_request", "running", {
    kind: service.serviceKind,
    tenancy: service.tenancy,
    plan: service.planKey,
  });
  try {
    const result = await provisionProvider(service, plan);
    await log(
      service,
      "provision",
      "provider_confirmed",
      "completed",
      {},
      {
        providerResourceId: result.primary,
        providerSecondaryId: result.secondary || null,
      },
    );
    const activated = await repo.activate(service.id, {
      providerResourceId: result.primary,
      providerSecondaryId: result.secondary || null,
      credentialsCiphertext: encryptCredentials(result.credentials),
      provisioningSecretCiphertext: null,
      credentialsPreview:
        result.credentials.host ||
        result.credentials.endpoint ||
        result.credentials.repositoryUrl ||
        result.credentials.internal?.host ||
        result.credentials.external?.host ||
        "Available",
      paymentStatus: paid ? "paid" : "test_paid",
      paidAt: paid ? new Date() : null,
      metadata: result.metadata,
    });
    if (service.serviceKind === "private_repository") {
      const webhookSecret = randomBytes(32).toString("base64url");
      await repo.upsertRepoLink(service.id, {
        repositoryName: service.name,
        deploymentBranch: service.deploymentBranch,
        webhookSecretHash: createHash("sha256")
          .update(webhookSecret)
          .digest("hex"),
        metadata: JSON.stringify({
          secretCiphertext: encryptCredentials({ webhookSecret }),
        }),
      });
    }
    return activated;
  } catch (error) {
    await log(service, "provision", "failed", "failed", {}, {}, error.message);
    await repo.markFailed(service.id, error, paid);
    throw Object.assign(
      new Error(`Cloud Storage provisioning failed: ${error.message}`),
      { status: paid ? 409 : 502 },
    );
  }
}

async function recordInitialBilling(service, plan) {
  await prisma.billingLedger
    .create({
      data: {
        userId: service.createdByUserId,
        organizationId: service.organizationId,
        scope: "service",
        serviceType: "cloud_storage",
        serviceId: service.id,
        serviceName: service.name,
        billingType: "charge",
        classification: "recurring_charge",
        stage: "recorded",
        direction: "debit",
        sourceTable: "cloud_storage_services",
        sourceId: service.id,
        description: `${service.name} monthly plan`,
        quantity: 1,
        unitCents: plan.totalPriceCents,
        providerAmountCents: plan.providerCostCents,
        markupPercent: plan.markupPercent,
        markupAmountCents: plan.markupAmountCents,
        amountCents: plan.totalPriceCents,
        currency: plan.currency,
        status: "pending",
        metadata: JSON.stringify({
          tenancy: service.tenancy,
          planSize: service.planSize,
          overageEnabled: true,
        }),
      },
    })
    .catch((error) => {
      if (error?.code !== "P2002") throw error;
    });
}

export async function createService(user, input = {}) {
  const actor = actorScope(user);
  const details = await quote(input);
  const plan = await catalogPlan(
    details.serviceKind,
    details.tenancy,
    details.planSize,
    details.region,
  );
  const name = String(input.name || "")
    .trim()
    .slice(0, 80);
  if (!name)
    throw Object.assign(new Error("A service name is required."), {
      status: 400,
    });
  const externalAccessEnabled =
    details.serviceKind === "postgres" && Boolean(input.externalAccessEnabled);
  const externalPassword = String(input.externalPassword || "");
  if (externalAccessEnabled && externalPassword.length < 12) {
    throw Object.assign(
      new Error(
        "External PostgreSQL access requires a password of at least 12 characters.",
      ),
      { status: 400 },
    );
  }
  const service = await repo.createPending({
    service: {
      clientProjectId: input.clientProjectId || null,
      organizationId: actor.organizationId,
      createdByUserId: actor.userId === "local-user" ? null : actor.userId,
      name,
      serviceKind: details.serviceKind,
      tenancy: details.tenancy,
      planKey: plan.id,
      planSize: details.planSize,
      region: details.region,
      postgresVersion: details.postgresVersion,
      externalAccessEnabled,
      privateNetworkAttached:
        details.serviceKind === "postgres" &&
        Boolean(input.privateNetworkAttached),
      trustedNetworks: JSON.stringify(
        Array.isArray(input.trustedNetworks)
          ? input.trustedNetworks.slice(0, 50)
          : [],
      ),
      provisioningSecretCiphertext: externalAccessEnabled
        ? encryptCredentials({ externalPassword })
        : null,
      capacityBytes: details.capacityBytes,
      transferIncludedBytes: details.transferIncludedBytes,
      monthlyCostCents: plan.providerCostCents,
      markupPercent: plan.markupPercent,
      markupAmountCents: plan.markupAmountCents,
      totalPriceCents: plan.totalPriceCents,
      currency: plan.currency,
      deploymentBranch:
        String(input.deploymentBranch || "main")
          .replace(/[^a-zA-Z0-9._/-]/g, "")
          .slice(0, 100) || "main",
      retentionDaily: 7,
      retentionWeekly: 4,
      metadata: { billingModel: "monthly_plus_overage" },
    },
    access: { userId: actor.userId === "local-user" ? null : actor.userId, clientProjectId: input.clientProjectId || null },
  });
  await log(service, "create", "intent_recorded", "completed", {
    serviceKind: details.serviceKind,
    tenancy: details.tenancy,
    planId: plan.id,
  });
  await recordInitialBilling(service, plan);
  if (service.serviceKind === "private_vault") {
    await createInitialDriveCredential(service.id, user);
  }
  if (vultr.isTestMode() && !vultr.isConfigured())
    return toClient(await provision(service, false));
  return toClient(service);
}

export async function listServices(user) {
  const actor = actorScope(user);
  return (await repo.listOwned(actor.organizationId)).map(toClient);
}

export async function getService(user, id) {
  const actor = actorScope(user);
  return toClient(await repo.requireOwned(id, actor.organizationId));
}

export async function getCredentials(user, id) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  if (service.status !== "active")
    throw Object.assign(
      new Error("Credentials are available after provisioning completes."),
      { status: 409 },
    );
  return {
    serviceId: service.id,
    credentials: decryptCredentials(service.credentialsCiphertext),
  };
}

export async function getLogs(user, id) {
  const actor = actorScope(user);
  await repo.requireOwned(id, actor.organizationId);
  return repo.listActions(id);
}

export async function getUsage(user, id) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  return { service: toClient(service), samples: await repo.listUsage(id) };
}

export async function getBilling(user, id) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const [ledger, invoices] = await Promise.all([
    prisma.billingLedger.findMany({
      where: { serviceType: "cloud_storage", serviceId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: {
        lineItems: { some: { serviceType: "cloud_storage", serviceId: id } },
      },
      include: { lineItems: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const clientLedger = ledger.map(
    ({
      providerAmountCents,
      markupPercent,
      markupAmountCents,
      metadata,
      sourceTable,
      sourceId,
      ...entry
    }) => entry,
  );
  const clientInvoices = invoices.map(
    ({ metadata, lineItems, ...invoice }) => ({
      ...invoice,
      lineItems: lineItems.map(
        ({
          providerAmountCents,
          markupPercent,
          markupAmountCents,
          metadata: lineMetadata,
          sourceTable,
          sourceId,
          ...line
        }) => line,
      ),
    }),
  );
  return {
    service: toClient(service),
    ledger: clientLedger,
    invoices: clientInvoices,
  };
}

export async function updateSettings(user, id, input = {}) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const data = {};
  if (input.deploymentBranch !== undefined)
    data.deploymentBranch =
      String(input.deploymentBranch)
        .replace(/[^a-zA-Z0-9._/-]/g, "")
        .slice(0, 100) || "main";
  if (input.corsOrigins !== undefined)
    data.corsOrigins = JSON.stringify(
      Array.isArray(input.corsOrigins) ? input.corsOrigins.slice(0, 20) : [],
    );
  if (input.trustedNetworks !== undefined)
    data.trustedNetworks = JSON.stringify(
      Array.isArray(input.trustedNetworks)
        ? input.trustedNetworks.slice(0, 50)
        : [],
    );
  if (input.retentionDaily !== undefined)
    data.retentionDaily = Math.min(
      90,
      Math.max(1, Number(input.retentionDaily)),
    );
  if (input.retentionWeekly !== undefined)
    data.retentionWeekly = Math.min(
      52,
      Math.max(0, Number(input.retentionWeekly)),
    );
  const updated = await repo.updateSettings(id, data);
  await log(service, "settings", "database_updated", "completed", {
    fields: Object.keys(data),
  });
  return toClient(updated);
}

export async function listObjects(user, id, includeDeleted = false) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  if (service.serviceKind !== "private_vault")
    throw Object.assign(
      new Error("This service does not support private file storage."),
      { status: 400 },
    );
  return repo.listObjects(id, includeDeleted);
}

export async function registerObject(user, id, input = {}) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  if (service.serviceKind !== "private_vault")
    throw Object.assign(new Error("This service does not support files."), {
      status: 400,
    });
  const displayName = String(input.displayName || input.objectKey || "")
    .trim()
    .slice(0, 240);
  const objectKey = String(input.objectKey || displayName)
    .replace(/^\/+/, "")
    .slice(0, 500);
  if (!displayName || !objectKey)
    throw Object.assign(new Error("A file name is required."), { status: 400 });
  const object = await repo.createObjectVersion(id, {
    objectKey,
    displayName,
    contentType: String(input.contentType || "application/octet-stream").slice(
      0,
      120,
    ),
    sizeBytes: String(Math.max(0, Number(input.sizeBytes || 0))),
    checksum: input.checksum ? String(input.checksum).slice(0, 128) : null,
    metadata: JSON.stringify({
      providerUpload: "signed_operation_required",
      ...(input.metadata && typeof input.metadata === "object"
        ? {
            documentType: String(input.metadata.documentType || "").slice(0, 20),
            documentContent: String(input.metadata.documentContent || "").slice(0, 1000000),
          }
        : {}),
    }),
  });
  await log(service, "upload", "upload_completed", "completed", {
    objectKey,
    sizeBytes: object.sizeBytes,
    protocol: "browser",
  });
  return {
    ...object,
    upload: {
      status: "registered",
      message:
        "File metadata recorded. The backend will issue provider-signed transfer operations when live credentials are available.",
    },
  };
}

export async function deleteObject(user, id, objectId) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const result = await repo.softDeleteObject(objectId, id);
  if (!result.count)
    throw Object.assign(new Error("File not found."), { status: 404 });
  await log(service, "delete", "file_deleted", "completed", { objectId });
  return { ok: true, recoverable: true };
}

export async function restoreObject(user, id, objectId) {
  const actor = actorScope(user);
  await repo.requireOwned(id, actor.organizationId);
  const result = await repo.restoreObject(objectId, id);
  if (!result.count)
    throw Object.assign(new Error("Deleted file not found."), { status: 404 });
  return { ok: true, restored: true };
}

export async function permanentlyDeleteObject(user, id, objectId) {
  const actor = actorScope(user);
  await repo.requireOwned(id, actor.organizationId);
  const result = await repo.permanentlyDeleteObject(objectId, id);
  if (!result.count)
    throw Object.assign(new Error("Deleted file not found."), { status: 404 });
  return { ok: true, permanentlyDeleted: true };
}

export async function listRestorePoints(user, id) {
  const actor = actorScope(user);
  await repo.requireOwned(id, actor.organizationId);
  return repo.listRestorePoints(id);
}

export async function createRestorePoint(user, id, kind = "manual") {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const point = await repo.createRestorePoint({
    serviceId: id,
    kind,
    status: "available",
    sizeBytes: service.storageUsedBytes,
    metadata: JSON.stringify({ requestedBy: actor.userId }),
  });
  await log(service, "backup", "restore_point_created", "completed", {
    restorePointId: point.id,
    kind,
  });
  return point;
}

export async function restoreFromPoint(user, id, restorePointId) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const point = await repo.restorePoint(restorePointId, id);
  await log(service, "backup", "restore_completed", "completed", {
    restorePointId,
  });
  return point;
}

export async function createPaymentOrder(user, id) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  if (service.status !== "pending_payment")
    throw Object.assign(new Error("This service is not awaiting payment."), {
      status: 409,
    });
  const total = (service.totalPriceCents / 100).toFixed(2);
  const created = await createPaypalOrderWithOptionalVault({
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: `cloud-storage-${service.id}`,
        description: `Glondia Cloud Storage - ${service.name}`,
        amount: { currency_code: service.currency, value: total },
      },
    ],
    application_context: {
      brand_name: "Glondia",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: `${FRONTEND}/cloud-storage/${service.id}`,
      cancel_url: `${FRONTEND}/cloud-storage`,
    },
  });
  const order = await prisma.$transaction(async (tx) => {
    const checkout = await tx.checkoutOrder.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId === "local-user" ? null : actor.userId,
        type: "cloud_storage",
        provider: "paypal",
        providerOrderId: created.id,
        status: "pending",
        currency: service.currency,
        actualAmountCents: service.monthlyCostCents,
        markupPercent: service.markupPercent,
        markupAmountCents: service.markupAmountCents,
        totalAmountCents: service.totalPriceCents,
        metadata: JSON.stringify({ serviceId: service.id }),
      },
    });
    const invoice = await tx.invoice.create({
      data: {
        userId: actor.userId === "local-user" ? null : actor.userId,
        organizationId: actor.organizationId,
        orderId: checkout.id,
        invoiceNumber: `CS-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`,
        status: "issued",
        settlementStatus: "not_ready",
        currency: service.currency,
        subtotalCents: service.totalPriceCents,
        totalCents: service.totalPriceCents,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        issuedAt: new Date(),
        metadata: JSON.stringify({
          scope: "cloud_storage_service",
          serviceId: service.id,
        }),
        lineItems: {
          create: {
            serviceType: "cloud_storage",
            serviceId: service.id,
            lineClassification: "recurring_charge",
            direction: "debit",
            sourceTable: "cloud_storage_services",
            sourceId: service.id,
            description: `${service.name} monthly plan`,
            quantity: 1,
            unitCents: service.totalPriceCents,
            providerAmountCents: service.monthlyCostCents,
            markupPercent: service.markupPercent,
            markupAmountCents: service.markupAmountCents,
            totalCents: service.totalPriceCents,
            metadata: JSON.stringify({
              tenancy: service.tenancy,
              planSize: service.planSize,
            }),
          },
        },
      },
      include: { lineItems: true },
    });
    await tx.billingLedger.updateMany({
      where: {
        serviceType: "cloud_storage",
        serviceId: service.id,
        classification: "recurring_charge",
      },
      data: {
        stage: "invoiced",
        checkoutOrderId: checkout.id,
        invoiceId: invoice.id,
        invoiceLineItemId: invoice.lineItems[0]?.id || null,
      },
    });
    await tx.cloudStorageService.update({
      where: { id },
      data: { checkoutOrderId: checkout.id },
    });
    return checkout;
  });
  await log(
    service,
    "billing",
    "checkout_created",
    "completed",
    {},
    { checkoutOrderId: order.id },
  );
  return {
    orderId: created.id,
    approvalUrl: created.approvalUrl,
    serviceId: service.id,
  };
}

export async function capturePayment(user, id, paypalOrderId) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  const order = await prisma.checkoutOrder.findFirst({
    where: {
      id: service.checkoutOrderId || undefined,
      providerOrderId: paypalOrderId,
      organizationId: actor.organizationId,
    },
  });
  if (!order)
    throw Object.assign(new Error("Payment order not found."), { status: 404 });
  if (order.status === "paid" && service.status === "active")
    return toClient(service);
  const capture = await capturePaypalOrderRaw(paypalOrderId);
  const payment = capture.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedCents = Math.round(Number(payment?.amount?.value || 0) * 100);
  if (
    payment?.status !== "COMPLETED" ||
    payment.amount?.currency_code !== order.currency ||
    capturedCents !== order.totalAmountCents
  ) {
    throw Object.assign(new Error("Payment verification failed."), {
      status: 400,
    });
  }
  const paidOrder = await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: { status: "paid", providerCaptureId: payment.id },
  });
  await recordPaymentTransaction({
    order: paidOrder,
    providerTransactionId: payment.id,
    status: "completed",
    metadata: { serviceId: id },
  });
  await prisma.billingLedger.updateMany({
    where: {
      serviceType: "cloud_storage",
      serviceId: id,
      classification: "recurring_charge",
    },
    data: {
      stage: "paid",
      status: "paid",
      paidAt: new Date(),
      checkoutOrderId: order.id,
    },
  });
  await prisma.invoice.updateMany({
    where: { orderId: order.id, organizationId: actor.organizationId },
    data: { status: "paid", settlementStatus: "funded", paidAt: new Date() },
  });
  return toClient(
    await provision(await repo.requireOwned(id, actor.organizationId), true),
  );
}

export async function configureRepository(user, id, input = {}) {
  const actor = actorScope(user);
  const service = await repo.requireOwned(id, actor.organizationId);
  if (service.serviceKind !== "private_repository")
    throw Object.assign(new Error("This is not a repository service."), {
      status: 400,
    });
  const existing = await repo.getRepoLink(id);
  const secret = randomBytes(32).toString("base64url");
  const repositoryName = String(input.repositoryName || service.name)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 100);
  const link = await repo.upsertRepoLink(id, {
    repositoryName,
    hostingServiceId: input.hostingServiceId || null,
    deploymentBranch: String(
      input.deploymentBranch || service.deploymentBranch || "main",
    ).slice(0, 100),
    autoDeployEnabled: input.autoDeployEnabled !== false,
    webhookSecretHash: createHash("sha256").update(secret).digest("hex"),
    metadata: JSON.stringify({
      ...safeJson(existing?.metadata),
      secretCiphertext: encryptCredentials({ webhookSecret: secret }),
    }),
  });
  return {
    link: { ...link, webhookSecretHash: undefined, metadata: undefined },
    webhookSecret: secret,
    webhookUrl: `/api/cloud-storage/webhooks/repositories/${link.id}`,
  };
}

export async function handleRepositoryWebhook(linkId, headers, body) {
  const link = await prisma.cloudStorageRepositoryLink.findUnique({
    where: { id: linkId },
    include: { service: true },
  });
  if (!link || !link.autoDeployEnabled)
    throw Object.assign(new Error("Repository webhook not found."), {
      status: 404,
    });
  const deliveryId = String(
    headers["x-gitea-delivery"] ||
      headers["x-github-delivery"] ||
      body?.deliveryId ||
      "",
  );
  if (!deliveryId)
    throw Object.assign(new Error("Webhook delivery ID is required."), {
      status: 400,
    });
  if (link.lastDeliveryId === deliveryId)
    return {
      accepted: true,
      duplicate: true,
      deploymentId: link.lastDeploymentId,
    };
  const secret = decryptCredentials(
    safeJson(link.metadata).secretCiphertext,
  )?.webhookSecret;
  const payload = JSON.stringify(body || {});
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const supplied = String(headers["x-glondia-signature"] || "").replace(
    /^sha256=/,
    "",
  );
  if (
    !supplied ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw Object.assign(new Error("Webhook signature is invalid."), {
      status: 401,
    });
  }
  const branch = String(body?.ref || body?.branch || "").replace(
    /^refs\/heads\//,
    "",
  );
  if (branch !== link.deploymentBranch)
    return { accepted: true, skipped: true, reason: "branch_not_configured" };
  const commitSha = String(
    body?.after || body?.commitSha || body?.head_commit?.id || "",
  ).slice(0, 64);
  if (commitSha && link.lastCommitSha === commitSha) {
    await repo.updateRepoLink(link.id, { lastDeliveryId: deliveryId });
    return {
      accepted: true,
      duplicate: true,
      deploymentId: link.lastDeploymentId,
    };
  }
  const deploymentId = link.hostingServiceId
    ? (
        await hostingService.redeploy(link.hostingServiceId, {
          reason: "private_repository_push",
          commitId: commitSha,
        })
      )?.deploymentId || link.hostingServiceId
    : `repo-deploy-${randomUUID()}`;
  await repo.updateRepoLink(link.id, {
    lastDeliveryId: deliveryId,
    lastCommitSha: commitSha || null,
    lastDeploymentId: deploymentId,
  });
  await log(
    link.service,
    "repository",
    "auto_deploy_triggered",
    "completed",
    { deliveryId, branch, commitSha },
    { deploymentId },
  );
  return { accepted: true, deploymentId };
}

export { actorScope };
