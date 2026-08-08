/**
 * providerSpaceship.service.js
 *
 * All Spaceship domain registrar business logic extracted from server.js.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getSpaceshipSettings() {
  return {
    provider: 'spaceship',
    configured: !!(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET),
    apiKeyPresent: !!process.env.SPACESHIP_API_KEY,
    apiSecretPresent: !!process.env.SPACESHIP_API_SECRET,
    baseUrl: spaceshipBaseUrl(),
    required: ['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET'].filter((key) => !process.env[key]),
  };
}

function spaceshipBaseUrl() {
  return (process.env.SPACESHIP_API_BASE_URL || 'https://spaceship.dev/api/v1').replace(/\/+$/, '');
}

function spaceshipHeaders(extra = {}) {
  if (!process.env.SPACESHIP_API_KEY || !process.env.SPACESHIP_API_SECRET) {
    const error = new Error('SPACESHIP_API_KEY and SPACESHIP_API_SECRET are required.');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return {
    'X-Api-Key': process.env.SPACESHIP_API_KEY,
    'X-Api-Secret': process.env.SPACESHIP_API_SECRET,
    Accept: 'application/json',
    ...extra,
  };
}

async function spaceshipRequest(path, options = {}) {
  const response = await fetch(`${spaceshipBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers: spaceshipHeaders(options.body ? { 'Content-Type': 'application/json' } : {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const operationId = response.headers.get('spaceship-async-operationid');
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const upstreamMessage = body?.detail || body?.message || body?.title || text || `Spaceship returned ${response.status}.`;
    const safeMessage = response.status === 401
      ? 'Spaceship authentication failed. Check SPACESHIP_API_KEY, SPACESHIP_API_SECRET, API scopes, and any Spaceship IP restrictions.'
      : upstreamMessage;
    const error = new Error(safeMessage);
    // Do not pass upstream provider auth failures through as app auth failures.
    // The browser clears the customer session on 401, but this 401 belongs to
    // Spaceship credentials/scopes/IP allowlist, not the logged-in customer.
    error.status = [401, 403].includes(response.status)
      ? 502
      : response.status >= 500 ? 502 : response.status;
    error.providerStatus = response.status;
    error.details = body;
    error.expose = true;
    throw error;
  }
  return { body, operationId, statusCode: response.status };
}

export function cleanDomainName(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || domain.includes('..')) {
    const error = new Error('A valid fully qualified domain name is required.');
    error.status = 400;
    throw error;
  }
  return domain;
}

// ── Domain operations ─────────────────────────────────────────────────────────

export async function checkSpaceshipAvailability(domains = []) {
  const uniqueDomains = [...new Set(domains.map(cleanDomainName))].slice(0, 20);
  if (!uniqueDomains.length) return { domains: [] };
  const { body } = await spaceshipRequest('/domains/available', {
    method: 'POST',
    body: { domains: uniqueDomains },
  });
  const rows = Array.isArray(body?.domains) ? body.domains : [];
  return {
    domains: rows.map((item) => {
      const price = item.premiumPricing?.find((entry) => entry.operation === 'register') || item.premiumPricing?.[0] || null;
      const status = item.result || item.status || 'unknown';
      return {
        domain: item.domain,
        available: status === 'available',
        status,
        pricing: price ? { amount: price.price, currency: price.currency || 'USD', operation: price.operation || 'register' } : null,
        raw: item,
      };
    }),
  };
}

export async function listSpaceshipDomains(query = {}) {
  const take = Math.min(Math.max(Number(query.take || 100), 1), 100);
  const skip = Math.max(Number(query.skip || 0), 0);
  const { body } = await spaceshipRequest(`/domains?take=${take}&skip=${skip}`);
  return body;
}

export async function getSpaceshipDomain(domain) {
  const { body } = await spaceshipRequest(`/domains/${encodeURIComponent(cleanDomainName(domain))}`);
  return body;
}

export async function registerSpaceshipDomain(domain, input = {}) {
  const name = cleanDomainName(domain);
  const contactId = input.contactId || input.registrant || input.contacts?.registrant;
  if (!contactId) {
    const error = new Error('A Spaceship contactId is required before registering a domain.');
    error.status = 400;
    throw error;
  }
  const payload = {
    autoRenew: input.autoRenew !== false,
    years: Math.min(Math.max(Number(input.years || 1), 1), 10),
    privacyProtection: typeof input.privacyProtection === 'object'
      ? input.privacyProtection
      : { level: input.privacyProtection === false ? 'none' : 'high', userConsent: input.privacyProtection !== false },
    contacts: {
      registrant: contactId,
      admin: input.adminContactId || contactId,
      tech: input.techContactId || contactId,
      billing: input.billingContactId || contactId,
    },
  };
  const result = await spaceshipRequest(`/domains/${encodeURIComponent(name)}/register`, {
    method: 'POST',
    body: payload,
  });
  return {
    domain: name,
    operationId: result.operationId || result.body?.operationId || null,
    status: result.operationId ? 'pending' : 'success',
    response: result.body,
  };
}

export async function renewSpaceshipDomain(domain, input = {}) {
  const name = cleanDomainName(domain);
  const result = await spaceshipRequest(`/domains/${encodeURIComponent(name)}/renew`, {
    method: 'POST',
    body: { years: Math.min(Math.max(Number(input.years || 1), 1), 10) },
  });
  return {
    domain: name,
    operationId: result.operationId || result.body?.operationId || null,
    status: result.operationId ? 'pending' : 'success',
    response: result.body,
  };
}

export function buildSpaceshipNameserverChange(domain, input = {}) {
  const name = cleanDomainName(domain);
  const hosts = Array.isArray(input.hosts) ? input.hosts.map((host) => String(host).trim()).filter(Boolean) : [];
  if (!hosts.length) {
    const error = new Error('At least one nameserver host is required.');
    error.status = 400;
    throw error;
  }
  return { domain: name, payload: { provider: input.provider || 'custom', hosts } };
}

export async function updateSpaceshipNameservers(domain, input = {}) {
  const change = buildSpaceshipNameserverChange(domain, input);
  await spaceshipRequest(`/domains/${encodeURIComponent(change.domain)}/nameservers`, {
    method: 'PUT',
    body: change.payload,
  });
  return { domain: change.domain, ...change.payload };
}

export async function updateSpaceshipAutoRenew(domain, input = {}) {
  const name = cleanDomainName(domain);
  await spaceshipRequest(`/domains/${encodeURIComponent(name)}/auto-renew`, {
    method: 'PUT',
    body: { autoRenew: !!input.autoRenew },
  });
  return { domain: name, autoRenew: !!input.autoRenew };
}

export async function saveSpaceshipContact(input = {}) {
  const payload = {
    firstName: input.firstName,
    lastName: input.lastName,
    organization: input.company || undefined,
    email: input.email,
    phone: input.phone,
    address1: input.address1,
    address2: input.address2 || undefined,
    city: input.city,
    postalCode: input.postalCode,
    country: input.country,
  };
  const { body } = await spaceshipRequest('/contacts', { method: 'PUT', body: payload });
  return { id: body.contactId || body.id, contactId: body.contactId || body.id, ...body };
}

export async function getSpaceshipOperation(operationId) {
  const id = String(operationId || '').trim();
  if (!/^[a-zA-Z0-9]{1,36}$/.test(id)) {
    const error = new Error('A valid Spaceship operation id is required.');
    error.status = 400;
    throw error;
  }
  const { body } = await spaceshipRequest(`/async-operations/${encodeURIComponent(id)}`);
  return { operationId: id, ...body };
}

// ── DNS records ───────────────────────────────────────────────────────────────

export async function listSpaceshipDnsRecords(domain, query = {}) {
  const name = cleanDomainName(domain);
  const take = Math.min(Math.max(Number(query.take || 500), 1), 500);
  const skip = Math.max(Number(query.skip || 0), 0);
  const { body } = await spaceshipRequest(`/dns/records/${encodeURIComponent(name)}?take=${take}&skip=${skip}`);
  const items = Array.isArray(body?.items) ? body.items : [];
  return {
    domain: name,
    pulled: items.length,
    items,
    records: items.map(fromSpaceshipDnsRecord),
    total: body?.total ?? items.length,
  };
}

export async function saveSpaceshipDnsRecords(domain, input = {}) {
  const name = cleanDomainName(domain);
  const records = Array.isArray(input.records) ? input.records : Array.isArray(input.items) ? input.items : [];
  const items = records.map(toSpaceshipDnsRecord).filter(Boolean);
  if (!items.length) return { domain: name, pushed: 0 };
  await spaceshipRequest(`/dns/records/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: { force: input.force !== false, items },
  });
  return { domain: name, pushed: items.length };
}

function toSpaceshipDnsRecord(record = {}) {
  const type = String(record.type || '').toUpperCase();
  const name = record.name || record.host || '@';
  const ttl = Number(record.ttlSeconds || record.ttl || 3600);
  const value = record.value || record.address || record.exchange || record.text || record.target || '';
  const base = { type, name, ttl: Number.isFinite(ttl) ? ttl : 3600 };
  if (['A', 'AAAA'].includes(type)) return { ...base, address: value };
  if (type === 'CNAME') return { ...base, cname: value };
  if (type === 'MX') return { ...base, exchange: value, preference: Number(record.priority || record.preference || 10) };
  if (type === 'TXT') return { ...base, text: value };
  if (type === 'CAA') return { ...base, flag: Number(record.flag || 0), tag: record.tag || 'issue', value };
  if (['SRV', 'TLSA', 'HTTPS', 'SVCB', 'NS', 'PTR', 'ALIAS'].includes(type)) return { ...base, value };
  return null;
}

function fromSpaceshipDnsRecord(record = {}) {
  const value = record.address || record.cname || record.exchange || record.text || record.value || record.target || '';
  return {
    id: `${record.type || 'record'}_${record.name || '@'}_${value}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    type: record.type,
    name: record.name || '@',
    value,
    ttl: record.ttl || 3600,
    priority: record.preference || record.priority || null,
    proxied: false,
    status: 'active',
  };
}
