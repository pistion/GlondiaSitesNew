const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

function cloudflareBaseUrl() {
  return (process.env.CLOUDFLARE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function cloudflareHeaders() {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!token) {
    const error = new Error('CLOUDFLARE_API_TOKEN is required.');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function cloudflareRequest(path, options = {}) {
  const response = await fetch(`${cloudflareBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...cloudflareHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    const providerMessage = payload?.errors?.[0]?.message || payload?.messages?.[0]?.message;
    const error = new Error(providerMessage || `Cloudflare returned ${response.status}.`);
    error.status = [401, 403].includes(response.status) ? 502 : response.status >= 500 ? 502 : response.status;
    error.providerStatus = response.status;
    error.details = payload;
    error.expose = true;
    throw error;
  }
  return payload;
}

export function priceCloudflarePlan(plan = {}, markupPercent = 30) {
  const providerPrice = Number(plan.price || 0);
  const markupAmount = Number((providerPrice * markupPercent / 100).toFixed(2));
  return {
    ...plan,
    provider: 'cloudflare',
    providerPrice,
    markupPercent,
    markupAmount,
    customerPrice: Number((providerPrice + markupAmount).toFixed(2)),
    pricingSource: 'cloudflare_api',
  };
}

function requireZoneId(zoneId) {
  const id = String(zoneId || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    const error = new Error('A valid Cloudflare zone ID is required.');
    error.status = 400;
    throw error;
  }
  return id;
}

export function getCloudflareSettings() {
  return {
    provider: 'cloudflare',
    configured: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    accountIdPresent: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
    required: ['CLOUDFLARE_API_TOKEN'].filter((key) => !process.env[key]),
  };
}

export async function listCloudflareZones() {
  const zones = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({ page: String(page), per_page: '50' });
    if (process.env.CLOUDFLARE_ACCOUNT_ID) params.set('account.id', process.env.CLOUDFLARE_ACCOUNT_ID);
    const payload = await cloudflareRequest(`/zones?${params}`);
    zones.push(...(Array.isArray(payload?.result) ? payload.result : []));
    totalPages = Math.max(Number(payload?.result_info?.total_pages || 1), 1);
    page += 1;
  } while (page <= totalPages);
  return zones;
}

export async function getCloudflareZone(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}`);
  return payload?.result || {};
}

export async function createCloudflareZone(domain) {
  const name = String(domain || '').trim().toLowerCase();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accountId) {
    const error = new Error('CLOUDFLARE_ACCOUNT_ID is required to activate domain add-ons.');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  const payload = await cloudflareRequest('/zones', {
    method: 'POST',
    body: { account: { id: accountId }, name, type: 'full' },
  });
  return payload?.result || {};
}

export async function requestCloudflareActivationCheck(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/activation_check`, {
    method: 'PUT',
  });
  return payload?.result || {};
}

export async function listCloudflareDnsRecords(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/dns_records?per_page=5000`);
  return (Array.isArray(payload?.result) ? payload.result : []).map((record) => ({
    id: record.id,
    type: record.type,
    name: record.name,
    value: record.content || '',
    ttl: record.ttl,
    priority: record.priority ?? null,
    proxied: Boolean(record.proxied),
    status: 'active',
    provider: 'cloudflare',
  }));
}

const IMPORTANT_ZONE_SETTINGS = [
  'ssl',
  'always_use_https',
  'min_tls_version',
  'security_level',
  'browser_check',
  'challenge_ttl',
  'ipv6',
  'websockets',
  'hotlink_protection',
  'development_mode',
  'cache_level',
];

export async function getCloudflareZoneSettings(zoneId) {
  const id = requireZoneId(zoneId);
  const results = await Promise.allSettled(IMPORTANT_ZONE_SETTINGS.map(async (settingId) => {
    const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/settings/${encodeURIComponent(settingId)}`);
    return payload?.result || { id: settingId };
  }));
  return results.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : {
      id: IMPORTANT_ZONE_SETTINGS[index],
      unavailable: true,
      error: result.reason?.message || 'Cloudflare setting unavailable.',
    });
}

export async function getCloudflareDnssec(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/dnssec`);
  return payload?.result || {};
}

export async function getCloudflareBotManagement(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/bot_management`);
  return payload?.result || {};
}

export async function updateCloudflareBotManagement(zoneId, configuration = {}) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/bot_management`, {
    method: 'PUT',
    body: configuration,
  });
  return payload?.result || {};
}

export async function listCloudflareHealthChecks(zoneId) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/healthchecks?page=1&per_page=50`);
  return Array.isArray(payload?.result) ? payload.result : [];
}

export async function listCloudflareAvailablePlans(zoneId, markupPercent = 30) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/available_plans`);
  return (Array.isArray(payload?.result) ? payload.result : [])
    .map((plan) => priceCloudflarePlan(plan, markupPercent));
}

export async function getCloudflareZoneSubscription(zoneId, markupPercent = 30) {
  const id = requireZoneId(zoneId);
  const payload = await cloudflareRequest(`/zones/${encodeURIComponent(id)}/subscription`);
  const subscription = payload?.result || {};
  return {
    ...subscription,
    provider: 'cloudflare',
    rate_plan: subscription.rate_plan
      ? priceCloudflarePlan(subscription.rate_plan, markupPercent)
      : null,
    pricingSource: 'cloudflare_api',
  };
}

export default {
  getCloudflareSettings,
  getCloudflareZone,
  createCloudflareZone,
  requestCloudflareActivationCheck,
  listCloudflareZones,
  listCloudflareDnsRecords,
  getCloudflareZoneSettings,
  getCloudflareDnssec,
  getCloudflareBotManagement,
  updateCloudflareBotManagement,
  listCloudflareHealthChecks,
  listCloudflareAvailablePlans,
  getCloudflareZoneSubscription,
};
