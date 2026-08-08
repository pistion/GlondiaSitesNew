/**
 * vpsHostingPublisher.stage.js
 *
 * Primary Glondia hosting backend for customer sites. This is separate from
 * the VPS product/service layer: it publishes hosted websites onto the main
 * Glondia server filesystem and exposes them through Nginx.
 */

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveWebsiteHostingProvider } from '../00-SHARED/hostingProviderResolver.js';

const execFileAsync = promisify(execFile);

const DEFAULT_PUBLIC_ROOT = '/var/www/glondia-hosted';
const DEFAULT_BUILD_ROOT = '/var/glondia/data/hosting-builds';
const DEFAULT_NGINX_CONF = '/etc/nginx/glondia-hosted-sites.conf';
const DEFAULT_PUBLIC_BASE_URL = 'http://45.77.236.52';

export function vpsHostingConfigured(requestedProvider = '') {
  return resolveWebsiteHostingProvider(requestedProvider) === 'vps';
}

export function vpsHostingSettings() {
  return {
    provider: 'vps',
    publicRoot: process.env.HOSTING_VPS_PUBLIC_ROOT || DEFAULT_PUBLIC_ROOT,
    buildRoot: process.env.HOSTING_VPS_BUILD_ROOT || DEFAULT_BUILD_ROOT,
    nginxConfPath: process.env.HOSTING_VPS_NGINX_CONF || DEFAULT_NGINX_CONF,
    publicBaseUrl: String(process.env.HOSTING_VPS_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, ''),
  };
}

export async function publishStaticSiteToVps(input = {}) {
  const deploymentId = safeSegment(input.deploymentId);
  if (!deploymentId) throw stageError('deploymentId is required for VPS hosting publish.', 'vps_publish');

  const serviceType = String(input.serviceType || 'static_site');
  if (serviceType !== 'static_site') {
    throw stageError(
      'This main-server hosting backend currently supports static sites and static builds only. Use static deploy mode or keep full web services on Render until per-app process isolation is wired.',
      'vps_publish',
      422,
    );
  }

  const sourceDir = path.resolve(input.sourceDir || '');
  if (!sourceDir || !existsSync(sourceDir)) {
    throw stageError('Source directory for VPS hosting publish was not found.', 'vps_publish');
  }

  const settings = vpsHostingSettings();
  const buildDir = path.join(settings.buildRoot, deploymentId);
  const publicDir = path.join(settings.publicRoot, deploymentId);
  const publishDirectory = String(input.publishDirectory || input.outputDirectory || '.').replace(/\\/g, '/').replace(/^\/+/, '') || '.';

  await rm(buildDir, { recursive: true, force: true });
  await mkdir(path.dirname(buildDir), { recursive: true });
  await cp(sourceDir, buildDir, { recursive: true, force: true });

  const logs = [];
  if (input.buildCommand) {
    logs.push(await runBuildCommand(buildDir, input.buildCommand, input.onLog));
  }

  const builtOutput = path.resolve(buildDir, publishDirectory);
  if (!builtOutput.startsWith(buildDir)) {
    throw stageError('Publish directory resolved outside the build workspace.', 'vps_publish', 400);
  }
  try {
    const outputStat = await stat(builtOutput);
    if (!outputStat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw stageError(`Publish directory was not created: ${publishDirectory}`, 'vps_publish', 422);
  }

  await rm(publicDir, { recursive: true, force: true });
  await mkdir(path.dirname(publicDir), { recursive: true });
  await cp(builtOutput, publicDir, { recursive: true, force: true });
  await ensureIndex(publicDir);
  await upsertNginxSite(deploymentId, settings);

  return {
    provider: 'vps',
    serviceId: `vps_${deploymentId}`,
    deployId: `vps_deploy_${Date.now()}`,
    providerStatus: 'live',
    liveUrl: `${settings.publicBaseUrl}/hosted/${deploymentId}/`,
    publicPath: `/hosted/${deploymentId}/`,
    publicDir,
    buildDir,
    publishDirectory,
    logs,
  };
}

async function runBuildCommand(cwd, command, onLog) {
  const started = Date.now();
  await emitBuildLog(onLog, `Running build command: ${command}`, 'info');
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CI: 'true',
      },
    });
    const output = [];
    let pending = Promise.resolve();
    let settled = false;
    const timeoutMs = Number(process.env.HOSTING_VPS_BUILD_TIMEOUT_MS || 600000);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const collect = (source) => (chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        output.push(line);
        if (output.length > 500) output.shift();
        pending = pending.then(() => emitBuildLog(onLog, line, source === 'stderr' ? 'warn' : 'info'));
      }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(stageError(`VPS build could not start: ${error.message}`, 'vps_build', 422));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      pending.finally(async () => {
        const durationMs = Date.now() - started;
        if (code === 0) {
          await emitBuildLog(onLog, `Build completed successfully in ${(durationMs / 1000).toFixed(1)}s.`, 'ok');
          resolve({ command, ok: true, durationMs, output: output.join('\n').slice(-12000) });
          return;
        }
        const err = stageError(`VPS build failed: exited with code ${code}${signal ? ` (${signal})` : ''}`, 'vps_build', 422);
        err.details = { command, durationMs, output: output.join('\n').slice(-12000) };
        reject(err);
      });
    });
  });
}

async function emitBuildLog(onLog, message, level) {
  if (typeof onLog === 'function') {
    await onLog({ message, level, source: 'vps-build', stage: 'build' });
  }
}

async function ensureIndex(publicDir) {
  if (existsSync(path.join(publicDir, 'index.html'))) return;
  throw stageError('Published output does not contain index.html.', 'vps_publish', 422);
}

async function upsertNginxSite(deploymentId, settings) {
  await mkdir(path.dirname(settings.nginxConfPath), { recursive: true });
  const block = [
    `# glondia-hosted:${deploymentId}`,
    `location ^~ /hosted/${deploymentId}/ {`,
    `    alias ${settings.publicRoot}/${deploymentId}/;`,
    '    index index.html;',
    `    try_files $uri $uri/ /hosted/${deploymentId}/index.html;`,
    '    add_header Cache-Control "public, max-age=300";',
    '}',
    '',
  ].join('\n');

  let current = '';
  try {
    current = await readFile(settings.nginxConfPath, 'utf8');
  } catch {
    current = '# Glondia hosted customer sites. Managed by Glondia.\n\n';
  }

  const start = `# glondia-hosted:${deploymentId}`;
  const escaped = escapeRegExp(start);
  const pattern = new RegExp(`${escaped}\\nlocation \\^~ /hosted/${escapeRegExp(deploymentId)}/ \\{[\\s\\S]*?\\n\\}\\n?`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, block.trimEnd())
    : `${current.trimEnd()}\n\n${block}`;

  await writeFile(settings.nginxConfPath, next);
  await execFileAsync('nginx', ['-t'], { timeout: 30000 });
  await execFileAsync('systemctl', ['reload', 'nginx'], { timeout: 30000 });
}

function safeSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stageError(message, stage, status = 500) {
  const error = new Error(message);
  error.stage = stage;
  error.status = status;
  error.expose = status < 500;
  return error;
}

export default { publishStaticSiteToVps, vpsHostingConfigured, vpsHostingSettings };
