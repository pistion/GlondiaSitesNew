/**
 * deploymentBilling.js — single source of truth for the deploy-first K100 rule.
 *
 * Business rule:
 *   - Every ZIP deploy and every GitHub deploy costs a fixed K100 (PGK).
 *   - Deployment happens first; the user then has `graceHours` to pay.
 *   - If unpaid (and not manually approved) within the grace window, the
 *     cleanup service suspends/deletes the Render service and marks the
 *     deployment expired.
 *
 * PayPal / card processors cannot settle PGK directly, so we DISPLAY K100 but
 * CHARGE the configured processor currency/amount. Override via env if needed.
 */

const amountCents = 10000;          // K100.00 in toea (PGK minor units)
const amount = 100;                 // K100 display value
const currency = 'PGK';
const graceHours = Number(process.env.DEPLOYMENT_BILLING_GRACE_HOURS || 12);

// Currency actually charged by the payment processor (PayPal/card).
const processorCurrency = (process.env.DEPLOYMENT_BILLING_PROCESSOR_CURRENCY || 'USD').toUpperCase();
// Processor amount as a decimal string (e.g. "30.00"). Roughly K100 ≈ US$30.
const processorAmount = String(process.env.DEPLOYMENT_BILLING_PROCESSOR_AMOUNT || '30.00');

export const deploymentBilling = {
  amountCents,
  amount,
  currency,
  graceHours,
  processorCurrency,
  processorAmount,
};

/** Milliseconds in the grace window. */
export function graceMs() {
  return graceHours * 60 * 60 * 1000;
}

/** Compute the billing due date from a start time (defaults to now). */
export function computeBillingDueAt(from = Date.now()) {
  const start = from instanceof Date ? from.getTime() : new Date(from).getTime();
  return new Date(start + graceMs());
}

/** Public-facing billing summary attached to deploy responses. */
export function billingSummary({ checkoutOrderId, status = 'pending', billingDueAt } = {}) {
  return {
    checkoutOrderId: checkoutOrderId || null,
    amount,
    amountCents,
    currency,
    displayAmount: `K${amount}`,
    status,
    graceHours,
    billingDueAt: billingDueAt
      ? (billingDueAt instanceof Date ? billingDueAt.toISOString() : billingDueAt)
      : null,
  };
}

export default deploymentBilling;
