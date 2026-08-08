import express from 'express';
import BillingController from '../controllers/billing.controller.js';
import UsageController from '../controllers/usage.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { invoiceStatusCheckMiddleware } from '../middleware/billing.middleware.js';

const router = express.Router({ mergeParams: true });

// Billing — deploy-first tiered summary: pricing, the user's own orders +
// deployment bills, and provider/payment-method status.
router.get('/summary', authMiddleware, invoiceStatusCheckMiddleware, BillingController.getSummary);

// Usage
router.get('/usage/summary', authMiddleware, invoiceStatusCheckMiddleware, UsageController.getSummary);

export default router;
