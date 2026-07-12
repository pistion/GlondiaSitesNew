#!/usr/bin/env node
/**
 * lint-syntax.mjs — dependency-free static check for a JavaScript codebase.
 *
 * Runs `node --check` (parse + early-error pass) over every server source and
 * test file. Not a style linter — a fast correctness gate for CI that needs no
 * extra dependencies. Exits nonzero on the first parse error.
 */

import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOTS = ['server/src', 'server/test', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.git']);

async function collect(dir, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collect(join(dir, entry.name), out);
    } else if (['.js', '.mjs', '.cjs', '.jsx'].includes(extname(entry.name))) {
      out.push(join(dir, entry.name));
    }
  }
}

const files = [];
for (const root of ROOTS) await collect(root, files);

let failures = 0;
await Promise.all(files.map(async (file) => {
  try {
    // .jsx is not parseable by node --check; skip those (build handles them).
    if (file.endsWith('.jsx')) return;
    await execFileAsync(process.execPath, ['--check', file]);
  } catch (err) {
    failures += 1;
    console.error(`✖ ${file}\n${err.stderr || err.message}`);
  }
}));

if (failures) {
  console.error(`\nlint: ${failures} file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`lint: ${files.filter((f) => !f.endsWith('.jsx')).length} files passed the syntax check.`);
