/**
 * VPS API integration tests.
 *
 * Boots the real Express server against a throwaway SQLite database (schema
 * pushed with the project's own Prisma workflow) and exercises the Cloud
 * Servers API in provider test mode: tenancy isolation, DTO privacy, the
 * protected credentials reveal, lifecycle and destroy.
 *
 * Auth uses the development fallback (x-user-id headers), which is exactly the
 * verified-req.user path the controllers consume.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}/api/v1/vps-hosting`;

let proc;
let tempDir;

function api(path, { method = 'GET', user, body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { 'x-user-id': user } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-vps-test-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });

  proc = spawn(process.execPath, ['server/src/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PORT: String(PORT),
      NODE_ENV: 'development',
      VPS_TEST_MODE: 'true',
      VULTR_API_KEY: '',
      AUTH_DEV_FALLBACK: 'true',
      AUDIT_LOG_ENABLED: 'true',
    },
    stdio: 'ignore',
  });

  // Wait for the server to accept requests.
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Server did not become healthy in 30s');
    await new Promise((r) => setTimeout(r, 400));
  }
}, { timeout: 120000 });

after(() => {
  if (proc) proc.kill();
  if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows file locks */ } }
});

test('public settings and quote respond, quote hides cost and margin', async () => {
  const settings = await (await api('/settings')).json();
  assert.equal(settings.testMode, true);

  const res = await api('/quote', { method: 'POST', body: { region: 'syd', plan: 'vc2-1c-1gb', osId: 2284 } });
  assert.equal(res.status, 200);
  const quote = await res.json();
  assert.equal(quote.totalMonthlyCostCents, 780);
  assert.equal(quote.currency, 'USD');
  for (const field of ['baseMonthlyCostCents', 'markupPercent', 'markupAmountCents', 'breakdown']) {
    assert.equal(field in quote, false, `quote must not include ${field}`);
  }
});

test('plan catalog is region-aware and curated for customer choices', async () => {
  const res = await api('/plans?type=vc2&region=syd&curated=true');
  assert.equal(res.status, 200);
  const plans = await res.json();
  assert.equal(plans.length <= 3, true);
  assert.equal(plans.every((p) => p.type === 'vc2' && p.locations.includes('syd')), true);
  assert.equal(plans.every((p) => ['starter', 'balanced', 'power', 'option'].includes(p.recommendation)), true);

  const unavailable = await api('/quote', {
    method: 'POST',
    body: { region: 'syd', plan: 'vhp-2c-4gb-amd', osId: 2284 },
  });
  assert.equal(unavailable.status, 400);
  const body = await unavailable.json();
  assert.match(body.error.message, /not available in region "syd"/);
});

let serviceId;

test('create returns a customer DTO without internal fields', async () => {
  const res = await api('/services', {
    method: 'POST',
    user: 'tenant-a',
    body: { plan: 'vc2-1c-1gb', region: 'syd', osId: 2284, label: 'itest-a', backups: true },
  });
  assert.equal(res.status, 201);
  const dto = await res.json();
  serviceId = dto.id;
  assert.ok(dto.id);
  assert.equal(dto.totalPriceCents, 780);
  assert.equal(dto.testMode, true);
  assert.equal(dto.backupsEnabled, true);
  for (const field of [
    'organizationId', 'createdByUserId', 'providerInstanceId', 'checkoutOrderId',
    'monthlyCostCents', 'markupPercent', 'markupAmountCents',
    'paypalOrderId', 'paypalCaptureId', 'connectionPassword', 'metadata',
  ]) {
    assert.equal(field in dto, false, `create response must not include ${field}`);
  }
});

test('tenant isolation: listing and detail are organization-scoped', async () => {
  const mine = await (await api('/services', { user: 'tenant-a' })).json();
  assert.equal(mine.length, 1);

  const theirs = await (await api('/services', { user: 'tenant-b' })).json();
  assert.equal(theirs.length, 0);

  const denied = await api(`/services/${serviceId}`, { user: 'tenant-b' });
  assert.equal(denied.status, 403);
  const deniedBody = await denied.json();
  assert.equal(deniedBody.error.code, 'SERVICE_OWNER_MISMATCH');
});

test('cross-tenant mutations are denied', async () => {
  for (const [method, path] of [
    ['POST', `/services/${serviceId}/start`],
    ['POST', `/services/${serviceId}/reboot`],
    ['DELETE', `/services/${serviceId}`],
    ['GET', `/services/${serviceId}/credentials`],
  ]) {
    const res = await api(path, { method, user: 'tenant-b' });
    assert.equal(res.status, 403, `${method} ${path} must be denied cross-tenant`);
  }
});

