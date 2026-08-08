import { getClientCloudStorageCatalog } from '../services/cloudStorageCatalogService.js';
import * as service from '../services/cloudStorageService.js';
import * as driveAuth from '../services/cloudDriveAuthService.js';

function wrap(handler) {
  return async (req, res, next) => {
    try {
      const data = await handler(req, res);
      if (!res.headersSent) res.json({ data, requestId: req.id });
    } catch (error) {
      next(error);
    }
  };
}

export const catalog = wrap(() => getClientCloudStorageCatalog());
export const quote = wrap((req) => service.quote(req.body || {}));
export const list = wrap((req) => service.listServices(req.user));
export const create = wrap(async (req, res) => {
  const data = await service.createService(req.user, req.body || {});
  res.status(201).json({ data, requestId: req.id });
});
export const detail = wrap((req) => service.getService(req.user, req.params.id));
export const usage = wrap((req) => service.getUsage(req.user, req.params.id));
export const logs = wrap((req) => service.getLogs(req.user, req.params.id));
export const billing = wrap((req) => service.getBilling(req.user, req.params.id));
export const settings = wrap((req) => service.updateSettings(req.user, req.params.id, req.body || {}));
export const credentials = wrap((req) => service.getCredentials(req.user, req.params.id));
export const objects = wrap((req) => service.listObjects(req.user, req.params.id, req.query.includeDeleted === 'true'));
export const registerObject = wrap(async (req, res) => {
  const data = await service.registerObject(req.user, req.params.id, req.body || {});
  res.status(201).json({ data, requestId: req.id });
});
export const deleteObject = wrap((req) => service.deleteObject(req.user, req.params.id, req.params.objectId));
export const restoreObject = wrap((req) => service.restoreObject(req.user, req.params.id, req.params.objectId));
export const permanentlyDeleteObject = wrap((req) => service.permanentlyDeleteObject(req.user, req.params.id, req.params.objectId));
export const restorePoints = wrap((req) => service.listRestorePoints(req.user, req.params.id));
export const createRestorePoint = wrap(async (req, res) => {
  const data = await service.createRestorePoint(req.user, req.params.id, req.body?.kind || 'manual');
  res.status(201).json({ data, requestId: req.id });
});
export const restore = wrap((req) => service.restoreFromPoint(req.user, req.params.id, req.params.restorePointId));
export const createPaymentOrder = wrap(async (req, res) => {
  const data = await service.createPaymentOrder(req.user, req.params.id);
  res.status(201).json({ data, requestId: req.id });
});
export const capturePayment = wrap((req) => service.capturePayment(req.user, req.params.id, req.body?.orderId));
export const configureRepository = wrap((req) => service.configureRepository(req.user, req.params.id, req.body || {}));
export const repositoryWebhook = wrap((req) => service.handleRepositoryWebhook(req.params.linkId, req.headers, req.body || {}));
export const driveSecurity = wrap((req) => driveAuth.getDriveSecurity(req.user, req.params.id));
export const revealDrivePassword = wrap((req) => driveAuth.revealInitialPassword(req.user, req.params.id));
export const changeDrivePassword = wrap((req) => driveAuth.changeDrivePassword(req.user, req.params.id, req.body || {}));
export const driveLogin = wrap((req) => driveAuth.loginToDrive(req.user, req.params.id, req.body || {}));
export const driveSession = wrap((req) => driveAuth.verifyDriveSession(req.user, req.params.id, req.headers['x-drive-session']));
