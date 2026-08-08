import { prisma } from './db.js';
import * as vultr from './vultrApiService.js';

const SYNC_INTERVAL_MS = Math.max(60_000, Number(process.env.VPS_CATALOG_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000));

// Immediate, deterministic catalog shown before the first provider sync.
const SEEDED_CATALOG = {
  regions: [
    { id: 'ewr', city: 'New Jersey', country: 'us', continent: 'North America', options: ['ddos_protection'] },
    { id: 'lhr', city: 'London', country: 'gb', continent: 'Europe', options: [] },
    { id: 'sgp', city: 'Singapore', country: 'sg', continent: 'Asia', options: [] },
    { id: 'syd', city: 'Sydney', country: 'au', continent: 'Oceania', options: [] },
  ],
  plans: [
    { id: 'vc2-1c-1gb', type: 'vc2', vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 6, locations: ['ewr', 'lhr', 'sgp', 'syd'] },
    { id: 'vc2-2c-2gb', type: 'vc2', vcpu_count: 2, ram: 2048, disk: 55, bandwidth: 2, monthly_cost: 12, locations: ['ewr', 'lhr', 'sgp', 'syd'] },
    { id: 'vhf-1c-2gb', type: 'vhf', vcpu_count: 1, ram: 2048, disk: 64, bandwidth: 2, monthly_cost: 18, locations: ['ewr', 'lhr', 'sgp'] },
    { id: 'vhp-2c-4gb-amd', type: 'vhp', vcpu_count: 2, ram: 4096, disk: 100, bandwidth: 3, monthly_cost: 24, locations: ['ewr', 'lhr'] },
    { id: 'voc-g-2c-8gb', type: 'voc-g', vcpu_count: 2, ram: 8192, disk: 160, bandwidth: 4, monthly_cost: 48, locations: ['ewr', 'sgp'] },
  ],
  operating_systems: [
    { id: 2284, name: 'Ubuntu 24.04 LTS x64', arch: 'x64', family: 'ubuntu' },
    { id: 2136, name: 'Debian 12 x64', arch: 'x64', family: 'debian' },
    { id: 2138, name: 'AlmaLinux 9 x64', arch: 'x64', family: 'almalinux' },
    { id: 2150, name: 'Rocky Linux 9 x64', arch: 'x64', family: 'rocky' },
  ],
};

function parsePayload(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeSnapshot(kind, payload, status = 'synced', errorMessage = null) {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "vps_catalog_snapshots"
      ("kind", "payload", "sync_status", "error_message", "last_synced_at", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("kind") DO UPDATE SET
       "payload" = excluded."payload",
       "sync_status" = excluded."sync_status",
       "error_message" = excluded."error_message",
       "last_synced_at" = excluded."last_synced_at",
       "updated_at" = excluded."updated_at"`,
    kind, JSON.stringify(payload), status, errorMessage, now, now, now,
  );
}

export async function seedVpsCatalog() {
  for (const [kind, payload] of Object.entries(SEEDED_CATALOG)) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "kind" FROM "vps_catalog_snapshots" WHERE "kind" = ? LIMIT 1`,
      kind,
    );
    if (!rows.length) await writeSnapshot(kind, payload, 'seeded');
  }
}

export async function readVpsCatalog(kind) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "payload" FROM "vps_catalog_snapshots" WHERE "kind" = ? LIMIT 1`,
    kind,
  );
  return parsePayload(rows[0]?.payload, SEEDED_CATALOG[kind] || []);
}

export async function listCachedRegions() {
  return readVpsCatalog('regions');
}

export async function listCachedOperatingSystems() {
  return readVpsCatalog('operating_systems');
}

export async function listCachedPlans(type, { region, curated = false } = {}) {
  let plans = await readVpsCatalog('plans');
  if (type) plans = plans.filter((plan) => plan.type === type);
  plans = plans
    .filter((plan) => vultr.planAvailableInRegion(plan, region))
    .map((plan) => region ? { ...plan, monthly_cost: vultr.planMonthlyCost(plan, region), region } : plan);
  return curated ? vultr.curatePlanRange(plans, region) : plans;
}

export async function getVpsCatalogStatus() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "kind", "sync_status", "error_message", "last_synced_at" FROM "vps_catalog_snapshots"`,
  );
  return rows.reduce((result, row) => {
    result[row.kind] = {
      status: row.sync_status,
      error: row.error_message || null,
      lastSyncedAt: row.last_synced_at || null,
    };
    return result;
  }, {});
}

export async function syncVpsCatalog() {
  if (!vultr.isConfigured()) return false;
  try {
    const [regions, plans, operatingSystems] = await Promise.all([
      vultr.listRegions(),
      vultr.listPlans(),
      vultr.listOs(),
    ]);
    await Promise.all([
      writeSnapshot('regions', regions),
      writeSnapshot('plans', plans),
      writeSnapshot('operating_systems', operatingSystems),
    ]);
    console.log(`[vps-catalog] Synced ${plans.length} plans, ${regions.length} regions, and ${operatingSystems.length} operating systems.`);
    return true;
  } catch (error) {
    console.warn('[vps-catalog] Provider sync failed; retaining database snapshot:', error.message);
    return false;
  }
}

export function startVpsCatalogScheduler() {
  const run = () => syncVpsCatalog().catch((error) => {
    console.warn('[vps-catalog] Scheduled sync failed:', error.message);
  });
  const initial = setTimeout(run, 1_000);
  initial.unref?.();
  const timer = setInterval(run, SYNC_INTERVAL_MS);
  timer.unref?.();
  return {
    close() {
      clearTimeout(initial);
      clearInterval(timer);
    },
  };
}
