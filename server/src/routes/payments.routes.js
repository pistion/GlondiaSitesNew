/**
 * payments.routes.js — customer-facing deployment payment endpoints.
 *
 *   GET  /api/payments/orders/:orderId        → order + receipt status (owner only)
 *   POST /api/payments/manual-receipts         → upload a bank-transfer receipt
 *   POST /api/payments/paypal/orders           → create a PayPal order for a deployment
 *   POST /api/payments/paypal/orders/:id/capture → capture + mark paid
 *
 * Manual receipts are written to the Render persistent disk under
 * DATA_DIR/receipts/{userId}/{checkoutOrderId}/ and must be approved by an admin.
 */
import express from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import authMiddleware from '../middleware/authMiddleware.js';
import { prisma } from '../services/db.js';
import { writeAuditLog } from '../services/auditLogService.js';
import { updateDeploymentRecord } from '../glondia-engines/00-SHARED/deploymentRecordStore.js';
import { findDeploymentRecord, createDeploymentRenewalOrder } from '../services/deploymentBillingService.js';
import { readHostingStore } from '../services/hostingStore.js';
import { initialRenderPlan } from '../config/hostingLifecycle.js';
import { createUserNotification, createAdminNotification } from '../services/notificationService.js';
import {
  createDeploymentPaypalOrder,
  captureDeploymentPaypalOrder,
  payDeploymentWithSavedMethod,
} from '../services/deploymentPaypalService.js';
import {
  listPaymentMethodsForUser,
  setDefaultPaymentMethod,
  removePaymentMethod,
  createPaypalVaultSetup,
  completePaypalVaultSetup,
} from '../services/paymentMethodService.js';
import { paymentLifecycleMiddleware } from '../middleware/billing.middleware.js';

const router = express.Router();

const dataDir = resolve(process.env.DATA_DIR || join(process.cwd(), '.glondia-data'));
const RECEIPTS_ROOT = join(dataDir, 'receipts');
const MAX_RECEIPT_BYTES = Number(process.env.RECEIPT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'application/octet-stream',
]);

