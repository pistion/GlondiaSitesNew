/**
 * Admin customer-oversight integration tests.
 *
 * Boots the real server against a throwaway SQLite database, seeds one
 * customer footprint (VPS in provider test mode + support ticket), then
 * exercises the unified /api/admin/customers/:userId/* endpoints:
 * admin gating, section completeness, cross-customer isolation, ServiceAccess
 * as the service index, and secret exclusion.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3984;
const BASE = `http://127.0.0.1:${PORT}/api`;

let proc;
let tempDir;

function api(path, { method = 'GET', user, role, body } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { 'x-user-id': user } : {}),
      ...(role ? { 'x-user-role': role } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const admin = (path, opts = {}) => api(path, { ...opts, user: 'admin-user', role: 'admin' });

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-admin-test-'));
  const dbPath = join(tempDir, 'test.db');
  const dataDir = join(tempDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });

  // The dev auth fallback trusts x-user-id headers but oversight resolves the
  // customer from the users table — seed the identities it will look up.
  const seed = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      for (const [id, email, clientId] of [
        ['cust-a', 'cust-a@test.local', 'glondiac-0001'],
        ['cust-b', 'cust-b@test.local', 'glondiac-0002'],
        ['cust-c', 'cust-c@test.local', 'glondiac-0003'],
        ['cust-d', 'cust-d@test.local', 'glondiac-0004'],
        ['admin-user', 'admin@test.local', null],
      ]) {
        await prisma.user.create({ data: { id, email, clientId, passwordHash: 'x', role: id === 'admin-user' ? 'admin' : 'owner' } });
      }
      await prisma.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  execSync(`node -e "${seed.replaceAll('"', '\\"').replaceAll('\n', ' ')}"`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });

  writeFileSync(join(dataDir, 'render-hosting.json'), JSON.stringify({
    deployments: [
      {
        deploymentId: 'dep-repair-missing',
        id: 'dep-repair-missing',
        userId: 'cust-a',
        serviceName: 'Repair Missing',
        serviceType: 'web_service',
        renderServiceId: 'render-repair-missing',
        checkoutOrderId: null,
        status: 'live',
        paymentStatus: 'paid',
        liveUrl: 'https://repair-missing.example.test',
        priceCents: 10000,
        priceCurrency: 'PGK',
        renderPlan: 'starter',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        deploymentId: 'dep-repair-perfect',
        id: 'dep-repair-perfect',
        userId: 'cust-a',
        serviceName: 'Repair Perfect',
        serviceType: 'web_service',
        renderServiceId: 'render-repair-perfect',
        status: 'live',
        paymentStatus: 'paid',
        liveUrl: 'https://repair-perfect.example.test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        deploymentId: 'dep-repair-owner-conflict',
        id: 'dep-repair-owner-conflict',
        userId: 'cust-a',
        organizationId: 'foreign-org',
        serviceName: 'Repair Owner Conflict',
        serviceType: 'web_service',
        renderServiceId: 'render-owner-conflict',
        status: 'live',
        paymentStatus: 'paid',
      },
      {
        deploymentId: 'dep-repair-provider-conflict',
        id: 'dep-repair-provider-conflict',
        userId: 'cust-a',
        serviceName: 'Repair Provider Conflict',
        serviceType: 'web_service',
        renderServiceId: 'render-provider-conflict',
        status: 'live',
        paymentStatus: 'paid',
      },
      {
        deploymentId: 'dep-lifecycle-c',
        id: 'dep-lifecycle-c',
        userId: 'cust-c',
        serviceName: 'Lifecycle Hosting',
        serviceType: 'web_service',
        renderServiceId: null,
        status: 'live',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString(),
      },
    ],
    sessions: [],
    logs: {},
    env: {},
    disks: {},
    domains: {},
    checkoutOrders: [],
    payments: [],
  }, null, 2));

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
      DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Server did not become healthy in 30s');
    await new Promise((r) => setTimeout(r, 400));
  }

  // Seed one customer footprint: a VPS (test mode) and a support ticket.
  const vps = await api('/v1/vps-hosting/services', {
    method: 'POST', user: 'cust-a',
    body: { plan: 'vc2-1c-1gb', region: 'syd', osId: 2284, label: 'oversight-a' },
  });
  assert.equal(vps.status, 201, 'seed VPS create must succeed');
  const ticket = await api('/v1/tickets', {
    method: 'POST', user: 'cust-a',
    body: { subject: 'Oversight test ticket', category: 'vps', priority: 'urgent', body: 'Something is wrong.' },
  });
  assert.equal(ticket.status, 201, 'seed ticket create must succeed');
  // A second customer with their own VPS for isolation checks.
  const vpsB = await api('/v1/vps-hosting/services', {
    method: 'POST', user: 'cust-b',
    body: { plan: 'vc2-1c-1gb', region: 'syd', osId: 2284, label: 'oversight-b' },
  });
  assert.equal(vpsB.status, 201);

  const extraSeed = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      await prisma.serviceAccess.create({
        data: {
          userId: null,
          organizationId: 'glondiac-0001',
          serviceType: 'email',
          serviceId: 'org-email-a',
          serviceName: 'Org email A',
          accessStatus: 'active',
          billingStatus: 'paid',
        },
      });
      await prisma.serviceAccess.create({
        data: {
          userId: null,
          organizationId: 'foreign-org',
          serviceType: 'email',
          serviceId: 'foreign-email',
          serviceName: 'Foreign email',
          accessStatus: 'active',
          billingStatus: 'paid',
        },
      });
      await prisma.webHostingService.create({
        data: {
          id: 'dep-repair-perfect',
          organizationId: 'glondiac-0001',
          createdByUserId: 'cust-a',
          provider: 'render',
          providerServiceId: 'render-repair-perfect',
          name: 'Repair Perfect',
          slug: 'repair-perfect',
          serviceType: 'web_service',
          status: 'live',
          url: 'https://repair-perfect.example.test',
          paymentStatus: 'paid',
        },
      });
      await prisma.serviceAccess.create({
        data: {
          userId: 'cust-a',
          organizationId: 'glondiac-0001',
          serviceType: 'hosting',
          serviceId: 'dep-repair-perfect',
          serviceName: 'Repair Perfect',
          accessStatus: 'active',
          billingStatus: 'paid',
        },
      });
      await prisma.serviceAccess.create({
        data: {
          userId: 'cust-c',
          organizationId: 'glondiac-0003',
          serviceType: 'hosting',
          serviceId: 'lifecycle-active',
          serviceName: 'Lifecycle Active',
          accessStatus: 'active',
          billingStatus: 'paid',
        },
      });
      await prisma.serviceAccess.create({
        data: {
          userId: null,
          organizationId: 'glondiac-0003',
          serviceType: 'email',
          serviceId: 'lifecycle-org-active',
          serviceName: 'Lifecycle Org Active',
          accessStatus: 'active',
          billingStatus: 'paid',
        },
      });
      await prisma.serviceAccess.create({
        data: {
          userId: 'cust-c',
          organizationId: 'glondiac-0003',
          serviceType: 'email',
          serviceId: 'lifecycle-pending',
          serviceName: 'Lifecycle Pending',
          accessStatus: 'pending',
          billingStatus: 'pending',
        },
      });
      for (let i = 0; i < 3; i += 1) {
        await prisma.serviceAccess.create({
          data: {
            userId: 'cust-a',
            organizationId: 'glondiac-0001',
            serviceType: 'email',
            serviceId: 'overview-extra-' + i,
            serviceName: 'Overview Extra ' + i,
            accessStatus: 'active',
            billingStatus: 'paid',
          },
        });
      }
      await prisma.serviceAccess.create({
        data: {
          userId: 'cust-c',
          organizationId: 'glondiac-0003',
          serviceType: 'hosting',
          serviceId: 'lifecycle-expired',
          serviceName: 'Lifecycle Expired',
          accessStatus: 'expired',
          billingStatus: 'paid',
        },
      });
      await prisma.webHostingService.create({
        data: {
          id: 'dep-provider-conflict-existing',
          organizationId: 'foreign-org',
          createdByUserId: 'cust-b',
          provider: 'render',
          providerServiceId: 'render-provider-conflict',
          name: 'Provider Conflict Existing',
          slug: 'provider-conflict-existing',
          serviceType: 'web_service',
          status: 'live',
          paymentStatus: 'paid',
        },
      });
      for (const order of [
        { userId: 'cust-a', organizationId: 'cust-a', currency: 'PGK', totalAmountCents: 10000, status: 'pending' },
        { userId: 'cust-a', organizationId: 'cust-a', currency: 'USD', totalAmountCents: 5000, status: 'pending' },
        { userId: 'cust-b', organizationId: 'cust-b', currency: 'PGK', totalAmountCents: 12345, status: 'pending' },
        { userId: 'cust-c', organizationId: 'cust-c', currency: 'PGK', totalAmountCents: 7777, status: 'paid' },
        { userId: 'cust-d', organizationId: 'cust-d', currency: 'PGK', totalAmountCents: 9999, status: 'paid' },
      ]) {
        await prisma.checkoutOrder.create({ data: { ...order, type: 'deployment', provider: 'test' } });
      }
      await prisma.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  execSync(`node -e "${extraSeed.replaceAll('"', '\\"').replaceAll('\n', ' ')}"`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });
}, { timeout: 120000 });

after(() => {
  if (proc) proc.kill();
  if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows file locks */ } }
});

