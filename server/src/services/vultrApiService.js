const VULTR_BASE = process.env.VULTR_API_BASE_URL || 'https://api.vultr.com/v2';

const TEST_REGIONS = [
  { id: 'ewr', city: 'New Jersey', country: 'us', continent: 'North America', options: ['ddos_protection'] },
  { id: 'ord', city: 'Chicago', country: 'us', continent: 'North America', options: ['ddos_protection'] },
  { id: 'lhr', city: 'London', country: 'gb', continent: 'Europe', options: [] },
  { id: 'sgp', city: 'Singapore', country: 'sg', continent: 'Asia', options: [] },
  { id: 'syd', city: 'Sydney', country: 'au', continent: 'Oceania', options: [] },
];

const TEST_PLANS = [
  { id: 'vc2-1c-1gb', type: 'vc2', vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 6, locations: ['ewr', 'ord', 'lhr', 'sgp', 'syd'] },
  { id: 'vc2-2c-2gb', type: 'vc2', vcpu_count: 2, ram: 2048, disk: 55, bandwidth: 2, monthly_cost: 12, locations: ['ewr', 'ord', 'lhr', 'sgp', 'syd'] },
  { id: 'vhf-1c-2gb', type: 'vhf', vcpu_count: 1, ram: 2048, disk: 64, bandwidth: 2, monthly_cost: 18, locations: ['ewr', 'ord', 'lhr', 'sgp'] },
  { id: 'vhp-2c-4gb-amd', type: 'vhp', vcpu_count: 2, ram: 4096, disk: 100, bandwidth: 3, monthly_cost: 24, locations: ['ewr', 'ord', 'lhr'] },
  { id: 'voc-g-2c-8gb', type: 'voc-g', vcpu_count: 2, ram: 8192, disk: 160, bandwidth: 4, monthly_cost: 48, locations: ['ewr', 'ord', 'sgp'] },
];

const TEST_OS = [
  { id: 2284, name: 'Ubuntu 24.04 LTS x64', arch: 'x64', family: 'ubuntu' },
  { id: 2136, name: 'Debian 12 x64', arch: 'x64', family: 'debian' },
  { id: 2138, name: 'AlmaLinux 9 x64', arch: 'x64', family: 'almalinux' },
  { id: 2150, name: 'Rocky Linux 9 x64', arch: 'x64', family: 'rocky' },
];

const TEST_SSH_KEYS = [];
const TEST_SNAPSHOTS = [];

export function isConfigured() {
  return Boolean(process.env.VULTR_API_KEY);
}

