/**
 * admin.routes.js — simple admin surface for deploy-first billing.
 * All routes require an authenticated admin (role === 'admin').
 */
import express from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requirePermission } from '../middleware/requirePermission.middleware.js';
import { requireRecentMfa } from '../middleware/requireRecentMfa.middleware.js';
import adminService from '../services/adminService.js';
import * as adminCustomerCtrl from '../controllers/adminCustomerController.js';
import * as hostingRepairCtrl from '../controllers/adminHostingRepairController.js';
import * as controlPlaneCtrl from '../controllers/adminControlPlane.controller.js';
import { adminTicketRouter } from './tickets.routes.js';
import { adminServiceRequestRouter } from './service-requests.routes.js';
import crmContactsRouter from './crm-contacts.routes.js';
import {
  listServiceAccess, getServiceAccess,
  adminUpdateServiceAccess, adminSuspendServiceAccess, adminReactivateServiceAccess,
} from '../services/serviceAccessService.js';
import * as adminDashboardRepo from '../repositories/adminDashboard.repository.js';
import {
  getReceiptMeta,
  streamReceipt,
  streamUserIdPhoto,
  streamUserAvatar,
  ID_PHOTOS_ROOT,
} from '../services/adminReceiptService.js';

const router = express.Router();

router.use(authMiddleware, requireAdmin);

// Canonical database-backed read models for the six related admin pages.
router.get('/control-plane/:section(clients|hosting|vps|cloud-storage|domains|email|security)', controlPlaneCtrl.getSection);

// ── ID photo upload (admin) ───────────────────────────────────────────────────
const ID_PHOTO_MAX_BYTES = Number(process.env.ID_PHOTO_MAX_BYTES || 5 * 1024 * 1024);
const ID_PHOTO_EXT = new Set(['.png', '.jpg', '.jpeg']);

function safeSegment(value, fallback) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || fallback;
}

const idPhotoStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = join(ID_PHOTOS_ROOT, safeSegment(req.params?.userId, 'unknown'));
    try { mkdirSync(dir, { recursive: true }); cb(null, dir); } catch (err) { cb(err); }
  },
  filename(_req, file, cb) {
    const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `id-photo-${Date.now()}${ext}`);
  },
});

const idPhotoUpload = multer({
  storage: idPhotoStorage,
  limits: { fileSize: ID_PHOTO_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (ID_PHOTO_EXT.has(ext) && (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime.startsWith('image/'))) {
      return cb(null, true);
    }
    const err = new Error('Only PNG, JPG or JPEG ID photos are accepted.');
    err.status = 400; err.code = 'ID_PHOTO_INVALID_TYPE'; err.expose = true;
    return cb(err);
  },
});

// ── Overview + lists ──────────────────────────────────────────────────────────
router.get('/overview', async (req, res, next) => {
  try { res.json({ data: await adminService.getOverview(), requestId: req.id }); } catch (e) { next(e); }
});

// Activity log (audit_logs table, newest first, paginated)
router.get('/activity', async (req, res, next) => {
  try {
    const { limit, offset, action, userId } = req.query;
    res.json({ data: await adminService.getActivity({ limit, offset, action, userId }), requestId: req.id });
  } catch (e) { next(e); }
});