test('oversight endpoints are admin-gated', async () => {
  const asCustomer = await api('/admin/customers/cust-a/overview', { user: 'cust-a' });
  assert.equal(asCustomer.status, 403);
  const anonymous = await api('/admin/customers/cust-a/overview');
  assert.equal([401, 403].includes(anonymous.status), true);
});

test('unknown customer returns the stable error format', async () => {
  const res = await admin('/admin/customers/does-not-exist/overview');
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'ADMIN_CUSTOMER_NOT_FOUND');
});

let overview;

test('overview returns every section for one customer', async () => {
  const res = await admin('/admin/customers/cust-a/overview');
  assert.equal(res.status, 200);
  overview = (await res.json()).data;

  assert.equal(overview.customer.id, 'cust-a');
  for (const key of ['summary', 'projects', 'services', 'billing', 'support', 'operations', 'activity', 'warnings']) {
    assert.ok(key in overview, `overview must include ${key}`);
  }
  for (const key of ['orders', 'receipts', 'subscriptions', 'invoices', 'creditNotes', 'paymentMethods']) {
    assert.ok(Array.isArray(overview.billing[key]), `billing.${key} must be an array`);
  }

  // The seeded VPS is resolved through ServiceAccess into a normalized DTO.
  const vps = overview.services.find((s) => s.serviceType === 'vps');
  assert.ok(vps, 'VPS service must be resolved');
  assert.equal(vps.serviceName, 'oversight-a');
  assert.equal(vps.accessStatus, 'active');
  assert.equal(vps.billingStatus, 'free');
  assert.ok(vps.price.totalPriceCents > 0);
  assert.equal(vps.details.region, 'syd');
  assert.equal(vps.details.plan, 'vc2-1c-1gb');
  assert.ok(vps.details.mainIp, 'VPS detail should include the live IP for admin tracking');
  assert.equal('metadata' in vps.details, false);
  assert.equal('connectionPassword' in vps.details, false);

  // Support section carries the seeded ticket and drives the summary.
  assert.equal(overview.support.tickets.length, 1);
  assert.equal(overview.summary.openTickets, 1);
  assert.equal(overview.summary.urgentTickets, 1);
  assert.equal(overview.summary.services >= 1, true);
  assert.ok(overview.summary.services > overview.services.length, 'overview summary counts the full service set while the payload stays lightweight');
  assert.ok(overview.services.length <= 6, 'overview returns only a service preview');
});

