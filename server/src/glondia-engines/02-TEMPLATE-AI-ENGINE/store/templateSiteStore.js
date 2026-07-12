/**
 * templateSiteStore.js
 * JSON-backed persistent store for AI-tailored template site drafts.
 * Store file: DATA_DIR/template-sites.json
 * Pattern mirrors hostingStore.js.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeId, nowIso } from '../../../services/hostingStore.js';

const rootDir    = resolve(process.cwd());
const fallbackDataDir = join(rootDir, '.glondia-data');
const dataDir    = resolve(process.env.DATA_DIR || fallbackDataDir);
const storePath  = join(dataDir, 'template-sites.json');

function emptyStore() {
  return { sites: [] };
}

async function ensureStore() {
  if (existsSync(storePath)) return;
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(emptyStore(), null, 2));
}

async function readStore() {
  await ensureStore();
  const text = await readFile(storePath, 'utf8');
  return JSON.parse(text);
}

// After the canonical cutover, Prisma is the source of truth and legacy JSON
// writes must stop. BUILDER_DB_STORAGE=true freezes this store; set
// BUILDER_LEGACY_JSON_WRITES=true only for a temporary rollback window.
function legacyWritesFrozen() {
  if (String(process.env.BUILDER_LEGACY_JSON_WRITES || '').toLowerCase() === 'true') return false;
  return String(process.env.FEATURE_BUILDER_DB_STORAGE || '').toLowerCase() === 'true';
}

async function writeStore(store) {
  if (legacyWritesFrozen()) {
    const err = new Error('Legacy template-site JSON store is read-only after the canonical Builder cutover.');
    err.status = 409;
    err.code = 'BUILDER_LEGACY_STORE_FROZEN';
    err.expose = true;
    throw err;
  }
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2));
  return store;
}

/**
 * Create and persist a new tailored site draft.
 * @param {object} params
 * @param {string} params.templateId
 * @param {object} params.answers      — Collected intake answers
 * @param {Array}  params.tailoredPages — [{title, path, html}]
 * @returns {Promise<object>}  The created site record
 */
export async function createTemplateSite({ templateId, answers = {}, tailoredPages = [], userId = null, ownerUserId = null }) {
  const store = await readStore();
  const site = {
    siteId:        makeId('tai'),
    userId:        userId || ownerUserId || null,
    ownerUserId:   ownerUserId || userId || null,
    templateId,
    answers,
    pages:         tailoredPages,
    status:        'draft',
    createdAt:     nowIso(),
    updatedAt:     nowIso(),
  };
  store.sites.push(site);
  await writeStore(store);
  return site;
}

/**
 * Retrieve a tailored site by siteId.
 * @param {string} siteId
 * @returns {Promise<object|null>}
 */
export async function getTemplateSite(siteId) {
  const store = await readStore();
  return store.sites.find(s => s.siteId === siteId) || null;
}

/**
 * Update fields on an existing tailored site.
 * @param {string} siteId
 * @param {object} updates  — Partial fields to merge
 * @returns {Promise<object|null>}  Updated site or null if not found
 */
export async function updateTemplateSite(siteId, updates) {
  const store = await readStore();
  const idx = store.sites.findIndex(s => s.siteId === siteId);
  if (idx === -1) return null;
  store.sites[idx] = { ...store.sites[idx], ...updates, siteId, updatedAt: nowIso() };
  await writeStore(store);
  return store.sites[idx];
}
