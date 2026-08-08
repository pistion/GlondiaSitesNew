import * as repo from "../repositories/cloudStorage.repository.js";
import * as vultr from "./vultrApiService.js";

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const MARKUP = 30;
const ACTIVE_KINDS = new Set([
  "postgres",
  "ssh_backup",
  "private_vault",
  "private_repository",
]);
const SYNC_MS = Math.max(
  60_000,
  Number(
    process.env.CLOUD_STORAGE_CATALOG_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000,
  ),
);

const KINDS = [
  {
    id: "postgres",
    name: "Managed PostgreSQL",
    description:
      "Private relational database with automated backups and connection pooling.",
  },
  {
    id: "ssh_backup",
    name: "SSH Backup",
    description:
      "Restricted SFTP and rsync backup space with managed restore points.",
  },
  {
    id: "private_vault",
    name: "Private File Storage",
    description:
      "A private cloud hard drive for storing, organizing and retrieving files.",
  },
  {
    id: "private_repository",
    name: "Private Repository",
    description:
      "Private Git history with deploy keys and automatic website redeployment.",
  },
];

function plan(
  serviceKind,
  tenancy,
  size,
  providerCostCents,
  capacityBytes,
  transferBytes,
  extra = {},
) {
  const markupAmountCents =
    providerCostCents === 0
      ? 0
      : Math.round((providerCostCents * MARKUP) / 100);
  return {
    id: `${serviceKind}-${tenancy}-${size}`,
    serviceKind,
    tenancy,
    size,
    label:
      serviceKind === "postgres"
        ? size.toUpperCase()
        : size === "smallest"
          ? "Smallest"
          : "Largest",
    providerCostCents,
    markupPercent: MARKUP,
    markupAmountCents,
    totalPriceCents: providerCostCents + markupAmountCents,
    currency: "USD",
    capacityBytes: String(capacityBytes),
    transferIncludedBytes: String(transferBytes),
    ...extra,
  };
}

export const SEEDED_CLOUD_STORAGE_CATALOG = {
  kinds: KINDS,
  regions: [
    { id: "syd", city: "Sydney", country: "au" },
    { id: "sgp", city: "Singapore", country: "sg" },
    { id: "ewr", city: "New Jersey", country: "us" },
  ],
  plans: [
    plan("postgres", "shared", "10gb", 500, 10 * GB, 100 * GB, {
      postgresVersions: ["15", "16"],
      resources: "Shared database · 10 GB",
    }),
    plan("postgres", "shared", "50gb", 1400, 50 * GB, 500 * GB, {
      postgresVersions: ["15", "16"],
      resources: "Shared database · 50 GB",
    }),
    plan("postgres", "shared", "100gb", 2500, 100 * GB, TB, {
      postgresVersions: ["15", "16"],
      resources: "Shared database · 100 GB",
    }),
    plan("postgres", "dedicated", "10gb", 3000, 10 * GB, TB, {
      postgresVersions: ["15", "16"],
      providerPlan: "vultr-dbaas-startup-cc-1-55-2",
      resources: "Dedicated database · 10 GB allocation",
    }),
    plan("postgres", "dedicated", "50gb", 6000, 50 * GB, 2 * TB, {
      postgresVersions: ["15", "16"],
      providerPlan: "vultr-dbaas-startup-cc-1-55-2",
      resources: "Dedicated database · 50 GB allocation",
    }),
    plan("postgres", "dedicated", "100gb", 10000, 100 * GB, 5 * TB, {
      postgresVersions: ["15", "16"],
      providerPlan: "vultr-dbaas-business-cc-2-110-4",
      resources: "Dedicated database · 100 GB allocation",
    }),
    plan("ssh_backup", "shared", "smallest", 500, 100 * GB, 100 * GB),
    plan("ssh_backup", "shared", "largest", 4000, 2 * TB, TB),
    plan("ssh_backup", "dedicated", "smallest", 1200, 250 * GB, TB, {
      computePlan: "vc2-1c-1gb",
      blockSizeGb: 250,
    }),
    plan("ssh_backup", "dedicated", "largest", 12000, 5 * TB, 5 * TB, {
      computePlan: "vhf-2c-4gb",
      blockSizeGb: 5120,
    }),
    plan("private_vault", "shared", "smallest", 400, 50 * GB, 100 * GB),
    plan("private_vault", "shared", "largest", 3500, TB, TB),
    plan("private_vault", "dedicated", "smallest", 500, TB, TB, {
      providerTier: 1,
    }),
    plan("private_vault", "dedicated", "largest", 10000, 10 * TB, 10 * TB, {
      providerTier: 2,
    }),
    plan("private_repository", "shared", "smallest", 600, 10 * GB, 100 * GB),
    plan("private_repository", "shared", "largest", 3000, 250 * GB, TB),
    plan("private_repository", "dedicated", "smallest", 1800, 80 * GB, TB, {
      computePlan: "vc2-1c-1gb",
      blockSizeGb: 80,
    }),
    plan("private_repository", "dedicated", "largest", 9600, TB, 5 * TB, {
      computePlan: "vhf-4c-8gb",
      blockSizeGb: 1024,
    }),
  ],
  syncedAt: null,
  source: "seeded",
};

