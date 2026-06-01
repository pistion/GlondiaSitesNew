import deploymentService from '../../../services/deploymentService.js';
import { getZipDeployConfigStatus, validateZipSite } from '../pipelines/base64ZipToRender.pipeline.js';
import { run as runGithubLinkToRender } from '../pipelines/githubLinkToRender.pipeline.js';
import { run as runGeneratedSiteToRender } from '../pipelines/generatedSiteToRender.pipeline.js';
import { run as runZipToRender } from '../pipelines/zipToRender.pipeline.js';
import { createDeploymentOrder } from '../../../services/deploymentBillingService.js';

/**
 * Attach a pending K100 billing order to a freshly created deployment.
 * Deployment happens first; billing must never block the deploy response, so a
 * failure here is logged and the deploy still succeeds (cleanup job is a safety
 * net only for deployments that actually carry an order).
 */
async function attachBilling(deployment, req, kind) {
  try {
    return await createDeploymentOrder({ deployment, user: req.user || {}, kind });
  } catch (error) {
    console.error('[billing] Failed to attach K100 order:', error.message);
    return null;
  }
}

const hostingDeployController = {
  createDeployment: async (req, res, next) => {
    try {
      const deployment = await deploymentService.createDeployment(req.body || {}, { userId: req.user?.id });
      res.status(202).json({ data: deployment, message: 'Deployment session started.', requestId: req.id });
    } catch (error) {
      next(error);
    }
  },

  createRenderDeployment: async (req, res, next) => {
    try {
      const deployment = await deploymentService.createRenderDeployment(req.body || {}, { userId: req.user?.id });
      res.status(202).json({ data: deployment, message: 'Render deployment accepted.', requestId: req.id });
    } catch (error) {
      if (!error.stage) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('repo') || msg.includes('github')) error.stage = 'github_repo_validate';
        else if (msg.includes('render') && msg.includes('service')) error.stage = 'render_service_create';
        else if (msg.includes('render') && msg.includes('deploy')) error.stage = 'render_deploy_trigger';
        else error.stage = 'render_service_create';
      }
      next(error);
    }
  },

  createGithubDeployment: async (req, res, next) => {
    try {
      const deployment = await runGithubLinkToRender(req.body || {}, { userId: req.user?.id });
      const billing = await attachBilling(deployment, req, 'github');
      res.status(202).json({ data: { ...deployment, billing }, billing, message: 'GitHub deployment session started.', requestId: req.id });
    } catch (error) {
      if (!error.stage) error.stage = 'github_repo_validate';
      next(error);
    }
  },

  createZipDeployment: async (req, res, next) => {
    try {
      const file = req.file || req.files?.siteZip?.[0] || req.files?.zip?.[0] || req.files?.file?.[0];
      const deployment = await runZipToRender({ file, fields: req.body || {} }, { userId: req.user?.id });
      const billing = await attachBilling(deployment, req, 'zip');
      res.status(202).json({ data: { ...deployment, billing }, billing, message: 'ZIP deployment session started.', requestId: req.id });
    } catch (error) {
      if (!error.stage) error.stage = 'zip_upload';
      next(error);
    }
  },

  createGeneratedSiteDeployment: async (req, res, next) => {
    try {
      const deployment = await runGeneratedSiteToRender(req.body || {}, { userId: req.user?.id });
      res.status(202).json({ data: deployment, message: 'Generated site deployment session started.', requestId: req.id });
    } catch (error) {
      if (!error.stage) error.stage = 'generated_site_package';
      next(error);
    }
  },

  getSettings: async (_req, res, next) => {
    try {
      res.ok(getZipDeployConfigStatus());
    } catch (error) {
      next(error);
    }
  },

  validateZipDeployment: async (req, res, next) => {
    try {
      const file = req.file || req.files?.siteZip?.[0] || req.files?.zip?.[0] || req.files?.file?.[0];
      if (!file) {
        const error = new Error('siteZip file is required.');
        error.status = 400;
        error.code = 'ZIP_MISSING_FILE';
        error.stage = 'zip_upload';
        throw error;
      }
      res.ok(await validateZipSite({
        fileName: file.originalname,
        fileBase64: file.buffer.toString('base64'),
      }));
    } catch (error) {
      if (!error.stage) error.stage = 'zip_validation';
      next(error);
    }
  },

  getDeployment: async (req, res, next) => {
    try {
      res.ok(await deploymentService.getDeployment(req.params.deploymentId));
    } catch (error) {
      next(error);
    }
  },

  getStatus: async (req, res, next) => {
    try {
      res.ok(await deploymentService.getStatus(req.params.deploymentId));
    } catch (error) {
      next(error);
    }
  },

  redeploy: async (req, res, next) => {
    try {
      res.status(202).json({
        data: await deploymentService.redeploy(req.params.deploymentId, req.body || {}),
        message: 'Redeploy started.',
        requestId: req.id,
      });
    } catch (error) {
      next(error);
    }
  },

  redeployClearCache: async (req, res, next) => {
    try {
      res.status(202).json({
        data: await deploymentService.redeploy(req.params.deploymentId, { ...req.body, clearCache: 'clear' }),
        message: 'Redeploy with cache clear started.',
        requestId: req.id,
      });
    } catch (error) {
      next(error);
    }
  },

  verifyUrl: async (req, res, next) => {
    try {
      res.ok(await deploymentService.verifyUrl(req.params.deploymentId));
    } catch (error) {
      next(error);
    }
  },

  getLogs: async (req, res, next) => {
    try {
      res.ok(await deploymentService.getLogs(req.params.deploymentId));
    } catch (error) {
      next(error);
    }
  },
};

export default hostingDeployController;
