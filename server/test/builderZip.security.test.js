/**
 * Hostile-archive and GitHub-SSRF defense — unit-level, no server needed.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractZipSafely } from '../src/glondia-engines/01-HOSTING-DEPLOY-ENGINE/02-UNZIP-AND-DETECT-MOUNTAIN/zipExtractor.stage.js';
import { hasZipMagic } from '../src/builder/security/zipGuard.js';
import { assertSafeGithubUrl, assertSafeBranch } from '../src/builder/security/githubGuard.js';

let workDir;
before(() => { workDir = mkdtempSync(join(tmpdir(), 'glondia-zipsec-')); });
after(() => { try { rmSync(workDir, { recursive: true, force: true }); } catch { /* Windows */ } });

let counter = 0;
function dest() { return join(workDir, `out-${counter++}`); }

async function extractExpectError(zip, code) {
  await assert.rejects(
    () => extractZipSafely(zip.toBuffer(), dest()),
    (err) => { assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`); return true; },
  );
}

test('valid ZIP with an index extracts', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html><body>ok</body></html>'));
  zip.addFile('style.css', Buffer.from('body{color:black}'));
  const out = dest();
  const result = await extractZipSafely(zip.toBuffer(), out);
  assert.ok(result.files.includes('index.html'));
  assert.equal(result.secretScan.ok, true);
  const written = await readdir(out);
  assert.ok(written.includes('index.html'));
});

test('non-ZIP bytes are rejected by signature', async () => {
  await assert.rejects(
    () => extractZipSafely(Buffer.from('this is not a zip file at all'), dest()),
    (err) => { assert.equal(err.code, 'ZIP_INVALID_SIGNATURE'); return true; },
  );
  assert.equal(hasZipMagic(Buffer.from('PK\x03\x04rest')), true);
  assert.equal(hasZipMagic(Buffer.from('NOTPK')), false);
});

test('path traversal entry is rejected', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  zip.addFile('placeholder.txt', Buffer.from('pwned'));
  // adm-zip normalizes ../ on addFile, so set the raw entry name directly.
  zip.getEntries().find((e) => e.entryName === 'placeholder.txt').entryName = '../escape.txt';
  await extractExpectError(zip, 'ZIP_PATH_NOT_ALLOWED');
});

test('absolute path entry is rejected', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  // adm-zip normalizes some paths; craft the entry name directly.
  const entry = zip.getEntries().find((e) => e.entryName === 'index.html');
  entry.entryName = '/etc/cron.d/evil';
  await assert.rejects(() => extractZipSafely(zip.toBuffer(), dest()));
});

test('symlink entry is rejected', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  zip.addFile('link', Buffer.from('/etc/passwd'));
  const entry = zip.getEntries().find((e) => e.entryName === 'link');
  // Set the Unix symlink mode (0o120000) in the high 16 bits of external attr.
  entry.header.attr = (0o120777 << 16) >>> 0;
  await extractExpectError(zip, 'ZIP_SYMLINK_REJECTED');
});

test('zip bomb (huge declared size / tiny compressed) trips a limit', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  // 50 MB of zeros compresses to almost nothing → ratio + aggregate limits.
  zip.addFile('bomb.bin', Buffer.alloc(50 * 1024 * 1024, 0));
  await assert.rejects(
    () => extractZipSafely(zip.toBuffer(), dest()),
    (err) => {
      assert.ok(['ZIP_COMPRESSION_RATIO', 'ZIP_ENTRY_TOO_LARGE', 'ZIP_TOO_LARGE_EXTRACTED'].includes(err.code), err.code);
      return true;
    },
  );
});

test('case-colliding paths are rejected', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  zip.addFile('App.js', Buffer.from('a'));
  zip.addFile('app.js', Buffer.from('b'));
  await extractExpectError(zip, 'ZIP_DUPLICATE_PATH');
});

test('secrets in the archive block the import and never leak the value', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  const secret = 'sk-' + 'a'.repeat(40);
  zip.addFile('config.js', Buffer.from(`export const key = "${secret}";`));
  await assert.rejects(
    () => extractZipSafely(zip.toBuffer(), dest()),
    (err) => {
      assert.equal(err.code, 'ZIP_SECRETS_DETECTED');
      assert.ok(!err.message.includes(secret), 'secret value must never appear in the error');
      return true;
    },
  );
});

test('.env / private key files are blocked', async () => {
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<html/>'));
  zip.addFile('.env', Buffer.from('DATABASE_URL=postgres://u:p@h/db'));
  await extractExpectError(zip, 'ZIP_SECRETS_DETECTED');
});

// ── GitHub SSRF guard ────────────────────────────────────────────────────────

test('valid github URLs normalize', () => {
  for (const url of [
    'https://github.com/pistion/NewSimpleProject',
    'https://github.com/pistion/NewSimpleProject.git',
    'https://www.github.com/pistion/NewSimpleProject/',
    'git@github.com:pistion/NewSimpleProject.git',
  ]) {
    const parsed = assertSafeGithubUrl(url);
    assert.equal(parsed.owner, 'pistion');
    assert.equal(parsed.repo, 'NewSimpleProject');
    assert.equal(parsed.url, 'https://github.com/pistion/NewSimpleProject');
  }
});

test('SSRF vectors are rejected', () => {
  const attacks = [
    ['http://github.com/o/r', 'GITHUB_URL_SCHEME'],
    ['https://user:pass@github.com/o/r', 'GITHUB_URL_CREDENTIALS'],
    ['https://attacker.com/github.com/o/r', 'GITHUB_URL_HOST'],
    ['https://github.com.attacker.com/o/r', 'GITHUB_URL_HOST'],
    ['https://127.0.0.1/o/r', 'GITHUB_URL_HOST'],
    ['https://localhost/o/r', 'GITHUB_URL_HOST'],
    ['https://169.254.169.254/o/r', 'GITHUB_URL_HOST'],
    ['https://[::1]/o/r', 'GITHUB_URL_HOST'],
    ['https://github.com/only-owner', 'GITHUB_URL_INVALID'],
    ['ftp://github.com/o/r', 'GITHUB_URL_SCHEME'],
  ];
  for (const [url, code] of attacks) {
    assert.throws(() => assertSafeGithubUrl(url), (err) => {
      assert.equal(err.code, code, `${url} → expected ${code}, got ${err.code}`);
      return true;
    });
  }
});

test('branch names are kept shell/path safe', () => {
  assert.equal(assertSafeBranch('main'), 'main');
  assert.equal(assertSafeBranch('release/v1.2'), 'release/v1.2');
  for (const bad of ['main; rm -rf /', 'a`whoami`', '../../etc', '$(id)', 'a b']) {
    assert.throws(() => assertSafeBranch(bad), (err) => {
      assert.equal(err.code, 'GITHUB_BRANCH_INVALID');
      return true;
    });
  }
});
