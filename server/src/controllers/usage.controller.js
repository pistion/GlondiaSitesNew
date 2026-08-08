import { getUserBillingSummary } from '../services/billingDashboardService.js';

const UsageController = {
  getSummary: async (req, res, next) => {
    try {
      const summary = await getUserBillingSummary(req.user?.id || null, {
        organizationId: req.params.workspaceId,
        serviceType: req.query.serviceType || null,
        serviceId: req.query.serviceId || null,
      });
      res.ok({ scope: summary.scope, totals: summary.totals, usage: summary.usage });
    } catch (error) {
      next(error);
    }
  },
};

export default UsageController;
