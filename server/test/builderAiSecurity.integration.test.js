/**
 * SiteBuilder Phase 1 security tests (hardening plan §15).
 *
 * Boots the real server with the AI builder feature enabled and proves:
 *  - no AI-spending endpoint responds without authentication,
 *  - ZIP deploy/validate require authentication,
 *  - generated previews are not served anonymously and grant tokens are
 *    validated (missing/garbage grants are rejected),
 *  - AI rate limits actually trip (429),
 *  - oversized prompts are rejected before reaching any AI provider.
 *
 * No OpenAI/Render/PayPal keys are configured, so nothing here can spend money.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 3983;
const BASE = `http://127.0.0.1:${PORT}/api/template-ai`;
const JWT_SECRET = 'builder-security-test-secret';

let proc;
let tempDir;

/** Real signed access token — dev header fallback is disabled in this suite. */
function bearer(userId = 'sec-user') {
  return `Bearer ${jwt.sign(
    { sub: userId, role: 'owner' },
    JWT_SECRET,
    {
      expiresIn: '10m',
      issuer: 'glondia-sites',
      audience: 'glondia-dashboard',
      jwtid: `security-test-${userId}`,
    },
  )}`;
}

function api(path, { method = 'POST', auth, body, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-builder-sec-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  const dbUrl = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'ignore',
  });

  proc = spawn(process.execPath, ['server/src/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PORT: String(PORT),
      NODE_ENV: 'development',
      AUTH_DEV_FALLBACK: 'false',        // anonymous requests must be rejected
      JWT_SECRET,
      FEATURE_AI_BUILDER: 'true',        // exercise auth, not the feature gate
      FEATURE_SITE_BUILDER: 'true',
      AI_SUGGESTIONS_PER_MINUTE: '3',    // small limit so the 429 test is fast
      AI_MAX_PROMPT_CHARS: '2000',
      OPENAI_API_KEY: '',                // never spend in tests
      DATA_DIR: join(tempDir, 'data'),
    },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Server did not become healthy in 30s');
    await new Promise((r) => setTimeout(r, 400));
  }
}, { timeout: 120000 });

after(() => {
  if (proc) proc.kill();
  if (tempDir) { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows file locks */ } }
});

test('every AI-spending endpoint rejects anonymous requests', async () => {
  const cases = [
    ['/intake/start', { templateId: 'pulse-works' }],
    ['/intake/message', { sessionId: 'x', message: 'hello' }],
    ['/intake/suggest-answer', { questionKey: 'businessName' }],
    ['/generate', { templateId: 'pulse-works', answers: {} }],
    ['/sites/some-site/ai-edit', { answers: {} }],
    ['/plans/some-plan/ai/suggest-sitemap', {}],
    ['/plans/some-plan/ai/autofill-brief', {}],
  ];
  for (const [path, body] of cases) {
    const res = await api(path, { body });
    assert.equal(res.status, 401, `${path} must require authentication (got ${res.status})`);
  }
});

test('ZIP deploy and validate reject anonymous requests', async () => {
  for (const path of ['/zip/deploy', '/zip/validate']) {
    const res = await api(path, { body: {} });
    assert.equal(res.status, 401, `${path} must require authentication (got ${res.status})`);
  }
});

test('generated preview is not served anonymously', async () => {
  const res = await api('/sites/any-site/preview', { method: 'GET' });
  assert.equal(res.status, 401, 'anonymous preview must be rejected');
});

test('garbage preview grants are rejected', async () => {
  for (const grant of ['abc', '9999999999.forged-signature', '1.x']) {
    const res = await api(`/sites/any-site/preview?grant=${encodeURIComponent(grant)}`, { method: 'GET' });
    assert.equal(res.status, 401, `grant "${grant}" must not grant access`);
  }
});

test('preview grant endpoint requires authentication', async () => {
  const res = await api('/sites/any-site/preview-grants', { body: {} });
  assert.equal(res.status, 401);
});

test('AI rate limit trips after the configured per-user budget', async () => {
  const auth = bearer('rate-limit-user');
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await api('/intake/start', { auth, body: { templateId: 'pulse-works' } });
    statuses.push(res.status);
  }
  // Budget is 3/minute — the 4th authenticated call must be throttled.
  assert.ok(statuses.includes(429), `expected a 429 within ${JSON.stringify(statuses)}`);
  const throttled = await api('/intake/start', { auth, body: { templateId: 'pulse-works' } });
  const body = await throttled.json();
  assert.equal(body.error.code, 'RATE_LIMITED');
});

test('oversized prompt is rejected before any provider call', async () => {
  const res = await api('/intake/message', {
    auth: bearer('prompt-user'),
    body: { sessionId: 'session-x', message: 'a'.repeat(5000) },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'AI_PROMPT_TOO_LARGE');
});

test('invalid tokens are rejected, not silently downgraded', async () => {
  const res = await api('/intake/start', {
    auth: `Bearer ${jwt.sign({ sub: 'x' }, 'wrong-secret')}`,
    body: { templateId: 'pulse-works' },
  });
  assert.equal(res.status, 401);
});
