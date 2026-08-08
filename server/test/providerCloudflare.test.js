import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCloudflareBotManagement,
  getCloudflareDnssec,
  getCloudflareSettings,
  getCloudflareZoneSettings,
  listCloudflareHealthChecks,
  listCloudflareDnsRecords,
  listCloudflareZones,
} from '../src/services/providerCloudflare.service.js';

const originalFetch = global.fetch;
const originalToken = process.env.CLOUDFLARE_API_TOKEN;
const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = originalToken;
  if (originalAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
});

test('Cloudflare settings report token configuration without exposing it', () => {
  process.env.CLOUDFLARE_API_TOKEN = 'secret-token';
  const settings = getCloudflareSettings();
  assert.equal(settings.configured, true);
  assert.equal(Object.hasOwn(settings, 'token'), false);
});

test('Cloudflare zone listing paginates and applies the configured account', async () => {
  process.env.CLOUDFLARE_API_TOKEN = 'secret-token';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-123';
  const urls = [];
  global.fetch = async (url, options) => {
    urls.push(String(url));
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    const page = new URL(url).searchParams.get('page');
    return new Response(JSON.stringify({
      success: true,
      result: [{ id: page.repeat(32).slice(0, 32), name: `page-${page}.example` }],
      result_info: { total_pages: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const zones = await listCloudflareZones();
  assert.equal(zones.length, 2);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).searchParams.get('account.id'), 'account-123');
});

test('Cloudflare DNS records are normalized for the dashboard', async () => {
  process.env.CLOUDFLARE_API_TOKEN = 'secret-token';
  global.fetch = async () => new Response(JSON.stringify({
    success: true,
    result: [{ id: 'record-1', type: 'A', name: 'www.example.com', content: '192.0.2.1', ttl: 300, proxied: true }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const records = await listCloudflareDnsRecords('a'.repeat(32));
  assert.deepEqual(records, [{
    id: 'record-1',
    type: 'A',
    name: 'www.example.com',
    value: '192.0.2.1',
    ttl: 300,
    priority: null,
    proxied: true,
    status: 'active',
    provider: 'cloudflare',
  }]);
});

test('Cloudflare domain service endpoints use zone-scoped provider APIs', async () => {
  process.env.CLOUDFLARE_API_TOKEN = 'secret-token';
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    const path = new URL(url).pathname;
    let result = {};
    if (path.endsWith('/dnssec')) result = { status: 'active', algorithm: '13' };
    else if (path.endsWith('/bot_management')) result = { fight_mode: true };
    else if (path.endsWith('/healthchecks')) result = [{ id: 'health-1', status: 'healthy' }];
    else if (path.includes('/settings/')) result = { id: path.split('/').at(-1), value: 'on', editable: true };
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const zoneId = 'b'.repeat(32);
  const [settings, dnssec, bots, checks] = await Promise.all([
    getCloudflareZoneSettings(zoneId),
    getCloudflareDnssec(zoneId),
    getCloudflareBotManagement(zoneId),
    listCloudflareHealthChecks(zoneId),
  ]);
  assert.equal(settings.find((item) => item.id === 'ssl').value, 'on');
  assert.equal(dnssec.status, 'active');
  assert.equal(bots.fight_mode, true);
  assert.equal(checks[0].status, 'healthy');
  assert.ok(urls.every((url) => url.includes(`/zones/${zoneId}/`)));
});