test('credentials come only from the protected reveal endpoint', async () => {
  const res = await api(`/services/${serviceId}/credentials`, { user: 'tenant-a' });
  assert.equal(res.status, 200);
  const creds = await res.json();
  assert.equal(creds.username, 'root');
  assert.ok(creds.password, 'owner must receive the root password');

  const detail = await (await api(`/services/${serviceId}`, { user: 'tenant-a' })).json();
  assert.equal('connectionPassword' in detail, false);
});

test('service summary returns toolbar state and cached usage fields', async () => {
  const res = await api(`/services/${serviceId}/summary`, { user: 'tenant-a' });
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.equal(summary.service.id, serviceId);
  assert.equal(summary.service.backupsEnabled, true);
  assert.equal(typeof summary.service.bandwidthUsedGb, 'number');
  assert.equal(summary.toolbar.canOpenConsole, false);
  assert.equal(typeof summary.toolbar.canReboot, 'boolean');
  assert.equal('providerInstanceId' in summary.service, false);
});

test('ssh keys and snapshots list only owned resources', async () => {
  assert.deepEqual(await (await api('/ssh-keys', { user: 'tenant-a' })).json(), []);
  assert.deepEqual(await (await api('/snapshots', { user: 'tenant-a' })).json(), []);
  // Deleting an unowned/unknown snapshot is a 404, not a provider call.
  const res = await api('/snapshots/some-foreign-snapshot', { method: 'DELETE', user: 'tenant-a' });
  assert.equal(res.status, 404);
});

test('owner service tabs have functional backend routes', async () => {
  const settings = await api(`/services/${serviceId}/settings`, {
    method: 'PATCH',
    user: 'tenant-a',
    body: { label: 'itest-a-renamed', hostname: 'itest-a-renamed', tags: ['org:tenant-a', 'role:web'] },
  });
  assert.equal(settings.status, 200);
  const updated = await settings.json();
  assert.equal(updated.label, 'itest-a-renamed');
  assert.deepEqual(updated.tags, ['org:tenant-a', 'role:web']);

  const bandwidth = await api(`/services/${serviceId}/bandwidth`, { user: 'tenant-a' });
  assert.equal(bandwidth.status, 200);

  const backup = await api(`/services/${serviceId}/backup-schedule`, {
    method: 'POST',
    user: 'tenant-a',
    body: { type: 'daily', enabled: true },
  });
  assert.equal(backup.status, 200);
  assert.equal((await backup.json()).enabled, true);

  const snapshot = await api(`/services/${serviceId}/snapshots`, {
    method: 'POST',
    user: 'tenant-a',
    body: { description: 'integration snapshot' },
  });
  assert.equal(snapshot.status, 201);
  const snap = await snapshot.json();
  assert.ok(snap.id);

  const serviceSnapshots = await api(`/services/${serviceId}/snapshots`, { user: 'tenant-a' });
  assert.equal(serviceSnapshots.status, 200);
  assert.equal((await serviceSnapshots.json()).some((item) => item.id === snap.id), true);

  const restore = await api(`/services/${serviceId}/restore`, {
    method: 'POST',
    user: 'tenant-a',
    body: { snapshotId: snap.id },
  });
  assert.equal(restore.status, 200);

  const createKey = await api('/ssh-keys', {
    method: 'POST',
    user: 'tenant-a',
    body: { name: 'integration-key', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest integration@example' },
  });
  assert.equal(createKey.status, 201);
  const key = await createKey.json();
  assert.ok(key.id);

  const keys = await api('/ssh-keys', { user: 'tenant-a' });
  assert.equal(keys.status, 200);
  assert.equal((await keys.json()).some((item) => item.id === key.id), true);
});

test('owner lifecycle works and destroy removes the service from the list', async () => {
  const halt = await api(`/services/${serviceId}/halt`, { method: 'POST', user: 'tenant-a' });
  assert.equal(halt.status, 200);

  const start = await api(`/services/${serviceId}/start`, { method: 'POST', user: 'tenant-a' });
  assert.equal(start.status, 200);

  const destroy = await api(`/services/${serviceId}`, { method: 'DELETE', user: 'tenant-a' });
  assert.equal(destroy.status, 200);

  const remaining = await (await api('/services', { user: 'tenant-a' })).json();
  assert.equal(remaining.length, 0);

  // Destroyed service is gone for its owner too.
  const gone = await api(`/services/${serviceId}`, { user: 'tenant-a' });
  assert.equal([403, 404].includes(gone.status), true);
});
