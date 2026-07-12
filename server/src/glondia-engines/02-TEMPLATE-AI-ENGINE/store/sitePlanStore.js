// sitePlanStore.js — File-backed JSON store for hybrid site plans
// Stored at: DATA_DIR/template-site-plans/plans.json
// Fallback:  .glondia-data/template-site-plans/plans.json

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

function makeId() { return 'plan_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function nowIso() { return new Date().toISOString(); }

const ROOT = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(resolve(process.cwd()), '.glondia-data');
const STORE_DIR = join(ROOT, 'template-site-plans');
const STORE_PATH = join(STORE_DIR, 'plans.json');

async function readStore() {
  await mkdir(STORE_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) { await writeFile(STORE_PATH, '[]'); return []; }
  try { return JSON.parse(await readFile(STORE_PATH, 'utf8')); } catch { return []; }
}

// After the canonical cutover, Prisma is the source of truth and legacy JSON
// writes must stop. BUILDER_DB_STORAGE=true (production cutover) makes these
// stores read-only; set BUILDER_LEGACY_JSON_WRITES=true only for rollback.
function legacyWritesFrozen() {
  const rollback = String(process.env.BUILDER_LEGACY_JSON_WRITES || '').toLowerCase() === 'true';
  if (rollback) return false;
  return String(process.env.FEATURE_BUILDER_DB_STORAGE || '').toLowerCase() === 'true';
}

async function writeStore(plans) {
  if (legacyWritesFrozen()) {
    const err = new Error('Legacy site-plan JSON store is read-only after the canonical Builder cutover.');
    err.status = 409;
    err.code = 'BUILDER_LEGACY_STORE_FROZEN';
    err.expose = true;
    throw err;
  }
  await mkdir(STORE_DIR, { recursive: true });
  const tmp = STORE_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(plans, null, 2));
  await rename(tmp, STORE_PATH);
}

export async function createSitePlan(input) {
  const plans = await readStore();
  const plan = {
    planId: makeId(),
    source: 'hybrid-site-plan',
    userId: input.userId || input.ownerUserId || null,
    ownerUserId: input.ownerUserId || input.userId || null,
    templateId: String(input.templateId || '').slice(0, 100),
    templateType: ['html','repo-template'].includes(input.templateType) ? input.templateType : 'repo-template',
    status: 'draft',
    brief: input.brief && typeof input.brief === 'object' ? input.brief : {},
    sitemap: input.sitemap && typeof input.sitemap === 'object' ? input.sitemap : { name: '', pages: [] },
    wireframe: input.wireframe || null,
    style: input.style && typeof input.style === 'object' ? input.style : {},
    siteId: null,
    deploymentId: null,
    answerSheet: input.answerSheet || null,
    answerSheetStatus: input.answerSheet ? 'draft' : 'missing',
    answerSheetUpdatedAt: input.answerSheet ? nowIso() : null,
    answerSheetApprovedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    approvedAt: null,
    generatedAt: null,
    handedOffAt: null,
  };
  plans.push(plan);
  await writeStore(plans);
  return plan;
}

export async function getSitePlan(planId) {
  const plans = await readStore();
  return plans.find(p => p.planId === planId) || null;
}

export async function updateSitePlan(planId, patch) {
  const plans = await readStore();
  const idx = plans.findIndex(p => p.planId === planId);
  if (idx === -1) return null;
  plans[idx] = { ...plans[idx], ...patch, planId, updatedAt: nowIso() };
  await writeStore(plans);
  return plans[idx];
}

export async function deleteSitePlan(planId) {
  const plans = await readStore();
  const filtered = plans.filter(p => p.planId !== planId);
  await writeStore(filtered);
}

export async function listSitePlans(filter = {}) {
  const plans = await readStore();
  if (filter.status) return plans.filter(p => p.status === filter.status);
  return plans;
}
