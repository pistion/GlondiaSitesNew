/**
 * deploymentOwnership.middleware.js
 *
 * Ensures a user can only act on their OWN deployments. Wired via
 * `router.param('deploymentId', ...)` so it runs for every route carrying a
 * :deploymentId param. Admins (role === 'admin') bypass the check.
 *
 * Behaviour:
 *   - Unknown deployment → pass through (the handler returns its own 404).
 *   - Imported/pre-existing services (platformDeployed === false) or records
 *     with no owner → pass through (legacy/unowned, not user-scoped).
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

    // Unknown or unowned/imported records are not user-scoped here.
    if (!deployment || deployment.platformDeployed === false || !deployment.userId) return next();

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
