/**
 * Payment verification guards.
 *
 * CheckoutOrder totals come from immutable invoices. Verification compares the
 * provider capture directly with that stored total; there are no tier or
 * fallback prices.
 */
const PAYPAL_VERIFIED_VIAS = new Set(['paypal', 'paypal_webhook', 'paypal_saved_method']);
const ADMIN_VERIFIED_VIAS = new Set([
  'manual_admin_approval',
  'admin_mark_paid',
  'admin_manual_renewal',
  'admin_billing_approval',
]);
const PAYABLE_STATUSES = new Set(['pending', 'payment_uploaded', 'provider_confirmed', 'paid']);

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}

export function assertOrderBelongsToDeployment(order, deploymentId) {
  if (order?.deploymentId && deploymentId && order.deploymentId !== deploymentId) {
    throw httpError('Checkout order does not belong to this deployment.', 400);
  }
}

export function assertOrderPayable(order) {
  if (!order) return;
  if (!PAYABLE_STATUSES.has(order.status)) {
    throw httpError(`Order is not payable in its current state (${order.status}).`, 409);
  }
}

export function assertVerifiedPaymentSignal({
  via,
  providerCaptureId = null,
  actorUserId = null,
} = {}) {
  if (PAYPAL_VERIFIED_VIAS.has(via)) {
    if (!providerCaptureId) {
      throw httpError('PayPal payment cannot be tagged paid without a verified capture id.', 400);
    }
    return { kind: 'paypal' };
  }
  if (ADMIN_VERIFIED_VIAS.has(via)) {
    if (!actorUserId) throw httpError('Admin payment approval requires an authenticated admin.', 403);
    return { kind: 'admin' };
  }
  if (['manual_receipt', 'receipt_upload', 'manual'].includes(via)) {
    throw httpError('Receipt upload is not payment approval.', 400);
  }
  throw httpError(`Refusing to mark paid from an unverified payment signal (${via || 'unknown'}).`, 400);
}

export function isAdminVia(via) {
  return ADMIN_VERIFIED_VIAS.has(via);
}

export function assertAmountMatchesOrder({ order, amount, currency } = {}) {
  if (!order) throw httpError('Checkout order is required for payment verification.', 400);
  const expectedValue = (Number(order.totalAmountCents || 0) / 100).toFixed(2);
  const expectedCurrency = order.currency;
  if (String(currency) !== String(expectedCurrency) || String(amount) !== expectedValue) {
    console.error(
      `[payment:verify] captured ${amount} ${currency}; expected ${expectedValue} ${expectedCurrency} for order ${order.id}`,
    );
    throw httpError('Payment amount mismatch. Contact support.', 400);
  }
  return order;
}

// Transitional export name for existing callers. The implementation is
// invoice/order-based and contains no billing tier behavior.
export const assertAmountMatchesTier = assertAmountMatchesOrder;

export default {
  assertOrderBelongsToDeployment,
  assertOrderPayable,
  assertVerifiedPaymentSignal,
  assertAmountMatchesOrder,
  assertAmountMatchesTier,
  isAdminVia,
};
