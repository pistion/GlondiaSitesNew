/**
 * hostingProvisioningService + payment-sync integration tests.
 *
 * Runs the canonical DB-first hosting create flow against a throwaway SQLite
 * database with an INJECTED provider adapter (no live Render), and verifies the
 * idempotent payment sync on the repository. Covers Phase-12 items:
 *   - provider success activates the exact local record + access,
 *   - provider failure keeps a visible failed row (paid → review_required),
 *   - payment sync activates access idempotently (repeat = no double-apply).
 *
 * DATABASE_URL is set before db.js is imported, so modules load dynamically.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let tempDir;
let provisioning;
let hostingRepo;
let accessRepo;
let prisma;
let disconnect;

const ORG = 'org-prov-1';
const USER = 'user-prov-1';

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-hosting-prov-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });
  process.env.DATABASE_URL = dbUrl;

  provisioning = await import('../src/services/hostingProvisioningService.js');
  hostingRepo = await import('../src/repositories/hosting.repository.js');
  accessRepo = await import('../src/repositories/serviceAccess.repository.js');
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('provider success activates the exact local record and its access', async () => {
  const providerCreate = async () => ({ providerServiceId: 'srv-ok-1', url: 'https://ok.example', raw: {} });
  const record = await provisioning.createHostingService(
    { id: 'dep_ok', name: 'OK Site' },
    { organizationId: ORG, userId: USER },
    { paid: false },
    { providerCreate },
  );

  assert.equal(record.id, 'dep_ok');
  assert.equal(record.providerServiceId, 'srv-ok-1');
  assert.equal(record.status, 'building');

  const access = await accessRepo.findByService('hosting', 'dep_ok');
  assert.equal(access.accessStatus, 'active');
});

test('provider failure on a paid flow keeps a visible review_required row', async () => {
  const providerCreate = async () => { throw new Error('render exploded'); };
  await assert.rejects(
    () => provisioning.createHostingService(
      { id: 'dep_fail', name: 'Fail Site', checkoutOrderId: 'ord_1' },
      { organizationId: ORG, userId: USER },
      { paid: true },
      { providerCreate },
    ),
    (err) => err.status === 502,
  );

  // Row is NOT deleted — it stays visible for support/audit.
  const row = await hostingRepo.findById('dep_fail');
  assert.ok(row, 'failed row is retained');
  assert.equal(row.status, 'review_required', 'paid failure escalates to review');

  const access = await accessRepo.findByService('hosting', 'dep_fail');
  assert.equal(access.adminStatus, 'review_required');
  assert.equal(access.billingStatus, 'paid', 'the customer paid — billing stays paid');
});

test('provider failure on an unpaid flow cancels access but keeps the failed row', async () => {
  const providerCreate = async () => { throw new Error('nope'); };
  await assert.rejects(
    () => provisioning.createHostingService(
      { id: 'dep_unpaid', name: 'Unpaid Site' },
      { organizationId: ORG, userId: USER },
      { paid: false },
      { providerCreate },
    ),
    (err) => err.status === 502,
  );
  const row = await hostingRepo.findById('dep_unpaid');
  assert.equal(row.status, 'error');
  const access = await accessRepo.findByService('hosting', 'dep_unpaid');
  assert.equal(access.accessStatus, 'cancelled');
});

test('markHostingPaid activates access idempotently', async () => {
  // Seed a pending, unpaid hosting row + access.
  await hostingRepo.createPendingBundle({
    service: { id: 'dep_pay', organizationId: ORG, createdByUserId: USER, name: 'Pay Site' },
    access: { userId: USER, organizationId: ORG },
  });

  const first = await hostingRepo.markHostingPaid('dep_pay', { checkoutOrderId: 'ord_pay' });
  assert.equal(first.paymentStatus, 'paid');
  assert.ok(first.paidAt);

  const access1 = await accessRepo.findByService('hosting', 'dep_pay');
  assert.equal(access1.accessStatus, 'active');
  assert.equal(access1.billingStatus, 'paid');
  const firstPaidAt = first.paidAt.toISOString();

  // Repeat capture/webhook: short-circuits, no double-apply, paidAt unchanged.
  const second = await hostingRepo.markHostingPaid('dep_pay', { checkoutOrderId: 'ord_pay' });
  assert.equal(second.paidAt.toISOString(), firstPaidAt, 'idempotent — paidAt not moved');
});

test('markHostingPaid is a safe no-op when no relational row exists', async () => {
  const result = await hostingRepo.markHostingPaid('dep_does_not_exist', { checkoutOrderId: 'ord_x' });
  assert.equal(result, null);
});

test('provider "skipped" keeps the record pending and does not activate access', async () => {
  const providerCreate = async () => ({ skipped: true, reason: 'render_not_configured' });
  const record = await provisioning.createHostingService(
    { id: 'dep_skip', name: 'Skip Site' },
    { organizationId: ORG, userId: USER },
    { paid: false },
    { providerCreate },
  );
  assert.equal(record.id, 'dep_skip');
  assert.equal(record.status, 'prepared');
  assert.equal(record.providerServiceId, null, 'no provider id — provider was never called');

  const access = await accessRepo.findByService('hosting', 'dep_skip');
  assert.equal(access.accessStatus, 'pending', 'access stays pending until a provider resource exists');
});

test('provider success + DB activation failure triggers compensation (provider delete)', async () => {
  let deleted = null;
  // providerCreate succeeds, but simulates a concurrent hard-delete of the
  // pending row so the subsequent activation transaction fails — forcing the
  // compensation path (delete the just-created provider resource).
  const providerCreate = async () => {
    await prisma.webHostingService.delete({ where: { id: 'dep_comp2' } });
    return { providerServiceId: 'srv-comp-2', url: 'https://c2.example' };
  };
  const providerDelete = async (id) => { deleted = id; };

  await assert.rejects(
    () => provisioning.createHostingService(
      { id: 'dep_comp2', name: 'Comp2 Site' },
      { organizationId: ORG, userId: USER },
      { paid: false },
      { providerCreate, providerDelete },
    ),
    (err) => err.status === 500,
  );
  assert.equal(deleted, 'srv-comp-2', 'compensation deleted the orphaned provider service');
});
