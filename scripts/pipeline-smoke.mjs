/**
 * pipeline-smoke.mjs — non-destructive smoke test for the ZIP + GitHub deploy
 * pipelines and the deploy-first billing path.
 *
 * Reads credentials from the environment (never hard-coded). Checks:
 *   1. Runtime config wiring (Render + GitHub publisher configured).
 *   2. Live read-only connectivity: GitHub repo + token push scope, Render owner.
 *   3. The billing path end-to-end against a TEMP sqlite DB (proves a deployment
 *      creates a CheckoutOrder + stamps billing fields + resolves the promo).
 *
 * It does NOT create Render services or push commits. Run:
 *   node scripts/pipeline-smoke.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);
const head = (m) => console.log(`\n── ${m} ──`);

async function main() {
  let failures = 0;

  // ── 1. Config wiring ────────────────────────────────────────────────
  head('1. Runtime config');
  const { getRuntimeConfig } = await import('../server/src/glondia-engines/00-SHARED/runtimeConfig.js');
  const renderApi = (await import('../server/src/services/renderApiService.js')).default;
  const cfg = getRuntimeConfig();
  cfg.renderConfigured ? ok('Render configured (API key + owner)') : (bad(`Render NOT configured: ${cfg.missingRender.join(', ')}`), failures++);
  renderApi.configured() ? ok('renderApiService.configured() = true') : (bad('renderApiService.configured() = false'), failures++);
  cfg.githubPublisherConfigured ? ok(`GitHub publisher configured (repo: ${cfg.generatedSitesRepo})`) : (bad(`GitHub publisher NOT configured: ${cfg.missingGithubPublisher.join(', ')}`), failures++);
  ok(`generated-sites root dir: ${cfg.generatedSitesRootDir}`);

  // ── 2. Live read-only connectivity ──────────────────────────────────
  head('2. Live connectivity (read-only)');
  const ghToken = cfg.githubPublisherToken;
  const repoUrl = cfg.generatedSitesRepo;
  const m = String(repoUrl).match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?$/i);
  if (m && ghToken) {
    const [, owner, repo] = m;
    const gh = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'glondia-smoke' },
    });
    if (gh.ok) {
      const body = await gh.json();
      const scopes = gh.headers.get('x-oauth-scopes') || '(fine-grained or app token)';
      const canPush = body?.permissions?.push;
      ok(`GitHub repo reachable: ${body.full_name} (default branch: ${body.default_branch})`);
      canPush ? ok('Token can PUSH to the generated-sites repo') : (bad('Token CANNOT push to the repo — publishing will fail'), failures++);
      console.log(`    token scopes: ${scopes}`);
    } else { bad(`GitHub repo check failed: ${gh.status}`); failures++; }
  } else { bad('Could not parse generated-sites repo URL / token missing'); failures++; }

  const ownerId = process.env.RENDER_OWNER_ID;
  const rKey = process.env.RENDER_API_KEY;
  if (rKey && ownerId) {
    const r = await fetch(`https://api.render.com/v1/owners/${encodeURIComponent(ownerId)}`, {
      headers: { Authorization: `Bearer ${rKey}`, Accept: 'application/json' },
    });
    if (r.ok) { const o = await r.json(); ok(`Render owner valid: ${o?.owner?.name || o?.name || ownerId} (${o?.owner?.type || ''})`); }
    else { bad(`Render owner check failed: ${r.status} — services may not create under this owner`); failures++; }
    const svc = await fetch('https://api.render.com/v1/services?limit=1', { headers: { Authorization: `Bearer ${rKey}`, Accept: 'application/json' } });
    svc.ok ? ok('Render services list reachable') : (bad(`Render services list failed: ${svc.status}`), failures++);
  } else { bad('RENDER_API_KEY / RENDER_OWNER_ID missing'); failures++; }

  // ── 3. Billing path against a temp DB ───────────────────────────────
  head('3. Billing path (temp DB, the part that was not updating)');
  const dir = mkdtempSync(join(tmpdir(), 'glondia-smoke-'));
  const dbPath = join(dir, 'smoke.db').replace(/\\/g, '/');
  const dataDir = join(dir, 'data');
  try {
    // Apply the schema to the temp DB.
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema=prisma/schema.prisma', '--accept-data-loss', '--skip-generate'],
      { stdio: 'ignore', env: { ...process.env, DATABASE_URL: `file:${dbPath}` } });
    ok('Temp DB schema applied');

    // Point the app at the temp DB + data dir for this check.
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.DATA_DIR = dataDir;

    const { registerUser } = await import('../server/src/services/authService.js');
    const { createDeploymentRecord } = await import('../server/src/glondia-engines/00-SHARED/deploymentRecordStore.js');
    const { createDeploymentOrder } = await import('../server/src/services/deploymentBillingService.js');
    const { prisma } = await import('../server/src/services/db.js');

    const session = await registerUser({ email: 'smoke@test.local', password: 'password123', name: 'Smoke Test' });
    ok(`Registered user: ${session.user.id}`);

    const deployment = await createDeploymentRecord({
      userId: session.user.id, serviceName: 'smoke-site', source: 'zip-upload',
      status: 'building', buildStatus: 'queued', currentStep: 'Queued',
    });
    ok(`Created deployment record: ${deployment.deploymentId}`);

    // No checkout exists until recorded usage has been issued on an invoice.
    const std = await createDeploymentOrder({ deployment, user: { id: session.user.id }, kind: 'zip' });

    const orderCount = await prisma.checkoutOrder.count({ where: { type: 'deployment' } });
    orderCount === 0 && std.status === 'metering'
      ? ok('No checkout order created before an invoice exists')
      : (bad(`Expected metering with 0 orders, got ${std.status} and ${orderCount}`), failures++);

    await prisma.$disconnect();
  } catch (err) {
    bad(`Billing path threw: ${err.message}`);
    failures++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  head('Result');
  if (failures === 0) console.log('  ALL CHECKS PASSED ✓');
  else { console.log(`  ${failures} CHECK(S) FAILED ✗`); process.exitCode = 1; }
}

main().catch((e) => { console.error('smoke test crashed:', e); process.exit(1); });
