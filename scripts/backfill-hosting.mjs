#!/usr/bin/env node
/**
 * backfill-hosting.mjs — promote legacy hostingStore deployments into canonical
 * WebHostingService + ServiceAccess rows (Phase 11).
 *
 *   node scripts/backfill-hosting.mjs            (dry-run; no writes — default)
 *   node scripts/backfill-hosting.mjs --execute  (writes rows)
 *   node scripts/backfill-hosting.mjs --deployment <deploymentId>  (scope to one)
 *
 * Delegates to hostingRelationshipRepairService.auditHostingRelationships, which:
 *   - resolves each deployment's owning user/organization scope,
 *   - creates a WebHostingService row when missing (pinned to the deploymentId),
 *   - creates a hosting ServiceAccess row when missing,
 *   - updates provider/order/status fields when they drift,
 *   - NEVER auto-claims imported/pre-existing provider services for a customer —
 *     those surface as conflicts for admin review instead.
 *
 * Idempotent: re-running matches existing rows and reports 0 created. Legacy
 * source is read-only. Blocking failures exit non-zero.
 */

import { auditHostingRelationships } from '../server/src/services/hostingRelationshipRepairService.js';
import { disconnectPrisma } from '../server/src/services/db.js';

const execute = process.argv.includes('--execute');
const depFlagIdx = process.argv.indexOf('--deployment');
const deploymentId = depFlagIdx >= 0 ? process.argv[depFlagIdx + 1] || null : null;

async function main() {
  const result = await auditHostingRelationships({
    dryRun: !execute,
    deploymentId,
    actorUserId: null,
    request: null,
  });

  const skipped = result.matched;
  const warnings = result.conflicts.length + result.unresolved.length + result.errors.length;

  console.log('');
  console.log(`[backfill-hosting] mode:       ${execute ? 'EXECUTE (writes)' : 'DRY-RUN (no writes)'}`);
  if (deploymentId) console.log(`[backfill-hosting] deployment: ${deploymentId}`);
  console.log(`[backfill-hosting] scanned:    ${result.scanned}`);
  console.log(`[backfill-hosting] created:    ${result.created}`);
  console.log(`[backfill-hosting] updated:    ${result.updated}`);
  console.log(`[backfill-hosting] skipped:    ${skipped} (already consistent)`);
  console.log(`[backfill-hosting] warnings:   ${warnings} (${result.conflicts.length} conflicts, ${result.unresolved.length} unresolved, ${result.errors.length} errors)`);

  for (const c of result.conflicts) console.warn(`  conflict  ${c.deploymentId}: ${c.code} — ${c.message}`);
  for (const u of result.unresolved) console.warn(`  unresolved ${u.deploymentId}: ${u.code} — ${u.message}`);
  for (const e of result.errors) console.error(`  error     ${e.deploymentId}: ${e.message}`);

  // Blocking errors (not resolvable-by-admin conflicts) exit non-zero.
  if (result.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[backfill-hosting] fatal:', err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma().catch(() => {}));
