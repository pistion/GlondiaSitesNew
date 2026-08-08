/**
 * BillingController — deploy-first tiered billing summary for the signed-in user.
 *
 * All data-gathering and aggregation is handled by billingDashboardService.
 * This controller is intentionally thin — it only reads the user from the
 * request, delegates to the service, and returns the result.
 */

import { getUserBillingSummary } from '../services/billingDashboardService.js';

const BillingController = {
  getSummary: async (req, res, next) => {
    try {
      const userId = req.user?.id || null;
      const summary = await getUserBillingSummary(userId, {
        organizationId: req.params.workspaceId,
        serviceType: req.query.serviceType || null,
        serviceId: req.query.serviceId || null,
      });
      res.ok(summary);
    } catch (error) {
      next(error);
    }
  },
};

export default BillingController;
