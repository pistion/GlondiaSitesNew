import express from 'express';
import multer from 'multer';
import hostingDeployController from '../controllers/hostingDeploy.controller.js';
import authMiddleware from '../../../middleware/authMiddleware.js';
import deploymentSessionMiddleware from '../../../middleware/deploymentSessionMiddleware.js';
import { validateDeploymentInput } from '../../../middleware/validationMiddleware.js';
import { requireFeature } from '../../../middleware/featureFlag.js';
import { deploymentOwnership } from '../../../middleware/deploymentOwnership.middleware.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.ZIP_UPLOAD_MAX_BYTES || process.env.MAX_ZIP_BYTES || 100 * 1024 * 1024),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!/\.zip$/i.test(file.originalname || '')) {
      const error = new Error('Only .zip uploads are supported.');
      error.status = 400;
      error.stage = 'zip_upload';
      cb(error);
      return;
    }
    cb(null, true);
  },
});

// All deployment routes require a valid session (authMiddleware rejects in prod
// without a token; allows the local-user fallback only in dev/demo mode).
router.use(authMiddleware);
// Per-user ownership guard on every :deploymentId route (admins bypass).
router.param('deploymentId', deploymentOwnership);
router.get('/settings', hostingDeployController.getSettings);

// ZIP upload hosting — deploy-first K100 billing. Feature-gated only; no plan
// or quota gate. The deployment runs first, then a pending K100 order is
// attached with a 12-hour grace window (see hostingDeploy.controller.js).
router.post(
  '/zip',
  requireFeature('ZIP_HOSTING'),
  upload.fields([{ name: 'zip', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'siteZip', maxCount: 1 }]),
  hostingDeployController.createZipDeployment,
);
router.post('/zip/validate', upload.fields([{ name: 'zip', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'siteZip', maxCount: 1 }]), hostingDeployController.validateZipDeployment);

// GitHub upload/import hosting — deploy-first K100 billing. Feature-gated only.
router.post(
  '/github',
  requireFeature('GITHUB_HOSTING'),
  hostingDeployController.createGithubDeployment,
);
router.post('/generated-site', hostingDeployController.createGeneratedSiteDeployment);
router.post('/render', validateDeploymentInput, hostingDeployController.createRenderDeployment);
router.post('/', validateDeploymentInput, hostingDeployController.createDeployment);
router.get('/:deploymentId', deploymentSessionMiddleware, hostingDeployController.getDeployment);
router.get('/:deploymentId/status', deploymentSessionMiddleware, hostingDeployController.getStatus);
router.post('/:deploymentId/verify-url', deploymentSessionMiddleware, hostingDeployController.verifyUrl);
router.post('/:deploymentId/redeploy', deploymentSessionMiddleware, hostingDeployController.redeploy);
router.post('/:deploymentId/redeploy-clear-cache', deploymentSessionMiddleware, hostingDeployController.redeployClearCache);
router.get('/:deploymentId/logs', deploymentSessionMiddleware, hostingDeployController.getLogs);

export default router;
