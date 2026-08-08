/**
 * Hosting provider lifecycle configuration.
 *
 * Pricing does not belong here. Customer charges come exclusively from
 * BillingUsageRecord -> Invoice -> PaymentTransaction.
 */
export const renderPlanMap = {
  trial: 'free',
  paidDefault: process.env.RENDER_PAID_PLAN || 'standard',
};

export const allowedRenderPlans = new Set([
  'free',
  'starter',
  'standard',
  'pro',
  'pro_plus',
  'pro_max',
  'pro_ultra',
]);

export function normalizeRenderPlan(plan, fallback = 'free') {
  const clean = String(plan || '').toLowerCase();
  return allowedRenderPlans.has(clean) ? clean : fallback;
}

export const initialRenderPlan = normalizeRenderPlan(
  process.env.RENDER_INITIAL_PLAN,
  renderPlanMap.trial,
);

export default {
  renderPlanMap,
  allowedRenderPlans,
  normalizeRenderPlan,
  initialRenderPlan,
};
