/**
 * admin.routes.js — simple admin surface for deploy-first billing.
 * All routes require an authenticated admin (role === 'admin').
 */
import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import adminService from '../services/adminService.js';

const router = express.Router();

router.use(authMiddleware, requireAdmin);

router.get('/overview', async (req, res, next) => {
  try { res.json({ data: await adminService.getOverview(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/users', async (req, res, next) => {
  try { res.json({ data: await adminService.listUsers(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/deployments', async (req, res, next) => {
  try { res.json({ data: await adminService.listDeployments(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/orders', async (req, res, next) => {
  try { res.json({ data: await adminService.listOrders(), requestId: req.id }); } catch (e) { next(e); }
});

router.get('/receipts', async (req, res, next) => {
  try { res.json({ data: await adminService.listReceipts(), requestId: req.id }); } catch (e) { next(e); }
});

router.post('/receipts/:receiptId/approve', async (req, res, next) => {
  try { res.json({ data: await adminService.approveReceipt(req.params.receiptId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

router.post('/receipts/:receiptId/reject', async (req, res, next) => {
  try { res.json({ data: await adminService.rejectReceipt(req.params.receiptId, req.user.id, req.body?.note), requestId: req.id }); } catch (e) { next(e); }
});

router.post('/deployments/:deploymentId/mark-paid', async (req, res, next) => {
  try { res.json({ data: await adminService.adminMarkDeploymentPaid(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

router.post('/deployments/:deploymentId/delete', async (req, res, next) => {
  try { res.json({ data: await adminService.adminDeleteDeployment(req.params.deploymentId, req.user.id), requestId: req.id }); } catch (e) { next(e); }
});

export default router;
