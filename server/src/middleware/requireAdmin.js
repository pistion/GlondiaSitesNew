/**
 * requireAdmin — gate a route to users with role === 'admin'.
 * Must run AFTER authMiddleware so req.user is populated.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Administrator access is required.' },
    requestId: req.id,
  });
}

export default requireAdmin;