// Config status — which integrations are wired up (no secret values)
router.get('/config-status', async (req, res, next) => {
  try { res.json({ data: adminService.getConfigStatus(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/users', async (req, res, next) => {
  try { res.json({ data: await adminService.listUsers(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/deployments', async (req, res, next) => {
  try { res.json({ data: await adminService.listDeployments(null), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/vps-services', async (req, res, next) => {
  try { res.json({ data: await adminService.listVpsServices(null), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/orders', async (req, res, next) => {
  try { res.json({ data: await adminService.listOrders(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/receipts', async (req, res, next) => {
  try { res.json({ data: await adminService.listReceipts(), requestId: req.id }); } catch (e) { next(e); }
});

// ── Receipt preview/download (safe: ID lookup → path/ext validation → stream) ──
router.get('/receipts/:receiptId', async (req, res, next) => {
  try { res.json({ data: await getReceiptMeta(req.params.receiptId), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/receipts/:receiptId/view', async (req, res, next) => {
  try {
    await streamReceipt({ receiptId: req.params.receiptId, disposition: 'inline', res, adminUserId: req.user.id });
  } catch (e) { next(e); }
});

router.get('/receipts/:receiptId/download', async (req, res, next) => {
  try {
    await streamReceipt({ receiptId: req.params.receiptId, disposition: 'attachment', res, adminUserId: req.user.id });
  } catch (e) { next(e); }
});

router.post('/receipts/:receiptId/approve',
  requirePermission('billing:approve'),
  async (req, res, next) => {
    try { res.json({ data: await adminService.approveReceipt(req.params.receiptId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/receipts/:receiptId/reject',
  requirePermission('billing:reject'),
  async (req, res, next) => {
    try { res.json({ data: await adminService.rejectReceipt(req.params.receiptId, req.user.id, req.body?.note), requestId: req.id }); } catch (e) { next(e); }
  });

// ── Customer oversight (unified detail; ServiceAccess is the service index) ──
// Layered: route → adminCustomerController → adminCustomerOversightService →
// repositories → shared db.js. Old endpoints below are preserved unchanged.
router.get('/customers/:userId/overview',   adminCustomerCtrl.getOverview);
router.get('/customers/:userId/services',   adminCustomerCtrl.getServices);
router.get('/customers/:userId/billing',    adminCustomerCtrl.getBilling);
router.get('/customers/:userId/support',    adminCustomerCtrl.getSupport);
router.get('/customers/:userId/operations', adminCustomerCtrl.getOperations);
router.get('/customers/:userId/activity',   adminCustomerCtrl.getActivity);

// ── User detail + account lifecycle ───────────────────────────────────────────
router.get('/users/:userId', async (req, res, next) => {
  try { res.json({ data: await adminService.getUserDetail(req.params.userId), requestId: req.id }); } catch (e) { next(e); }
});

router.patch('/users/:userId', async (req, res, next) => {
  try { res.json({ data: await adminService.updateUser(req.params.userId, req.body || {}, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

// Suspend = temporary account hold (reversible); cascades a suspend to sites.
router.post('/users/:userId/suspend',
  requirePermission('users:suspend'),
  requireRecentMfa(),
  async (req, res, next) => {
    try { res.json({ data: await adminService.suspendUser(req.params.userId, req.body?.reason, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/users/:userId/disable',
  requirePermission('users:suspend'),
  requireRecentMfa(),
  async (req, res, next) => {
    try { res.json({ data: await adminService.disableUser(req.params.userId, req.body?.reason, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/users/:userId/reactivate',
  requirePermission('users:reactivate'),
  async (req, res, next) => {
    try {
      res.json({
        data: await adminService.reactivateUser(req.params.userId, req.user.id, {
          resumeDeployments: req.body?.resumeDeployments === true || req.body?.resumeDeployments === 'true',
        }),
        requestId: req.id,
      });
    } catch (e) { next(e); }
  });

router.post('/users/:userId/delete',
  requirePermission('users:delete'),
  requireRecentMfa(),
  async (req, res, next) => {
    try { res.json({ data: await adminService.deleteUser(req.params.userId, req.body?.reason, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

// ── ID photo upload + inline view (admin) ─────────────────────────────────────
router.post('/users/:userId/id-photo', idPhotoUpload.single('idPhoto'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'ID_PHOTO_REQUIRED', message: 'An ID photo file is required.' }, requestId: req.id });
    }
    const data = await adminService.setUserIdPhotoPath(req.params.userId, req.file.path, req.user.id);
    res.status(201).json({ data, requestId: req.id });
  } catch (e) { next(e); }
});

router.get('/users/:userId/id-photo', async (req, res, next) => {
  try {
    await streamUserIdPhoto({ userId: req.params.userId, res, adminUserId: req.user.id });
  } catch (e) { next(e); }
});

// Admin view of any user's profile avatar (authenticated + admin-gated).
router.get('/users/:userId/avatar', async (req, res, next) => {
  try {
    await streamUserAvatar({ userId: req.params.userId, res, viewerUserId: req.user.id });
  } catch (e) { next(e); }
});

// ── Deployment lifecycle ──────────────────────────────────────────────────────
router.post('/deployments/:deploymentId/mark-paid',
  requirePermission('billing:approve'),
  async (req, res, next) => {
    try { res.json({ data: await adminService.adminMarkDeploymentPaid(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/deployments/:deploymentId/delete',
  requirePermission('services:manage'),
  requireRecentMfa(),
  async (req, res, next) => {
    try { res.json({ data: await adminService.adminDeleteDeployment(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/deployments/:deploymentId/suspend',
  requirePermission('services:suspend'),
  async (req, res, next) => {
    try { res.json({ data: await adminService.suspendDeployment(req.params.deploymentId, req.user.id, req.body?.reason), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/deployments/:deploymentId/reactivate',
  requirePermission('services:manage'),
  async (req, res, next) => {
    try { res.json({ data: await adminService.reactivateDeployment(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
  });

router.post('/deployments/:deploymentId/approve-billing', async (req, res, next) => {
  try { res.json({ data: await adminService.approveDeploymentBilling(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

router.post('/deployments/:deploymentId/renew-manually', async (req, res, next) => {
  try { res.json({ data: await adminService.adminRenewDeploymentManually(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

// ── Order delete ─────────────────────────────────────────────────────────────
router.post('/orders/:orderId/delete', async (req, res, next) => {
  try { res.json({ data: await adminService.deleteOrder(req.params.orderId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

// Manual Render plan override: { plan: 'free'|'starter'|'standard', redeploy: bool }
router.post('/deployments/:deploymentId/render-plan', async (req, res, next) => {
  try {
    res.json({
      data: await adminService.setDeploymentRenderPlan(req.params.deploymentId, req.body?.plan, {
        redeploy: req.body?.redeploy === true || req.body?.redeploy === 'true',
        adminUserId: req.user.id,
      }),
      requestId: req.id,
    });
  } catch (e) { next(e); }
});

// ── Tickets ───────────────────────────────────────────────────────────────────
router.post('/repairs/hosting/audit',
  requirePermission('services:manage'),
  hostingRepairCtrl.auditHosting);

router.post('/repairs/hosting/run',
  requirePermission('services:manage'),
  requireRecentMfa(),
  hostingRepairCtrl.runHostingRepair);

router.post('/services/hosting/:serviceId/repair',
  requirePermission('services:manage'),
  requireRecentMfa(),
  hostingRepairCtrl.repairHostingService);

router.use('/tickets', adminTicketRouter);

// CRM Service Requests (intake/consultation — not support tickets)
router.use('/crm/service-requests', adminServiceRequestRouter);

// CRM contact emails (client accounts + captured contacts)
router.use('/crm', crmContactsRouter);

// ── ServiceAccess management ──────────────────────────────────────────────────
router.get('/service-access', async (req, res, next) => {
  try {
    res.json({ data: await listServiceAccess(req.query), requestId: req.id });
  } catch (e) { next(e); }
});

router.get('/service-access/:id', async (req, res, next) => {
  try {
    res.json({ data: await getServiceAccess(req.params.id), requestId: req.id });
  } catch (e) { next(e); }
});

router.patch('/service-access/:id',
  requirePermission('services:manage'),
  async (req, res, next) => {
    try {
      res.json({ data: await adminUpdateServiceAccess(req.params.id, req.user.id, req.body), requestId: req.id });
    } catch (e) { next(e); }
  });

router.post('/service-access/:id/suspend',
  requirePermission('services:suspend'),
  requireRecentMfa(),
  async (req, res, next) => {
    try {
      res.json({ data: await adminSuspendServiceAccess(req.params.id, req.user.id, req.body?.reason), requestId: req.id });
    } catch (e) { next(e); }
  });

router.post('/service-access/:id/reactivate',
  requirePermission('services:manage'),
  async (req, res, next) => {
    try {
      res.json({ data: await adminReactivateServiceAccess(req.params.id, req.user.id), requestId: req.id });
    } catch (e) { next(e); }
  });

// ── DashboardWarnings ─────────────────────────────────────────────────────────
// Schema fields: warningType, status (open|dismissed|escalated), count,
//   dismissedByAdmin, dismissedAt, escalatedToEvent
router.get('/warnings', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, status, warningType } = req.query;
    res.json({ data: await adminDashboardRepo.listDashboardWarnings({ limit, offset, status, warningType }), requestId: req.id });
  } catch (e) { next(e); }
});

router.post('/warnings/:id/dismiss', async (req, res, next) => {
  try {
    const updated = await adminDashboardRepo.dismissDashboardWarning(req.params.id, req.user.id);
    res.json({ data: updated, requestId: req.id });
  } catch (e) { next(e); }
});

router.post('/warnings/:id/escalate', async (req, res, next) => {
  try {
    const warning = await adminDashboardRepo.findDashboardWarning(req.params.id);
    if (!warning) return res.status(404).json({ error: { message: 'Warning not found.' }, requestId: req.id });

    const watchdog = await adminDashboardRepo.createWatchdogEvent({
      eventType: warning.warningType,
      severity: 'high',
      message: `Escalated from DashboardWarning: ${warning.warningType}`,
      metadata: JSON.stringify({ warningId: warning.id, escalatedBy: req.user.id, note: req.body?.note }),
    });

    const updated = await adminDashboardRepo.updateDashboardWarning(req.params.id, { status: 'escalated', escalatedToEvent: watchdog.id });

    res.json({ data: updated, requestId: req.id });
  } catch (e) { next(e); }
});

// ── WatchdogEvents ────────────────────────────────────────────────────────────
// Schema fields: eventType, severity, status (open|reviewed|dismissed|escalated),
//   message, reviewedByAdminId, reviewedAt
router.get('/watchdog', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, status, severity } = req.query;
    res.json({ data: await adminDashboardRepo.listWatchdogEvents({ limit, offset, status, severity }), requestId: req.id });
  } catch (e) { next(e); }
});

router.post('/watchdog/:id/review',
  requirePermission('watchdog:review'),
  async (req, res, next) => {
    try {
      const updated = await adminDashboardRepo.updateWatchdogEvent(req.params.id, { status: 'reviewed', reviewedByAdminId: req.user.id, reviewedAt: new Date() });
      res.json({ data: updated, requestId: req.id });
    } catch (e) { next(e); }
  });

router.post('/watchdog/:id/dismiss',
  requirePermission('watchdog:dismiss'),
  async (req, res, next) => {
    try {
      const updated = await adminDashboardRepo.updateWatchdogEvent(req.params.id, { status: 'dismissed', reviewedByAdminId: req.user.id, reviewedAt: new Date() });
      res.json({ data: updated, requestId: req.id });
    } catch (e) { next(e); }
  });

// ── AdminCommands (audit trail, read-only) ────────────────────────────────────
// Schema fields: adminUserId, commandType, beforeState, afterState, reason, metadata
router.get('/commands', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, adminUserId, commandType } = req.query;
    res.json({ data: await adminDashboardRepo.listAdminCommands({ limit, offset, adminUserId, commandType }), requestId: req.id });
  } catch (e) { next(e); }
});

// ── AdminPolicies ─────────────────────────────────────────────────────────────
// Schema fields: policyKey (unique), category, enabled, valueJson, description
router.get('/policies', async (req, res, next) => {
  try {
    res.json({ data: await adminDashboardRepo.listAdminPolicies(), requestId: req.id });
  } catch (e) { next(e); }
});

router.get('/policies/:key', async (req, res, next) => {
  try {
    const policy = await adminDashboardRepo.findAdminPolicy(req.params.key);
    if (!policy) return res.status(404).json({ error: { message: 'Policy not found.' }, requestId: req.id });
    res.json({ data: policy, requestId: req.id });
  } catch (e) { next(e); }
});

router.put('/policies/:key', async (req, res, next) => {
  try {
    const { valueJson, category, description, enabled } = req.body;
    if (!valueJson) return res.status(400).json({ error: { message: 'valueJson is required.' }, requestId: req.id });

    const policy = await adminDashboardRepo.upsertAdminPolicy(req.params.key, {
      valueJson,
      category,
      description,
      enabled,
      adminUserId: req.user.id,
    });

    res.json({ data: policy, requestId: req.id });
  } catch (e) { next(e); }
});

export default router;
