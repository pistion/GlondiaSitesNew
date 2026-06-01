/**
 * deploymentPaypalService.js
 *
 * PayPal (and card-via-PayPal) payment flow for the deploy-first K100 rule.
 *
 * PayPal cannot settle PGK, so we DISPLAY K100 but CHARGE the configured
 * processor currency/amount (deploymentBilling.processorCurrency/Amount).
 * On a completed capture we mark the CheckoutOrder + deployment paid through
 * the shared deploymentBillingService.
 */
import { prisma } from './db.js';
import { markDeploymentPaid } from './deploymentBillingService.js';
import { deploymentBilling } from '../config/deploymentBilling.js';

const SANDBOX = String(process.env.PAYPAL_SANDBOX ?? 'true').toLowerCase() !== 'false';
const BASE = SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const id = process.env.PAYPAL_CLIENT_ID || '';
  const sec = process.env.PAYPAL_CLIENT_SECRET || '';
  if (!id || !sec) throw Object.assign(new Error('PayPal is not configured.'), { status: 400, expose: true });
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${sec}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw Object.assign(new Error('Failed to authenticate with PayPal.'), { status: 400, expose: true });
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

function assertOwner(order, user) {
  if (user?.role === 'admin') return;
  if (order.userId && order.userId !== user?.id) {
    throw Object.assign(new Error('This order belongs to another account.'), { status: 403, expose: true });
  }
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

/** Create a PayPal order for a deployment's pending CheckoutOrder. */
export async function createDeploymentPaypalOrder({ checkoutOrderId, user } = {}) {
  if (!checkoutOrderId) throw Object.assign(new Error('checkoutOrderId is required.'), { status: 400, expose: true });

  const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404, expose: true });
  assertOwner(order, user);
  if (order.status === 'paid') {
    return { alreadyPaid: true, checkoutOrderId: order.id, paypalOrderId: order.providerOrderId };
  }

  const value = deploymentBilling.processorAmount;
  const currency = deploymentBilling.processorCurrency;
  const token = await getToken();

  const ppRes = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.id,
        description: `Glondia deployment hosting — K${deploymentBilling.amount} (${order.deploymentId || 'deployment'})`,
        custom_id: order.deploymentId || order.id,
        amount: {
          currency_code: currency, value,
          breakdown: { item_total: { currency_code: currency, value } },
        },
        items: [{
          name: 'Glondia deployment hosting',
          description: `Fixed K${deploymentBilling.amount} hosting fee`,
          quantity: '1',
          unit_amount: { currency_code: currency, value },
          category: 'DIGITAL_GOODS',
        }],
      }],
      application_context: {
        brand_name: 'Glondia', locale: 'en-US',
        shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: `${FRONTEND}/dashboard/hosting?payment=success`,
        cancel_url: `${FRONTEND}/dashboard/hosting?payment=cancelled`,
      },
    }),
  });

  if (!ppRes.ok) {
    const body = await ppRes.text();
    console.error('[paypal:deployment] createOrder failed:', body);
    throw Object.assign(new Error('Failed to create PayPal order. Please try again.'), { status: 400, expose: true });
  }

  const ppOrder = await ppRes.json();
  const approvalUrl = ppOrder.links?.find((l) => l.rel === 'approve')?.href;

  await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: {
      provider: 'paypal',
      providerOrderId: ppOrder.id,
      metadata: JSON.stringify({
        ...safeJson(order.metadata),
        paypal: { orderId: ppOrder.id, charged: { value, currency } },
      }),
    },
  });

  return {
    checkoutOrderId: order.id,
    paypalOrderId: ppOrder.id,
    approvalUrl,
    display: { amount: deploymentBilling.amount, currency: deploymentBilling.currency },
    charged: { value, currency },
  };
}

/** Capture a PayPal order and mark the deployment + order paid. */
export async function captureDeploymentPaypalOrder({ paypalOrderId, user } = {}) {
  if (!paypalOrderId) throw Object.assign(new Error('paypalOrderId is required.'), { status: 400, expose: true });

  const order = await prisma.checkoutOrder.findFirst({ where: { providerOrderId: paypalOrderId } });
  if (!order) throw Object.assign(new Error('Order not found for this PayPal order.'), { status: 404, expose: true });
  assertOwner(order, user);

  // Idempotency — already settled.
  if (order.status === 'paid') {
    return { checkoutOrderId: order.id, deploymentId: order.deploymentId, status: 'paid', alreadyPaid: true };
  }

  const token = await getToken();
  const captureRes = await fetch(`${BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!captureRes.ok) {
    const body = await captureRes.text();
    console.error('[paypal:deployment] capture failed:', body);
    throw Object.assign(new Error('PayPal payment capture failed. Please try again.'), { status: 400, expose: true });
  }

  const capture = await captureRes.json();
  const captureRecord = capture.purchase_units?.[0]?.payments?.captures?.[0];
  if (!captureRecord || captureRecord.status !== 'COMPLETED') {
    throw Object.assign(
      new Error(`Payment not completed. Status: ${captureRecord?.status ?? 'unknown'}`),
      { status: 400, expose: true },
    );
  }

  // Verify the processor currency/amount we expected to charge.
  const expectedCurrency = deploymentBilling.processorCurrency;
  const expectedValue = deploymentBilling.processorAmount;
  if (captureRecord.amount?.currency_code !== expectedCurrency || captureRecord.amount?.value !== expectedValue) {
    console.error(`[paypal:deployment] amount mismatch: expected ${expectedValue} ${expectedCurrency}, got ${captureRecord.amount?.value} ${captureRecord.amount?.currency_code}`);
    throw Object.assign(new Error('Payment amount mismatch. Contact support.'), { status: 400, expose: true });
  }

  const result = await markDeploymentPaid({
    deploymentId: order.deploymentId,
    actorUserId: user?.id !== 'local-user' ? user?.id : null,
    via: 'paypal',
    providerCaptureId: captureRecord.id,
  });

  return { checkoutOrderId: order.id, deploymentId: order.deploymentId, status: 'paid', ...result };
}

export default { createDeploymentPaypalOrder, captureDeploymentPaypalOrder };
