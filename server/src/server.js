import './config/env.js';

import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { requestId } from './middleware/request-id.middleware.js';
import { responseHelper } from './middleware/response.middleware.js';
import { requireFeature, featureFlagsHandler } from './middleware/featureFlag.js';
import { securityContext } from './middleware/securityContext.middleware.js';
import { slowRequestWarning } from './middleware/slowRequestWarning.middleware.js';
import { threatTag } from './middleware/threatTag.middleware.js';

import frontPageRoutes from './routes/frontPage.routes.js';
import publicRoutes from './routes/public.routes.js';
import authRoutes from './routes/auth.routes.js';
import workspaceRoutes from './routes/workspace.routes.js';
import workspaceDetailRoutes from './routes/workspace-detail.routes.js';
import projectRoutes from './routes/project.routes.js';
import domainPublicRoutes from './routes/domain-public.routes.js';
import domainRoutes from './routes/domain.routes.js';
import customerDomainRoutes from './routes/customer-domains.routes.js';
import siteRoutes from './routes/site.routes.js';
import publicSalesRoutes from './routes/public-sales.routes.js';
import commerceRoutes from './routes/commerce.routes.js';
import templateRoutes from './routes/template.routes.js';
import templateAiRoutes from './routes/template-ai.routes.js';
import builderRoutes from './routes/builder.routes.js';
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
import cloudStorageRoutes from './routes/cloudStorage.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import adminRoutes from './routes/admin.routes.js';
import {
  publicServiceRequestRouter,
  customerServiceRequestRouter,
} from './routes/service-requests.routes.js';
import { customerTicketRouter } from './routes/tickets.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import emailRoutes from './routes/email.routes.js';
import glondiaMailRoutes from './routes/glondia-mail.routes.js';
import providerRenderRoutes from './glondia-engines/01-HOSTING-DEPLOY-ENGINE/01-ROUTES/providerRender.routes.js';
import sandboxRoutes from './glondia-engines/01-HOSTING-DEPLOY-ENGINE/01-ROUTES/sandbox.routes.js';
import sandboxSimulationRoutes from './routes/sandbox-simulation.routes.js';
import deploymentStreamRoutes from './glondia-engines/01-HOSTING-DEPLOY-ENGINE/01-ROUTES/deploymentStream.routes.js';
import paymentsProviderRoutes from './routes/payments-provider.routes.js';
import spaceshipRoutes from './routes/provider-spaceship.routes.js';
import { providerApiGuard } from './glondia-engines/01-HOSTING-DEPLOY-ENGINE/services/providerApiGuard.service.js';
import { verifyPaypalWebhook, handlePaypalWebhookEvent } from './services/paypalWebhookService.js';
import { startEmailSyncScheduler } from './services/emailSyncService.js';
import { startDomainSyncScheduler } from './services/customerDomainService.js';
import { startBillingReconciliationScheduler } from './services/billingLifecycleService.js';
import { seedVpsCatalog, startVpsCatalogScheduler } from './services/vpsCatalogService.js';
import { startVpsServiceSyncScheduler } from './services/vpsHostingService.js';
import hostingService from './services/hostingService.js';
import {
  seedCloudStorageCatalog,
  startCloudStorageCatalogScheduler,
} from './services/cloudStorageCatalogService.js';
import {
  prisma,
  ensureUserColumns,
  ensureNotificationsTable,
  ensureClientProjectsTable,
  ensureDeploymentSubscriptionsTable,
  ensurePaymentMethodsTable,
  ensureBillingLedgerTable,
  ensureBillingEvidenceTables,
  ensureServiceRequestsTable,
  ensureCrmEmailTables,
  ensureEmailMailboxTables,
  ensureBuilderLifecycleTables,
  ensureProviderResourcesTable,
  ensureHostingEnvVarsTable,
  ensureHostingHeadersTable,
  ensureHostingDisksTable,
  ensureHostingMetricsTables,
  ensureVpsTenancyBackfill,
  ensureVpsCatalogSnapshotsTable,
  ensureDomainServiceSnapshotsTable,
  ensureDomainAddonServicesTable,
  ensureTicketColumns,
} from './services/db.js';
import { auditWrites } from './middleware/audit.middleware.js';
import renderApiService from './services/renderApiService.js';
import { mutateHostingStore, nowIso, readHostingStore } from './services/hostingStore.js';
import { readinessSnapshot } from './builder/builderReadiness.service.js';
import { durableJobsEnabled } from './builder/builderFlags.js';
import { createBuilderWorker } from './builder/jobs/builderWorker.js';
import builderPreviewRoutes from './builder/preview/previewRoutes.js';

