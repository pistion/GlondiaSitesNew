/**
 * Payments API client — deploy-first K100 billing (customer side).
 */
import { liveApiRequest } from '../api.js';
import { authHeaders } from './auth.js';

function liveApiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : `/api${path}`;
}

export const getOrder = (orderId) => liveApiRequest(`/payments/orders/${encodeURIComponent(orderId)}`);

/** Upload a manual bank-transfer receipt (pdf/png/jpg/jpeg) for an order. */
export async function uploadManualReceipt(file, { checkoutOrderId, note } = {}) {
  if (!file) throw new Error('Choose a receipt file first.');
  if (!checkoutOrderId) throw new Error('A checkout order is required.');

  const form = new FormData();
  form.append('receipt', file);
  form.append('checkoutOrderId', checkoutOrderId);
  if (note) form.append('note', note);

  let response;
  try {
    response = await fetch(liveApiUrl('/payments/manual-receipts'), {
      method: 'POST',
      headers: { ...authHeaders() },
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

/** Start a PayPal (card via PayPal) payment for a deployment order. */
export const createPaypalOrder = (checkoutOrderId) =>
  liveApiRequest('/payments/paypal/orders', { method: 'POST', body: { checkoutOrderId } });

/** Capture a PayPal order after approval. */
export const capturePaypalOrder = (paypalOrderId) =>
  liveApiRequest(`/payments/paypal/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST' });
