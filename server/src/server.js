import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { requestId } from './middleware/request-id.middleware.js';
import { responseHelper } from './middleware/response.middleware.js';
import { requireFeature, featureFlagsHandler } from './middleware/featureFlag.js';

import frontPageRoutes from './routes/frontPage.routes.js';
import publicRoutes from './routes/public.routes.js';
import authRoutes from './routes/auth.routes.js';
import workspaceRoutes from './routes/workspace.routes.js';
import workspaceDetailRoutes from './routes/workspace-detail.routes.js';
import projectRoutes from './routes/project.routes.js';
import domainPublicRoutes from './routes/domain-public.routes.js';
import domainRoutes from './routes/domain.routes.js';
import siteRoutes from './routes/site.routes.js';
import publicSalesRoutes from './routes/public-sales.routes.js';
import commerceRoutes from './routes/commerce.routes.js';
import templateRoutes from './routes/template.routes.js';
import templateAiRoutes from './routes/template-ai.routes.js';
import eventsRoutes from './routes/events.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import billingRoutes from './routes/billing.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import eventStreamRoutes from './routes/event-stream.routes.js';
import deploymentRoutes from './routes/deploymentRoutes.js';
import hostingRoutes from './routes/hostingRoutes.js';
import environmentRoutes from './routes/environmentRoutes.js';
import domainHostingRoutes from './routes/domainRoutes.js';
import diskRoutes from './routes/diskRoutes.js';
import vpsHostingRoutes from './routes/vpsHostingRoutes.js';
import paymentsRoutes from './routes/payments.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { startDeploymentCleanupJob } from './services/deploymentCleanupService.js';
import { prisma } from './services/db.js';
import { auditWrites } from './middleware/audit.middleware.js';
import deploymentService from './services/deploymentService.js';
import deploymentStatusService from './services/deploymentStatusService.js';
import renderApiService from './services/renderApiService.js';
import { makeId, mutateHostingStore, nowIso, readHostingStore } from './services/hostingStore.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const isProd = process.env.NODE_ENV === 'production';
// Render injects PORT automatically. Local dev defaults to 3001 (matches vite proxy).
const PORT = Number(process.env.PORT || (isProd ? 10000 : 3001));
const execFileAsync = promisify(execFile);

// ── Static file serving ─────────────────────────────────────────────────────
const rootDir = resolve(process.cwd());
const distDir = join(rootDir, 'dist');
const dataDir = resolveDataDir();
const sandboxRoot = join(dataDir, 'sandboxes');
const sandboxProcesses = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const safePath = decodedPath.replace(/^\/+/, '');
  let filePath = resolve(distDir, safePath);

  if (!filePath.startsWith(distDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  const fallback = join(rootDir, '.glondia-data');
  if (!configured) return ensureDataDir(fallback);
  if (process.platform === 'win32' && configured.startsWith('/var/')) {
    return ensureDataDir(fallback);
  }

  const configuredDir = resolve(configured);
  try {
    return ensureDataDir(configuredDir);
  } catch (error) {
    console.warn(`[startup] DATA_DIR "${configuredDir}" is not writable (${error.code || error.message}); using "${fallback}" instead.`);
    return ensureDataDir(fallback);
  }
}

function ensureDataDir(dir) {
  mkdirSync(join(dir, 'sandboxes'), { recursive: true });
  return dir;
}

// ── Global middleware ────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : (isProd ? false : true); // allow all in dev, same-origin only in production

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(requestId);
app.use(responseHelper);
app.use(auditWrites);

// ── Health check (must come before API and static routes) ───────────────────
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.type('text/plain').send('ok');
  } catch (err) {
    console.error('[healthz] DB check failed:', err.message);
    res.status(503).type('text/plain').send(`db_error: ${err.message}`);
  }
});

// ── Landing page — static assets + root HTML ─────────────────────────────────
const landingDir = join(rootDir, 'landing');
if (existsSync(landingDir)) {
  app.use(express.static(landingDir, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
    },
  }));
}
app.use('/', frontPageRoutes);

// Public feature-flag snapshot — drives the frontend Coming Soon gating.
app.get('/api/v1/features', featureFlagsHandler);

// Domain registrar + domain-payment provider surfaces are not part of the MVP.
app.use('/api/spaceship', requireFeature('DOMAINS'));
app.use('/api/payments/domain', requireFeature('DOMAINS'));

