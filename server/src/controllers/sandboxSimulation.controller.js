import {
  listSandboxServices,
  simulateSandboxCall,
} from '../services/sandboxSimulationService.js';

export async function listServices(req, res, next) {
  try {
    const data = await listSandboxServices(req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function simulate(req, res, next) {
  try {
    const data = await simulateSandboxCall(req.user?.id, req.body?.scenarioId, req.body?.payload || {});
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({
        success: false,
        error: { code: err.code || 'NOT_FOUND', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}