const app = express();
const httpServer = createHttpServer(app);
const isProd = process.env.NODE_ENV === 'production';
// One process, one port: API + frontend always share this PORT.
// Render injects PORT in production. Local default is 3001.
const PORT = Number(process.env.PORT || (isProd ? 10000 : 3001));

// ── Static file serving ─────────────────────────────────────────────────────
const rootDir = resolve(process.cwd());
const distDir = join(rootDir, 'dist');
const dataDir = resolveDataDir();

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

app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Vite's development middleware injects an inline React Refresh
      // bootstrap. Allow it only locally; production remains self-only.
      scriptSrc: ["'self'", ...(isProd ? [] : ["'unsafe-inline'", "'unsafe-eval'"])],
      connectSrc: ["'self'", 'https:', ...(isProd ? [] : ['ws:', 'wss:'])],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));
app.use(cors({ origin: corsOrigins, credentials: true }));

// ── PayPal webhook ───────────────────────────────────────────────────────────
// MUST be registered before express.json(): PayPal signature verification needs
// the exact raw request body. Configured webhook URL:
//   POST /api/v1/payments/paypal/webhook
app.post('/api/v1/payments/paypal/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const verification = await verifyPaypalWebhook({ headers: req.headers, rawBody: req.body });
    if (!verification.ok) {
      console.error('[paypal:webhook] verification failed:', verification.reason || verification.status);
      // 400 → PayPal will retry; we do NOT act on unverified events.
      return res.status(400).json({ received: true, verified: false });
    }
    const result = await handlePaypalWebhookEvent(verification.event);
    console.log('[paypal:webhook]', verification.event?.event_type, JSON.stringify(result));
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[paypal:webhook] error:', err.message);
    // 500 → PayPal retries with backoff (covers transient DB/network errors).
    return res.status(500).json({ received: false });
  }
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(requestId);
app.use(securityContext);
app.use(slowRequestWarning);
app.use(threatTag);
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

