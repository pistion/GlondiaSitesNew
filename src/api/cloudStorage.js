import { authFetch } from "./auth.js";
import {
  CLOUD_STORAGE_SANDBOX_SERVICE_KEY,
  getActiveServiceSandbox,
} from "../features/sandbox/sandboxState.js";

const GB = 1073741824;
const CLOUD_STORAGE_SANDBOX_OBJECTS_KEY = "glondia.cloud-storage.objects";
const KINDS = ["postgres", "ssh_backup", "private_vault", "private_repository"];
const storageSandbox = () => {
  const active = getActiveServiceSandbox();
  return active?.service === "cloud-storage" ? active : null;
};
const storedService = () => {
  try {
    const value = window.localStorage.getItem(
      CLOUD_STORAGE_SANDBOX_SERVICE_KEY,
    );
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
const persistService = (service) => {
  try {
    window.localStorage.setItem(
      CLOUD_STORAGE_SANDBOX_SERVICE_KEY,
      JSON.stringify(service),
    );
  } catch {}
  return service;
};
const sandboxCatalog = () => ({
  kinds: [
    { id: "postgres", name: "Managed PostgreSQL" },
    { id: "ssh_backup", name: "SSH Backup" },
    { id: "private_vault", name: "Private File Storage" },
    { id: "private_repository", name: "Private Repository" },
  ],
  regions: [
    { id: "syd", name: "Sydney, AU" },
    { id: "sgp", name: "Singapore, SG" },
    { id: "ewr", name: "New Jersey, US" },
  ],
  plans: KINDS.flatMap((serviceKind) =>
    ["shared", "dedicated"].flatMap((tenancy) =>
      (serviceKind === "postgres"
        ? ["10gb", "50gb", "100gb"]
        : ["smallest", "largest"]
      ).map((size) => {
        const largest = size === "largest" || size === "100gb";
        const capacity =
          serviceKind === "postgres"
            ? Number(size.replace("gb", ""))
            : largest
              ? 1024
              : 50;
        const base =
          serviceKind === "postgres"
            ? 500
            : serviceKind === "private_repository"
              ? 600
              : 400;
        const sizeFactor = size === "50gb" ? 3 : largest ? 5 : 1;
        return {
          id: `${serviceKind}-${tenancy}-${size}`,
          serviceKind,
          tenancy,
          size,
          label: size,
          totalPriceCents:
            base * sizeFactor * (tenancy === "dedicated" ? 3 : 1),
          currency: "USD",
          capacityBytes: String(capacity * GB),
          transferIncludedBytes: String((largest ? 2048 : 100) * GB),
        };
      }),
    ),
  ),
  status: "sandbox",
  lastSyncedAt: new Date().toISOString(),
});
const sandboxService = (override = {}) => {
  const sandbox = storageSandbox();
  const payload = {
    serviceKind: "private_vault",
    tenancy: "dedicated",
    planSize: "largest",
    region: "syd",
    name: "Company File Storage",
    storageUsedGb: 286,
    ...(sandbox?.payload || {}),
    ...override,
  };
  if (
    payload.serviceKind === "postgres" &&
    !String(payload.planSize).endsWith("gb")
  ) {
    payload.planSize = "50gb";
  }
  const catalog = sandboxCatalog();
  const plan =
    catalog.plans.find(
      (item) =>
        item.serviceKind === payload.serviceKind &&
        item.tenancy === payload.tenancy &&
        item.size === payload.planSize,
    ) || catalog.plans[0];
  return {
    id: "sandbox-cloud-storage-1",
    name: payload.name,
    serviceKind: payload.serviceKind,
    tenancy: payload.tenancy,
    planKey: plan.id,
    planSize: plan.size,
    region: payload.region,
    postgresVersion: payload.serviceKind === "postgres" ? "16" : null,
    externalAccessEnabled:
      payload.serviceKind === "postgres" &&
      Boolean(payload.externalAccessEnabled),
    status: "active",
    provisioningStage: "ready",
    syncStatus: "synced",
    adminStatus: "allowed",
    paymentStatus: "paid",
    capacityBytes: plan.capacityBytes,
    transferIncludedBytes: plan.transferIncludedBytes,
    storageUsedBytes: String(Number(payload.storageUsedGb || 12) * GB),
    transferUsedBytes: String(18 * GB),
    overageStorageBytes: "0",
    overageTransferBytes: "0",
    totalPriceCents: plan.totalPriceCents,
    currency: "USD",
    deploymentBranch: payload.deploymentBranch || "main",
    retentionDaily: 7,
    retentionWeekly: 4,
    credentialsAvailable: true,
    credentialsPreview: "Access available",
    endpoint: "storage.sandbox.glondia.local",
    repositoryUrl:
      payload.serviceKind === "private_repository"
        ? "ssh://git@sandbox.glondia.local/website.git"
        : null,
    activatedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    updatedAt: new Date().toISOString(),
    sandbox: true,
  };
};
const currentService = () => storedService() || sandboxService();

function url(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || "").replace(
    /\/+$/,
    "",
  );
  return `${base || "/api"}${path}`;
}
async function request(path, options = {}) {
  const response = await authFetch(url(path), {
    method: options.method || "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      result?.error?.message ||
        result?.message ||
        `Cloud Storage request failed (${response.status}).`,
    );
  return result.data ?? result;
}
const servicePath = (id, suffix = "") =>
  `/cloud-storage/services/${encodeURIComponent(id)}${suffix}`;
const driveSessionKey = (id) => `glondia.drive.session.${id}`;
const driveSessionHeader = (id) => {
  try {
    const value = window.sessionStorage.getItem(driveSessionKey(id));
    return value ? { "X-Drive-Session": value } : {};
  } catch {
    return {};
  }
};

export const getCloudStorageCatalog = () =>
  storageSandbox()
    ? Promise.resolve(sandboxCatalog())
    : request("/cloud-storage/catalog");
export const listCloudStorageServices = () =>
  storageSandbox()
    ? Promise.resolve(
        storageSandbox()?.id === "cloud-storage.create" && !storedService()
          ? []
          : [currentService()],
      )
    : request("/cloud-storage/services");
export const quoteCloudStorage = (body) =>
  storageSandbox()
    ? Promise.resolve(
        (() => {
          const plan = sandboxCatalog().plans.find(
            (item) =>
              item.serviceKind === body.serviceKind &&
              item.tenancy === body.tenancy &&
              item.size === body.planSize,
          );
          if (!plan)
            throw new Error("The selected sandbox plan is unavailable.");
          return {
            ...body,
            planId: plan.id,
            capacityBytes: plan.capacityBytes,
            transferIncludedBytes: plan.transferIncludedBytes,
            totalPriceCents: plan.totalPriceCents,
            currency: "USD",
            billingModel: "sandbox",
          };
        })(),
      )
    : request("/cloud-storage/quote", { method: "POST", body });
export const createCloudStorageService = (body) =>
  storageSandbox()
    ? Promise.resolve(persistService(sandboxService(body)))
    : request("/cloud-storage/services", { method: "POST", body });
export const getCloudStorageService = (id) =>
  storageSandbox()
    ? Promise.resolve(currentService())
    : request(servicePath(id));
export const getCloudStorageUsage = (id) =>
  storageSandbox()
    ? Promise.resolve({
        service: currentService(),
        samples: [
          {
            id: "usage-1",
            storageBytes: currentService().storageUsedBytes,
            transferBytes: currentService().transferUsedBytes,
            requestCount: 18432,
            source: "service monitor",
            sampledAt: new Date().toISOString(),
          },
          {
            id: "usage-2",
            storageBytes: String(10 * GB),
            transferBytes: String(12 * GB),
            requestCount: 15208,
            source: "service monitor",
            sampledAt: new Date(Date.now() - 86400000).toISOString(),
          },
          {
            id: "usage-3",
            storageBytes: String(8 * GB),
            transferBytes: String(9 * GB),
            requestCount: 11940,
            source: "service monitor",
            sampledAt: new Date(Date.now() - 172800000).toISOString(),
          },
        ],
      })
    : request(servicePath(id, "/usage"));
export const getCloudStorageLogs = (id) =>
  storageSandbox()
    ? Promise.resolve([
        {
          id: "log-1",
          action: "sftp_session_opened",
          stage: "ssh",
          status: "completed",
          createdAt: new Date(Date.now() - 240000).toISOString(),
        },
        {
          id: "log-2",
          action: "upload_completed",
          stage: "upload",
          status: "completed",
          createdAt: new Date(Date.now() - 180000).toISOString(),
        },
        {
          id: "log-3",
          action: "download_completed",
          stage: "download",
          status: "completed",
          createdAt: new Date(Date.now() - 120000).toISOString(),
        },
        {
          id: "log-4",
          action: "sftp_session_closed",
          stage: "ssh",
          status: "completed",
          createdAt: new Date(Date.now() - 60000).toISOString(),
        },
      ])
    : request(servicePath(id, "/logs"));
export const getCloudStorageBilling = (id) =>
  storageSandbox()
    ? Promise.resolve({
        service: currentService(),
        ledger: [
          {
            id: "sandbox-ledger-plan",
            description: `${currentService().name} monthly plan`,
            billingType: "charge",
            classification: "recurring_charge",
            direction: "debit",
            quantity: 1,
            unitCents: currentService().totalPriceCents,
            amountCents: currentService().totalPriceCents,
            currency: "USD",
            status: "paid",
            createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
          },
          {
            id: "sandbox-ledger-usage",
            description: "Data transfer overage",
            billingType: "usage",
            classification: "usage_charge",
            direction: "debit",
            quantity: 2,
            unitCents: 130,
            amountCents: 260,
            currency: "USD",
            status: "paid",
            createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
          },
          {
            id: "sandbox-ledger-payment",
            description: "Invoice payment",
            billingType: "payment",
            classification: "payment",
            direction: "credit",
            quantity: 1,
            unitCents: currentService().totalPriceCents + 260,
            amountCents: currentService().totalPriceCents + 260,
            currency: "USD",
            status: "paid",
            createdAt: new Date(Date.now() - 86400000).toISOString(),
          },
        ],
        invoices: [
          {
            id: "sandbox-invoice",
            invoiceNumber: "SANDBOX-CS-001",
            status: "paid",
            currency: "USD",
            subtotalCents: currentService().totalPriceCents + 260,
            taxCents: 0,
            discountCents: 0,
            totalCents: currentService().totalPriceCents + 260,
            issuedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
            createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
            lineItems: [
              {
                id: "sandbox-line-plan",
                description: `${currentService().name} monthly plan`,
                lineClassification: "recurring_charge",
                quantity: 1,
                unitCents: currentService().totalPriceCents,
                totalCents: currentService().totalPriceCents,
              },
              {
                id: "sandbox-line-usage",
                description: "Data transfer overage",
                lineClassification: "usage_charge",
                quantity: 2,
                unitCents: 130,
                totalCents: 260,
              },
            ],
          },
        ],
      })
    : request(servicePath(id, "/billing"));
export const getCloudStorageCredentials = (id) => {
  if (!storageSandbox()) return request(servicePath(id, "/credentials"));
  const service = currentService();
  let credentials = {
    endpoint: service.endpoint,
    access: "Signed browser operations",
  };
  if (service.serviceKind === "postgres") {
    credentials = {
      sandboxDisabled: true,
      internal: {
        host: "postgres.sandbox.glondia.internal",
        port: 5432,
        database: "db_sandbox_site",
        username: "internal_sandbox",
        password: "sandbox-internal-password",
        sslMode: "require",
        url: "postgresql://internal_sandbox:sandbox-internal-password@postgres.sandbox.glondia.internal:5432/db_sandbox_site?sslmode=require",
      },
      external: {
        host: "postgres.sandbox.glondia.com",
        port: 5432,
        database: "db_sandbox_site",
        username: "external_sandbox",
        password: "sandbox-external-password",
        sslMode: "require",
        url: "postgresql://external_sandbox:sandbox-external-password@postgres.sandbox.glondia.com:5432/db_sandbox_site?sslmode=require",
      },
    };
  } else if (service.serviceKind === "ssh_backup") {
    credentials = {
      host: "backup.sandbox.glondia.local",
      port: 22,
      username: "sandbox_backup",
      protocol: "sftp/rsync",
    };
  } else if (service.serviceKind === "private_repository") {
    credentials = {
      repositoryUrl: service.repositoryUrl,
      deployKey: "Sandbox key hidden",
    };
  } else if (service.serviceKind === "private_vault") {
    credentials = {
      transferAccess: {
        host: "sftp.sandbox.glondia.local",
        port: 22,
        username: "drive_sandbox",
        password: "sandbox-drive-password",
        privateKey: "-----BEGIN PRIVATE KEY-----\nSandbox preview key\n-----END PRIVATE KEY-----",
        protocol: "sftp/ssh",
        root: "/drive",
        scope: "cloud-drive-container",
        configured: false,
        sshCommand: "ssh drive_sandbox@sftp.sandbox.glondia.local",
        sftpCommand: "sftp drive_sandbox@sftp.sandbox.glondia.local",
      },
    };
  }
  return Promise.resolve({ serviceId: id, credentials });
};
export const updateCloudStorageSettings = (id, body) =>
  storageSandbox()
    ? Promise.resolve(
        persistService({
          ...currentService(),
          ...body,
          updatedAt: new Date().toISOString(),
        }),
      )
    : request(servicePath(id, "/settings"), { method: "PATCH", body });
export const listCloudStorageObjects = (id, deleted = false) =>
  storageSandbox()
    ? Promise.resolve(
        (() => {
          try {
            const stored = window.localStorage.getItem(
              CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
            );
            if (stored) {
              const items = JSON.parse(stored);
              const cleaned = items.filter(
                (item) =>
                  item.id !== "file-1" &&
                  item.objectKey !== "Documents/Company documents",
              );
              if (cleaned.length !== items.length) {
                window.localStorage.setItem(
                  CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
                  JSON.stringify(cleaned),
                );
              }
              return deleted
                ? cleaned
                : cleaned.filter((item) => !item.deletedAt && item.status !== "deleted");
            }
          } catch {}
          return [];
        })(),
      )
    : request(`${servicePath(id, "/objects")}?includeDeleted=${deleted}`, { headers: driveSessionHeader(id) });
export const registerCloudStorageObject = (id, body) =>
  storageSandbox()
    ? listCloudStorageObjects(id, true).then((items) => {
        const record = {
          id: `sandbox-file-${Date.now()}`,
          ...body,
          status: "active",
          version: 1,
        };
        try {
          window.localStorage.setItem(
            CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
            JSON.stringify([...items, record]),
          );
        } catch {}
        return record;
      })
    : request(servicePath(id, "/objects"), { method: "POST", body, headers: driveSessionHeader(id) });
export const deleteCloudStorageObject = (id, objectId) =>
  storageSandbox()
    ? listCloudStorageObjects(id, true).then((items) => {
        try {
          window.localStorage.setItem(
            CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
            JSON.stringify(items.map((item) =>
              item.id === objectId
                ? { ...item, status: "deleted", deletedAt: new Date().toISOString() }
                : item,
            )),
          );
        } catch {}
        return { ok: true, recoverable: true, objectId };
      })
    : request(servicePath(id, `/objects/${encodeURIComponent(objectId)}`), {
        method: "DELETE",
        headers: driveSessionHeader(id),
      });
export const restoreCloudStorageObject = (id, objectId) =>
  storageSandbox()
    ? listCloudStorageObjects(id, true).then((items) => {
        const restored = items.map((item) =>
          item.id === objectId
            ? { ...item, status: "active", deletedAt: null }
            : item,
        );
        try {
          window.localStorage.setItem(
            CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
            JSON.stringify(restored),
          );
        } catch {}
        return restored.find((item) => item.id === objectId);
      })
    : request(servicePath(id, `/objects/${encodeURIComponent(objectId)}/restore`), {
        method: "POST",
        headers: driveSessionHeader(id),
      });
export const permanentlyDeleteCloudStorageObject = (id, objectId) =>
  storageSandbox()
    ? listCloudStorageObjects(id, true).then((items) => {
        try {
          window.localStorage.setItem(
            CLOUD_STORAGE_SANDBOX_OBJECTS_KEY,
            JSON.stringify(items.filter((item) => item.id !== objectId)),
          );
        } catch {}
        return { ok: true, permanentlyDeleted: true };
      })
    : request(servicePath(id, `/objects/${encodeURIComponent(objectId)}/permanent`), {
        method: "DELETE",
        headers: driveSessionHeader(id),
      });
export const getCloudDriveSecurity = (id) =>
  storageSandbox()
    ? Promise.resolve({
        accountEmail: "sandbox@glondia.local",
        passwordVersion: 1,
        initialPasswordAvailable: true,
        twoFactorEnabled: false,
        twoFactorAvailable: false,
      })
    : request(servicePath(id, "/drive/security"));
export const revealCloudDrivePassword = (id) =>
  storageSandbox()
    ? Promise.resolve({ password: "SandboxDrive!2026" })
    : request(servicePath(id, "/drive/password/reveal"), { method: "POST" });
export const updateCloudDrivePassword = (id, password) =>
  storageSandbox()
    ? Promise.resolve({ passwordVersion: 2, initialPasswordAvailable: false, accountEmail: "sandbox@glondia.local", twoFactorEnabled: false, twoFactorAvailable: false })
    : request(servicePath(id, "/drive/password"), { method: "PUT", body: { password } });
export const loginCloudDrive = (id, email, password) =>
  storageSandbox()
    ? Promise.resolve({ token: `sandbox-drive-${id}`, expiresAt: new Date(Date.now() + 28800000).toISOString(), accountEmail: email })
    : request(servicePath(id, "/drive/login"), { method: "POST", body: { email, password } });
export const storeCloudDriveSession = (id, token) => {
  window.sessionStorage.setItem(driveSessionKey(id), token);
};
export const clearCloudDriveSession = (id) => {
  window.sessionStorage.removeItem(driveSessionKey(id));
};
export const verifyCloudDriveSession = (id) =>
  storageSandbox()
    ? Promise.resolve({ authenticated: Boolean(window.sessionStorage.getItem(driveSessionKey(id))) })
    : request(servicePath(id, "/drive/session"), { headers: driveSessionHeader(id) });
export const listCloudStorageRestorePoints = (id) =>
  storageSandbox()
    ? Promise.resolve([
        {
          id: "restore-1",
          kind: "daily",
          status: "available",
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      ])
    : request(servicePath(id, "/restore-points"));
export const createCloudStorageRestorePoint = (id) =>
  storageSandbox()
    ? Promise.resolve({
        id: "restore-new",
        kind: "manual",
        status: "available",
        createdAt: new Date().toISOString(),
      })
    : request(servicePath(id, "/restore-points"), {
        method: "POST",
        body: { kind: "manual" },
      });
export const restoreCloudStoragePoint = (id, pointId) =>
  storageSandbox()
    ? Promise.resolve({ id: pointId, status: "restored" })
    : request(
        servicePath(
          id,
          `/restore-points/${encodeURIComponent(pointId)}/restore`,
        ),
        { method: "POST" },
      );
export const createCloudStoragePayment = (id) =>
  request(servicePath(id, "/paypal/create-order"), { method: "POST" });
export const configureCloudStorageRepository = (id, body) =>
  storageSandbox()
    ? Promise.resolve({
        link: body,
        webhookUrl: "/sandbox/cloud-storage/repository-webhook",
      })
    : request(servicePath(id, "/repository"), { method: "PUT", body });