export function isTestMode() {
  return String(process.env.VPS_TEST_MODE ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')).toLowerCase() === 'true';
}

export function planAvailableInRegion(plan, region) {
  if (!plan || plan.deploy_ondemand === false) return false;
  if (!region) return true;
  return !Array.isArray(plan.locations) || plan.locations.includes(region);
}

export function planMonthlyCost(plan, region) {
  return Number(plan?.location_cost?.[region]?.monthly_cost ?? plan?.monthly_cost ?? 0);
}

function withRegionPrice(plan, region) {
  if (!region) return plan;
  const monthlyCost = planMonthlyCost(plan, region);
  const hourlyCost = Number(plan?.location_cost?.[region]?.hourly_cost ?? plan?.hourly_cost ?? 0);
  return {
    ...plan,
    monthly_cost: monthlyCost,
    hourly_cost: hourlyCost || plan.hourly_cost,
    region,
  };
}

export function curatePlanRange(plans, region) {
  const available = (plans || [])
    .filter((plan) => planAvailableInRegion(plan, region))
    .map((plan) => withRegionPrice(plan, region))
    .sort((a, b) => planMonthlyCost(a, region) - planMonthlyCost(b, region));

  if (available.length <= 3) {
    return available.map((plan, index) => ({
      ...plan,
      recommendation: ['starter', 'balanced', 'power'][index] || 'option',
    }));
  }

  const starter = available[0];
  const power = available[available.length - 1];
  const starterCost = planMonthlyCost(starter, region);
  const powerCost = planMonthlyCost(power, region);
  const targetCost = Math.min(Math.max(starterCost * 4, starterCost + 10), powerCost * 0.45);
  const middleCandidates = available.slice(1, -1);
  const balanced = middleCandidates.reduce((best, plan) => {
    const costDistance = Math.abs(planMonthlyCost(plan, region) - targetCost);
    const bestDistance = Math.abs(planMonthlyCost(best, region) - targetCost);
    if (costDistance !== bestDistance) return costDistance < bestDistance ? plan : best;
    const planPower = Number(plan.vcpu_count || 0) * 1000 + Number(plan.ram || 0) + Number(plan.disk || 0) * 10;
    const bestPower = Number(best.vcpu_count || 0) * 1000 + Number(best.ram || 0) + Number(best.disk || 0) * 10;
    return planPower > bestPower ? plan : best;
  }, middleCandidates[0]);

  return [
    { ...starter, recommendation: 'starter' },
    { ...balanced, recommendation: 'balanced' },
    { ...power, recommendation: 'power' },
  ];
}

async function vultrReq(path, init = {}) {
  const key = process.env.VULTR_API_KEY;
  if (!key) {
    const err = new Error('Vultr API key is not configured. Set VULTR_API_KEY.');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${VULTR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error ?? json?.message ?? `Vultr API error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status >= 500 ? 502 : res.status;
    throw err;
  }
  return json;
}

export async function listRegions() {
  if (!isConfigured() && isTestMode()) return TEST_REGIONS;
  const d = await vultrReq('/regions?per_page=500');
  return d.regions ?? [];
}

export async function listPlans(type, options = {}) {
  if (!isConfigured() && isTestMode()) {
    const testPlans = type ? TEST_PLANS.filter((p) => p.type === type) : TEST_PLANS;
    const available = options.region ? testPlans.filter((p) => planAvailableInRegion(p, options.region)) : testPlans;
    return options.curated ? curatePlanRange(available, options.region) : available;
  }
  const qs = type ? `?type=${encodeURIComponent(type)}&per_page=500` : '?per_page=500';
  const d = await vultrReq(`/plans${qs}`);
  const plans = (d.plans ?? [])
    .filter((p) => planAvailableInRegion(p, options.region))
    .map((p) => withRegionPrice(p, options.region));
  return options.curated ? curatePlanRange(plans, options.region) : plans;
}

export async function listOs() {
  if (!isConfigured() && isTestMode()) return TEST_OS;
  const d = await vultrReq('/os?per_page=500');
  return d.os ?? [];
}

export async function createSshKey(name, publicKey) {
  if (!isConfigured() && isTestMode()) {
    const key = { id: `dummy-ssh-${Date.now()}`, name, ssh_key: publicKey, date_created: new Date().toISOString() };
    TEST_SSH_KEYS.push(key);
    return key;
  }
  const d = await vultrReq('/ssh-keys', {
    method: 'POST',
    body: JSON.stringify({ name, ssh_key: publicKey }),
  });
  return d.ssh_key;
}

export async function createInstance(opts) {
  if (!isConfigured() && isTestMode()) {
    const plan = TEST_PLANS.find((p) => p.id === opts.plan) || TEST_PLANS[0];
    return {
      id: `dummy-vultr-${Date.now()}`,
      status: 'running',
      main_ip: `192.0.2.${Math.floor(Math.random() * 180) + 20}`,
      vcpu_count: plan.vcpu_count,
      ram: plan.ram,
      disk: plan.disk,
      region: opts.region,
      plan: opts.plan,
      os_id: opts.os_id,
      label: opts.label,
    };
  }
  const d = await vultrReq('/instances', { method: 'POST', body: JSON.stringify(opts) });
  return d.instance;
}

export async function getInstance(instanceId) {
  const d = await vultrReq(`/instances/${encodeURIComponent(instanceId)}`);
  return d.instance;
}

export async function deleteInstance(instanceId) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
}

export async function listDatabasePlans(region) {
  if (!isConfigured() && isTestMode()) {
    return [
      { id: 'vultr-dbaas-startup-cc-1-55-2', type: 'startup', monthly_cost: 30, vcpu_count: 1, ram: 2048, disk: 55, locations: TEST_REGIONS.map((item) => item.id) },
      { id: 'vultr-dbaas-premium-cc-4-220-8', type: 'premium', monthly_cost: 240, vcpu_count: 8, ram: 32768, disk: 220, locations: TEST_REGIONS.map((item) => item.id) },
    ];
  }
  const suffix = region ? `?region=${encodeURIComponent(region)}&per_page=500` : '?per_page=500';
  const data = await vultrReq(`/databases/plans${suffix}`);
  return data.plans ?? data.database_plans ?? [];
}

export async function listObjectStorageTiers() {
  if (!isConfigured() && isTestMode()) {
    return [
      { id: 1, name: 'Standard', monthly_cost: 5, storage_gb: 1000, bandwidth_tb: 1 },
      { id: 2, name: 'Scale', monthly_cost: 100, storage_gb: 10000, bandwidth_tb: 10 },
    ];
  }
  const data = await vultrReq('/object-storage/tiers?per_page=500');
  return data.tiers ?? data.object_storage_tiers ?? [];
}

export async function listObjectStorageClusters() {
  if (!isConfigured() && isTestMode()) {
    return TEST_REGIONS.map((item, index) => ({ id: index + 1, region: item.id, hostname: `${item.id}1.vultrobjects.com` }));
  }
  const data = await vultrReq('/object-storage/clusters?per_page=500');
  return data.clusters ?? data.object_storage_clusters ?? [];
}

export async function createManagedDatabase({ region, plan, version, label }) {
  if (!isConfigured() && isTestMode()) {
    return { id: `dummy-db-${Date.now()}`, status: 'Running', region, plan, database_engine: 'pg', database_engine_version: version, label, host: `${label}.db.internal`, port: 16751 };
  }
  const data = await vultrReq('/databases', {
    method: 'POST',
    body: JSON.stringify({
      database_engine: 'pg',
      database_engine_version: String(version),
      plan,
      region,
      label,
    }),
  });
  return data.database;
}

export async function createObjectStorage({ clusterId, tierId, label }) {
  if (!isConfigured() && isTestMode()) {
    return { id: `dummy-object-${Date.now()}`, status: 'active', cluster_id: clusterId, tier_id: tierId, label, s3_hostname: 'sandbox.vultrobjects.com' };
  }
  const data = await vultrReq('/object-storage', {
    method: 'POST',
    body: JSON.stringify({ cluster_id: clusterId, tier_id: tierId, label }),
  });
  return data.object_storage;
}

export async function createBlockStorage({ region, sizeGb, label, highPerf = false }) {
  if (!isConfigured() && isTestMode()) {
    return { id: `dummy-block-${Date.now()}`, status: 'active', region, size_gb: sizeGb, label, block_type: highPerf ? 'high_perf' : 'storage_opt' };
  }
  const data = await vultrReq('/blocks', {
    method: 'POST',
    body: JSON.stringify({ region, size_gb: sizeGb, label, block_type: highPerf ? 'high_perf' : 'storage_opt' }),
  });
  return data.block;
}

export async function attachBlockStorage(blockId, instanceId) {
  if (!isConfigured() && isTestMode()) return { id: blockId, attached_to_instance: instanceId };
  const data = await vultrReq(`/blocks/${encodeURIComponent(blockId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ attached_to_instance: instanceId, live: true }),
  });
  return data.block ?? {};
}

export async function haltInstance(instanceId) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}/halt`, { method: 'POST' });
}

export async function rebootInstance(instanceId) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}/reboot`, { method: 'POST' });
}