// Readiness: database + Builder tables + (when enabled) worker heartbeat and
// preview configuration. Load balancers and the staged Builder cutover use
// this to keep traffic away from an instance that would accept dead jobs.
app.get('/readyz', async (req, res) => {
  try {
    const snapshot = await readinessSnapshot();
    res.status(snapshot.ready ? 200 : 503).json(snapshot);
  } catch (err) {
    res.status(503).json({ ready: false, error: err.message });
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
app.use('/api/payments/domain', requireFeature('DOMAINS'));

// Provider routes: Render deploy/settings/import-github + Spaceship domain registrar
app.use('/api', providerRenderRoutes);
// Generic frontend-facing registrar API (provider-agnostic path).
// Spaceship is the current implementation; swap the handler later without changing the client.
app.use('/api/registrar', requireFeature('DOMAINS'), spaceshipRoutes);
// Provider-specific alias kept for admin/tools and backwards compatibility.
app.use('/api/spaceship', requireFeature('DOMAINS'), spaceshipRoutes);

// ── Provider payment routes (PayPal client, domain+hosting checkout) ──────────
app.use('/api/payments', paymentsProviderRoutes);
app.use('/api/domains', requireFeature('DOMAINS'), customerDomainRoutes);

// Sandbox preview routes (must come before SPA fallback)
app.use('/sandbox', sandboxRoutes);

// Canonical isolated Builder preview. Unauthenticated by design — access is
// controlled by hashed, expiring database grants. In production this path is
// reached via the dedicated preview origin (BUILDER_PREVIEW_ORIGIN), never
// the authenticated dashboard origin.
app.use('/p', builderPreviewRoutes);

// ── API routes ───────────────────────────────────────────────────────────────

// Public (unauthenticated)
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/public/sites', publicSalesRoutes);
// Service Requests intake (public — not tickets)
app.use('/api/public/service-requests', publicServiceRequestRouter);
app.use('/api/v1/public/service-requests', publicServiceRequestRouter);
app.use('/api/v1/domains', requireFeature('DOMAINS'), domainPublicRoutes);
// Template catalog is part of the Site Builder surface. TEMPLATE_MARKETPLACE
// remains reserved for the future paid template store.
app.use('/api/v1/templates', requireFeature('SITE_BUILDER'), templateRoutes);
app.use('/api/v1/builder', requireFeature('SITE_BUILDER'), builderRoutes);
app.use('/api/template-ai', templateAiRoutes);
app.use('/api/v1/events', eventsRoutes);
app.use('/api/v1/sandbox', sandboxSimulationRoutes);
app.use('/api/sandbox', sandboxSimulationRoutes);

// Auth
app.use('/api/v1/auth', authRoutes);

// Workspace (authenticated)
app.use('/api/v1/workspaces', workspaceRoutes);
app.use('/api/v1/workspaces/:workspaceId', workspaceDetailRoutes);
app.use('/api/v1/workspaces/:workspaceId/projects', projectRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/v1/workspaces/:workspaceId/domains', requireFeature('DOMAINS'), domainRoutes);
app.use('/api/v1/workspaces/:workspaceId/sites', siteRoutes);
app.use('/api/v1/workspaces/:workspaceId/commerce', commerceRoutes);
app.use('/api/v1/workspaces/:workspaceId/analytics', requireFeature('ANALYTICS'), analyticsRoutes);
app.use('/api/v1/workspaces/:workspaceId/billing', billingRoutes);
app.use('/api/v1/workspaces/:workspaceId/settings', requireFeature('SETTINGS'), settingsRoutes);
app.use('/api/v1/workspaces/:workspaceId/events', eventStreamRoutes);

// VPS Services — Vultr-backed virtual servers.
app.use('/api/v1/vps-hosting', requireFeature('VPS'), vpsHostingRoutes);
app.use('/api/cloud-storage', cloudStorageRoutes);

// Render-powered customer hosting surface used by the site builder and hosting dashboard.
// deploymentStreamRoutes must come first so the SSE path is matched before the REST routes.
app.use('/api/deployments', deploymentStreamRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/hosting', hostingRoutes);
app.use('/api/hosting', environmentRoutes);
app.use('/api/hosting', diskRoutes);
app.use('/api/hosting', requireFeature('DOMAINS'), domainHostingRoutes);

// Deploy-first tiered billing: customer payments + receipts, and the admin surface.
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/v1/tickets', customerTicketRouter);
app.use('/api/v1/service-requests', customerServiceRequestRouter);
// Dashboard Business Email — setup, DNS, mailbox requests (not webmail reading).
app.use('/api/v1/email', requireFeature('EMAIL'), emailRoutes);
// GlondiaMail — separate webmail (login / folders / messages / send).
app.use('/api/v1/glondia-mail', requireFeature('GLONDIA_MAIL'), glondiaMailRoutes);
// User-facing notifications (Bell dropdown) — mounted on both API prefixes.
app.use('/api/notifications', notificationRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// ── Admin dashboard — served from admin-dashboard/frontend/ ──────────────────
const adminDashDir = join(rootDir, 'admin-dashboard', 'frontend');
if (existsSync(adminDashDir)) {
  // Static assets: /dashboard-assets/* → admin-dashboard/frontend/*
  app.use('/dashboard-assets', express.static(adminDashDir, {
    index: false,
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  // Admin shell. Keep /dashboard as a backwards-compatible alias while using
  // /admin as the discoverable entry point from the signed-in application.
  app.get(['/admin', '/admin/*', '/dashboard', '/dashboard/*'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(join(adminDashDir, 'index.html')).pipe(res);
  });
}

// ── Frontend (same process + same port as the API) ───────────────────────────
// Production / start: serve prebuilt dist/
// Local npm run dev: optional Vite middleware for HMR (still ONE server, ONE port)
let frontendMode = 'dist';

async function attachFrontend() {
  const wantViteDev =
    !isProd
    && process.env.NODE_ENV !== 'test'
    && String(process.env.GLONDIA_VITE_MIDDLEWARE || 'true').toLowerCase() !== 'false';

  if (wantViteDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        configFile: join(rootDir, 'vite.config.js'),
        server: {
          middlewareMode: true,
          hmr: { server: httpServer },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      frontendMode = 'vite-middleware';
      return;
    } catch (err) {
      console.warn('[glondia] Vite middleware unavailable; using dist/.', err.message);
    }
  }

  app.use((req, res) => serveStatic(req, res));
  frontendMode = 'dist';
}

// Payment business logic → server/src/services/payments-provider.service.js
// SSE stream logic → server/src/glondia-engines/01-HOSTING-DEPLOY-ENGINE/services/deploymentStream.service.js

function attachErrorHandler() {
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = isProd && !err.expose ? 'An unexpected error occurred.' : (err.message || String(err));
    console.error(`[error] ${req.method} ${req.url} →`, err.message || err);
    const body = {
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message },
      requestId: req.id,
    };
    if (err.stage) body.stage = err.stage;
    if (err.details && err.expose) body.details = err.details;
    res.status(status).json(body);
  });
}

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
        if (['not_billable_yet', 'billing_pending', 'billing_error'].includes(String(dep.paymentStatus || '').toLowerCase())) continue;
        if (['not_started', 'trial_pending'].includes(String(dep.subscriptionStatus || '').toLowerCase())) continue;
        if (!dep.checkoutOrderId) continue;
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

// ── Builder durable worker ────────────────────────────────────────────────────
// Starts only after DB bootstrap succeeds; a job never runs against missing
// tables. Set BUILDER_WORKER_ENABLED=false to run an API-only instance.
let builderWorker = null;
let emailSyncScheduler = null;
let domainSyncScheduler = null;
let billingReconciliationScheduler = null;
let vpsCatalogScheduler = null;
let vpsServiceSyncScheduler = null;
let cloudStorageCatalogScheduler = null;
let hostingProviderSyncTimer = null;

async function startBuilderWorkerIfEnabled() {
  const enabled = durableJobsEnabled()
    && String(process.env.BUILDER_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) return;
  builderWorker = createBuilderWorker();
  await builderWorker.start();
}

function attachGracefulShutdown() {
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[glondia] ${signal} received; shutting down gracefully.`);
    try {
      if (builderWorker) await builderWorker.stop();
    } catch (err) {
      console.error('[glondia] Worker shutdown error:', err.message);
    }
    if (emailSyncScheduler) clearInterval(emailSyncScheduler);
    if (domainSyncScheduler) clearInterval(domainSyncScheduler);
    if (billingReconciliationScheduler) clearInterval(billingReconciliationScheduler);
    vpsCatalogScheduler?.close();
    vpsServiceSyncScheduler?.close();
    cloudStorageCatalogScheduler?.close();
    if (hostingProviderSyncTimer) clearInterval(hostingProviderSyncTimer);
    try { await prisma.$disconnect(); } catch { /* already gone */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function boot() {
  await attachFrontend();
  attachErrorHandler();

  if (process.env.NODE_ENV === 'test') return;

  await prisma.$connect();
  console.log('[glondia] Database connection established.');
  await ensureUserColumns();
  await ensureNotificationsTable();
  await ensureClientProjectsTable();
  await ensureDeploymentSubscriptionsTable();
  await ensurePaymentMethodsTable();
  await ensureBillingLedgerTable();
  await ensureBillingEvidenceTables();
  await ensureServiceRequestsTable();
  await ensureCrmEmailTables();
  await ensureEmailMailboxTables();
  await ensureBuilderLifecycleTables();
  await ensureProviderResourcesTable();
  await ensureHostingEnvVarsTable();
  await ensureHostingHeadersTable();
  await ensureHostingDisksTable();
  await ensureHostingMetricsTables();
  await ensureVpsTenancyBackfill();
  await ensureVpsCatalogSnapshotsTable();
  await seedVpsCatalog();
  await seedCloudStorageCatalog();
  await ensureDomainServiceSnapshotsTable();
  await ensureDomainAddonServicesTable();
  await ensureTicketColumns();
  await startBuilderWorkerIfEnabled();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[glondia] Single server listening on http://localhost:${PORT}`);
    if (frontendMode === 'vite-middleware') {
      console.log('[glondia] Frontend: Vite middleware (HMR) on the SAME port as the API');
    } else {
      console.log(`[glondia] Frontend: static dist from ${distDir}`);
    }
    console.log(`[glondia] Open: http://localhost:${PORT}`);
    console.log(`[glondia] Mailboxes: http://localhost:${PORT}/mailboxes`);
    console.log(`[glondia] DATABASE_URL: ${(process.env.DATABASE_URL || '(not set)').replace(/:[^:@]+@/, ':***@')}`);

    emailSyncScheduler = startEmailSyncScheduler();
    console.log('[email-sync] Database-backed DNS synchronization enabled.');
    domainSyncScheduler = startDomainSyncScheduler();
    console.log('[domain-sync] Database-backed domain synchronization enabled.');
    billingReconciliationScheduler = startBillingReconciliationScheduler();
    console.log('[billing] Invoice and payment reconciliation enabled.');
    vpsCatalogScheduler = startVpsCatalogScheduler();
    vpsServiceSyncScheduler = startVpsServiceSyncScheduler();
    console.log('[vps-sync] Database-backed catalog and service synchronization enabled.');
    cloudStorageCatalogScheduler = startCloudStorageCatalogScheduler();
    console.log('[cloud-storage] Database-backed catalog synchronization enabled.');
    const hostingSyncIntervalMs = Math.max(60_000, Number(process.env.HOSTING_PROVIDER_SYNC_INTERVAL_MS || 5 * 60 * 1000));
    hostingProviderSyncTimer = setInterval(() => {
      hostingService.syncManagedRenderDeployments().catch((error) => {
        console.warn('[hosting-sync] Scheduled provider sync failed:', error.message);
      });
    }, hostingSyncIntervalMs);
    hostingProviderSyncTimer.unref?.();
    console.log('[hosting-sync] Database-backed Render synchronization enabled.');
  });

  attachGracefulShutdown();
}

boot().catch((err) => {
  console.error('[glondia] Failed to start server:', err);
  process.exit(1);
});

export default app;
