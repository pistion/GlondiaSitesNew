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
import { findDeploymentRecord } from '../services/deploymentBillingService.js';
import { deploymentBilling } from '../config/deploymentBilling.js';
import {
  createDeploymentPaypalOrder,
  captureDeploymentPaypalOrder,
} from '../services/deploymentPaypalService.js';

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
        amountCents: order.totalAmountCents || deploymentBilling.amountCents,
        currency: order.currency || deploymentBilling.currency,
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

router.post('/paypal/orders/:paypalOrderId/capture', async (req, res, next) => {
  try {
    const result = await captureDeploymentPaypalOrder({
      paypalOrderId: req.params.paypalOrderId,
      user: req.user,
    });
    res.json({ data: result, requestId: req.id });
  } catch (error) { next(error); }
});

export default router;
