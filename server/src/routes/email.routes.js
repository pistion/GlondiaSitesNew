/**
 * email.routes.js — Dashboard Business Email API.
 *
 * GET  /status
 * GET  /plans
 * POST /plans/select
 * GET  /mailboxes
 * POST /mailboxes/request
 * GET  /dns/:domain
 * POST /dns/:domain/check
 *
 * Mounted at /api/v1/email behind requireFeature('EMAIL').
 * Does not expose provider secrets or mailbox passwords.
 */
import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { requireEmailMailboxCapacity } from '../middleware/emailMailboxCapacity.middleware.js';
import * as emailController from '../controllers/email.controller.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/status', emailController.getStatus);
router.get('/capacity', emailController.getCapacity);
router.get('/plans', emailController.getPlans);
router.post('/plans/select', emailController.selectPlan);
router.get('/mailboxes', emailController.listMailboxes);
router.post('/mailboxes/request', requireEmailMailboxCapacity, emailController.requestMailbox);
router.get('/mailboxes/:mailboxId/usage', emailController.getMailboxUsage);
router.patch('/mailboxes/:mailboxId/password', emailController.changeMailboxPassword);
router.get('/mailboxes/:mailboxId', emailController.getMailbox);
// Back-compat with earlier client path
router.post('/requests', requireEmailMailboxCapacity, emailController.requestMailbox);
router.get('/dns/:domain', emailController.getDns);
router.post('/dns/:domain/check', emailController.checkDns);

export default router;
