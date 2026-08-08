import express from 'express';
import hostingController from '../controllers/hostingController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { deploymentOwnership } from '../middleware/deploymentOwnership.middleware.js';
import { requireServiceAccessOrLegacy } from '../middleware/serviceAccess.middleware.js';

const router = express.Router();

router.use(authMiddleware);
// Enforce per-user ownership on every :deploymentId route (admins bypass).
router.param('deploymentId', deploymentOwnership);
// Then enforce ServiceAccess when a row exists for the deployment. The stable
// hosting service id is the deploymentId (ServiceAccess.serviceId === deploymentId).
// Transitional: passes through when no access row exists yet (ownership above
// still applies) so un-backfilled legacy deployments are not locked out.
//
// MIGRATION GUARD — flip to strict `requireServiceAccess('hosting', …)` (which
// denies on a missing access row) ONCE every deployment has a backfilled
// ServiceAccess row. To verify readiness: run `npm run backfill:hosting` and
// confirm 0 unresolved/conflicts, then check the hostingStore has no deployment
// whose deploymentId lacks a `serviceType='hosting'` ServiceAccess row. New ZIP
// deploys already create the pending row up-front (base64ZipToRender.pipeline),
// so only pre-migration records are at risk. Backfill pins
// WebHostingService.id === ServiceAccess.serviceId === deploymentId.
router.param('deploymentId', requireServiceAccessOrLegacy('hosting', (req) => req.params.deploymentId));
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
router.get('/:deploymentId/webhooks', hostingController.listHostingWebhooks);
router.post('/:deploymentId/webhooks', hostingController.createHostingWebhook);
router.patch('/:deploymentId/webhooks/:webhookId', hostingController.updateHostingWebhook);
router.delete('/:deploymentId/webhooks/:webhookId', hostingController.deleteHostingWebhook);
router.get('/:deploymentId/metrics', hostingController.getHostingMetrics);
router.delete('/:deploymentId', hostingController.deleteHostingService);

export default router;
