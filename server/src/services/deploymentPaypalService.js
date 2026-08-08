/**
 * PayPal settlement for database-backed invoice checkout orders.
 *
 * The provider is charged CheckoutOrder.totalAmountCents in the order currency.
 * There are no fixed hosting tiers, forex fallbacks, or independently generated
 * amounts in this module.
 */
import { prisma } from './db.js';
import { markDeploymentPaid } from './deploymentBillingService.js';
import { assertOrderPayable, assertAmountMatchesOrder } from './paymentVerificationGuards.js';
import {
  createPaypalOrderWithOptionalVault,
  savePaymentMethodFromCapture,
  chargeUserPaymentMethod,
  getOwnedPaymentMethod,
  getDefaultPaymentMethod,
} from './paymentMethodService.js';

const SANDBOX = String(process.env.PAYPAL_SANDBOX ?? 'true').toLowerCase() !== 'false';
const BASE = SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';
let tokenCache = null;
let tokenExpiry = 0;

function moneyValue(cents) {
  return (Math.max(0, Number(cents || 0)) / 100).toFixed(2);
}

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function assertOwner(order, user) {
  if (user?.role === 'admin') return;
  if (order.userId && order.userId !== user?.id) {
    throw Object.assign(new Error('This order belongs to another account.'), { status: 403, expose: true });
  }
}

function assertInvoiceOrder(order) {
  const invoiceId = safeJson(order.metadata).invoiceId;
  if (!invoiceId || Number(order.totalAmountCents || 0) <= 0) {
    throw Object.assign(
      new Error('This checkout order is not backed by a payable invoice. Generate a current invoice first.'),
      { status: 409, expose: true },
    );
  }
  return invoiceId;
}

async function getToken() {
  if (tokenCache && Date.now() < tokenExpiry) return tokenCache;
  const id = process.env.PAYPAL_CLIENT_ID || '';
  const secret = process.env.PAYPAL_CLIENT_SECRET || '';
  if (!id || !secret) throw Object.assign(new Error('PayPal is not configured.'), { status: 400, expose: true });
  const response = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw Object.assign(new Error('Failed to authenticate with PayPal.'), { status: 400, expose: true });
  const payload = await response.json();
  tokenCache = payload.access_token;
  tokenExpiry = Date.now() + (Number(payload.expires_in || 300) - 60) * 1000;
  return tokenCache;
}

export async function getPaypalAccessToken() {
  return getToken();
}

export function getPaypalApiBase() {
  return BASE;
}

export async function createDeploymentPaypalOrder({ checkoutOrderId, user } = {}) {
  if (!checkoutOrderId) {
    throw Object.assign(new Error('checkoutOrderId is required.'), { status: 400, expose: true });
  }
  const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404, expose: true });
  assertOwner(order, user);
  const invoiceId = assertInvoiceOrder(order);
  if (order.status === 'paid') {
    return { alreadyPaid: true, checkoutOrderId: order.id, paypalOrderId: order.providerOrderId };
  }
  assertOrderPayable(order);

  const value = moneyValue(order.totalAmountCents);
  const currency = String(order.currency || 'USD').toUpperCase();
  const created = await createPaypalOrderWithOptionalVault({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: order.id,
      custom_id: invoiceId,
      description: `Glondia invoice ${safeJson(order.metadata).invoiceNumber || invoiceId}`,
      amount: {
        currency_code: currency,
        value,
        breakdown: { item_total: { currency_code: currency, value } },
      },
      items: [{
        name: 'Glondia invoice',
        description: 'Usage and service charges from your Glondia invoice',
        quantity: '1',
        unit_amount: { currency_code: currency, value },
        category: 'DIGITAL_GOODS',
      }],
    }],
    application_context: {
      brand_name: 'Glondia',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: `${FRONTEND}/dashboard/billing?payment=success`,
      cancel_url: `${FRONTEND}/dashboard/billing?payment=cancelled`,
    },
  });
  await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: {
      provider: 'paypal',
      providerOrderId: created.id,
      metadata: JSON.stringify({
        ...safeJson(order.metadata),
        paypal: { orderId: created.id, charged: { value, currency } },
      }),
    },
  });
  return {
    checkoutOrderId: order.id,
    invoiceId,
    paypalOrderId: created.id,
    approvalUrl: created.approvalUrl,
    charged: { value, currency },
  };
}