export async function seedCloudStorageCatalog() {
  const existing = await repo.getCatalogSnapshot("catalog");
  let current = null;
  try {
    current = existing ? JSON.parse(existing.payload) : null;
  } catch {}
  const postgresSizes = new Set(
    (current?.plans || [])
      .filter((item) => item.serviceKind === "postgres")
      .map((item) => item.size),
  );
  if (
    !existing ||
    !["10gb", "50gb", "100gb"].every((size) => postgresSizes.has(size))
  )
    await repo.putCatalogSnapshot(
      "catalog",
      {
        ...SEEDED_CLOUD_STORAGE_CATALOG,
        providerCatalog: current?.providerCatalog,
      },
      "seeded",
    );
}

export async function getCloudStorageCatalog() {
  await seedCloudStorageCatalog();
  const snapshot = await repo.getCatalogSnapshot("catalog");
  try {
    const parsed = JSON.parse(snapshot.payload);
    return {
      ...parsed,
      kinds: KINDS,
      plans: (parsed.plans || []).filter((item) =>
        ACTIVE_KINDS.has(item.serviceKind),
      ),
      status: snapshot.syncStatus,
      lastSyncedAt: snapshot.lastSyncedAt,
      error: snapshot.errorMessage,
    };
  } catch {
    return { ...SEEDED_CLOUD_STORAGE_CATALOG, status: "seeded" };
  }
}

export async function getClientCloudStorageCatalog() {
  const catalog = await getCloudStorageCatalog();
  return {
    kinds: catalog.kinds,
    regions: (catalog.regions || []).map((region) => ({
      id: region.id,
      name:
        region.name ||
        [region.city, region.country?.toUpperCase()].filter(Boolean).join(", "),
    })),
    plans: (catalog.plans || []).map((item) => ({
      id: item.id,
      serviceKind: item.serviceKind,
      tenancy: item.tenancy,
      size: item.size,
      label: item.label,
      totalPriceCents: item.totalPriceCents,
      currency: item.currency,
      capacityBytes: item.capacityBytes,
      transferIncludedBytes: item.transferIncludedBytes,
      postgresVersions: item.postgresVersions,
      resources: item.resources,
    })),
    status: catalog.status,
    lastSyncedAt: catalog.lastSyncedAt,
  };
}

export async function syncCloudStorageCatalog() {
  if (!vultr.isConfigured()) return false;
  try {
    const [regions, databasePlans, objectTiers, objectClusters, computePlans] =
      await Promise.all([
        vultr.listRegions(),
        vultr.listDatabasePlans(),
        vultr.listObjectStorageTiers(),
        vultr.listObjectStorageClusters(),
        vultr.listPlans(),
      ]);
    const current = await getCloudStorageCatalog();
    await repo.putCatalogSnapshot("catalog", {
      ...current,
      regions,
      providerCatalog: {
        databasePlans,
        objectTiers,
        objectClusters,
        computePlans,
      },
      syncedAt: new Date().toISOString(),
      source: "provider_sync",
    });
    return true;
  } catch (error) {
    const current = await getCloudStorageCatalog();
    await repo.putCatalogSnapshot("catalog", current, "stale", error.message);
    console.warn(
      "[cloud-storage-catalog] Provider sync failed; retaining database snapshot:",
      error.message,
    );
    return false;
  }
}

export function startCloudStorageCatalogScheduler() {
  const initial = setTimeout(
    () => syncCloudStorageCatalog().catch(() => {}),
    2_000,
  );
  initial.unref?.();
  const timer = setInterval(
    () => syncCloudStorageCatalog().catch(() => {}),
    SYNC_MS,
  );
  timer.unref?.();
  return {
    close() {
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}
