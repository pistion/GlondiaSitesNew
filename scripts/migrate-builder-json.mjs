#!/usr/bin/env node
/**
 * migrate-builder-json.mjs — import legacy JSON stores into canonical
 * BuilderProject rows. Prisma becomes the source of truth; legacy JSON is
 * migration input, not the final store.
 *
 *   npm run migrate:builder-json -- --dry-run   (default; no writes)
 *   npm run migrate:builder-json -- --execute    (writes + backups)
 *   npm run migrate:builder-json -- --verify     (compare counts, exit nonzero on drift)
 *
 * Sources (under DATA_DIR):
 *   template-site-plans/plans.json      (hybrid site plans)
 *   template-sites.json                 (AI-tailored template drafts)
 *   render-hosting.json                 (deployment records — reported only)
 *
 * Guarantees: source files are never mutated; each source is SHA-256'd and
 * backed up before --execute; upserts are deterministic and idempotent; a
 * machine-readable report is written and printed; blocking failures exit
 * nonzero.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MODES = ['--dry-run', '--execute', '--verify'];
const mode = process.argv.find((a) => MODES.includes(a)) || '--dry-run';
const execute = mode === '--execute';

const dataDir = resolve(process.env.DATA_DIR || join(process.cwd(), '.glondia-data'));
const backupDir = join(dataDir, 'migration-backups', `builder-${new Date().toISOString().replace(/[:.]/g, '-')}`);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readJsonSource(relativePath) {
  const full = join(dataDir, relativePath);
  if (!existsSync(full)) return { path: full, present: false, sha256: null, raw: null, data: null };
  const raw = await readFile(full, 'utf8');
  let data = null;
  let corrupt = false;
  try { data = JSON.parse(raw); } catch { corrupt = true; }
  return { path: full, present: true, sha256: sha256(raw), raw, data, corrupt };
}

function slugify(value, fallback = 'legacy') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback;
}

/** Map a legacy hybrid site plan to a canonical project record. */
function mapPlan(plan) {
  return {
    legacyKind: 'site-plan',
    legacyId: plan.planId,
    userId: plan.userId || plan.ownerUserId || 'legacy-import',
    sourceType: 'template',
    templateId: plan.templateId || null,
    name: plan.brief?.businessName || plan.sitemap?.name || plan.templateId || 'Imported plan',
    slug: slugify(plan.brief?.businessName || plan.templateId || plan.planId),
    status: 'DRAFT',
    plan: { brief: plan.brief || {}, sitemap: plan.sitemap || {}, style: plan.style || {}, wireframe: plan.wireframe || null },
    answerSheet: plan.answerSheet || {},
    createdAt: normalizeTs(plan.createdAt),
  };
}

/** Map a legacy tailored template site to a canonical project record. */
function mapSite(site) {
  return {
    legacyKind: 'template-site',
    legacyId: site.siteId,
    userId: site.userId || site.ownerUserId || 'legacy-import',
    sourceType: 'template',
    templateId: site.templateId || null,
    name: site.answers?.businessName || site.templateId || 'Imported site',
    slug: slugify(site.answers?.businessName || site.templateId || site.siteId),
    status: 'DRAFT',
    plan: { brief: site.answers || {} },
    answerSheet: { data: site.answers || {} },
    createdAt: normalizeTs(site.createdAt),
  };
}

function normalizeTs(value) {
  if (!value) return null;
  try { return new Date(value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''); } catch { return null; }
}

async function main() {
  console.log(`[migrate:builder-json] mode=${mode} dataDir=${dataDir}`);

  const plansSrc = await readJsonSource('template-site-plans/plans.json');
  const sitesSrc = await readJsonSource('template-sites.json');
  const hostingSrc = await readJsonSource('render-hosting.json');

  const report = {
    mode,
    startedAt: new Date().toISOString(),
    dataDir,
    sources: {
      'template-site-plans/plans.json': sourceMeta(plansSrc),
      'template-sites.json': sourceMeta(sitesSrc),
      'render-hosting.json': sourceMeta(hostingSrc),
    },
    counts: { created: 0, updated: 0, unchanged: 0, corrupt: 0, total: 0 },
    corruptRecords: [],
    ok: true,
  };

  // Import repo is loaded lazily so --dry-run without a DB still validates parsing.
  let repo = null;
  if (mode !== '--dry-run' || process.env.MIGRATION_CONNECT_DB === 'true') {
    repo = await import('../server/src/repositories/builderMigration.repository.js');
  }

  if (execute) {
    await mkdir(backupDir, { recursive: true });
    for (const src of [plansSrc, sitesSrc, hostingSrc]) {
      if (src.present) {
        const dest = join(backupDir, src.path.split(/[\\/]/).pop());
        await copyFile(src.path, dest);
      }
    }
    report.backupDir = backupDir;
  }

  const records = [];
  if (plansSrc.corrupt) report.corruptRecords.push({ source: 'plans.json', reason: 'invalid JSON' });
  else for (const plan of asArray(plansSrc.data)) {
    if (!plan?.planId) { report.counts.corrupt++; report.corruptRecords.push({ source: 'plans.json', reason: 'missing planId' }); continue; }
    records.push(mapPlan(plan));
  }
  if (sitesSrc.corrupt) report.corruptRecords.push({ source: 'template-sites.json', reason: 'invalid JSON' });
  else for (const site of asArray(sitesSrc.data?.sites)) {
    if (!site?.siteId) { report.counts.corrupt++; report.corruptRecords.push({ source: 'template-sites.json', reason: 'missing siteId' }); continue; }
    records.push(mapSite(site));
  }

  report.counts.total = records.length;

  if (mode === '--verify') {
    // Verify's contract is reconciliation: every migratable record is present.
    // Corrupt legacy records were never migratable — they are reported for
    // visibility but do not fail verification.
    const migrated = repo ? await repo.countMigratedProjects() : 0;
    report.verify = { expected: records.length, migrated, matches: migrated >= records.length };
    report.ok = report.verify.matches;
  } else {
    for (const record of records) {
      const result = repo
        ? await repo.upsertLegacyProject(record, { execute })
        : 'created'; // dry-run without DB: report intended action
      report.counts[result] = (report.counts[result] || 0) + 1;
    }
  }

  report.finishedAt = new Date().toISOString();

  const reportPath = join(dataDir, 'migration-backups', `builder-migration-report-${mode.replace('--', '')}.json`);
  await mkdir(join(dataDir, 'migration-backups'), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`[migrate:builder-json] report written to ${reportPath}`);

  if (repo) {
    const { prisma } = await import('../server/src/services/db.js');
    await prisma.$disconnect().catch(() => {});
  }

  if (!report.ok) {
    console.error('[migrate:builder-json] completed with blocking issues.');
    process.exit(1);
  }
}

function sourceMeta(src) {
  return { present: src.present, sha256: src.sha256, corrupt: Boolean(src.corrupt) };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

main().catch((err) => {
  console.error('[migrate:builder-json] failed:', err.message);
  process.exit(1);
});