test('customer-scope ServiceAccess includes user-owned and organization-owned rows only', async () => {
  assert.ok(overview, 'overview loaded');
  assert.ok(overview.services.some((s) => s.serviceType === 'vps' && s.serviceName === 'oversight-a'), 'user-owned ServiceAccess must be included');
  assert.ok(overview.services.some((s) => s.serviceType === 'email' && s.serviceName === 'Org email A'), 'organization-owned ServiceAccess must be included');
  assert.equal(overview.services.some((s) => s.serviceName === 'Foreign email'), false, 'foreign organization ServiceAccess must not leak');
});

test('outstanding totals are grouped by currency', async () => {
  assert.deepEqual(overview.summary.outstandingByCurrency, [
    { currency: 'PGK', amountCents: 10000 },
    { currency: 'USD', amountCents: 5000 },
  ]);
  assert.equal('outstandingAmountCents' in overview.summary, false);
  assert.equal('currency' in overview.summary, false);
});

test('one-currency outstanding total remains a single grouped amount', async () => {
  const res = await admin('/admin/customers/cust-b/overview');
  assert.equal(res.status, 200);
  const body = (await res.json()).data;
  assert.deepEqual(body.summary.outstandingByCurrency, [
    { currency: 'PGK', amountCents: 12345 },
  ]);
});

test('no pending orders returns an empty outstanding group', async () => {
  const res = await admin('/admin/customers/cust-d/overview');
  assert.equal(res.status, 200);
  const body = (await res.json()).data;
  assert.deepEqual(body.summary.outstandingByCurrency, []);
});