export async function startInstance(instanceId) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}/start`, { method: 'POST' });
}

export async function updateInstanceSettings(instanceId, settings = {}) {
  if (!isConfigured() && isTestMode()) return { id: instanceId, ...(settings || {}) };
  const body = {};
  if (settings.label != null) body.label = settings.label;
  if (settings.hostname != null) body.hostname = settings.hostname;
  if (Array.isArray(settings.tags)) body.tags = settings.tags;
  if (Object.keys(body).length === 0) return {};
  const d = await vultrReq(`/instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return d.instance ?? {};
}

export async function listInstances() {
  const d = await vultrReq('/instances?per_page=500');
  return d.instances ?? [];
}

export async function resizeInstance(instanceId, plan) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ plan }),
  });
}

export async function reinstallInstance(instanceId, osId) {
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}/reinstall`, {
    method: 'POST',
    body: JSON.stringify(osId != null ? { os_id: osId } : {}),
  });
}

export async function listSshKeys() {
  if (!isConfigured() && isTestMode()) return TEST_SSH_KEYS;
  const d = await vultrReq('/ssh-keys?per_page=500');
  return d.ssh_keys ?? [];
}

export async function deleteSshKey(keyId) {
  if (!isConfigured() && isTestMode()) {
    const index = TEST_SSH_KEYS.findIndex((key) => key.id === keyId);
    if (index >= 0) TEST_SSH_KEYS.splice(index, 1);
    return;
  }
  await vultrReq(`/ssh-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
}

