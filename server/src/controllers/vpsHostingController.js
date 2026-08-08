import * as catalog from '../services/vpsCatalogService.js';
import * as pricing from '../services/vpsPricingService.js';
import * as paypal from '../services/paypalBillingService.js';
import * as svc from '../services/vpsHostingService.js';

/**
 * Build the acting identity from the verified `req.user` set by authMiddleware.
 * Every route that calls this sits behind authMiddleware, so an unset user
 * means a wiring bug — reject rather than fall back to a shared tenant.
 * Tokens carry no organizationId, so each user is their own tenant; the
 * dev-fallback 'local-user' keeps its historical 'local-org' bucket.
 */
function extractActor(req) {
  const user = req.user;
  if (!user?.id) {
    throw Object.assign(new Error('Authentication required.'), { status: 401 });
  }
  const organizationId = user.organizationId
    || (user.id === 'local-user' ? 'local-org' : user.id);
  return {
    userId: user.id,
    organizationId,
    role: user.role || 'owner',
    isAdmin: user.role === 'admin',
  };
}

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); } catch (err) {
      res.status(err.status || 500).json({ error: { message: err.message } });
    }
  };
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export const getSettings = (req, res) => res.json(svc.getSettings());

export const listRegions = wrap(async (req, res) =>
  res.json(await catalog.listCachedRegions()));

export const listPlans = wrap(async (req, res) => {
  const plans = await catalog.listCachedPlans(req.query.type, {
    region: req.query.region,
    curated: String(req.query.curated || '').toLowerCase() === 'true',
  });
  res.json(plans);
});

export const listOs = wrap(async (req, res) =>
  res.json(await catalog.listCachedOperatingSystems()));

export const quote = wrap(async (req, res) => {
  const { region, plan, osId } = req.body || {};
  res.json(await pricing.getQuote(plan, region, osId));
});

// ─── Direct deploy ────────────────────────────────────────────────────────────

export const createService = wrap(async (req, res) => {
  const actor = extractActor(req);
  const record = await svc.createDirect(req.body || {}, actor);
  res.status(201).json(record);
});

// ─── PayPal ───────────────────────────────────────────────────────────────────

export const createPaypalOrder = wrap(async (req, res) => {
  const { userId, organizationId } = extractActor(req);
  const result = await paypal.createOrder(organizationId, userId, req.body || {});
  res.status(201).json(result);
});

export const capturePaypalOrder = wrap(async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: { message: 'orderId is required.' } });
  const actor = extractActor(req);
  const record = await svc.captureAndProvision(orderId, actor);
  res.status(201).json(record);
});

// ─── Service management ───────────────────────────────────────────────────────

export const listServices = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.listServices(organizationId));
});

export const getService = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.getService(req.params.id, organizationId));
});

export const getServiceSummary = wrap(async (req, res) => {
  res.json(await svc.getServiceSummary(req.params.id, extractActor(req)));
});

export const getServiceCredentials = wrap(async (req, res) => {
  res.json(await svc.getServiceCredentials(req.params.id, extractActor(req)));
});

export const updateServiceSettings = wrap(async (req, res) => {
  res.json(await svc.updateServiceSettings(req.params.id, extractActor(req), req.body));
});

export const startService = wrap(async (req, res) => {
  await svc.startService(req.params.id, extractActor(req));
  res.json({ ok: true });
});

export const haltService = wrap(async (req, res) => {
  await svc.haltService(req.params.id, extractActor(req));
  res.json({ ok: true });
});

export const rebootService = wrap(async (req, res) => {
  await svc.rebootService(req.params.id, extractActor(req));
  res.json({ ok: true });
});

export const destroyService = wrap(async (req, res) => {
  await svc.destroyService(req.params.id, extractActor(req));
  res.json({ ok: true });
});

// ─── SSH keys ─────────────────────────────────────────────────────────────────

export const listSshKeys = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.listSshKeys(organizationId));
});

export const createSshKey = wrap(async (req, res) => {
  res.status(201).json(await svc.createSshKey(extractActor(req), req.body));
});

export const deleteSshKey = wrap(async (req, res) => {
  await svc.deleteSshKey(req.params.keyId, extractActor(req));
  res.json({ ok: true });
});

// ─── Bandwidth ────────────────────────────────────────────────────────────────

export const getBandwidth = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.getBandwidth(req.params.id, organizationId));
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

export const listSnapshots = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.listSnapshots(organizationId));
});

export const listServiceSnapshots = wrap(async (req, res) => {
  res.json(await svc.listServiceSnapshots(req.params.id, extractActor(req)));
});

export const createSnapshot = wrap(async (req, res) => {
  res.status(201).json(await svc.createSnapshot(req.params.id, extractActor(req), req.body?.description));
});

export const deleteSnapshot = wrap(async (req, res) => {
  await svc.deleteSnapshot(req.params.snapshotId, extractActor(req));
  res.json({ ok: true });
});

export const restoreService = wrap(async (req, res) => {
  await svc.restoreService(req.params.id, extractActor(req), req.body?.snapshotId);
  res.json({ ok: true });
});

// ─── Backup schedule ──────────────────────────────────────────────────────────

export const getBackupSchedule = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.getBackupSchedule(req.params.id, organizationId));
});

export const setBackupSchedule = wrap(async (req, res) => {
  const { organizationId } = extractActor(req);
  res.json(await svc.setBackupSchedule(req.params.id, organizationId, req.body));
});

// ─── Resize / reinstall ───────────────────────────────────────────────────────

export const resizeService = wrap(async (req, res) => {
  await svc.resizeService(req.params.id, extractActor(req), req.body?.plan);
  res.json({ ok: true });
});

export const reinstallService = wrap(async (req, res) => {
  await svc.reinstallService(req.params.id, extractActor(req), req.body);
  res.json({ ok: true });
});
