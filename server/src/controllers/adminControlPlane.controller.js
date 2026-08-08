import * as controlPlane from '../services/adminControlPlane.service.js';

const handlers = {
  clients: controlPlane.getClients,
  hosting: controlPlane.getHosting,
  vps: controlPlane.getVps,
  'cloud-storage': controlPlane.getCloudStorage,
  domains: controlPlane.getDomains,
  email: controlPlane.getEmail,
  security: controlPlane.getSecurity,
};

export async function getSection(req, res, next) {
  try {
    const load = handlers[req.params.section];
    if (!load) return res.status(404).json({ error: { code: 'ADMIN_SECTION_NOT_FOUND', message: 'Admin section not found.' }, requestId: req.id });
    return res.json({ data: await load(), requestId: req.id });
  } catch (error) {
    return next(error);
  }
}
