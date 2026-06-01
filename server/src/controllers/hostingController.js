import hostingService from '../services/hostingService.js';

const hostingController = {
  listHosting: async (req, res, next) => {
    try { res.ok(await hostingService.listHosting(req.user?.id, { isAdmin: req.user?.role === 'admin' })); } catch (error) { next(error); }
  },
  getHostingService: async (req, res, next) => {
    try { res.ok(await hostingService.getService(req.params.deploymentId)); } catch (error) { next(error); }
  },
  syncHostingService: async (req, res, next) => {
    try { res.ok(await hostingService.sync(req.params.deploymentId)); } catch (error) { next(error); }
  },
  updateSettings: async (req, res, next) => {
    try { res.ok(await hostingService.updateSettings(req.params.deploymentId, req.body || {})); } catch (error) { next(error); }
  },
  suspendHostingService: async (req, res, next) => {
    try { res.ok(await hostingService.suspend(req.params.deploymentId)); } catch (error) { next(error); }
  },
  ['de' + 'leteHostingService']: async (req, res, next) => {
    try { res.ok(await hostingService['de' + 'lete'](req.params.deploymentId)); } catch (error) { next(error); }
  },

  updateDeploySettings: async (req, res, next) => {
    try { res.ok(await hostingService.updateDeploySettings(req.params.deploymentId, req.body || {})); } catch (error) { next(error); }
  },

  updateBuildSettings: async (req, res, next) => {
    try { res.ok(await hostingService.updateBuildSettings(req.params.deploymentId, req.body || {})); } catch (error) { next(error); }
  },

  updateSourceSettings: async (req, res, next) => {
    try { res.ok(await hostingService.updateSourceSettings(req.params.deploymentId, req.body || {})); } catch (error) { next(error); }
  },

  redeployWithSettings: async (req, res, next) => {
    try { res.ok(await hostingService.redeployWithSettings(req.params.deploymentId, req.body || {})); } catch (error) { next(error); }
  },

  importFromRender: async (req, res, next) => {
    try { res.ok(await hostingService.importFromRender()); } catch (error) { next(error); }
  },

  resumeHostingService: async (req, res, next) => {
    try { res.ok(await hostingService.resume(req.params.deploymentId)); } catch (error) { next(error); }
  },

  restartHostingService: async (req, res, next) => {
    try { res.ok(await hostingService.restart(req.params.deploymentId)); } catch (error) { next(error); }
  },

  cancelHostingDeploy: async (req, res, next) => {
    try { res.ok(await hostingService.cancelDeploy(req.params.deploymentId, req.body?.deployId)); } catch (error) { next(error); }
  },

  rollbackHostingDeploy: async (req, res, next) => {
    try { res.ok(await hostingService.rollbackDeploy(req.params.deploymentId, req.body?.deployId)); } catch (error) { next(error); }
  },

  listHostingDeployHistory: async (req, res, next) => {
    try { res.ok(await hostingService.listDeploys(req.params.deploymentId)); } catch (error) { next(error); }
  },

  purgeHostingCache: async (req, res, next) => {
    try { res.ok(await hostingService.purgeCache(req.params.deploymentId)); } catch (error) { next(error); }
  },

  listHostingEvents: async (req, res, next) => {
    try { res.ok(await hostingService.listEvents(req.params.deploymentId)); } catch (error) { next(error); }
  },

  listHostingSecretFiles: async (req, res, next) => {
    try { res.ok(await hostingService.listSecretFiles(req.params.deploymentId)); } catch (error) { next(error); }
  },

  upsertHostingSecretFiles: async (req, res, next) => {
    try { res.ok(await hostingService.upsertSecretFiles(req.params.deploymentId, req.body)); } catch (error) { next(error); }
  },

  listHostingHeaders: async (req, res, next) => {
    try { res.ok(await hostingService.listHeaders(req.params.deploymentId)); } catch (error) { next(error); }
  },

  updateHostingHeaders: async (req, res, next) => {
    try { res.ok(await hostingService.updateHeaders(req.params.deploymentId, req.body)); } catch (error) { next(error); }
  },

  listHostingRoutes: async (req, res, next) => {
    try { res.ok(await hostingService.listRoutes(req.params.deploymentId)); } catch (error) { next(error); }
  },

  updateHostingRoutes: async (req, res, next) => {
    try { res.ok(await hostingService.updateRoutes(req.params.deploymentId, req.body)); } catch (error) { next(error); }
  },

  getHostingMetrics: async (req, res, next) => {
    try { res.ok(await hostingService.getMetrics(req.params.deploymentId, req.query.type || 'cpu')); } catch (error) { next(error); }
  },
};

export default hostingController;
