import { auditHostingRelationships } from '../services/hostingRelationshipRepairService.js';

function requestedDryRun(req) {
  return req.body?.dryRun === true || req.body?.dryRun === 'true';
}

function wrap(fn) {
  return async (req, res, next) => {
    try {
      res.json({ data: await fn(req), requestId: req.id });
    } catch (error) {
      next(error);
    }
  };
}

export const auditHosting = wrap((req) => auditHostingRelationships({
  dryRun: true,
  actorUserId: req.user.id,
  request: req,
}));

export const runHostingRepair = wrap((req) => auditHostingRelationships({
  dryRun: requestedDryRun(req),
  actorUserId: req.user.id,
  request: req,
}));

export const repairHostingService = wrap((req) => auditHostingRelationships({
  dryRun: requestedDryRun(req),
  deploymentId: req.params.serviceId,
  actorUserId: req.user.id,
  request: req,
}));