function safeSegment(value, fallback) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || fallback;
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const userSeg = safeSegment(req.user?.id, 'anonymous');
    const orderSeg = safeSegment(req.body?.checkoutOrderId || req.body?.orderId, 'unassigned');
    const dir = join(RECEIPTS_ROOT, userSeg, orderSeg);
    try {
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `receipt-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    if (ALLOWED_EXT.has(ext) && (ALLOWED_MIME.has(mime) || mime.startsWith('image/'))) {
      return cb(null, true);
    }
    const err = new Error('Only PDF, PNG, JPG or JPEG receipts are accepted.');
    err.status = 400;
    err.code = 'RECEIPT_INVALID_TYPE';
    err.expose = true;
    return cb(err);
  },
});

router.use(authMiddleware);

// ── Per-user billing summary (pricing + orders + deployments) ────────────────
router.get('/billing-summary', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'admin';
    const paymentMethods = await listPaymentMethodsForUser(userId);

    // Normal users see only their own orders/deployments; admins see all.
    const orderWhere = isAdmin
      ? { type: 'deployment' }
      : { type: 'deployment', userId: userId && userId !== 'local-user' ? userId : '__none__' };
    const orders = await prisma.checkoutOrder.findMany({
      where: orderWhere,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { receipts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    const store = await readHostingStore();
    const deployments = (store.deployments || [])
      .filter((d) => isAdmin || d.userId === userId)
      .map((d) => ({
        deploymentId: d.deploymentId,
        serviceName: d.serviceName || null,
        status: d.status || null,
        paymentStatus: d.paymentStatus || 'none',
        priceCents: d.priceCents ?? null,
        priceCurrency: d.priceCurrency || null,
        checkoutOrderId: d.checkoutOrderId || null,
        billingDueAt: d.billingDueAt || null,
        trialStartedAt: d.trialStartedAt || null,
        trialEndsAt: d.trialEndsAt || d.billingDueAt || null,
        paidAt: d.paidAt || null,
        renderPlan: d.renderPlan || null,
        liveUrl: d.liveUrl || null,
      }));

    res.json({
      data: {
        initialRenderPlan,
        orders,
        deployments,
        paymentMethods,
      },
      requestId: req.id,
    });
  } catch (error) { next(error); }
});

// ── Create a standard hosting renewal order ──────────────────────────────────
router.post('/deployments/:deploymentId/renew', async (req, res, next) => {
  try {
    const result = await createDeploymentRenewalOrder({
      deploymentId: req.params.deploymentId,
      user: req.user,
    });
    res.status(201).json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

// ── Order status (owner only) ────────────────────────────────────────────────
router.get('/orders/:orderId', async (req, res, next) => {
  try {
    const order = await prisma.checkoutOrder.findUnique({
      where: { id: req.params.orderId },
      include: { receipts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!order) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' }, requestId: req.id });
    if (req.user?.role !== 'admin' && order.userId && order.userId !== req.user?.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'This order belongs to another account.' }, requestId: req.id });
    }
    res.json({ data: order, requestId: req.id });
  } catch (error) { next(error); }
});

// ── Manual bank receipt upload ───────────────────────────────────────────────
router.post('/manual-receipts', upload.single('receipt'), async (req, res, next) => {
  try {
    const checkoutOrderId = req.body?.checkoutOrderId || req.body?.orderId;
    if (!checkoutOrderId) {
      return res.status(400).json({ success: false, error: { code: 'ORDER_REQUIRED', message: 'checkoutOrderId is required.' }, requestId: req.id });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'RECEIPT_REQUIRED', message: 'A receipt file is required.' }, requestId: req.id });
    }

    const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
    if (!order) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' }, requestId: req.id });
    }
    // Ownership: a user may only upload receipts against their own order.
    if (req.user?.role !== 'admin' && order.userId && order.userId !== req.user?.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'This order belongs to another account.' }, requestId: req.id });
    }

    const receipt = await prisma.paymentReceipt.create({
      data: {
        checkoutOrderId: order.id,
        userId: order.userId || (req.user?.id !== 'local-user' ? req.user?.id : null),
        deploymentId: order.deploymentId || null,
        method: 'bank_transfer',
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileType: req.file.mimetype || null,
        fileSize: req.file.size || 0,
        amountCents: order.totalAmountCents,
        currency: order.currency,
        status: 'pending',
        note: req.body?.note ? String(req.body.note).slice(0, 1000) : null,
      },
    });

    // Order → payment_uploaded; deployment → payment_uploaded.
    await prisma.checkoutOrder.update({ where: { id: order.id }, data: { status: 'payment_uploaded' } });
    if (order.deploymentId) {
      const deployment = await findDeploymentRecord(order.deploymentId);
      if (deployment) {
        await updateDeploymentRecord(order.deploymentId, { paymentStatus: 'payment_uploaded' });
      }
    }

    await writeAuditLog({
      organizationId: order.organizationId,
      actorUserId: req.user?.id !== 'local-user' ? req.user?.id : null,
      action: 'payment.receipt.uploaded',
      entityType: 'payment_receipt',
      entityId: receipt.id,
      result: { checkoutOrderId: order.id, deploymentId: order.deploymentId, fileSize: receipt.fileSize },
    });

    // Notify the customer (uploaded) and admins (needs review).
    await createUserNotification(order.userId || req.user?.id, {
      type: 'receipt',
      title: 'Receipt uploaded',
      message: 'Your receipt has been uploaded and is waiting for admin verification.',
      actionUrl: '/dashboard/billing',
      entityType: 'receipt',
      entityId: receipt.id,
    });
    await createAdminNotification({
      type: 'receipt',
      title: 'New bank receipt needs review',
      message: 'A customer uploaded a bank receipt for hosting payment.',
      actionUrl: '/admin',
      entityType: 'receipt',
      entityId: receipt.id,
    });

    res.status(201).json({
      data: {
        receiptId: receipt.id,
        status: receipt.status,
        checkoutOrderId: order.id,
        deploymentId: order.deploymentId,
        message: 'Receipt uploaded. An administrator will review and approve it.',
      },
      requestId: req.id,
    });
  } catch (error) { next(error); }
});

// ── PayPal (card via PayPal) deployment payment ──────────────────────────────
router.post('/paypal/orders', async (req, res, next) => {
  try {
    const result = await createDeploymentPaypalOrder({
      checkoutOrderId: req.body?.checkoutOrderId || req.body?.orderId,
      user: req.user,
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

router.post(
  '/paypal/orders/:paypalOrderId/capture',
  paymentLifecycleMiddleware({ provider: 'paypal', source: 'paypal_capture' }),
  async (req, res, next) => {
  try {
    const result = await captureDeploymentPaypalOrder({
      paypalOrderId: req.params.paypalOrderId,
      user: req.user,
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) {
    await req.billing?.fail(error, { providerOrderId: req.params.paypalOrderId });
    next(error);
  }
});

// Saved PayPal/card methods (vaulted by PayPal, display-safe only here).
router.get('/payment-methods', async (req, res, next) => {
  try {
    res.json({ data: await listPaymentMethodsForUser(req.user?.id), requestId: req.id });
  } catch (error) { next(error); }
});

router.post('/payment-methods/:paymentMethodId/default', async (req, res, next) => {
  try {
    const result = await setDefaultPaymentMethod(req.user?.id, req.params.paymentMethodId);
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

router.delete('/payment-methods/:paymentMethodId', async (req, res, next) => {
  try {
    const result = await removePaymentMethod(req.user?.id, req.params.paymentMethodId);
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

router.post('/payment-methods/paypal/setup', async (req, res, next) => {
  try {
    const result = await createPaypalVaultSetup({
      user: req.user,
      returnUrl: req.body?.returnUrl || null,
      cancelUrl: req.body?.cancelUrl || null,
      source: req.body?.source || 'paypal',
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

router.post('/payment-methods/paypal/complete', async (req, res, next) => {
  try {
    const result = await completePaypalVaultSetup({
      user: req.user,
      setupTokenId: req.body?.setupTokenId || req.body?.token || null,
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

router.post(
  '/deployment-orders/:orderId/pay-saved-method',
  paymentLifecycleMiddleware({ provider: 'paypal', source: 'saved_payment_method' }),
  async (req, res, next) => {
  try {
    const result = await payDeploymentWithSavedMethod({
      checkoutOrderId: req.params.orderId,
      paymentMethodId: req.body?.paymentMethodId || null,
      user: req.user,
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) {
    await req.billing?.fail(error, {
      checkoutOrderId: req.params.orderId,
      paymentMethodId: req.body?.paymentMethodId || null,
    });
    next(error);
  }
});

export default router;
