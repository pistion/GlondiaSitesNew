import { getEmailMailboxCapacity } from '../services/email.service.js';

/**
 * Fast, asynchronous plan gate for mailbox creation. The service performs a
 * second transactional count before writing so concurrent requests are safe.
 */
export async function requireEmailMailboxCapacity(req, res, next) {
  try {
    const capacity = await getEmailMailboxCapacity(req.user?.id);
    req.emailMailboxCapacity = capacity;

    if (!capacity.hasPlan) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_PLAN_REQUIRED', message: 'Choose a Business Email plan before creating mailboxes.' },
        capacity,
        requestId: req.id,
      });
    }
    if (capacity.atLimit) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_PLAN_LIMIT_REACHED',
          message: `Your ${capacity.planName} plan has used all ${capacity.allowed} mailboxes.`,
        },
        capacity,
        requestId: req.id,
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