app.post('/api/builder/import-github', providerApiGuard, async (req, res, next) => {
  try {
    const result = await importGithubSandbox(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/render/deploy', providerApiGuard, async (req, res, next) => {
  try {
    const result = await triggerRenderDeploy(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/render/test-deploy', providerApiGuard, async (req, res, next) => {
  try {
    const result = await testRenderDeploy(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/render/activate-repo', providerApiGuard, async (req, res, next) => {
  try {
    const result = await activateRenderRepoService(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/render/settings', async (req, res, next) => {
  try {
    res.json(getRenderSettings());
  } catch (error) {
    next(error);
  }
});

app.get('/api/render/deploys', async (req, res, next) => {
  try {
    const result = await listRenderDeploys(req.query || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/render/services', async (req, res, next) => {
  try {
    if (process.env.RENDER_EXPOSE_SERVICE_LIST !== 'true') {
      res.json([]);
      return;
    }
    const result = await listRenderServices();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/payments/paypal-client', (req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    sandbox: String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false',
    markupPercent: getPlatformMarkupPercent(),
  });
});

app.post('/api/payments/domain/create-order', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await createDomainPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/domain/capture', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await captureDomainPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/hosting/create-order', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await createHostingPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
});

app.post('/api/payments/hosting/capture', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await captureHostingPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
});

// Payment status for an existing deployment — no auth required (billing tab reads this)
app.get('/api/payments/hosting/status/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const GRACE_MS = Number(process.env.PAYMENT_GRACE_HOURS || 24) * 60 * 60 * 1000;
    const store = await readHostingStore();
    const dep = (store.deployments || []).find((d) => d.deploymentId === deploymentId || d.id === deploymentId);
    const paidOrder = (store.checkoutOrders || []).find(
      (o) => o.type === 'hosting_deployment' && o.status === 'paid' && o.metadata?.deploymentId === deploymentId
    );
    const deployedAt = dep?.createdAt ? new Date(dep.createdAt).getTime() : null;
    const deadline = deployedAt ? deployedAt + GRACE_MS : null;
    const msRemaining = deadline ? Math.max(0, deadline - Date.now()) : null;
    res.json({
      deploymentId,
      paid: Boolean(paidOrder),
      paymentStatus: dep?.paymentStatus || (paidOrder ? 'paid' : 'pending'),
      graceHours: Number(process.env.PAYMENT_GRACE_HOURS || 24),
      deployedAt: dep?.createdAt || null,
      deadlineAt: deadline ? new Date(deadline).toISOString() : null,
      hoursRemaining: msRemaining != null ? Math.ceil(msRemaining / (1000 * 3600)) : null,
      minutesRemaining: msRemaining != null ? Math.ceil(msRemaining / 60000) : null,
      overdue: deployedAt ? Date.now() > deployedAt + GRACE_MS : false,
      paidAt: paidOrder?.updatedAt || null,
      amounts: paidOrder?.amounts || null,
    });
  } catch (err) {
    next(err);
  }
});

// ── Live deploy log stream (SSE) ─────────────────────────────────────────────
// Client connects via EventSource. We immediately flush stored Glondia events,
// then poll Render + our DB every 3 s for new log lines and status changes.
app.get('/api/deployments/:deploymentId/logs/stream', async (req, res) => {
  const { deploymentId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Render
  res.flushHeaders();

  const TERMINAL = new Set(['live', 'failed', 'deleted', 'suspended', 'deployed_unverified']);
  const POLL_MS = 3000;
  let cursor = null;
  let timer = null;
  let finished = false;

  const emit = (event, payload) => {
    if (finished) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const finish = (reason = 'done') => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    emit('done', { reason });
    res.end();
  };

  req.on('close', () => { finished = true; clearInterval(timer); });

  try {
    const store = await readHostingStore();
    const dep = (store.deployments || []).find((d) => d.deploymentId === deploymentId || d.id === deploymentId);

    if (!dep) {
      emit('error', { message: 'Deployment not found.' });
      return res.end();
    }

    // Flush existing Glondia internal events (reverse so oldest is first)
    const stored = (store.logs[deploymentId] || []).slice().reverse();
    for (const log of stored) {
      emit('log', { id: log.id, message: log.message, level: log.level || 'info', timestamp: log.timestamp || log.createdAt, source: 'glondia' });
    }

    // Emit current status
    emit('status', { status: dep.status, buildStatus: dep.buildStatus, currentStep: dep.currentStep, liveUrl: dep.liveUrl, errorMessage: dep.errorMessage });

    if (TERMINAL.has(dep.status)) return finish('terminal');

    const poll = async () => {
      if (finished) return;
      try {
        // Refresh deployment status from Render API and sync into the store
        // This is the live sync point — keeps our store in sync with Render
        const s = await readHostingStore();
        let fresh = (s.deployments || []).find((d) => d.deploymentId === deploymentId || d.id === deploymentId);
        if (!fresh) return finish('not_found');

        // Only call Render to refresh if the deployment is in an active state
        const activeStates = new Set(['preparing', 'queued', 'building', 'deploying', 'deployed', 'deployed_unverified', 'prepared']);
        if (activeStates.has(fresh.status) && fresh.renderServiceId && !String(fresh.renderServiceId).includes('_pending')) {
          try {
            fresh = await deploymentStatusService.refreshDeployment(fresh) || fresh;
          } catch { /* continue with stored status if refresh fails */ }
        }

        emit('status', { status: fresh.status, buildStatus: fresh.buildStatus, currentStep: fresh.currentStep, liveUrl: fresh.liveUrl, errorMessage: fresh.errorMessage });

        // Fetch any new Glondia log entries since last poll
        const freshLogs = (s.logs[deploymentId] || []).slice().reverse();
        const seenGlondiaCount = stored.length;
        const newGlondia = freshLogs.slice(seenGlondiaCount);
        for (const log of newGlondia) {
          emit('log', { id: log.id, message: log.message, level: log.level || 'info', timestamp: log.timestamp || log.createdAt, source: 'glondia' });
          stored.push(log);
        }

        // Fetch Render deploy logs if we have real (non-pending) IDs
        if (fresh.renderServiceId && fresh.renderDeployId
            && !String(fresh.renderServiceId).includes('_pending')
            && !String(fresh.renderDeployId).includes('_pending')) {
          try {
            const resp = await renderApiService.getDeployLogs(fresh.renderServiceId, fresh.renderDeployId, cursor);
            const lines = Array.isArray(resp) ? resp : (resp?.logs || resp?.data || []);
            for (const line of lines) {
              const msg = line.message || line.msg || line.text || String(line);
              const level = (line.type === 'error' || line.level === 'error') ? 'error' : (line.type === 'warning' || line.level === 'warn') ? 'warn' : 'info';
              emit('log', { id: line.id, message: msg, level, timestamp: line.timestamp || line.createdAt, source: 'render' });
            }
            if (lines.length > 0 && lines[lines.length - 1].id) cursor = lines[lines.length - 1].id;
          } catch {
            // Render log API unavailable — continue polling status only
          }
        }

        if (TERMINAL.has(fresh.status)) finish('terminal');
      } catch (err) {
        emit('error', { message: err.message || 'Poll failed.' });
      }
    };

    await poll();
    timer = setInterval(poll, POLL_MS);
    // Hard timeout after 35 minutes so we don't leak connections
    setTimeout(() => finish('timeout'), 35 * 60 * 1000);
  } catch (err) {
    emit('error', { message: err.message || 'Stream initialisation failed.' });
    res.end();
  }
});

app.get('/api/spaceship/settings', async (req, res, next) => {
  try {
    res.json(getSpaceshipSettings());
  } catch (error) {
    next(error);
  }
});

app.post('/api/spaceship/availability', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await checkSpaceshipAvailability(req.body?.domains || []));
  } catch (error) {
    next(error);
  }
});

app.get('/api/spaceship/domains', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await listSpaceshipDomains(req.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/spaceship/domains/:domain', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await getSpaceshipDomain(req.params.domain));
  } catch (error) {
    next(error);
  }
});

app.post('/api/spaceship/domains/:domain/register', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await registerSpaceshipDomain(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post('/api/spaceship/domains/:domain/renew', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await renewSpaceshipDomain(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.put('/api/spaceship/domains/:domain/nameservers', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await updateSpaceshipNameservers(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.put('/api/spaceship/domains/:domain/auto-renew', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await updateSpaceshipAutoRenew(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.put('/api/spaceship/contacts', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await saveSpaceshipContact(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.get('/api/spaceship/contacts', providerApiGuard, async (req, res, next) => {
  try {
    res.json({ items: [], total: 0, message: 'Spaceship contact listing is not exposed by this integration yet.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/spaceship/async-operations/:operationId', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await getSpaceshipOperation(req.params.operationId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/spaceship/dns/:domain/records', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await listSpaceshipDnsRecords(req.params.domain, req.query));
  } catch (error) {
    next(error);
  }
});

app.put('/api/spaceship/dns/:domain/records', providerApiGuard, async (req, res, next) => {
  try {
    res.json(await saveSpaceshipDnsRecords(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.use('/sandbox/:siteId', (req, res, next) => {
  const siteId = sanitizeId(req.params.siteId);
  const sandboxDist = resolve(sandboxRoot, siteId, 'dist');
  if (!siteId || !sandboxDist.startsWith(sandboxRoot)) return next();
  const runtime = sandboxProcesses.get(siteId);
  if (runtime?.port) return proxySandboxRuntime(req, res, next, runtime.port, siteId);
  if (!existsSync(sandboxDist)) return next();
  return express.static(sandboxDist, {
    index: 'index.html',
    fallthrough: true,
    setHeaders(response, filePath) {
      response.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=60');
    },
  })(req, res, next);
});

app.get('/sandbox/:siteId/*', (req, res, next) => {
  const siteId = sanitizeId(req.params.siteId);
  const indexPath = resolve(sandboxRoot, siteId, 'dist', 'index.html');
  if (!siteId || !indexPath.startsWith(sandboxRoot) || !existsSync(indexPath)) return next();
  res.type('html').sendFile(indexPath);
});

// ── API routes ───────────────────────────────────────────────────────────────

// Public (unauthenticated)
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/public/sites', publicSalesRoutes);
app.use('/api/v1/domains', requireFeature('DOMAINS'), domainPublicRoutes);
app.use('/api/v1/templates', requireFeature('TEMPLATE_MARKETPLACE'), templateRoutes);
app.use('/api/template-ai', templateAiRoutes);
app.use('/api/v1/events', eventsRoutes);

// Auth
app.use('/api/v1/auth', authRoutes);

// Workspace (authenticated)
app.use('/api/v1/workspaces', workspaceRoutes);
app.use('/api/v1/workspaces/:workspaceId', workspaceDetailRoutes);
app.use('/api/v1/workspaces/:workspaceId/projects', projectRoutes);
app.use('/api/v1/workspaces/:workspaceId/domains', requireFeature('DOMAINS'), domainRoutes);
app.use('/api/v1/workspaces/:workspaceId/sites', siteRoutes);
app.use('/api/v1/workspaces/:workspaceId/commerce', commerceRoutes);
app.use('/api/v1/workspaces/:workspaceId/analytics', requireFeature('ANALYTICS'), analyticsRoutes);
app.use('/api/v1/workspaces/:workspaceId/billing', billingRoutes);
app.use('/api/v1/workspaces/:workspaceId/settings', requireFeature('SETTINGS'), settingsRoutes);
app.use('/api/v1/workspaces/:workspaceId/events', eventStreamRoutes);

// VPS hosting — Vultr-backed cloud servers (not part of the MVP).
app.use('/api/v1/vps-hosting', requireFeature('VPS'), vpsHostingRoutes);

// Render-powered customer hosting surface used by the site builder and hosting dashboard.
app.use('/api/deployments', deploymentRoutes);
app.use('/api/hosting', hostingRoutes);
app.use('/api/hosting', environmentRoutes);
app.use('/api/hosting', diskRoutes);
app.use('/api/hosting', requireFeature('DOMAINS'), domainHostingRoutes);

// Deploy-first K100 billing: customer payments + receipts, and the admin surface.
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', adminRoutes);

// ── SPA fallback — serve Vite dist for everything else ──────────────────────
app.use((req, res) => serveStatic(req, res));

function sanitizeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

const providerRateWindowMs = Number(process.env.PROVIDER_RATE_WINDOW_MS || 60_000);
const providerRateLimit = Number(process.env.PROVIDER_RATE_LIMIT || 20);
const providerRateBuckets = new Map();

function providerApiGuard(req, res, next) {
  if (String(process.env.PROVIDER_API_ENABLED || 'true').toLowerCase() === 'false') {
    return res.status(503).json({ status: 'disabled', message: 'Provider API endpoints are disabled.' });
  }

  const token = process.env.PROVIDER_API_TOKEN;
  if (token) {
    const expected = `Bearer ${token}`;
    if (req.headers.authorization !== expected) {
      return res.status(401).json({ status: 'unauthorized', message: 'Provider API token is required.' });
    }
  }

  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.path}`;
  const now = Date.now();
  const bucket = providerRateBuckets.get(key) || { count: 0, resetAt: now + providerRateWindowMs };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + providerRateWindowMs;
  }
  bucket.count += 1;
  providerRateBuckets.set(key, bucket);
  res.setHeader('X-RateLimit-Limit', String(providerRateLimit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, providerRateLimit - bucket.count)));
  if (bucket.count > providerRateLimit) {
    return res.status(429).json({ status: 'rate_limited', message: 'Too many provider API requests. Try again shortly.' });
  }

  return next();
}

function parseGithubRepo(value) {
  const raw = extractGithubRepoInput(value);
  if (!raw) return null;
  const ssh = raw.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (ssh) return normalizeGithubRepo(ssh[1], ssh[2]);
  const shorthand = raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthand && !raw.includes('://')) return normalizeGithubRepo(shorthand[1], shorthand[2]);
  try {
    const url = new URL(raw);
    if (!/github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return normalizeGithubRepo(parts[0], parts[1]);
  } catch {
    return null;
  }
}

function normalizeGithubRepo(owner, repo) {
  const cleanOwner = String(owner || '').trim().replace(/^@/, '');
  const cleanRepo = String(repo || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/https?:.*$/i, '')
    .replace(/\.git.*$/i, '')
    .replace(/[/\\].*$/, '');
  if (!/^[A-Za-z0-9-]+$/.test(cleanOwner) || !/^[A-Za-z0-9._-]+$/.test(cleanRepo)) return null;
  return {
    owner: cleanOwner,
    repo: cleanRepo,
    fullName: `${cleanOwner}/${cleanRepo}`,
    url: `https://github.com/${cleanOwner}/${cleanRepo}`,
  };
}

function extractGithubRepoInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const urlMatch = raw.match(/https?:\/\/github\.com\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const sshMatch = raw.match(/git@github\.com:[^\s]+/i);
  if (sshMatch) return sshMatch[0];
  return raw.split(/\s+/)[0];
}

function assertRepoAllowed(repo) {
  const allowlist = String(process.env.GITHUB_REPO_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.length) return;
  const fullName = repo.fullName.toLowerCase();
  const allowed = allowlist.some((item) => item === fullName || item === repo.owner.toLowerCase() || item === '*');
  if (!allowed) {
    const error = new Error(`Repository ${repo.fullName} is not allowed in this environment.`);
    error.status = 403;
    throw error;
  }
}

function safeBranchName(value) {
  const branch = String(value || 'main').trim() || 'main';
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
    const error = new Error('Branch contains unsupported characters.');
    error.status = 400;
    throw error;
  }
  return branch;
}

function safeRelativePath(value, fallback = 'dist') {
  const cleaned = String(value || fallback).replace(/^[/\\]+/, '').trim() || fallback;
  if (cleaned.includes('..') || resolve('/', cleaned) === '/') {
    const error = new Error('Path must be a non-root relative path.');
    error.status = 400;
    throw error;
  }
  return cleaned;
}

function childProcessEnv(extra = {}) {
  const allowed = [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'COMSPEC',
    'ComSpec',
    'PATHEXT',
    'NPM_CONFIG_CACHE',
  ];
  const env = {};
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    CI: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    ...extra,
  };
}

async function runStep(command, args, options = {}) {
  const started = Date.now();
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024 * 4,
      cwd: options.cwd,
      env: childProcessEnv(),
    });
    return {
      command: `${command} ${args.join(' ')}`,
      ok: true,
      durationMs: Date.now() - started,
      output: [stdout, stderr].filter(Boolean).join('\n').trim(),
    };
  } catch (error) {
    error.step = {
      command: `${command} ${args.join(' ')}`,
      ok: false,
      durationMs: Date.now() - started,
      output: [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim(),
    };
    throw error;
  }
}

async function importGithubSandbox(input) {
  const repo = parseGithubRepo(input.repoUrl);
  if (repo) assertRepoAllowed(repo);
  const branch = safeBranchName(input.branch);
  const fallbackName = repo ? `${repo.owner}-${repo.repo}`.toLowerCase() : 'invalid-repository';
  const siteId = sanitizeId(input.siteId || fallbackName);
  const sandboxDir = resolve(sandboxRoot, siteId);
  const repoDir = join(sandboxDir, 'repo');
  const outputDirectory = safeRelativePath(input.outputDirectory, 'dist');
  const distOut = resolve(sandboxDir, 'dist');
  const logs = [];

  try {
    if (!repo) {
      const error = new Error('Enter a valid GitHub repository URL.');
      error.status = 400;
      throw error;
    }

    await rm(sandboxDir, { recursive: true, force: true });
    mkdirSync(sandboxDir, { recursive: true });

    logs.push(await runStep('git', ['clone', '--depth', '1', '--branch', branch, repo.url, repoDir], { timeout: 180000 }));

    const packageJsonPath = join(repoDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      logs.push(await runStep('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: repoDir, timeout: 300000 }));
      if (packageJson.scripts?.build) {
        logs.push(await runStep('npm', ['run', 'build'], { cwd: repoDir, timeout: 300000 }));
      }
    }

    const packageJson = existsSync(packageJsonPath) ? JSON.parse(await readFile(packageJsonPath, 'utf8')) : null;
    const candidateOutput = resolve(repoDir, outputDirectory);
    const sourceDir = existsSync(join(candidateOutput, 'index.html')) ? candidateOutput : repoDir;
    if (!existsSync(join(sourceDir, 'index.html'))) {
      if (packageJson?.scripts?.start) {
        const runtimePort = 4100 + Math.floor(Math.random() * 1000);
        startSandboxRuntime(siteId, repoDir, runtimePort);
        logs.push({ command: `PORT=${runtimePort} npm start`, ok: true, durationMs: 0, output: 'Started repository server and attached it to the sandbox viewer.' });
        return {
          siteId,
          repo: repo.fullName,
          branch,
          previewUrl: `/sandbox/${siteId}/`,
          outputDirectory: 'runtime',
          status: 'ready',
          mode: 'runtime',
          files: await listSandboxFiles(repoDir),
          logs,
        };
      }
      const error = new Error(`No static index.html found in ${outputDirectory}, and package.json has no start script for runtime preview.`);
      error.status = 422;
      throw error;
    }

    await rm(distOut, { recursive: true, force: true });
    logs.push(await runStep('node', ['-e', `require('fs').cpSync(${JSON.stringify(sourceDir)}, ${JSON.stringify(distOut)}, { recursive: true })`], { timeout: 120000 }));

    return {
      siteId,
      repo: repo.fullName,
      branch,
      previewUrl: `/sandbox/${siteId}/`,
      outputDirectory: sourceDir === repoDir ? './' : outputDirectory,
      status: 'ready',
      files: await listSandboxFiles(repoDir),
      logs,
    };
  } catch (error) {
    return {
      siteId,
      repo: repo?.fullName || null,
      branch,
      previewUrl: null,
      outputDirectory,
      status: 'failed',
      files: existsSync(repoDir) ? await listSandboxFiles(repoDir).catch(() => []) : [],
      logs: [...logs, error.step || { ok: false, command: 'sandbox', output: error.message }],
      error: error.message,
    };
  }
}

async function listSandboxFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (files.length >= 500) break;
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
    const absolute = join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listSandboxFiles(absolute, relative));
    else files.push({ path: relative });
  }
  return files;
}

function startSandboxRuntime(siteId, cwd, port) {
  const existing = sandboxProcesses.get(siteId);
  if (existing?.child) existing.child.kill();
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['start'], {
    cwd,
    env: childProcessEnv({
      PORT: String(port),
      NODE_ENV: 'development',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const runtime = { child, port, logs: [] };
  child.stdout?.on('data', (chunk) => runtime.logs.push(String(chunk).trim()));
  child.stderr?.on('data', (chunk) => runtime.logs.push(String(chunk).trim()));
  child.on('exit', (code, signal) => {
    runtime.exited = { code, signal };
  });
  sandboxProcesses.set(siteId, runtime);
  return runtime;
}

async function proxySandboxRuntime(req, res, next, port, siteId) {
  try {
    const prefix = `/sandbox/${siteId}`;
    const original = req.originalUrl || req.url || '/';
    const targetPath = original.startsWith(prefix) ? original.slice(prefix.length) || '/' : req.url || '/';
    const target = `http://127.0.0.1:${port}${targetPath}`;
    const response = await fetch(target, {
      method: req.method,
      headers: {
        accept: req.headers.accept || '*/*',
        'user-agent': req.headers['user-agent'] || 'GlondiaSandbox',
      },
      redirect: 'manual',
    });
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

async function triggerRenderDeploy(input = {}) {
  const allowPlatformService = input.allowPlatformService === true || input.useDefaultService === true;
  const deployHookUrl = input.deployHookUrl || (allowPlatformService ? process.env.RENDER_DEPLOY_HOOK_URL : null);
  const serviceId = await resolveRenderServiceId(input);
  const apiKey = process.env.RENDER_API_KEY;
  const liveUrl = await resolveRenderLiveUrl(serviceId, input);
  const siteUrl = buildPublishedSiteUrl(liveUrl, input);
  if (isPlatformRenderService(serviceId) && !allowPlatformService) {
    return {
      status: 'blocked',
      provider: 'render',
      serviceId,
      message: 'This is the Glondiasites platform service. Customer deploys must use a separate Render service.',
    };
  }

  if (deployHookUrl) {
    const response = await fetch(deployHookUrl, { method: 'POST' });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Render deploy hook failed with ${response.status}: ${text}`);
      error.status = 502;
      throw error;
    }
    return {
      status: 'triggered',
      provider: 'render',
      method: 'deploy_hook',
      serviceId: serviceId || null,
      liveUrl,
      siteUrl,
      message: text || 'Render deploy hook triggered.',
    };
  }

  if (!apiKey || !serviceId) {
    return {
      status: 'configuration_required',
      provider: 'render',
      serviceId: serviceId || null,
      missing: {
        RENDER_API_KEY: !apiKey,
        RENDER_CUSTOMER_SERVICE_ID: !serviceId,
      },
      message: 'Select an existing customer Render service or activate the imported repo to create one.',
    };
  }

  const response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      clearCache: input.clearCache === 'clear' || input.clearCache === true ? 'clear' : 'do_not_clear',
    }),
  });
  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }

  if (!response.ok) {
    const error = new Error(body?.message || bodyText || `Render deploy failed with ${response.status}.`);
    error.status = 502;
    throw error;
  }

  return {
    status: 'triggered',
    provider: 'render',
    method: 'api',
    serviceId,
    liveUrl,
    siteUrl,
    deploy: body,
    message: isPlatformRenderService(serviceId) ? 'Glondiasites deployment started.' : 'Customer deployment started.',
  };
}

async function activateRenderRepoService(input = {}) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return { status: 'configuration_required', message: 'RENDER_API_KEY is required.' };
  const repo = parseGithubRepo(input.repoUrl || input.repo || input.repository);
  if (!repo) return { status: 'failed', message: 'A valid GitHub repository URL is required.' };
  assertRepoAllowed(repo);

  const services = await listRenderServices();
  const existing = services.find((service) => sameRepo(service.repo, repo.fullName, repo.url));
  if (existing?.id) {
    const deploy = await triggerRenderDeploy({ ...input, serviceId: existing.id });
    return { status: 'activated', action: 'reused', service: existing, deploy };
  }

  const ownerId = process.env.RENDER_OWNER_ID || input.ownerId || await getDefaultRenderOwnerId();
  if (!ownerId) return { status: 'configuration_required', message: 'RENDER_OWNER_ID is required to create a new Render service.' };

  const serviceType = input.serviceType || inferRenderServiceType(input);
  const body = {
    type: serviceType,
    name: renderSafeName(input.name || repo.repo),
    ownerId,
    repo: `https://github.com/${repo.fullName}`,
    branch: safeBranchName(input.branch),
    autoDeploy: 'no',
    rootDir: input.rootDirectory ? safeRelativePath(input.rootDirectory, '') : '',
    serviceDetails: serviceType === 'static_site'
      ? {
          buildCommand: input.buildCommand || 'npm install && npm run build',
          publishPath: input.outputDirectory || 'dist',
        }
      : {
          plan: input.plan || 'starter',
          region: input.region || 'oregon',
          env: input.runtime || input.env || 'node',
          envSpecificDetails: {
            buildCommand: input.buildCommand || 'npm install && npm run build',
            startCommand: input.startCommand || 'npm start',
          },
        },
  };

  const response = await fetch('https://api.render.com/v1/services', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const created = await readRenderJson(response);
  if (!response.ok) {
    return { status: 'failed', action: 'create', error: created?.message || `Render create service failed with ${response.status}.`, response: created };
  }

  const service = created.service || created;
  const deploy = await triggerRenderDeploy({ ...input, serviceId: service.id });
  return { status: 'activated', action: 'created', service, deploy };
}

async function getDefaultRenderOwnerId() {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return null;
  const response = await fetch('https://api.render.com/v1/owners?limit=20', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const body = await readRenderJson(response);
  if (!response.ok) return null;
  const owners = Array.isArray(body) ? body : [body];
  return owners[0]?.owner?.id || owners[0]?.id || null;
}

function sameRepo(serviceRepo, fullName, cloneUrl) {
  const normalized = String(serviceRepo || '').toLowerCase().replace(/\.git$/, '');
  return normalized.includes(fullName.toLowerCase()) || normalized === String(cloneUrl || '').toLowerCase().replace(/\.git$/, '');
}

function renderSafeName(value) {
  return String(value || 'glondia-site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'glondia-site';
}

function inferRenderServiceType(input = {}) {
  const hasStart = !!input.startCommand || input.framework === 'Node' || input.framework === 'Express';
  return hasStart ? 'web_service' : 'static_site';
}

async function testRenderDeploy(input = {}) {
  const serviceId = await resolveRenderServiceId(input);
  const apiKey = process.env.RENDER_API_KEY;
  if (isPlatformRenderService(serviceId) && input.allowPlatformService !== true && input.useDefaultService !== true) {
    return {
      status: 'blocked',
      serviceId,
      message: 'This is the Glondiasites platform service. Customer test deploys must use a separate Render service.',
    };
  }
  if (!apiKey || !serviceId) {
    return {
      status: 'configuration_required',
      settings: getRenderSettings({ ...input, serviceId }),
      message: 'Set RENDER_API_KEY and select or activate a customer Render service before testing deploy.',
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const deployResponse = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  const deploy = await readRenderJson(deployResponse);
  if (!deployResponse.ok) {
    return {
      status: 'failed',
      phase: 'trigger',
      serviceId,
      error: deploy?.message || `Render deploy trigger failed with ${deployResponse.status}.`,
      response: deploy,
    };
  }

  const deployId = deploy.id;
  await delay(2000);
  const beforeCancel = await getRenderDeploy(serviceId, deployId, headers);
  const cancelResponse = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}/cancel`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const cancel = await readRenderJson(cancelResponse);
  await delay(2000);
  const afterCancel = await getRenderDeploy(serviceId, deployId, headers);

  return {
    status: afterCancel?.status === 'canceled' ? 'passed' : 'check',
    serviceId,
    deployId,
    triggerStatus: deploy.status,
    statusBeforeCancel: beforeCancel?.status || null,
    cancelResponseStatus: cancel?.status || null,
    statusAfterCancel: afterCancel?.status || null,
    trigger: afterCancel?.trigger || deploy.trigger || 'api',
  };
}

async function getRenderDeploy(serviceId, deployId, headers) {
  const response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`, {
    headers,
  });
  return readRenderJson(response);
}

async function readRenderJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function getRenderSettings(input = {}) {
  const serviceId = input.serviceId || input.renderServiceId || null;
  return {
    provider: 'render',
    configured: !!process.env.RENDER_API_KEY && !!process.env.RENDER_OWNER_ID,
    customerServiceReady: !!serviceId,
    required: ['RENDER_API_KEY', 'RENDER_OWNER_ID'].filter((key) => !process.env[key]),
  };
}

async function listRenderDeploys(input = {}) {
  if (!input.serviceId && !input.renderServiceId && !input.repo && !input.repository && !input.name) {
    return { status: 'customer_service_required', deploys: [], settings: getRenderSettings(input) };
  }
  const serviceId = await resolveRenderServiceId(input);
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey || !serviceId) {
    return { status: 'configuration_required', deploys: [], settings: getRenderSettings(input) };
  }

  const response = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=5`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : []; } catch { body = []; }
  if (!response.ok) {
    return { status: 'failed', deploys: [], settings: getRenderSettings(input), error: body?.message || bodyText || `Render returned ${response.status}.` };
  }
  return { status: 'ok', deploys: Array.isArray(body) ? body : [], settings: getRenderSettings(input) };
}

async function resolveRenderServiceId(input = {}) {
  if (input.serviceId || input.renderServiceId) return input.serviceId || input.renderServiceId;
  const services = await listRenderServices().catch(() => []);
  const repoNeedle = String(input.repo || input.repository || '').toLowerCase();
  const nameNeedle = String(input.name || '').toLowerCase();
  const match = services.find((service) => {
    const haystack = [
      service.id,
      service.name,
      service.slug,
      service.repo,
      service.url,
    ].filter(Boolean).join(' ').toLowerCase();
    return (repoNeedle && haystack.includes(repoNeedle.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')))
      || (nameNeedle && haystack.includes(nameNeedle));
  });
  if (match?.id) return match.id;
  if (input.allowPlatformService === true || input.useDefaultService === true) return process.env.RENDER_SERVICE_ID || services[0]?.id || null;
  return null;
}

function isPlatformRenderService(serviceId) {
  return !!serviceId && !!process.env.RENDER_SERVICE_ID && serviceId === process.env.RENDER_SERVICE_ID;
}

async function resolveRenderLiveUrl(serviceId, input = {}) {
  if (input.liveUrl) return String(input.liveUrl).replace(/\/+$/, '');
  const configured = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (!serviceId) return null;
  const services = await listRenderServices().catch(() => []);
  const service = services.find((item) => item.id === serviceId);
  return service?.url ? String(service.url).replace(/\/+$/, '') : null;
}

function buildPublishedSiteUrl(liveUrl, input = {}) {
  if (!liveUrl) return null;
  const sitePath = input.sitePath || input.publishedPath;
  if (sitePath) return `${liveUrl}/${String(sitePath).replace(/^\/+/, '')}`;
  return liveUrl;
}

async function listRenderServices() {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return [];
  const response = await fetch('https://api.render.com/v1/services?limit=100', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : []; } catch { body = []; }
  if (!response.ok) return [];
  const rows = Array.isArray(body) ? body : [];
  return rows.map((item) => {
    const svc = item.service || item;
    return {
      id: svc.id,
      name: svc.name,
      type: svc.type,
      slug: svc.slug,
      suspended: svc.suspended && svc.suspended !== 'not_suspended',
      url: svc.serviceDetails?.url || svc.url || null,
      region: svc.serviceDetails?.region || svc.region || null,
      env: svc.serviceDetails?.env || svc.env || null,
      repo: svc.repo || svc.repoUrl || svc.serviceDetails?.repo || null,
      isPlatform: isPlatformRenderService(svc.id),
    };
  }).filter((service) => service.id);
}

// ── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
function getSpaceshipSettings() {
  return {
    provider: 'spaceship',
    configured: !!(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET),
    apiKeyPresent: !!process.env.SPACESHIP_API_KEY,
    apiSecretPresent: !!process.env.SPACESHIP_API_SECRET,
    baseUrl: spaceshipBaseUrl(),
    required: ['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET'].filter((key) => !process.env[key]),
  };
}

function spaceshipBaseUrl() {
  return (process.env.SPACESHIP_API_BASE_URL || 'https://spaceship.dev/api/v1').replace(/\/+$/, '');
}

function spaceshipHeaders(extra = {}) {
  if (!process.env.SPACESHIP_API_KEY || !process.env.SPACESHIP_API_SECRET) {
    const error = new Error('SPACESHIP_API_KEY and SPACESHIP_API_SECRET are required.');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return {
    'X-API-Key': process.env.SPACESHIP_API_KEY,
    'X-API-Secret': process.env.SPACESHIP_API_SECRET,
    Accept: 'application/json',
    ...extra,
  };
}

async function spaceshipRequest(path, options = {}) {
  const response = await fetch(`${spaceshipBaseUrl()}${path}`, {
    method: options.method || 'GET',
    headers: spaceshipHeaders(options.body ? { 'Content-Type': 'application/json' } : {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const operationId = response.headers.get('spaceship-async-operationid');
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const upstreamMessage = body?.detail || body?.message || body?.title || text || `Spaceship returned ${response.status}.`;
    const safeMessage = response.status === 401
      ? 'Spaceship authentication failed. Check SPACESHIP_API_KEY, SPACESHIP_API_SECRET, API scopes, and any Spaceship IP restrictions.'
      : upstreamMessage;
    const error = new Error(safeMessage);
    error.status = response.status >= 500 ? 502 : response.status;
    error.details = body;
    error.expose = true;
    throw error;
  }
  return { body, operationId, statusCode: response.status };
}

function cleanDomainName(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || domain.includes('..')) {
    const error = new Error('A valid fully qualified domain name is required.');
    error.status = 400;
    throw error;
  }
  return domain;
}

async function checkSpaceshipAvailability(domains = []) {
  const uniqueDomains = [...new Set(domains.map(cleanDomainName))].slice(0, 20);
  if (!uniqueDomains.length) return { domains: [] };
  const { body } = await spaceshipRequest('/domains/available', {
    method: 'POST',
    body: { domains: uniqueDomains },
  });
  const rows = Array.isArray(body?.domains) ? body.domains : [];
  return {
    domains: rows.map((item) => {
      const price = item.premiumPricing?.find((entry) => entry.operation === 'register') || item.premiumPricing?.[0] || null;
      const status = item.result || item.status || 'unknown';
      return {
        domain: item.domain,
        available: status === 'available',
        status,
        pricing: price ? { amount: price.price, currency: price.currency || 'USD', operation: price.operation || 'register' } : null,
        raw: item,
      };
    }),
  };
}

async function listSpaceshipDomains(query = {}) {
  const take = Math.min(Math.max(Number(query.take || 100), 1), 100);
  const skip = Math.max(Number(query.skip || 0), 0);
  const { body } = await spaceshipRequest(`/domains?take=${take}&skip=${skip}`);
  return body;
}

async function getSpaceshipDomain(domain) {
  const { body } = await spaceshipRequest(`/domains/${encodeURIComponent(cleanDomainName(domain))}`);
  return body;
}

async function registerSpaceshipDomain(domain, input = {}) {
  const name = cleanDomainName(domain);
  const contactId = input.contactId || input.registrant || input.contacts?.registrant;
  if (!contactId) {
    const error = new Error('A Spaceship contactId is required before registering a domain.');
    error.status = 400;
    throw error;
  }
  const payload = {
    autoRenew: input.autoRenew !== false,
    years: Math.min(Math.max(Number(input.years || 1), 1), 10),
    privacyProtection: typeof input.privacyProtection === 'object'
      ? input.privacyProtection
      : { level: input.privacyProtection === false ? 'none' : 'high', userConsent: input.privacyProtection !== false },
    contacts: {
      registrant: contactId,
      admin: input.adminContactId || contactId,
      tech: input.techContactId || contactId,
      billing: input.billingContactId || contactId,
    },
  };
  const result = await spaceshipRequest(`/domains/${encodeURIComponent(name)}/register`, {
    method: 'POST',
    body: payload,
  });
  return {
    domain: name,
    operationId: result.operationId || result.body?.operationId || null,
    status: result.operationId ? 'pending' : 'success',
    response: result.body,
  };
}

async function renewSpaceshipDomain(domain, input = {}) {
  const name = cleanDomainName(domain);
  const result = await spaceshipRequest(`/domains/${encodeURIComponent(name)}/renew`, {
    method: 'POST',
    body: { years: Math.min(Math.max(Number(input.years || 1), 1), 10) },
  });
  return {
    domain: name,
    operationId: result.operationId || result.body?.operationId || null,
    status: result.operationId ? 'pending' : 'success',
    response: result.body,
  };
}

async function updateSpaceshipNameservers(domain, input = {}) {
  const name = cleanDomainName(domain);
  const hosts = Array.isArray(input.hosts) ? input.hosts.map((host) => String(host).trim()).filter(Boolean) : [];
  if (!hosts.length) {
    const error = new Error('At least one nameserver host is required.');
    error.status = 400;
    throw error;
  }
  await spaceshipRequest(`/domains/${encodeURIComponent(name)}/nameservers`, {
    method: 'PUT',
    body: { provider: input.provider || 'custom', hosts },
  });
  return { domain: name, provider: input.provider || 'custom', hosts };
}

async function updateSpaceshipAutoRenew(domain, input = {}) {
  const name = cleanDomainName(domain);
  await spaceshipRequest(`/domains/${encodeURIComponent(name)}/auto-renew`, {
    method: 'PUT',
    body: { autoRenew: !!input.autoRenew },
  });
  return { domain: name, autoRenew: !!input.autoRenew };
}

async function saveSpaceshipContact(input = {}) {
  const payload = {
    firstName: input.firstName,
    lastName: input.lastName,
    organization: input.company || undefined,
    email: input.email,
    phone: input.phone,
    address1: input.address1,
    address2: input.address2 || undefined,
    city: input.city,
    postalCode: input.postalCode,
    country: input.country,
  };
  const { body } = await spaceshipRequest('/contacts', { method: 'PUT', body: payload });
  return { id: body.contactId || body.id, contactId: body.contactId || body.id, ...body };
}

async function getSpaceshipOperation(operationId) {
  const id = String(operationId || '').trim();
  if (!/^[a-zA-Z0-9]{1,36}$/.test(id)) {
    const error = new Error('A valid Spaceship operation id is required.');
    error.status = 400;
    throw error;
  }
  const { body } = await spaceshipRequest(`/async-operations/${encodeURIComponent(id)}`);
  return { operationId: id, ...body };
}

async function listSpaceshipDnsRecords(domain, query = {}) {
  const name = cleanDomainName(domain);
  const take = Math.min(Math.max(Number(query.take || 500), 1), 500);
  const skip = Math.max(Number(query.skip || 0), 0);
  const { body } = await spaceshipRequest(`/dns/records/${encodeURIComponent(name)}?take=${take}&skip=${skip}`);
  const items = Array.isArray(body?.items) ? body.items : [];
  return {
    domain: name,
    pulled: items.length,
    items,
    records: items.map(fromSpaceshipDnsRecord),
    total: body?.total ?? items.length,
  };
}

async function saveSpaceshipDnsRecords(domain, input = {}) {
  const name = cleanDomainName(domain);
  const records = Array.isArray(input.records) ? input.records : Array.isArray(input.items) ? input.items : [];
  const items = records.map(toSpaceshipDnsRecord).filter(Boolean);
  if (!items.length) return { domain: name, pushed: 0 };
  await spaceshipRequest(`/dns/records/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: { force: input.force !== false, items },
  });
  return { domain: name, pushed: items.length };
}

function toSpaceshipDnsRecord(record = {}) {
  const type = String(record.type || '').toUpperCase();
  const name = record.name || record.host || '@';
  const ttl = Number(record.ttlSeconds || record.ttl || 3600);
  const value = record.value || record.address || record.exchange || record.text || record.target || '';
  const base = { type, name, ttl: Number.isFinite(ttl) ? ttl : 3600 };
  if (['A', 'AAAA'].includes(type)) return { ...base, address: value };
  if (type === 'CNAME') return { ...base, cname: value };
  if (type === 'MX') return { ...base, exchange: value, preference: Number(record.priority || record.preference || 10) };
  if (type === 'TXT') return { ...base, text: value };
  if (type === 'CAA') return { ...base, flag: Number(record.flag || 0), tag: record.tag || 'issue', value };
  if (['SRV', 'TLSA', 'HTTPS', 'SVCB', 'NS', 'PTR', 'ALIAS'].includes(type)) return { ...base, value };
  return null;
}

function fromSpaceshipDnsRecord(record = {}) {
  const value = record.address || record.cname || record.exchange || record.text || record.value || record.target || '';
  return {
    id: `${record.type || 'record'}_${record.name || '@'}_${value}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    type: record.type,
    name: record.name || '@',
    value,
    ttl: record.ttl || 3600,
    priority: record.preference || record.priority || null,
    proxied: false,
    status: 'active',
  };
}

const FALLBACK_TLD_PRICE_CENTS = new Map([
  ['.com', 1499], ['.com.pg', 4999], ['.com.fj', 5999], ['.com.vu', 4499],
  ['.co', 2499], ['.io', 3999], ['.app', 1699], ['.dev', 1499],
  ['.org', 1249], ['.net', 1199], ['.store', 499], ['.shop', 199],
]);
// Pre-sorted longest-first so multi-part TLDs (.com.pg) match before shorter ones (.com)
const FALLBACK_TLD_SUFFIXES = [...FALLBACK_TLD_PRICE_CENTS.keys()].sort((a, b) => b.length - a.length);

async function createDomainPaymentOrder(input = {}, user = {}) {
  const domains = Array.isArray(input.domains) ? input.domains : [];
  if (!domains.length) throw httpError('At least one domain is required.', 400);
  const normalized = domains.map((item) => ({
    name: cleanDomainName(item.name || item.hostname || item.domain),
    years: Math.min(Math.max(Number(item.years || 1), 1), 10),
  }));
  const availability = await checkSpaceshipAvailability(normalized.map((item) => item.name));
  const lines = normalized.map((item) => {
    const row = availability.domains.find((candidate) => candidate.domain === item.name);
    if (row && !row.available) throw httpError(`${item.name} is no longer available.`, 409);
    const actualAmountCents = domainActualPriceCents(item.name, row) * item.years;
    return { type: 'domain_registration', name: item.name, years: item.years, actualAmountCents };
  });
  return createCheckoutOrder({
    type: 'domain_purchase',
    user,
    source: input,
    lineItems: lines,
    metadata: {
      domains: normalized,
      contact: sanitizeContact(input.contact || {}),
      autoRenew: input.autoRenew !== false,
      privacyProtection: input.privacyProtection !== false,
    },
  });
}

async function captureDomainPaymentOrder(input = {}, user = {}) {
  const order = await getCheckoutOrder(input.checkoutOrderId);
  if (order.type !== 'domain_purchase') throw httpError('Checkout order is not for a domain purchase.', 400);
  if (order.status === 'paid') return order.result;

  const domains = order.metadata.domains || [];
  const providerOrderId = input.providerOrderId || input.orderId || order.providerOrderId;

  // Batch availability check BEFORE capturing payment to prevent money being taken for unavailable domains
  if (domains.length) {
    const availability = await checkSpaceshipAvailability(domains.map((d) => d.name));
    const unavailable = domains.filter((item) => {
      const row = availability.domains.find((r) => r.domain === item.name);
      return row && !row.available;
    });
    if (unavailable.length) throw httpError(`${unavailable.map((d) => d.name).join(', ')} is no longer available.`, 409);
  }

  const capturePayload = await capturePayPalOrder(providerOrderId);
  const captureId = capturePayload?.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  const contact = order.metadata.contact || {};
  const createdContact = await saveSpaceshipContact(contact);
  const contactId = createdContact.contactId || createdContact.id;

  let operations;
  try {
    operations = await Promise.all(
      domains.map(async (item) => {
        const registered = await registerSpaceshipDomain(item.name, {
          years: item.years || 1,
          autoRenew: order.metadata.autoRenew !== false,
          privacyProtection: order.metadata.privacyProtection !== false,
          contactId,
        });
        return { domain: item.name, operationId: registered.operationId, status: registered.status };
      })
    );
  } catch (registrationError) {
    if (captureId) await refundPayPalCapture(captureId).catch(() => {});
    throw httpError(`Domain registration failed after payment: ${registrationError.message}. A refund has been requested.`, 500);
  }

  const result = { status: 'paid', checkoutOrderId: order.id, operations, amounts: order.amounts };
  await markCheckoutPaid(order.id, providerOrderId, result, user);
  return result;
}

async function createHostingPaymentOrder(input = {}, user = {}) {
  // New flow: pay for an already-running deployment from the Billing tab
  if (input.deploymentId) {
    const store = await readHostingStore();
    const dep = (store.deployments || []).find((d) => d.deploymentId === input.deploymentId || d.id === input.deploymentId);
    if (!dep) throw httpError('Deployment not found.', 404);
    const existing = (store.checkoutOrders || []).find(
      (o) => o.type === 'hosting_deployment' && o.status === 'paid' && o.metadata?.deploymentId === input.deploymentId
    );
    if (existing) throw httpError('This deployment has already been paid for.', 409);
    const actualAmountCents = hostingActualCostCents(dep);
    return createCheckoutOrder({
      type: 'hosting_deployment',
      user,
      source: input,
      lineItems: [{ type: 'render_deployment', name: dep.serviceName || 'Render hosting', actualAmountCents }],
      metadata: { deploymentId: dep.deploymentId },
    });
  }

  // Legacy flow: deploy-then-pay (kept for compat, no longer called from builder)
  const deploymentPayload = input.deployment || input;
  if (!(deploymentPayload.repoUrl || deploymentPayload.repositoryUrl || deploymentPayload.sourceReference || deploymentPayload.renderServiceId || deploymentPayload.serviceId)) {
    throw httpError('A repository or existing Render service is required before hosting checkout.', 400);
  }
  const actualAmountCents = hostingActualCostCents(deploymentPayload);
  return createCheckoutOrder({
    type: 'hosting_deployment',
    user,
    source: input,
    lineItems: [{ type: 'render_deployment', name: deploymentPayload.name || deploymentPayload.serviceName || 'Render deployment', actualAmountCents }],
    metadata: { deploymentPayload },
  });
}

async function captureHostingPaymentOrder(input = {}, user = {}) {
  const order = await getCheckoutOrder(input.checkoutOrderId);
  if (order.type !== 'hosting_deployment') throw httpError('Checkout order is not for hosting.', 400);
  if (order.status === 'paid') return order.result;

  const providerOrderId = input.providerOrderId || input.orderId || order.providerOrderId;
  const capturePayload = await capturePayPalOrder(providerOrderId);
  const captureId = capturePayload?.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  // New path: payment for an already-deployed service from the Billing tab
  if (order.metadata?.deploymentId) {
    const result = { status: 'paid', checkoutOrderId: order.id, deploymentId: order.metadata.deploymentId, amounts: order.amounts };
    await markCheckoutPaid(order.id, providerOrderId, result, user);
    // Also stamp paymentStatus on the deployment record
    await mutateHostingStore((store) => {
      const dep = (store.deployments || []).find((d) => d.deploymentId === order.metadata.deploymentId);
      if (dep) { dep.paymentStatus = 'paid'; dep.updatedAt = nowIso(); }
    });
    return result;
  }

  // Legacy path: deploy-then-pay (kept for compat)
  let deployment;
  try {
    deployment = await deploymentService.createRenderDeployment(order.metadata.deploymentPayload || {}, { userId: user.id || 'local-user' });
  } catch (deployError) {
    if (captureId) await refundPayPalCapture(captureId).catch(() => {});
    throw httpError(`Render deployment failed after payment: ${deployError.message}. A refund has been requested.`, 500);
  }

  const result = { status: 'paid', checkoutOrderId: order.id, deployment, amounts: order.amounts };
  await markCheckoutPaid(order.id, providerOrderId, result, user);
  return result;
}

async function createCheckoutOrder({ type, user, source, lineItems, metadata }) {
  assertPayPalConfigured();
  const actualAmountCents = lineItems.reduce((sum, item) => sum + item.actualAmountCents, 0);
  const markupPercent = getPlatformMarkupPercent();
  const markupAmountCents = Math.round(actualAmountCents * markupPercent / 100);
  const totalAmountCents = actualAmountCents + markupAmountCents;
  const id = makeId('checkout');
  const amounts = {
    currency: 'USD',
    actualAmountCents,
    markupPercent,
    markupAmountCents,
    totalAmountCents,
    actualAmount: centsToUsd(actualAmountCents),
    markupAmount: centsToUsd(markupAmountCents),
    totalAmount: centsToUsd(totalAmountCents),
  };
  const paypal = await createPayPalOrder({
    checkoutOrderId: id,
    type,
    totalAmountCents,
    lineItems,
    amounts,
    returnUrl: source?.returnUrl,
    cancelUrl: source?.cancelUrl,
  });
  const order = {
    id,
    organizationId: source?.organizationId || user.organizationId || 'local-org',
    userId: user.id || 'local-user',
    type,
    provider: 'paypal',
    providerOrderId: paypal.id,
    status: 'pending',
    currency: 'USD',
    actualAmountCents,
    markupPercent,
    markupAmountCents,
    totalAmountCents,
    amounts,
    lineItems,
    metadata,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await mutateHostingStore((store) => {
    store.checkoutOrders = store.checkoutOrders || [];
    store.payments = store.payments || [];
    store.checkoutOrders.unshift(order);
    return order;
  });
  return { checkoutOrderId: id, providerOrderId: paypal.id, approvalUrl: paypal.approvalUrl, amounts, lineItems };
}

async function getCheckoutOrder(checkoutOrderId) {
  const id = String(checkoutOrderId || '').trim();
  if (!id) throw httpError('checkoutOrderId is required.', 400);
  const store = await readHostingStore();
  const order = (store.checkoutOrders || []).find((item) => item.id === id);
  if (!order) throw httpError('Checkout order not found.', 404);
  return order;
}

async function markCheckoutPaid(checkoutOrderId, providerCaptureId, result, user = {}) {
  return mutateHostingStore((store) => {
    const order = (store.checkoutOrders || []).find((item) => item.id === checkoutOrderId);
    if (!order) return result;
    if (order.status === 'paid') return order.result;
    Object.assign(order, {
      status: 'paid',
      providerCaptureId,
      result,
      updatedAt: nowIso(),
    });
    store.payments = store.payments || [];
    store.payments.unshift({
      id: makeId('pay'),
      checkoutOrderId: order.id,
      organizationId: order.organizationId,
      userId: user.id || order.userId,
      type: order.type,
      provider: 'paypal',
      providerOrderId: order.providerOrderId,
      providerCaptureId,
      status: 'paid',
      currency: order.currency,
      actualAmountCents: order.actualAmountCents,
      markupPercent: order.markupPercent,
      markupAmountCents: order.markupAmountCents,
      totalAmountCents: order.totalAmountCents,
      metadata: order.metadata,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return result;
  });
}

async function refundPayPalCapture(captureId) {
  const response = await fetch(`${paypalBaseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify({ note_to_payer: 'Your payment could not be fulfilled and has been refunded.' }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || 'PayPal refund request failed');
  }
}

async function createPayPalOrder({ checkoutOrderId, type, totalAmountCents, lineItems, amounts, returnUrl, cancelUrl }) {
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: checkoutOrderId,
      custom_id: `${type}:${checkoutOrderId}`,
      description: type === 'domain_purchase' ? 'Glondia domain registration' : 'Glondia Render deployment',
      amount: {
        currency_code: 'USD',
        value: centsToUsd(totalAmountCents),
        breakdown: {
          item_total: { currency_code: 'USD', value: centsToUsd(totalAmountCents) },
        },
      },
      items: [
        ...lineItems.map((item) => ({
          name: item.name,
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: centsToUsd(item.actualAmountCents) },
          category: 'DIGITAL_GOODS',
        })),
        ...(amounts.markupAmountCents > 0 ? [{
          name: 'Glondia platform service fee',
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: centsToUsd(amounts.markupAmountCents) },
          category: 'DIGITAL_GOODS',
        }] : []),
      ],
    }],
    application_context: {
      brand_name: 'Glondia',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: safeReturnUrl(returnUrl),
      cancel_url: safeReturnUrl(cancelUrl || returnUrl),
    },
  };
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(payload?.message || 'PayPal order creation failed.', response.status, payload);
  return { id: payload.id, approvalUrl: payload.links?.find((link) => link.rel === 'approve')?.href, payload };
}

async function capturePayPalOrder(providerOrderId) {
  const id = String(providerOrderId || '').trim();
  if (!id) throw httpError('PayPal order id is required.', 400);
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(payload?.message || 'PayPal capture failed.', response.status, payload);
  if (payload.status !== 'COMPLETED') throw httpError(`PayPal capture status is ${payload.status || 'unknown'}.`, 409, payload);
  return payload;
}

let paypalTokenCache = { token: '', expiresAt: 0 };
async function getPayPalAccessToken() {
  assertPayPalConfigured();
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt) return paypalTokenCache.token;
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError('Failed to authenticate with PayPal.', response.status, payload);
  paypalTokenCache = { token: payload.access_token, expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 300) - 60) * 1000 };
  return paypalTokenCache.token;
}

async function paypalHeaders() {
  return {
    Authorization: `Bearer ${await getPayPalAccessToken()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function paypalBaseUrl() {
  return String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() === 'false'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function assertPayPalConfigured() {
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) return;
  throw httpError('PayPal credentials are not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.', 503);
}

function getPlatformMarkupPercent() {
  const raw = process.env.PLATFORM_MARKUP_PERCENT;
  if (raw === undefined || raw === '') return 30;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 30;
  return value;
}

function domainActualPriceCents(domain, availabilityRow) {
  const premium = availabilityRow?.pricing?.amount;
  if (premium != null && Number.isFinite(Number(premium))) return Math.max(0, Math.round(Number(premium)));
  const tld = FALLBACK_TLD_SUFFIXES.find((suffix) => domain.endsWith(suffix));
  if (!tld) throw httpError(`No registrar price is configured for ${domain}.`, 400);
  return FALLBACK_TLD_PRICE_CENTS.get(tld);
}

function hostingActualCostCents(input = {}) {
  const supplied = Number(input.actualAmountCents || input.hostingCostCents || 0);
  if (Number.isFinite(supplied) && supplied > 0) return Math.round(supplied);
  const plan = String(input.plan || 'starter').toLowerCase();
  if (plan === 'free') return 0;
  if (plan === 'standard') return 2500;
  if (plan === 'pro') return 8500;
  return 700;
}

function sanitizeContact(input = {}) {
  return {
    firstName: String(input.firstName || '').trim(),
    lastName: String(input.lastName || '').trim(),
    company: String(input.company || '').trim() || undefined,
    email: String(input.email || '').trim(),
    phone: String(input.phone || '').trim(),
    address1: String(input.address1 || '').trim(),
    address2: String(input.address2 || '').trim() || undefined,
    city: String(input.city || '').trim(),
    postalCode: String(input.postalCode || '').trim(),
    country: String(input.country || '').trim().toUpperCase(),
  };
}

function centsToUsd(cents) {
  return (Math.max(0, Math.round(Number(cents) || 0)) / 100).toFixed(2);
}

function safeReturnUrl(value) {
  const fallback = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const url = new URL(value || fallback);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function httpError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  error.expose = true;
  return error;
}

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = isProd && !err.expose ? 'An unexpected error occurred.' : (err.message || String(err));
  console.error(`[error] ${req.method} ${req.url} →`, err.message || err);
  const body = {
    success: false,
    error: { code: err.code || 'INTERNAL_ERROR', message },
    requestId: req.id,
  };
  // Include stage field when present — used by deployment error responses
  if (err.stage) body.stage = err.stage;
  if (err.details && err.expose) body.details = err.details;
  res.status(status).json(body);
});

// ── Payment enforcement job ───────────────────────────────────────────────────
// Runs every 30 minutes. Only acts on deployments that were made through the
// Glondia platform (platformDeployed: true). Never scans Render directly —
// only reads from the local store. Never touches anything on startup.
function startPaymentEnforcementJob() {
  const GRACE_MS = Number(process.env.PAYMENT_GRACE_HOURS || 24) * 60 * 60 * 1000;
  const INTERVAL_MS = 30 * 60 * 1000;

  const runEnforcement = async () => {
    try {
      const store = await readHostingStore();
      const paidIds = new Set(
        (store.checkoutOrders || [])
          .filter((o) => o.type === 'hosting_deployment' && o.status === 'paid' && o.metadata?.deploymentId)
          .map((o) => o.metadata.deploymentId)
      );

      for (const dep of store.deployments || []) {
        // ONLY act on deployments made through this platform.
        // platformDeployed must be explicitly true — anything else is off-limits.
        if (dep.platformDeployed !== true) continue;
        if (dep.paymentStatus === 'paid' || dep.paymentStatus === 'overdue_suspended') continue;
        if (paidIds.has(dep.deploymentId)) continue;
        if (!dep.createdAt) continue;
        if (Date.now() < new Date(dep.createdAt).getTime() + GRACE_MS) continue;

        // Grace period expired and no payment — suspend via Render
        if (dep.renderServiceId) {
          await renderApiService.suspendService(dep.renderServiceId).catch((err) => {
            console.error(`[enforcement] Suspend failed for ${dep.deploymentId}:`, err.message);
          });
        }
        await mutateHostingStore((s) => {
          const d = (s.deployments || []).find((x) => x.deploymentId === dep.deploymentId);
          if (d) { d.paymentStatus = 'overdue_suspended'; d.status = 'suspended'; d.updatedAt = nowIso(); }
        });
        console.log(`[enforcement] Suspended ${dep.serviceName || dep.deploymentId} — payment overdue.`);
      }
    } catch (err) {
      console.error('[enforcement] Job error:', err.message);
    }
  };

  // No immediate startup run — only fires on the interval.
  // This prevents touching anything when the server redeploys.
  return setInterval(runEnforcement, INTERVAL_MS);
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[glondia] API + static server listening on port ${PORT}`);
    console.log(`[glondia] Serving Vite app from ${distDir}`);
    console.log(`[glondia] DATABASE_URL: ${(process.env.DATABASE_URL || '(not set)').replace(/:[^:@]+@/, ':***@')}`);

    // Verify DB is reachable on startup — logs clearly if the file can't be opened.
    prisma.$connect()
      .then(() => console.log('[glondia] Database connection established.'))
      .catch((err) => console.error('[glondia] Database connection FAILED:', err.message, '\n  Check that the persistent disk is mounted and DATABASE_URL is correct.'));
  });
  // Deploy-first K100 billing: enforce the 12-hour grace window every 5 minutes.
  startDeploymentCleanupJob();
}

export default app;
