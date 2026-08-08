/**
 * Payments API client — deploy-first tiered billing (customer side).
 */
import { liveApiRequest } from '../api.js';
import { authFetch } from './auth.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';

function paymentSandbox() {
  const sandbox = getActiveServiceSandbox();
  return sandbox?.service === 'billing' ? sandbox : null;
}

function liveApiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : `/api${path}`;
}

/** Fetch a single checkout order (owner only) with its receipts. */
export const getPaymentOrder = (orderId) => paymentSandbox()
  ? Promise.resolve({ id: orderId, status: 'pending', currency: 'USD', totalAmountCents: 500, sandbox: true })
  : liveApiRequest(`/payments/orders/${encodeURIComponent(orderId)}`);
// Backward-compatible alias.
export const getOrder = getPaymentOrder;

/** Per-user billing summary: pricing, orders, and deployments. */
export const getBillingSummary = () => paymentSandbox()
  ? Promise.resolve({ orders: [], deployments: [], paymentMethods: [], sandbox: true })
  : liveApiRequest('/payments/billing-summary');

/** Public PayPal client/settings snapshot; secrets never leave the server. */
export const getPayPalClientSettings = () => paymentSandbox()
  ? Promise.resolve({ configured: true, sandbox: true, clientId: 'sandbox' })
  : liveApiRequest('/payments/paypal-client');

export const createDeploymentRenewalOrder = (deploymentId) =>
  paymentSandbox() ? Promise.resolve({ id: 'sandbox-renewal-order', deploymentId, sandbox: true }) : liveApiRequest(`/payments/deployments/${encodeURIComponent(deploymentId)}/renew`, {
    method: 'POST',
  });

/**
 * Upload a manual bank-transfer receipt (PDF/PNG/JPG/JPEG) for an order.
 * Canonical form: uploadManualReceipt({ checkoutOrderId, file, note }).
 * Also accepts the legacy form uploadManualReceipt(file, { checkoutOrderId, note }).
 */
export async function uploadManualReceipt(arg, maybeOpts) {
  if (paymentSandbox()) return { id: 'sandbox-receipt', status: 'payment_uploaded', sandbox: true };
  const isFileFirst = arg && typeof arg === 'object' && (typeof File !== 'undefined' ? arg instanceof File : arg.name && arg.size != null);
  const { checkoutOrderId, file, note } = isFileFirst
    ? { file: arg, ...(maybeOpts || {}) }
    : (arg || {});

  if (!file) throw new Error('Choose a receipt file first.');
  if (!checkoutOrderId) throw new Error('A checkout order is required.');

  const form = new FormData();
  form.append('receipt', file);
  form.append('checkoutOrderId', checkoutOrderId);
  if (note) form.append('note', note);

  let response;
  try {
    response = await authFetch(liveApiUrl('/payments/manual-receipts'), {
      method: 'POST',
      body: form,
    });
  } catch (networkError) {
    throw new Error(`Network error: ${networkError.message || 'Could not reach the server.'}`);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = result?.error?.message || result?.message || `Receipt upload failed (${response.status}).`;
    throw new Error(msg);
  }
  return result?.data ?? result;
}

/** Start a PayPal (card via PayPal) payment for a deployment order. Returns { approvalUrl, paypalOrderId }. */
export const createDeploymentPaypalOrder = (checkoutOrderId) =>
  paymentSandbox()
    ? Promise.resolve({ paypalOrderId: 'sandbox-paypal-order', approvalUrl: '#sandbox-paypal', checkoutOrderId, sandbox: true })
    : liveApiRequest('/payments/paypal/orders', { method: 'POST', body: { checkoutOrderId } });
// Backward-compatible alias.
export const createPaypalOrder = createDeploymentPaypalOrder;

/** Capture a PayPal order after approval; marks the order + deployment paid. */
export const captureDeploymentPaypalOrder = (paypalOrderId) =>
  paymentSandbox()
    ? Promise.resolve({ paypalOrderId, status: 'paid', sandbox: true })
    : liveApiRequest(`/payments/paypal/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST' });
// Backward-compatible alias.
export const capturePaypalOrder = captureDeploymentPaypalOrder;

/** Saved PayPal/card methods vaulted by PayPal (display-safe metadata only). */
export const listPaymentMethods = () => paymentSandbox() ? Promise.resolve([]) : liveApiRequest('/payments/payment-methods');

export const setDefaultPaymentMethod = (paymentMethodId) =>
  paymentSandbox() ? Promise.resolve({ ok: true, paymentMethodId, sandbox: true }) : liveApiRequest(`/payments/payment-methods/${encodeURIComponent(paymentMethodId)}/default`, { method: 'POST' });

export const removePaymentMethod = (paymentMethodId) =>
  paymentSandbox() ? Promise.resolve({ ok: true, paymentMethodId, sandbox: true }) : liveApiRequest(`/payments/payment-methods/${encodeURIComponent(paymentMethodId)}`, { method: 'DELETE' });

export const createPayPalVaultSetup = (input = {}) =>
  paymentSandbox() ? Promise.resolve({ setupTokenId: 'sandbox-vault-token', input, sandbox: true }) : liveApiRequest('/payments/payment-methods/paypal/setup', { method: 'POST', body: input });

export const completePayPalVaultSetup = (setupTokenId) =>
  paymentSandbox() ? Promise.resolve({ ok: true, setupTokenId, sandbox: true }) : liveApiRequest('/payments/payment-methods/paypal/complete', {
    method: 'POST',
    body: { setupTokenId },
  });

/** Charge a deployment order using the default or selected saved PayPal vault token. */
export const payDeploymentOrderWithSavedMethod = (orderId, paymentMethodId = null) =>
  paymentSandbox() ? Promise.resolve({ orderId, paymentMethodId, status: 'paid', sandbox: true }) : liveApiRequest(`/payments/deployment-orders/${encodeURIComponent(orderId)}/pay-saved-method`, {
    method: 'POST',
    body: paymentMethodId ? { paymentMethodId } : {},
  });