test('cross-customer isolation: no foreign services or tickets leak', async () => {
  assert.ok(overview, 'overview loaded');
  const foreign = overview.services.find((s) => s.serviceName === 'oversight-b');
  assert.equal(foreign, undefined, "customer A's overview must not contain customer B's VPS");

  const resB = await admin('/admin/customers/cust-b/overview');
  const b = (await resB.json()).data;
  assert.equal(b.support.tickets.length, 0);
  assert.equal(b.services.some((s) => s.serviceName === 'oversight-a'), false);
});

test('no secrets in any oversight payload', async () => {
  const raw = JSON.stringify(overview);
  for (const needle of ['passwordHash', 'password_hash', 'connectionPassword', 'idPhotoPath', 'avatarPath', 'filePath', 'providerMethodId']) {
    assert.equal(raw.includes(needle), false, `overview must not contain ${needle}`);
  }
});

test('section endpoints respond individually', async () => {
  for (const sectionPath of ['services', 'billing', 'support', 'operations', 'activity']) {
    const res = await admin(`/admin/customers/cust-a/${sectionPath}`);
    assert.equal(res.status, 200, `${sectionPath} must respond 200`);
  }
});

test('section endpoints return pagination metadata and reject invalid pagination', async () => {
  const services = await admin('/admin/customers/cust-a/services?limit=2&offset=0');
  assert.equal(services.status, 200);
  const servicesData = (await services.json()).data;
  assert.equal(Array.isArray(servicesData.items), true);
  assert.equal(servicesData.limit, 2);
  assert.equal(typeof servicesData.total, 'number');

  const billing = await admin('/admin/customers/cust-a/billing?limit=2');
  assert.equal(billing.status, 200);
  const billingData = (await billing.json()).data;
  assert.equal(Array.isArray(billingData.orders.items), true);
  assert.equal(typeof billingData.orders.total, 'number');

  const invalid = await admin('/admin/customers/cust-a/services?limit=500');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'ADMIN_INVALID_PAGINATION');

  const decimal = await admin('/admin/customers/cust-a/services?limit=1.5');
  assert.equal(decimal.status, 400);
  const badDate = await admin('/admin/customers/cust-a/activity?dateFrom=not-a-date');
  assert.equal(badDate.status, 400);

  const filtered = await admin('/admin/customers/cust-a/services?serviceType=email&limit=2');
  const filteredData = (await filtered.json()).data;
  assert.equal(filteredData.items.length, 2);
  assert.ok(filteredData.items.every((item) => item.serviceType === 'email'));
});

test('hosting repair audits, repairs safe gaps, and preserves conflicts', async () => {
  const dry = await admin('/admin/repairs/hosting/audit', { method: 'POST' });
  assert.equal(dry.status, 200);
  const dryData = (await dry.json()).data;
  assert.equal(dryData.dryRun, true);
  assert.equal(dryData.scanned, 5);
  assert.equal(dryData.created, 0, 'dry run must not write');
  assert.ok(dryData.items.find((item) => item.deploymentId === 'dep-repair-missing')?.plans.length >= 2);
  assert.ok(dryData.conflicts.some((item) => item.code === 'ORGANIZATION_OWNER_MISMATCH'));
  assert.ok(dryData.conflicts.some((item) => item.code === 'USER_OWNER_MISMATCH'));

  const run = await admin('/admin/repairs/hosting/run', { method: 'POST', body: { dryRun: false } });
  assert.equal(run.status, 200);
  const runData = (await run.json()).data;
  assert.equal(runData.dryRun, false);
  assert.equal(runData.scanned, 5);
  assert.equal(runData.created, 4, 'missing relational rows and ServiceAccess links are created');
  assert.equal(runData.errors.length, 0);
  assert.ok(runData.conflicts.length >= 2);

  const single = await admin('/admin/services/hosting/dep-repair-missing/repair', { method: 'POST', body: { dryRun: false } });
  assert.equal(single.status, 200);
  const singleData = (await single.json()).data;
  assert.equal(singleData.created, 0, 'repeat repair must be idempotent');
  assert.equal(singleData.updated, 0);
  assert.equal(singleData.conflicts.length, 0);
  assert.equal(singleData.items[0].organizationId, 'glondiac-0001', 'repair writes the safe owner link back to the compatibility store');

  const unknown = await admin('/admin/services/hosting/does-not-exist/repair', { method: 'POST', body: { dryRun: true } });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'ADMIN_HOSTING_DEPLOYMENT_NOT_FOUND');

});

