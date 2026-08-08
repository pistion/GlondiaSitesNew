/**
 * hosting.repository integration tests.
 *
 * Exercises the canonical WebHostingService gateway directly against a
 * throwaway SQLite database (schema pushed with the project's own Prisma
 * workflow). Proves the DB-first ownership contract the hosting flows depend
 * on, mirroring the VPS repository guarantees:
 *
 *   - creation records a pending hosting row AND a pending ServiceAccess row
 *     BEFORE any provider call,
 *   - provider success activates the exact local row + its access,
 *   - provider-missing flags the row and never deletes it,
 *   - destroy soft-deletes (history preserved) and cancels access.
 *
 * DATABASE_URL is set before db.js is imported, so the repository is loaded
 * dynamically inside `before`.
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
let repo;
let accessRepo;
let prisma;
let disconnect;

const ORG = 'org-hosting-1';
const USER = 'user-hosting-1';
const DEPLOYMENT_ID = 'dep_repo_test_1';

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-hosting-repo-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });

  // Set the connection BEFORE db.js is imported anywhere in this process.
  process.env.DATABASE_URL = dbUrl;

  repo = await import('../src/repositories/hosting.repository.js');
  accessRepo = await import('../src/repositories/serviceAccess.repository.js');
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('createPendingBundle records a pending hosting row + pending access before any provider call', async () => {
  const { record } = await repo.createPendingBundle({
    service: {
      id: DEPLOYMENT_ID,
      organizationId: ORG,
      createdByUserId: USER,
      name: 'Repo Test Site',
      plan: 'starter',
    },
    access: { userId: USER, organizationId: ORG },
  });

  assert.equal(record.id, DEPLOYMENT_ID, 'primary key is pinned to the stable deployment id');
  assert.equal(record.status, 'pending');
  assert.equal(record.providerServiceId, null, 'no provider id before the provider call');

  const access = await accessRepo.findByService('hosting', DEPLOYMENT_ID);
  assert.ok(access, 'a ServiceAccess row exists');
  assert.equal(access.accessStatus, 'pending');
  assert.equal(access.userId, USER);
  assert.equal(access.organizationId, ORG);
});

test('activateProvisionedBundle updates the exact local row and activates access', async () => {
  const record = await repo.activateProvisionedBundle({
    serviceId: DEPLOYMENT_ID,
    providerFields: { providerServiceId: 'srv-render-123', status: 'live', url: 'https://x.example' },
    metadata: { renderServiceId: 'srv-render-123' },
    access: { billingStatus: 'paid' },
  });

  assert.equal(record.providerServiceId, 'srv-render-123');
  assert.equal(record.status, 'live');
  assert.equal(record.url, 'https://x.example');

  const access = await accessRepo.findByService('hosting', DEPLOYMENT_ID);
  assert.equal(access.accessStatus, 'active');
  assert.equal(access.billingStatus, 'paid');
  assert.ok(access.startsAt, 'startsAt was stamped on activation');
});

test('findByProviderServiceId and ownership reads resolve the row', async () => {
  const byProvider = await repo.findByProviderServiceId('srv-render-123');
  assert.equal(byProvider.id, DEPLOYMENT_ID);

  const owned = await repo.requireOwnedHostingService(DEPLOYMENT_ID, ORG);
  assert.equal(owned.id, DEPLOYMENT_ID);

  await assert.rejects(
    () => repo.requireOwnedHostingService(DEPLOYMENT_ID, 'someone-else-org'),
    (err) => err.status === 404,
    'a different organization cannot resolve the row',
  );
});

test('markProviderMissing flags the row without deleting it', async () => {
  await repo.markProviderMissing(DEPLOYMENT_ID);
  const row = await repo.findById(DEPLOYMENT_ID);
  assert.equal(row.status, 'provider_missing');
  assert.equal(row.deletedAt, null, 'provider-missing never soft-deletes');
  // Still owned/listable — customer keeps visibility on the failed row.
  const listed = await repo.listByOrganization(ORG);
  assert.ok(listed.some((r) => r.id === DEPLOYMENT_ID));
});

test('finalizeDestroyBundle soft-deletes (history preserved) and cancels access', async () => {
  const record = await repo.finalizeDestroyBundle({ serviceId: DEPLOYMENT_ID, reason: 'customer_deleted' });
  assert.equal(record.status, 'destroyed');
  assert.ok(record.deletedAt, 'row is soft-deleted');
  assert.equal(record.deletedReason, 'customer_deleted');

  // History preserved: the row still exists in the table.
  const stillThere = await repo.findById(DEPLOYMENT_ID);
  assert.ok(stillThere, 'destroyed row is retained for history');

  // But it is excluded from the customer-facing owned listing.
  const listed = await repo.listByOrganization(ORG);
  assert.equal(listed.some((r) => r.id === DEPLOYMENT_ID), false);

  const access = await accessRepo.findByService('hosting', DEPLOYMENT_ID);
  assert.equal(access.accessStatus, 'deleted');
  assert.equal(access.billingStatus, 'cancelled');
});
