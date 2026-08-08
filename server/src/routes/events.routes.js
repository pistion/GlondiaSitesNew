import express from 'express';
import EventTrackingController from '../controllers/event-tracking.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { analyticsRateLimit } from '../middleware/rateLimit.middleware.js';

const router = express.Router();
router.use(authMiddleware, analyticsRateLimit);

router.post('/track', EventTrackingController.trackEvent);
router.post('/batch', EventTrackingController.trackBatch);

export default router;
