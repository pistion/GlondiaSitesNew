import { verifyAccessToken, getUserAccountStatus } from '../services/authService.js';

// Account states that are denied access even with an otherwise-valid JWT.
const BLOCKED_STATUSES = new Set(['disabled', 'deleted', 'suspended']);

/**
 * Authenticate a request from the `Authorization: Bearer <jwt>` header.
 *
 *  - A valid JWT sets req.user = { id, email, role, name }.
 *  - A present-but-invalid token is rejected (401), except in explicit
 *    development/demo fallback mode where stale browser storage should not
 *    block local testing.
 *  - When NO token is present:
 *      • In explicit development/demo mode we fall back to a local user so the
 *        app is usable without a backend session (honouring x-user-id headers).
 *      • In production we reject (401). We never trust x-user-id in production
 *        and never default to "local-user" there.
 */
export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (match) {
    let payload;
    try {
      payload = verifyAccessToken(match[1]);
    } catch {
      if (devFallbackAllowed()) return setDevFallbackUser(req, next);
      return reject(req, res);
    }
    req.user = {
      id: payload.sub,
      email: payload.email || null,
      role: payload.role || 'owner',
      name: payload.name || null,
    };
    // Enforce account lifecycle even on still-valid JWTs: a disabled/deleted/
    // suspended user is rejected immediately. Fail-open on lookup errors or when
    // there is no DB row (system/local-user) so admin scripts keep working.
    try {
      const status = await getUserAccountStatus(payload.sub);
      if (status && BLOCKED_STATUSES.has(status)) return rejectDisabled(req, res);
    } catch (err) {
      console.error('[auth] account-status check failed:', err.message);
    }
    return next();
  }

  if (devFallbackAllowed()) {
    return setDevFallbackUser(req, next);
  }

  return reject(req, res);
}

/** Dev/demo fallback is allowed only outside production and unless disabled. */
function devFallbackAllowed() {
  const isProd = process.env.NODE_ENV === 'production';
  return !isProd && String(process.env.AUTH_DEV_FALLBACK || 'true').toLowerCase() !== 'false';
}

function setDevFallbackUser(req, next) {
  req.user = {
    id: req.headers['x-user-id'] || req.headers['x-glondia-user-id'] || 'local-user',
    role: req.headers['x-user-role'] || 'owner',
    email: null,
    name: null,
  };
  return next();
}

function reject(req, res) {
  return res.status(401).json({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid access token is required.' },
    requestId: req.id,
  });
}

function rejectDisabled(req, res) {
  return res.status(403).json({
    success: false,
    error: { code: 'ACCOUNT_DISABLED', message: 'This account is not active.' },
    requestId: req.id,
  });
}

export default authMiddleware;