export async function captureDeploymentPaypalOrder({ paypalOrderId, user } = {}) {
  if (!paypalOrderId) throw Object.assign(new Error('paypalOrderId is required.'), { status: 400, expose: true });
  const order = await prisma.checkoutOrder.findFirst({ where: { providerOrderId: paypalOrderId } });
  if (!order) throw Object.assign(new Error('Order not found for this PayPal order.'), { status: 404, expose: true });
  assertOwner(order, user);
  const invoiceId = assertInvoiceOrder(order);
  if (order.status === 'paid') {
    return { checkoutOrderId: order.id, deploymentId: order.deploymentId, invoiceId, status: 'paid', alreadyPaid: true };
  }
  assertOrderPayable(order);

  const response = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
  });
  const capture = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error('PayPal payment capture failed. Please try again.'), { status: 400, expose: true });
  }
  const purchaseUnit = capture.purchase_units?.[0] || {};
  const captureRecord = purchaseUnit.payments?.captures?.[0];
  if (!captureRecord?.id || captureRecord.status !== 'COMPLETED') {
    throw Object.assign(new Error('Payment was not completed.'), { status: 400, expose: true });
  }
  if (purchaseUnit.reference_id && purchaseUnit.reference_id !== order.id) {
    throw Object.assign(new Error('Payment reference mismatch. Contact support.'), { status: 400, expose: true });
  }
  if (purchaseUnit.custom_id && purchaseUnit.custom_id !== invoiceId) {
    throw Object.assign(new Error('Invoice reference mismatch. Contact support.'), { status: 400, expose: true });
  }
  assertAmountMatchesOrder({
    order,
    amount: captureRecord.amount?.value,
    currency: captureRecord.amount?.currency_code,
  });
  const result = await markDeploymentPaid({
    deploymentId: order.deploymentId,
    checkoutOrderId: order.id,
    actorUserId: user?.id !== 'local-user' ? user?.id : null,
    via: 'paypal',
    providerCaptureId: captureRecord.id,
  });
  const savedMethod = await savePaymentMethodFromCapture({
    userId: user?.id || order.userId,
    organizationId: order.organizationId,
    capturePayload: capture,
    productType: 'invoice',
  });
  return { checkoutOrderId: order.id, deploymentId: order.deploymentId, invoiceId, status: 'paid', paymentMethod: savedMethod, ...result };
}

export async function payDeploymentWithSavedMethod({
  checkoutOrderId,
  paymentMethodId = null,
  user,
} = {}) {
  const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404, expose: true });
  assertOwner(order, user);
  const invoiceId = assertInvoiceOrder(order);
  if (order.status === 'paid') {
    return { checkoutOrderId: order.id, deploymentId: order.deploymentId, invoiceId, status: 'paid', alreadyPaid: true };
  }
  assertOrderPayable(order);
  const value = moneyValue(order.totalAmountCents);
  const currency = String(order.currency || 'USD').toUpperCase();
  const charge = await chargeUserPaymentMethod({
    userId: user?.id || order.userId,
    paymentMethodId,
    amountValue: value,
    currency,
    description: `Glondia invoice ${safeJson(order.metadata).invoiceNumber || invoiceId}`,
    referenceId: order.id,
    customId: invoiceId,
    itemName: 'Glondia invoice',
    productType: 'invoice',
  });
  assertAmountMatchesOrder({ order, amount: charge.amount, currency: charge.currency });
  await prisma.checkoutOrder.update({
    where: { id: order.id },
    data: {
      provider: 'paypal',
      providerOrderId: charge.paypalOrderId,
      providerCaptureId: charge.captureId,
      metadata: JSON.stringify({
        ...safeJson(order.metadata),
        paypal: {
          orderId: charge.paypalOrderId,
          captureId: charge.captureId,
          charged: { value: charge.amount, currency: charge.currency },
          paymentMethodId: charge.paymentMethod?.id || paymentMethodId || null,
        },
      }),
    },
  });
  const result = await markDeploymentPaid({
    deploymentId: order.deploymentId,
    checkoutOrderId: order.id,
    actorUserId: user?.id !== 'local-user' ? user?.id : null,
    via: 'paypal_saved_method',
    providerCaptureId: charge.captureId,
  });
  return {
    checkoutOrderId: order.id,
    deploymentId: order.deploymentId,
    invoiceId,
    status: 'paid',
    paymentMethod: charge.paymentMethod,
    charged: { value: charge.amount, currency: charge.currency },
    ...result,
  };
}

export async function resolveSavedMethodForUser(userId, paymentMethodId = null) {
  if (paymentMethodId) return getOwnedPaymentMethod(userId, paymentMethodId);
  return getDefaultPaymentMethod(userId);
}

export default {
  createDeploymentPaypalOrder,
  captureDeploymentPaypalOrder,
  payDeploymentWithSavedMethod,
  resolveSavedMethodForUser,
};
