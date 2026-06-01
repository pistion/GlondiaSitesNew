import express from 'express';
import hostingController from '../controllers/hostingController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { deploymentOwnership } from '../middleware/deploymentOwnership.middleware.js';

const router = express.Router();

router.use(authMiddleware);
// Enforce per-user ownership on every :deploymentId route (admins bypass).
router.param('deploymentId', deploymentOwnership);
router.post('/import-from-render', hostingController.importFromRender);
router.get('/', hostingController.listHosting);
router.get('/:deploymentId', hostingController.getHostingService);
router.post('/:deploymentId/sync', hostingController.syncHostingService);
router.patch('/:deploymentId/settings', hostingController.updateSettings);
router.patch('/:deploymentId/deploy-settings', hostingController.updateDeploySettings);
router.patch('/:deploymentId/build-settings', hostingController.updateBuildSettings);
router.patch('/:deploymentId/source-settings', hostingController.updateSourceSettings);
router.post('/:deploymentId/redeploy-with-settings', hostingController.redeployWithSettings);
router.post('/:deploymentId/suspend', hostingController.suspendHostingService);
router.post('/:deploymentId/resume', hostingController.resumeHostingService);
router.post('/:deploymentId/restart', hostingController.restartHostingService);
router.post('/:deploymentId/cancel-deploy', hostingController.cancelHostingDeploy);
router.post('/:deploymentId/rollback', hostingController.rollbackHostingDeploy);
router.get('/:deploymentId/deploys', hostingController.listHostingDeployHistory);
router.post('/:deploymentId/purge-cache', hostingController.purgeHostingCache);
router.get('/:deploymentId/events', hostingController.listHostingEvents);
router.get('/:deploymentId/secret-files', hostingController.listHostingSecretFiles);
router.put('/:deploymentId/secret-files', hostingController.upsertHostingSecretFiles);
router.get('/:deploymentId/headers', hostingController.listHostingHeaders);
router.put('/:deploymentId/headers', hostingController.updateHostingHeaders);
router.get('/:deploymentId/routes', hostingController.listHostingRoutes);
router.put('/:deploymentId/routes', hostingController.updateHostingRoutes);
router.get('/:deploymentId/metrics', hostingController.getHostingMetrics);
router.delete('/:deploymentId', hostingController.deleteHostingService);

export default router;
