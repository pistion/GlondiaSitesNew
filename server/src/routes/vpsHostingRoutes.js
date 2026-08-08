import express from 'express';
import * as ctrl from '../controllers/vpsHostingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireServiceAccess } from '../middleware/serviceAccess.middleware.js';
import { paymentLifecycleMiddleware } from '../middleware/billing.middleware.js';

const router = express.Router();

// Resolver: VPS serviceId comes from :id param
const vpsServiceId = (req) => req.params.id;

// ── Public catalog (no auth needed) ──────────────────────────────────────────
router.get('/settings',           ctrl.getSettings);
router.get('/regions',            ctrl.listRegions);
router.get('/plans',              ctrl.listPlans);
router.get('/os',                 ctrl.listOs);
router.post('/quote',             ctrl.quote);

// ── Service creation + payment (auth required but no access row yet) ─────────
router.post('/services',          authMiddleware, ctrl.createService);
router.post('/paypal/create-order', authMiddleware, ctrl.createPaypalOrder);
router.post(
  '/paypal/capture',
  authMiddleware,
  paymentLifecycleMiddleware({ provider: 'paypal', source: 'vps_paypal_capture' }),
  ctrl.capturePaypalOrder,
);

// ── Service list (auth, ownership enforced in controller) ─────────────────────
router.get('/services',               authMiddleware, ctrl.listServices);

// ── Individual service management — require active ServiceAccess ──────────────
router.get('/services/:id/summary',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.getServiceSummary);

// Read-only details: auth + access check
router.get('/services/:id',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.getService);

// Protected reveal: root credentials are never included in list/get payloads.
router.get('/services/:id/credentials',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.getServiceCredentials);

router.patch('/services/:id/settings',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.updateServiceSettings);

// Mutating actions: auth + access check
router.post('/services/:id/start',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.startService);

router.post('/services/:id/halt',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.haltService);

router.post('/services/:id/reboot',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.rebootService);

router.delete('/services/:id',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.destroyService);

// ── SSH keys (auth only — not tied to a single service ID) ────────────────────
router.get('/ssh-keys',               authMiddleware, ctrl.listSshKeys);
router.post('/ssh-keys',              authMiddleware, ctrl.createSshKey);
router.delete('/ssh-keys/:keyId',     authMiddleware, ctrl.deleteSshKey);

// ── Bandwidth / snapshots / backup / resize ───────────────────────────────────
router.get('/services/:id/bandwidth',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.getBandwidth);

router.get('/snapshots',              authMiddleware, ctrl.listSnapshots);

router.get('/services/:id/snapshots',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.listServiceSnapshots);

router.post('/services/:id/snapshots',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.createSnapshot);

router.delete('/snapshots/:snapshotId', authMiddleware, ctrl.deleteSnapshot);

router.post('/services/:id/restore',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.restoreService);

router.get('/services/:id/backup-schedule',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.getBackupSchedule);

router.post('/services/:id/backup-schedule',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.setBackupSchedule);

router.patch('/services/:id/resize',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.resizeService);

router.post('/services/:id/reinstall',
  authMiddleware,
  requireServiceAccess('vps', vpsServiceId),
  ctrl.reinstallService);

export default router;
