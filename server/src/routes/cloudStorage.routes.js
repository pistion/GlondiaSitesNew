import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireServiceAccess } from '../middleware/serviceAccess.middleware.js';
import * as controller from '../controllers/cloudStorageController.js';
import { requireDriveSession } from '../services/cloudDriveAuthService.js';

const router = express.Router();

// Signed machine webhook. Signature and replay protection are enforced by the service.
router.post('/webhooks/repositories/:linkId', controller.repositoryWebhook);

router.use(authMiddleware);
router.get('/catalog', controller.catalog);
router.post('/quote', controller.quote);
router.get('/services', controller.list);
router.post('/services', controller.create);
router.get('/services/:id', controller.detail);
router.get('/services/:id/usage', controller.usage);
router.get('/services/:id/logs', controller.logs);
router.get('/services/:id/billing', controller.billing);
router.post('/services/:id/paypal/create-order', controller.createPaymentOrder);
router.post('/services/:id/paypal/capture', controller.capturePayment);
const activeAccess = requireServiceAccess('cloud_storage', (req) => req.params.id);
router.patch('/services/:id/settings', activeAccess, controller.settings);
router.get('/services/:id/drive/security', activeAccess, controller.driveSecurity);
router.post('/services/:id/drive/password/reveal', activeAccess, controller.revealDrivePassword);
router.put('/services/:id/drive/password', activeAccess, controller.changeDrivePassword);
router.post('/services/:id/drive/login', activeAccess, controller.driveLogin);
router.get('/services/:id/drive/session', activeAccess, controller.driveSession);
router.get('/services/:id/credentials', activeAccess, controller.credentials);
router.get('/services/:id/objects', activeAccess, requireDriveSession, controller.objects);
router.post('/services/:id/objects', activeAccess, requireDriveSession, controller.registerObject);
router.delete('/services/:id/objects/:objectId', activeAccess, requireDriveSession, controller.deleteObject);
router.post('/services/:id/objects/:objectId/restore', activeAccess, requireDriveSession, controller.restoreObject);
router.delete('/services/:id/objects/:objectId/permanent', activeAccess, requireDriveSession, controller.permanentlyDeleteObject);
router.get('/services/:id/restore-points', activeAccess, controller.restorePoints);
router.post('/services/:id/restore-points', activeAccess, controller.createRestorePoint);
router.post('/services/:id/restore-points/:restorePointId/restore', activeAccess, controller.restore);
router.put('/services/:id/repository', activeAccess, controller.configureRepository);

export default router;
