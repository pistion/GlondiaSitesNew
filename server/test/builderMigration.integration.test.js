/**
 * Legacy JSON → BuilderProject migration: dry-run makes no writes, execute is
 * idempotent, ownership is preserved, sources are never mutated, and verify
 * reconciles counts.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, mkdirSync, openSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(projectRoot, 'scripts', 'migrate-builder-json.mjs');

let tempDir;
let dataDir;
let dbUrl;
let plansPath;
let sitesPath;

function runMigration(mode) {
  const out = execFileSync(process.execPath, [script, mode], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl, DATA_DIR: dataDir, MIGRATION_CONNECT_DB: 'true' },
    encoding: 'utf8',
  });
  // The report JSON is printed; grab the first well-formed object.
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  return JSON.parse(out.slice(start, end + 1));
}

async function countProjects() {
  const { prisma } = await import('../src/services/db.js');
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "builder_projects"`);
  return Number(rows[0].c);
}

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-builder-migrate-'));
  dataDir = join(tempDir, 'data');
  mkdirSync(join(dataDir, 'template-site-plans'), { recursive: true });
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;
  process.env.DATABASE_URL = dbUrl;
  process.env.DATA_DIR = dataDir;

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
    shell: true,
  });

  plansPath = join(dataDir, 'template-site-plans', 'plans.json');
  sitesPath = join(dataDir, 'template-sites.json');
  writeFileSync(plansPath, JSON.stringify([
    { planId: 'plan_a', userId: 'owner-1', templateId: 'pulse-works', brief: { businessName: 'Alpha Co' }, sitemap: { pages: [] }, createdAt: '2026-01-01T00:00:00.000Z' },
    { planId: 'plan_b', userId: 'owner-2', templateId: 'forge', brief: { businessName: 'Beta Co' }, createdAt: '2026-01-02T00:00:00.000Z' },
    { /* corrupt: no planId */ userId: 'owner-x' },
  ], null, 2));
  writeFileSync(sitesPath, JSON.stringify({
    sites: [
      { siteId: 'tai_1', userId: 'owner-3', templateId: 'pulse-works', answers: { businessName: 'Gamma Co' }, createdAt: '2026-01-03T00:00:00.000Z' },
    ],
  }, null, 2));
}, { timeout: 120000 });

after(() => {
  if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ } }
});

test('dry-run makes no database writes and flags corrupt records', async () => {
  const report = runMigration('--dry-run');
  assert.equal(report.mode, '--dry-run');
  assert.equal(report.counts.total, 3); // 2 plans + 1 site (corrupt plan excluded)
  assert.ok(report.corruptRecords.length >= 1, 'corrupt record must be reported');
  assert.equal(await countProjects(), 0, 'dry-run must not write');
});

test('execute imports, preserves ownership, and is idempotent', async () => {
  const sourceHashBefore = createHash('sha256').update(readFileSync(plansPath)).digest('hex');

  const first = runMigration('--execute');
  assert.equal(first.counts.created, 3);
  assert.ok(first.backupDir && existsSync(first.backupDir), 'backups must be written');
  assert.equal(await countProjects(), 3);

  // Source files are never mutated.
  const sourceHashAfter = createHash('sha256').update(readFileSync(plansPath)).digest('hex');
  assert.equal(sourceHashAfter, sourceHashBefore, 'source JSON must not be mutated');

  // Ownership preserved.
  const { prisma } = await import('../src/services/db.js');
  const rows = await prisma.$queryRawUnsafe(`SELECT "user_id", "name" FROM "builder_projects" ORDER BY "name"`);
  const owners = Object.fromEntries(rows.map((r) => [r.name, r.user_id]));
  assert.equal(owners['Alpha Co'], 'owner-1');
  assert.equal(owners['Beta Co'], 'owner-2');
  assert.equal(owners['Gamma Co'], 'owner-3');

  // Idempotent: a second execute changes nothing.
  const second = runMigration('--execute');
  assert.equal(second.counts.created, 0);
  assert.equal(second.counts.unchanged, 3);
  assert.equal(await countProjects(), 3, 're-run must not duplicate');
});

test('verify reconciles counts', async () => {
  const report = runMigration('--verify');
  assert.equal(report.verify.migrated, 3);
  assert.equal(report.verify.expected, 3);
  assert.equal(report.ok, true);
});
