/**
 * deploymentOwnership.middleware.js
 *
 * Ensures a user can only act on their OWN deployments. Wired via
 * `router.param('deploymentId', ...)` so it runs for every route carrying a
 * :deploymentId param. Admins (role === 'admin') bypass the check.
 *
 * Behaviour:
 *   - Unknown deployment → pass through (the handler returns its own 404).
 *   - Imported/pre-existing services or records with no owner → 404 for
 *     customers. They belong to the provider/master account, not the client.
 *   - Owned by someone else → 403.
 */
import { readHostingStore } from '../services/hostingStore.js';

export async function deploymentOwnership(req, res, next, deploymentId) {
  try {
    if (req.user?.role === 'admin') return next();

    const store = await readHostingStore();
    const deployment = (store.deployments || []).find(
      (d) => d.deploymentId === deploymentId || d.id === deploymentId || d.renderServiceId === deploymentId,
    );

    if (!deployment) return next();

    if (deployment.platformDeployed === false || !deployment.userId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Hosting service not found.' },
        requestId: req.id,
      });
    }

    if (deployment.userId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have access to this deployment.' },
        requestId: req.id,
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export default deploymentOwnership;
