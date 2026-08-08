/**
 * ZIP deploy pipeline → DB-first provisioning integration test.
 *
 * Proves the acceptance-critical wiring: the live ZIP deploy path
 * (base64ZipToRender.pipeline.deployZipSite) creates the canonical
 * WebHostingService record + ServiceAccess row through
 * hostingProvisioningService BEFORE/without a direct provider write, and the
 * hostingStore write is only a tagged transitional mirror.
 *
 * Render is force-disabled (RENDER_API_DISABLED=true) so the provider step is
 * skipped deterministically and no network is touched — the DB pending row must
 * still be created. DATABASE_URL + DATA_DIR are set before any app module loads.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let tempDir;
let pipeline;
let hostingRepo;
let accessRepo;
let readHostingStore;
let disconnect;

const USER = 'user-zip-1';

function makeZipBase64() {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<!doctype html><title>hi</title>'));
  return zip.toBuffer().toString('base64');
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-zip-pipeline-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });

  // Configure the environment BEFORE any app module is imported.
  process.env.DATABASE_URL = dbUrl;
  process.env.DATA_DIR = join(tempDir, 'data');
  process.env.RENDER_API_DISABLED = 'true';   // force the provider-skipped path
  delete process.env.RENDER_GENERATED_SITES_REPO_URL;
  delete process.env.GENERATED_SITES_REPO_URL;

  pipeline = await import('../src/glondia-engines/01-HOSTING-DEPLOY-ENGINE/pipelines/base64ZipToRender.pipeline.js');
  hostingRepo = await import('../src/repositories/hosting.repository.js');
  accessRepo = await import('../src/repositories/serviceAccess.repository.js');
  ({ readHostingStore } = await import('../src/services/hostingStore.js'));
  ({ disconnectPrisma: disconnect } = await import('../src/services/db.js'));
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('ZIP deploy creates the canonical pending DB row + access without a provider call', async () => {
  const result = await pipeline.deployZipSite({
    fileBase64: makeZipBase64(),
    fileName: 'my-site.zip',
    userId: USER,
    siteName: 'My Zip Site',
  });

  assert.ok(result.deploymentId, 'a deploymentId is returned');
  const deploymentId = result.deploymentId;

  // Canonical DB row exists, pinned to the deploymentId, owned by the user.
  const row = await hostingRepo.findById(deploymentId);
  assert.ok(row, 'WebHostingService row was created');
  assert.equal(row.id, deploymentId, 'row id === deploymentId');
  assert.equal(row.createdByUserId, USER);
  assert.equal(row.organizationId, USER, 'org falls back to userId when none supplied');
  assert.equal(row.status, 'prepared', 'provider skipped → record stays prepared (not activated)');
  assert.equal(row.providerServiceId, null, 'no provider id — provider was never called');

  // ServiceAccess pending row keyed on the same stable id.
  const access = await accessRepo.findByService('hosting', deploymentId);
  assert.ok(access, 'a ServiceAccess row was created');
  assert.equal(access.serviceId, deploymentId);
  assert.equal(access.accessStatus, 'pending');

  // hostingStore write is present but clearly marked as a transitional mirror.
  const store = await readHostingStore();
  const mirror = (store.deployments || []).find((d) => d.deploymentId === deploymentId);
  assert.ok(mirror, 'legacy mirror row exists');
  assert.equal(mirror.legacyMirror, true);
  assert.equal(mirror.mirrorOf, 'web_hosting_service');
  assert.equal(mirror.canonicalServiceId, deploymentId);
  assert.equal(mirror.dbBacked, true);
});

test('a second ZIP deploy for the same user gets its own DB row + access (unique)', async () => {
  const result = await pipeline.deployZipSite({
    fileBase64: makeZipBase64(),
    fileName: 'my-site.zip',
    userId: USER,
    siteName: 'My Zip Site',   // same name → slug collision would break a naive create
  });
  const row = await hostingRepo.findById(result.deploymentId);
  assert.ok(row, 'second deploy created its own canonical row despite the same site name');
  const access = await accessRepo.findByService('hosting', result.deploymentId);
  assert.equal(access.accessStatus, 'pending');
});
