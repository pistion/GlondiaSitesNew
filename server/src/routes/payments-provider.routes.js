/**
 * payments-provider.routes.js
 *
 * Payment routes for PayPal client config, domain purchases, and hosting billing.
 * Mounted at /api/payments in server.js — BEFORE the existing paymentsRoutes
 * so these more-specific paths take priority.
 */

import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import paymentsProviderController from '../controllers/payments-provider.controller.js';

const router = express.Router();

router.get('/paypal-client', paymentsProviderController.getPaypalClient);
router.post('/domain/validate-cart', authMiddleware, paymentsProviderController.validateDomainCart);
router.post('/domain/create-order', authMiddleware, paymentsProviderController.createDomainOrder);
router.post('/domain/capture', authMiddleware, paymentsProviderController.captureDomainOrder);
router.post('/domain-addon/create-order', authMiddleware, paymentsProviderController.createDomainAddonOrder);
router.post('/domain-addon/capture', authMiddleware, paymentsProviderController.captureDomainAddonOrder);
router.post('/hosting/create-order', authMiddleware, paymentsProviderController.createHostingOrder);
router.post('/hosting/capture', authMiddleware, paymentsProviderController.captureHostingOrder);
router.get('/hosting/status/:deploymentId', authMiddleware, paymentsProviderController.getHostingStatus);

export default router;
