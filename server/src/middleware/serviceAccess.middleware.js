/**
 * serviceAccess.middleware.js
 *
 * HTTP guard that verifies the authenticated user has an active ServiceAccess
 * row for the requested service before the controller runs.
 *
 * Layering — this file speaks HTTP only:
 *   middleware → serviceAccessService (rules) → serviceAccess.repository (Prisma)
 *
 * Usage:
 *   router.use(authMiddleware, requireServiceAccess('hosting', getServiceId))
 *
 * getServiceId is a fn(req) => serviceId string.
 * If the service is blocked/expired, tags the attempt and returns 403.
 */

import { checkServiceAccess } from '../services/serviceAccessService.js';

// Re-exported for callers that check access outside the middleware chain.
export { checkServiceAccess };

/**
 * Express middleware factory.
 *
 * @param {string} serviceType  e.g. 'hosting'
 * @param {Function} getServiceId  fn(req) => serviceId string
 */
export function requireServiceAccess(serviceType, getServiceId) {
  return async function serviceAccessMiddleware(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: { message: 'Authentication required.', code: 'UNAUTHENTICATED' } });

      const serviceId = typeof getServiceId === 'function' ? getServiceId(req) : getServiceId;
      if (!serviceId) return next(); // no service ID — let controller handle

      const isAdmin = req.user?.role === 'admin';
      const result = await checkServiceAccess(userId, serviceType, serviceId, { adminBypass: isAdmin });

      if (!result.allowed) {
        // Tag the attempt
        if (req.securityContext) {
          const tag = result.reason === 'owner_mismatch'
            ? 'service.owner_mismatch'
            : result.reason === 'admin_blocked'
            ? 'service.disabled_access_attempt'
            : 'service.access_denied';
          req.securityContext.watchdogTags.push(tag);
          req.securityContext.riskScore += result.reason === 'owner_mismatch' ? 5 : 2;
        }

        return res.status(403).json({
          error: {
            message: friendlyMessage(result.code),
            code:    result.code,
          },
        });
      }

      // Attach access row to request for downstream use
      req.serviceAccess = result.row;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Transitional ServiceAccess guard (Phase 6 migration).
 *
 * Enforces access when a ServiceAccess row exists for the service, but falls
 * THROUGH when none exists yet (SERVICE_NOT_FOUND) so legacy records that have
 * not been backfilled are not locked out. Ownership is still enforced upstream
 * (e.g. deploymentOwnership). Once backfill is complete and every service has an
 * access row, callers should switch to `requireServiceAccess`, which denies on a
 * missing row. Active denials (blocked / suspended / review / billing / expired)
 * are always enforced.
 */
export function requireServiceAccessOrLegacy(serviceType, getServiceId) {
  return async function serviceAccessOrLegacyMiddleware(req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: { message: 'Authentication required.', code: 'UNAUTHENTICATED' } });

      const serviceId = typeof getServiceId === 'function' ? getServiceId(req) : getServiceId;
      if (!serviceId) return next();

      const isAdmin = req.user?.role === 'admin';
      const result = await checkServiceAccess(userId, serviceType, serviceId, { adminBypass: isAdmin });

      if (result.allowed) {
        req.serviceAccess = result.row;
        return next();
      }
      // No access row yet — transitional pass-through (ownership enforced upstream).
      if (result.code === 'SERVICE_NOT_FOUND') return next();

      if (req.securityContext) {
        const tag = result.reason === 'owner_mismatch'
          ? 'service.owner_mismatch'
          : result.reason === 'admin_blocked'
          ? 'service.disabled_access_attempt'
          : 'service.access_denied';
        req.securityContext.watchdogTags.push(tag);
        req.securityContext.riskScore += result.reason === 'owner_mismatch' ? 5 : 2;
      }
      return res.status(403).json({ error: { message: friendlyMessage(result.code), code: result.code } });
    } catch (err) {
      next(err);
    }
  };
}

function friendlyMessage(code) {
  switch (code) {
    case 'SERVICE_NOT_FOUND':       return 'Service access record not found.';
    case 'SERVICE_OWNER_MISMATCH':  return 'You do not own this service.';
    case 'SERVICE_ADMIN_BLOCKED':   return 'This service has been blocked by an administrator.';
    case 'SERVICE_UNDER_REVIEW':    return 'This service is currently under review.';
    case 'SERVICE_NOT_ACTIVE':      return 'This service is not currently active.';
    case 'SERVICE_BILLING_ISSUE':   return 'Service access requires payment. Please update your billing.';
    case 'SERVICE_EXPIRED':         return 'Your service access has expired. Please renew to continue.';
    default:                        return 'Service access denied.';
  }
}