test('old admin endpoints are preserved', async () => {
  const users = await admin('/admin/users');
  assert.equal(users.status, 200);
  const vps = await admin('/admin/vps-services');
  assert.equal(vps.status, 200);
  const vpsData = (await vps.json()).data;
  assert.ok(vpsData.some((row) => row.label === 'oversight-a' && row.userId === 'cust-a'), 'admin VPS list must include customer-owned VPS records');
  assert.equal(JSON.stringify(vpsData).includes('connectionPassword'), false);
  const detail = await admin('/admin/users/cust-a');
  assert.equal(detail.status, 200);
  const legacy = (await detail.json()).data;
  assert.ok('deployments' in legacy && 'orders' in legacy && 'receipts' in legacy, 'legacy detail shape unchanged');
});

test('existing admin user lifecycle actions are preserved', async () => {
  const suspend = await admin('/admin/users/cust-c/suspend', {
    method: 'POST',
    body: { reason: 'freeze compatibility' },
  });
  assert.equal(suspend.status, 200);
  const suspended = (await suspend.json()).data;
  assert.equal(suspended.accountStatus, 'suspended');
  assert.ok(suspended.serviceAccess.count >= 1);

  let services = await admin('/admin/customers/cust-c/services');
  let serviceItems = (await services.json()).data.items;
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-org-active').accessStatus, 'suspended', 'organization-owned access follows account suspension');
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-pending').accessStatus, 'pending', 'pending access is blocked without being promoted or rewritten');
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-pending').adminStatus, 'blocked');

  const reactivate = await admin('/admin/users/cust-c/reactivate', {
    method: 'POST',
    body: { resumeDeployments: false },
  });
  assert.equal(reactivate.status, 200);
  const reactivated = (await reactivate.json()).data;
  assert.equal(reactivated.accountStatus, 'active');
  assert.ok(reactivated.serviceAccess.count >= 1);

  services = await admin('/admin/customers/cust-c/services');
  assert.equal(services.status, 200);
  serviceItems = (await services.json()).data.items;
  const activeAccess = serviceItems.find((item) => item.id === 'lifecycle-active');
  const expiredAccess = serviceItems.find((item) => item.id === 'lifecycle-expired');
  assert.equal(activeAccess.accessStatus, 'active');
  assert.equal(expiredAccess.accessStatus, 'expired', 'expired access is not revived by reactivation');
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-org-active').accessStatus, 'active');
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-pending').accessStatus, 'pending');
  assert.equal(serviceItems.find((item) => item.id === 'lifecycle-pending').adminStatus, 'allowed');

  const disable = await admin('/admin/users/cust-c/disable', {
    method: 'POST',
    body: { reason: 'freeze compatibility' },
  });
  assert.equal(disable.status, 200);
  const disabled = (await disable.json()).data;
  assert.equal(disabled.accountStatus, 'disabled');
  assert.ok(disabled.serviceAccess.count >= 1);

  const enableAfterDisable = await admin('/admin/users/cust-c/reactivate', {
    method: 'POST',
    body: { resumeDeployments: false },
  });
  assert.equal(enableAfterDisable.status, 200);

  const remove = await admin('/admin/users/cust-c/delete', {
    method: 'POST',
    body: { reason: 'freeze compatibility' },
  });
  assert.equal(remove.status, 200);
  const removed = (await remove.json()).data;
  assert.equal(removed.deleted, true);
  assert.equal(removed.hardDelete, false);
  assert.equal(removed.id, 'cust-c');
  assert.equal(removed.account.accountStatus, 'deleted');
  assert.equal(removed.billing.preserved, true);
  assert.ok(removed.hosting.some((row) => row.deploymentId === 'dep-lifecycle-c'));

  const reviveDeleted = await admin('/admin/users/cust-c/reactivate', { method: 'POST', body: {} });
  assert.equal(reviveDeleted.status, 409, 'soft-deleted accounts cannot be revived by the ordinary reactivation route');
  const suspendDeleted = await admin('/admin/users/cust-c/suspend', { method: 'POST', body: {} });
  assert.equal(suspendDeleted.status, 409, 'soft-deleted accounts cannot re-enter the suspend lifecycle');

  const detail = await admin('/admin/users/cust-c');
  assert.equal(detail.status, 200);
  const legacy = (await detail.json()).data;
  assert.equal(legacy.user.accountStatus, 'deleted');
  assert.ok(legacy.orders.some((order) => order.totalAmountCents === 7777), 'financial history is preserved');
  assert.equal(legacy.deployments.find((row) => row.deploymentId === 'dep-lifecycle-c').status, 'account_deleted');

  const activity = await admin('/admin/customers/cust-c/activity?action=soft_deleted&entityType=user');
  const activityData = (await activity.json()).data.audit;
  assert.ok(activityData.items.length >= 1);
  assert.ok(activityData.items.every((row) => row.action.includes('soft_deleted') && row.entityType === 'user'));
});
