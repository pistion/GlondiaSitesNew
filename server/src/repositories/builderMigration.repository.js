/**
 * builderMigration.repository.js — idempotent upserts for legacy JSON import.
 *
 * Kept separate from builder.repository so the migration command owns its own
 * deterministic-id / upsert semantics without entangling the runtime paths.
 */

import { createHash } from 'node:crypto';
import { prisma } from '../services/db.js';
import { jsonText } from './builder.repository.js';

/** Deterministic project id from the legacy source id so re-runs upsert. */
export function deterministicProjectId(legacyKind, legacyId) {
  return `mig-${createHash('sha256').update(`${legacyKind}:${legacyId}`).digest('hex').slice(0, 28)}`;
}

export async function ensureMigrationUser(userId) {
  const id = userId || 'legacy-import';
  const existing = await prisma.user.findUnique({ where: { id } }).catch(() => null);
  if (existing) return existing;
  return prisma.user.create({
    data: { id, email: `${id}@glondia.local`, passwordHash: '', name: id, role: 'owner' },
  }).catch(() => prisma.user.findUnique({ where: { id } }));
}

/**
 * Idempotent upsert of one legacy record into builder_projects.
 * Returns 'created' | 'updated' | 'unchanged'.
 */
export async function upsertLegacyProject(record, { execute }) {
  const id = deterministicProjectId(record.legacyKind, record.legacyId);
  const contentHash = createHash('sha256').update(JSON.stringify({
    plan: record.plan, answerSheet: record.answerSheet, name: record.name, status: record.status,
  })).digest('hex');

  const existingRows = await prisma.$queryRawUnsafe(
    `SELECT "id", "metadata" FROM "builder_projects" WHERE "id" = ? LIMIT 1`, id,
  );
  const existing = existingRows[0];

  if (existing) {
    let priorHash = null;
    try { priorHash = JSON.parse(existing.metadata)?.data?.migration?.contentHash || null; } catch { /* ignore */ }
    if (priorHash === contentHash) return 'unchanged';
    if (!execute) return 'updated';
    await prisma.$executeRawUnsafe(
      `UPDATE "builder_projects"
       SET "name" = ?, "plan_json" = ?, "answer_sheet_json" = ?, "metadata" = ?, "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = ?`,
      record.name,
      jsonText({ schemaVersion: 1, data: record.plan || {} }),
      jsonText({ schemaVersion: 1, data: record.answerSheet || {} }),
      jsonText({ schemaVersion: 1, data: { migration: { legacyKind: record.legacyKind, legacyId: record.legacyId, contentHash, importedAt: new Date().toISOString() } } }),
      id,
    );
    return 'updated';
  }

  if (!execute) return 'created';
  await ensureMigrationUser(record.userId);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "builder_projects" (
      "id", "user_id", "source_type", "template_id", "name", "slug", "status",
      "plan_json", "answer_sheet_json", "metadata", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    record.userId || 'legacy-import',
    record.sourceType || 'template',
    record.templateId || null,
    record.name,
    `${record.slug || 'legacy'}-${id.slice(4, 12)}`,
    record.status || 'DRAFT',
    jsonText({ schemaVersion: 1, data: record.plan || {} }),
    jsonText({ schemaVersion: 1, data: record.answerSheet || {} }),
    jsonText({ schemaVersion: 1, data: { migration: { legacyKind: record.legacyKind, legacyId: record.legacyId, contentHash, importedAt: new Date().toISOString() } } }),
    record.createdAt || new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
    new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
  );
  return 'created';
}

/** Count migrated projects (metadata.migration present) for --verify. */
export async function countMigratedProjects() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS "count" FROM "builder_projects" WHERE "id" LIKE 'mig-%'`,
  );
  return Number(rows[0]?.count || 0);
}

export async function getMigratedProject(legacyKind, legacyId) {
  const id = deterministicProjectId(legacyKind, legacyId);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "name", "status" FROM "builder_projects" WHERE "id" = ? LIMIT 1`, id,
  );
  return rows[0] || null;
}