export async function getInstanceBandwidth(instanceId) {
  if (!isConfigured() && isTestMode()) {
    return {
      '2026-01-01': { incoming_bytes: 18_000_000, outgoing_bytes: 32_000_000 },
    };
  }
  const d = await vultrReq(`/instances/${encodeURIComponent(instanceId)}/bandwidth`);
  return d.bandwidth ?? {};
}

export async function listSnapshots() {
  if (!isConfigured() && isTestMode()) return TEST_SNAPSHOTS;
  const d = await vultrReq('/snapshots?per_page=500');
  return d.snapshots ?? [];
}

export async function createSnapshot(instanceId, description) {
  if (!isConfigured() && isTestMode()) {
    const snapshot = {
      id: `dummy-snapshot-${Date.now()}`,
      instance_id: instanceId,
      description,
      status: 'complete',
      date_created: new Date().toISOString(),
    };
    TEST_SNAPSHOTS.push(snapshot);
    return snapshot;
  }
  const d = await vultrReq('/snapshots', {
    method: 'POST',
    body: JSON.stringify({ instance_id: instanceId, description }),
  });
  return d.snapshot;
}

export async function deleteSnapshot(snapshotId) {
  if (!isConfigured() && isTestMode()) {
    const index = TEST_SNAPSHOTS.findIndex((snapshot) => snapshot.id === snapshotId);
    if (index >= 0) TEST_SNAPSHOTS.splice(index, 1);
    return;
  }
  await vultrReq(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
}

export async function restoreInstance(instanceId, snapshotId) {
  if (!isConfigured() && isTestMode()) return { id: instanceId, snapshot_id: snapshotId, status: 'restoring' };
  await vultrReq(`/instances/${encodeURIComponent(instanceId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ snapshot_id: snapshotId }),
  });
}

export async function getBackupSchedule(instanceId) {
  if (!isConfigured() && isTestMode()) return { type: 'daily', enabled: true };
  const d = await vultrReq(`/instances/${encodeURIComponent(instanceId)}/backup-schedule`);
  return d.backup_schedule ?? {};
}

export async function setBackupSchedule(instanceId, schedule) {
  if (!isConfigured() && isTestMode()) return { ...(schedule || {}), enabled: true };
  const d = await vultrReq(`/instances/${encodeURIComponent(instanceId)}/backup-schedule`, {
    method: 'POST',
    body: JSON.stringify(schedule),
  });
  return d.backup_schedule ?? {};
}

// Vultr's public API exposes billing evidence as reads. It does not expose an
// invoice-payment mutation, so these methods verify account autopay/funding
// instead of pretending that an API call paid Vultr.
export async function listBillingHistory({ cursor = null, perPage = 100 } = {}) {
  const query = new URLSearchParams({ per_page: String(Math.max(1, Math.min(500, Number(perPage) || 100))) });
  if (cursor) query.set('cursor', cursor);
  return vultrReq(`/billing/history?${query.toString()}`);
}

export async function getBillingInvoice(invoiceId) {
  if (!invoiceId) throw Object.assign(new Error('Vultr invoice id is required.'), { status: 400 });
  return vultrReq(`/billing/invoices/${encodeURIComponent(invoiceId)}`);
}

export async function getBillingInvoiceItems(invoiceId) {
  if (!invoiceId) throw Object.assign(new Error('Vultr invoice id is required.'), { status: 400 });
  return vultrReq(`/billing/invoices/${encodeURIComponent(invoiceId)}/items`);
}
