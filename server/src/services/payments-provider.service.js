/**
 * payments-provider.service.js
 *
 * All payment order/capture business logic extracted from server.js.
 * Handles PayPal checkout orders for domain registration and hosting deployment.
 */

import {
  checkSpaceshipAvailability,
  registerSpaceshipDomain,
  saveSpaceshipContact,
  cleanDomainName,
  getSpaceshipSettings,
} from './providerSpaceship.service.js';
import { makeId, nowIso } from './hostingStore.js';
import { recordRegisteredDomains } from './customerDomainService.js';
import { prisma } from './db.js';
import { issueInvoice, recordPaymentTransaction } from './billingRecordsService.js';

// ── Fallback TLD pricing (used when registrar does not return a price) ─────────

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getPlatformMarkupPercent() {
  const raw = process.env.PLATFORM_MARKUP_PERCENT;
  if (raw === undefined || raw === '') return 30;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 30;
  return value;
}

export function getPaypalClientSettings() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    sandbox: String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false',
    markupPercent: getPlatformMarkupPercent(),
  };
}

export function domainActualPriceCents(domain, availabilityRow) {
  const premium = availabilityRow?.pricing?.amount;
  if (premium != null && Number.isFinite(Number(premium))) return Math.max(0, Math.round(Number(premium)));
  throw httpError(`The registrar did not return a current price for ${domain}.`, 409);
}

export function sanitizeContact(input = {}) {
  return {
    firstName: String(input.firstName || '').trim(),
    lastName: String(input.lastName || '').trim(),
    company: String(input.company || '').trim() || undefined,
    email: String(input.email || '').trim(),
    phone: String(input.phone || '').trim(),
    address1: String(input.address1 || '').trim(),
    address2: String(input.address2 || '').trim() || undefined,
    city: String(input.city || '').trim(),
    postalCode: String(input.postalCode || '').trim(),
    country: String(input.country || '').trim().toUpperCase(),
  };
}

export function centsToUsd(cents) {
  return (Math.max(0, Math.round(Number(cents) || 0)) / 100).toFixed(2);
}

export function safeReturnUrl(value) {
  const fallback = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const url = new URL(value || fallback);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

export function httpError(message, status = 400, details) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  error.expose = true;
  return error;
}

// ── PayPal auth ───────────────────────────────────────────────────────────────

let paypalTokenCache = { token: '', expiresAt: 0 };

export function assertPayPalConfigured() {
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) return;
  throw httpError('PayPal credentials are not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.', 503);
}

export function paypalBaseUrl() {
  return String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() === 'false'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken() {
  assertPayPalConfigured();
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt) return paypalTokenCache.token;
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError('Failed to authenticate with PayPal.', response.status, payload);
  paypalTokenCache = { token: payload.access_token, expiresAt: Date.now() + Math.max(0, Number(payload.expires_in || 300) - 60) * 1000 };
  return paypalTokenCache.token;
}

export async function paypalHeaders() {
  return {
    Authorization: `Bearer ${await getPayPalAccessToken()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// ── PayPal order CRUD ─────────────────────────────────────────────────────────

export async function createPayPalOrder({ checkoutOrderId, type, totalAmountCents, lineItems, amounts, returnUrl, cancelUrl }) {
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: checkoutOrderId,
      custom_id: `${type}:${checkoutOrderId}`,
      description: type === 'domain_purchase' ? 'Glondia domain registration' : 'Glondia hosting deployment',
      amount: {
        currency_code: 'USD',
        value: centsToUsd(totalAmountCents),
        breakdown: {
          item_total: { currency_code: 'USD', value: centsToUsd(totalAmountCents) },
        },
      },
      items: [
        ...lineItems.map((item) => ({
          name: item.name,
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: centsToUsd(item.customerAmountCents) },
          category: 'DIGITAL_GOODS',
        })),
      ],
    }],
    application_context: {
      brand_name: 'Glondia',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: safeReturnUrl(returnUrl),
      cancel_url: safeReturnUrl(cancelUrl || returnUrl),
    },
  };
  // Shared vault helper: request vault-on-success when enabled; fall back cleanly.
  const { createPaypalOrderWithOptionalVault } = await import('./paymentMethodService.js');
  const created = await createPaypalOrderWithOptionalVault(body);
  return { id: created.id, approvalUrl: created.approvalUrl, payload: created.payload };
}

export async function capturePayPalOrder(providerOrderId) {
  const id = String(providerOrderId || '').trim();
  if (!id) throw httpError('PayPal order id is required.', 400);
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(payload?.message || 'PayPal capture failed.', response.status, payload);
  if (payload.status !== 'COMPLETED') throw httpError(`PayPal capture status is ${payload.status || 'unknown'}.`, 409, payload);
  return payload;
}

export async function refundPayPalCapture(captureId) {
  const response = await fetch(`${paypalBaseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify({ note_to_payer: 'Your payment could not be fulfilled and has been refunded.' }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || 'PayPal refund request failed');
  }
}

// ── Checkout order store helpers ──────────────────────────────────────────────

export async function createCheckoutOrder({ type, user, source, lineItems, metadata }) {
  assertPayPalConfigured();
  const markupPercent = getPlatformMarkupPercent();
  const ratedLineItems = lineItems.map((item) => {
    const actualAmountCents = Math.max(0, Math.round(Number(item.actualAmountCents || 0)));
    const lineMarkupPercent = Math.max(0, Number(item.markupPercent ?? markupPercent));
    const markupAmountCents = Math.round(actualAmountCents * lineMarkupPercent / 100);
    return {
      ...item,
      actualAmountCents,
      markupPercent: lineMarkupPercent,
      markupAmountCents,
      customerAmountCents: actualAmountCents + markupAmountCents,
    };
  });
  const actualAmountCents = ratedLineItems.reduce((sum, item) => sum + item.actualAmountCents, 0);
  const markupAmountCents = ratedLineItems.reduce((sum, item) => sum + item.markupAmountCents, 0);
  const totalAmountCents = ratedLineItems.reduce((sum, item) => sum + item.customerAmountCents, 0);
  const id = makeId('checkout');
  const amounts = {
    currency: 'USD',
    actualAmountCents,
    markupPercent,
    markupAmountCents,
    totalAmountCents,
    actualAmount: centsToUsd(actualAmountCents),
    markupAmount: centsToUsd(markupAmountCents),
    totalAmount: centsToUsd(totalAmountCents),
  };
  const paypal = await createPayPalOrder({
    checkoutOrderId: id,
    type,
    totalAmountCents,
    lineItems: ratedLineItems,
    amounts,
    returnUrl: source?.returnUrl,
    cancelUrl: source?.cancelUrl,
  });
  await prisma.checkoutOrder.create({
    data: {
      id,
      organizationId: source?.organizationId || user.organizationId || user.id || 'local-org',
      userId: user.id && user.id !== 'local-user' ? user.id : null,
      type,
      provider: 'paypal',
      providerOrderId: paypal.id,
      status: 'pending',
      currency: 'USD',
      actualAmountCents,
      markupPercent,
      markupAmountCents,
      totalAmountCents,
      deploymentId: metadata?.deploymentId || null,
      metadata: JSON.stringify({
        ...(metadata || {}),
        billingPayload: { amounts, lineItems: ratedLineItems },
      }),
    },
  });
  return { checkoutOrderId: id, providerOrderId: paypal.id, approvalUrl: paypal.approvalUrl, amounts, lineItems: ratedLineItems };
}

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export function assertCheckoutOrderOwner(order, user = {}) {
  const userId = String(user?.id || '').trim();
  if (!userId || userId === 'local-user' || !order || order.userId !== userId) {
    throw httpError('Checkout order not found.', 404);
  }
  return order;
}

export async function getCheckoutOrder(checkoutOrderId, user = null) {
  const id = String(checkoutOrderId || '').trim();
  if (!id) throw httpError('checkoutOrderId is required.', 400);
  const row = await prisma.checkoutOrder.findUnique({ where: { id } });
  const parsed = row ? safeJson(row.metadata) : {};
  const order = row ? {
    ...row,
    metadata: parsed,
    amounts: parsed.billingPayload?.amounts || {
      currency: row.currency,
      actualAmountCents: row.actualAmountCents,
      markupPercent: row.markupPercent,
      markupAmountCents: row.markupAmountCents,
      totalAmountCents: row.totalAmountCents,
    },
    lineItems: parsed.billingPayload?.lineItems || [],
  } : null;
  if (!order) throw httpError('Checkout order not found.', 404);
  return user ? assertCheckoutOrderOwner(order, user) : order;
}

export async function markCheckoutPaid(checkoutOrderId, providerCaptureId, result, user = {}) {
  const order = await prisma.checkoutOrder.findUnique({ where: { id: checkoutOrderId } });
  if (!order || order.status === 'paid') return result;
  const paidOrder = await prisma.checkoutOrder.update({
    where: { id: checkoutOrderId },
    data: {
      status: 'paid',
      providerCaptureId,
      paidAt: new Date(),
      metadata: JSON.stringify({ ...safeJson(order.metadata), result }),
    },
  });
  await recordPaymentTransaction({
    order: paidOrder,
    provider: 'paypal',
    providerTransactionId: providerCaptureId,
    status: 'completed',
    metadata: { source: 'payments_provider', actorUserId: user.id || order.userId || null },
  });
  return result;
}

// ── Domain payment ────────────────────────────────────────────────────────────

function assertSpaceshipConfigured() {
  const settings = getSpaceshipSettings();
  if (!settings.configured) {
    throw httpError(
      'Domain registration is not configured yet. Add SPACESHIP_API_KEY and SPACESHIP_API_SECRET on the server.',
      503
    );
  }
}

export async function validateDomainCart(input = {}) {
  assertSpaceshipConfigured();

  const domains = Array.isArray(input.domains) ? input.domains : [];
  if (!domains.length) throw httpError('At least one domain is required.', 400);
  const normalized = domains.map((item) => ({
    name: cleanDomainName(item.name || item.hostname || item.domain),
    years: Math.min(Math.max(Number(item.years || 1), 1), 10),
  }));
  // Real availability check before creating any PayPal order.
  const availability = await checkSpaceshipAvailability(normalized.map((item) => item.name));
  const markupPercent = getPlatformMarkupPercent();
  const lines = normalized.map((item) => {
    const row = availability.domains.find((candidate) => candidate.domain === item.name);
    if (!row) throw httpError(`Could not verify availability for ${item.name}.`, 502);
    if (!row.available) throw httpError(`${item.name} is no longer available.`, 409);
    const actualAmountCents = domainActualPriceCents(item.name, row) * item.years;
    const markupAmountCents = Math.round(actualAmountCents * markupPercent / 100);
    return {
      type: 'domain_registration',
      name: item.name,
      years: item.years,
      available: true,
      status: row.status,
      actualAmountCents,
      actualAmount: centsToUsd(actualAmountCents),
      markupAmountCents,
      customerAmountCents: actualAmountCents + markupAmountCents,
      pricingSource: 'provider_api',
    };
  });
  const actualAmountCents = lines.reduce((sum, item) => sum + item.actualAmountCents, 0);
  const markupAmountCents = lines.reduce((sum, item) => sum + item.markupAmountCents, 0);
  const totalAmountCents = lines.reduce((sum, item) => sum + item.customerAmountCents, 0);
  return {
    valid: true,
    provider: 'spaceship',
    checkedAt: nowIso(),
    domains: lines,
    amounts: {
      currency: 'USD',
      actualAmountCents,
      markupPercent,
      markupAmountCents,
      totalAmountCents,
      actualAmount: centsToUsd(actualAmountCents),
      markupAmount: centsToUsd(markupAmountCents),
      totalAmount: centsToUsd(totalAmountCents),
    },
  };
}

export async function createDomainPaymentOrder(input = {}, user = {}) {
  assertPayPalConfigured();
  const quote = await validateDomainCart(input);
  const normalized = quote.domains.map((item) => ({ name: item.name, years: item.years }));
  const lines = quote.domains.map((item) => ({
    type: item.type,
    name: item.name,
    years: item.years,
    actualAmountCents: item.actualAmountCents,
  }));
  return createCheckoutOrder({
    type: 'domain_purchase',
    user,
    source: input,
    lineItems: lines,
    metadata: {
      domains: normalized,
      contact: sanitizeContact(input.contact || {}),
      autoRenew: input.autoRenew !== false,
      privacyProtection: input.privacyProtection !== false,
    },
  });
}

export async function captureDomainPaymentOrder(input = {}, user = {}) {
  assertSpaceshipConfigured();
  assertPayPalConfigured();

  const order = await getCheckoutOrder(input.checkoutOrderId, user);
  if (order.type !== 'domain_purchase') throw httpError('Checkout order is not for a domain purchase.', 400);
  if (order.status === 'paid') return order.result;

  const domains = order.metadata.domains || [];
  const providerOrderId = input.providerOrderId || input.orderId || order.providerOrderId;

  // Re-check availability BEFORE capturing payment — never charge if the domain is gone.
  if (!domains.length) throw httpError('Checkout order has no domains to register.', 400);
  const availability = await checkSpaceshipAvailability(domains.map((d) => d.name));
  const unavailable = domains.filter((item) => {
    const row = availability.domains.find((r) => r.domain === item.name);
    return !row || !row.available;
  });
  if (unavailable.length) {
    throw httpError(`${unavailable.map((d) => d.name).join(', ')} is no longer available.`, 409);
  }

  // Capture only after provider + availability are confirmed.
  const capturePayload = await capturePayPalOrder(providerOrderId);
  const captureId = capturePayload?.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  const contact = order.metadata.contact || {};
  const createdContact = await saveSpaceshipContact(contact);
  const contactId = createdContact.contactId || createdContact.id;

  let operations;
  try {
    operations = await Promise.all(
      domains.map(async (item) => {
        const registered = await registerSpaceshipDomain(item.name, {
          years: item.years || 1,
          autoRenew: order.metadata.autoRenew !== false,
          privacyProtection: order.metadata.privacyProtection !== false,
          contactId,
        });
        return { domain: item.name, operationId: registered.operationId, status: registered.status };
      })
    );
  } catch (registrationError) {
    if (captureId) await refundPayPalCapture(captureId).catch(() => {});
    throw httpError(`Domain registration failed after payment: ${registrationError.message}. A refund has been requested.`, 500);
  }

  const registeredDomains = await recordRegisteredDomains({
    user,
    order,
    domains: order.lineItems || domains,
    operations,
    contact,
  });
  // Best-effort vault save — domain checkout also seeds the shared wallet.
  let paymentMethod = null;
  try {
    const { savePaymentMethodFromCapture } = await import('./paymentMethodService.js');
    paymentMethod = await savePaymentMethodFromCapture({
      userId: user?.id || order.userId,
      organizationId: order.organizationId,
      capturePayload,
      productType: 'domain',
    });
  } catch { /* non-fatal */ }
  const result = {
    status: 'paid',
    checkoutOrderId: order.id,
    operations,
    amounts: order.amounts,
    domains: registeredDomains,
    paymentMethod,
  };
  await markCheckoutPaid(order.id, providerOrderId, result, user);
  return result;
}

// ── Hosting payment ───────────────────────────────────────────────────────────

export async function createHostingPaymentOrder(input = {}, user = {}) {
  if (!input.deploymentId) throw httpError('deploymentId is required.', 400);
  const {
    findDeploymentRecord,
    createDeploymentOrder,
  } = await import('./deploymentBillingService.js');
  const { createDeploymentPaypalOrder } = await import('./deploymentPaypalService.js');
  const deployment = await findDeploymentRecord(input.deploymentId);
  if (!deployment || !user?.id || (deployment.userId && deployment.userId !== user.id)) {
    throw httpError('Deployment not found.', 404);
  }
  const summary = await createDeploymentOrder({ deployment, user, kind: 'invoice_payment' });
  if (!summary.checkoutOrderId) {
    throw httpError('No payable hosting invoice exists yet.', 409);
  }
  return createDeploymentPaypalOrder({ checkoutOrderId: summary.checkoutOrderId, user });
}

export async function createDomainAddonPaymentOrder(input = {}, user = {}) {
  const addonServiceId = String(input.addonServiceId || '').trim();
  if (!addonServiceId) throw httpError('addonServiceId is required.', 400);
  const addon = await prisma.domainAddonService.findFirst({
    where: {
      id: addonServiceId,
      userId: user.id,
      status: 'awaiting_payment',
      paymentStatus: { not: 'paid' },
    },
  });
  if (!addon) throw httpError('Charged Glondia add-on not found.', 404);
  if (addon.providerAmountCents <= 0 || addon.totalAmountCents <= 0) {
    throw httpError('This included service does not require checkout.', 409);
  }
  const checkout = await createCheckoutOrder({
    type: 'domain_addon',
    user,
    source: { organizationId: addon.organizationId },
    lineItems: [{
      type: 'domain_addon',
      name: addon.name,
      actualAmountCents: addon.providerAmountCents,
      markupPercent: addon.markupPercent,
    }],
    metadata: {
      domainServiceId: addon.domainServiceId,
      addonServiceId: addon.id,
      addonKey: addon.addonKey,
    },
  });
  const invoice = await issueInvoice({
    userId: addon.userId,
    organizationId: addon.organizationId,
    orderId: checkout.checkoutOrderId,
    invoiceNumber: `GLD-ADDON-${checkout.checkoutOrderId}`,
    currency: addon.currency,
    status: 'issued',
    lineItems: [{
      serviceType: 'domain_addon',
      serviceId: addon.id,
      sourceTable: 'domain_addon_services',
      sourceId: addon.id,
      lineClassification: 'recurring_charge',
      description: `${addon.name} domain protection`,
      providerAmountCents: addon.providerAmountCents,
      markupPercent: addon.markupPercent,
      markupAmountCents: addon.markupAmountCents,
      unitCents: addon.totalAmountCents,
      totalCents: addon.totalAmountCents,
      metadata: { provider: addon.internalProvider, addonKey: addon.addonKey },
    }],
    metadata: {
      category: 'domain_addon',
      domainServiceId: addon.domainServiceId,
      addonServiceId: addon.id,
    },
  });
  await prisma.domainAddonService.update({
    where: { id: addon.id },
    data: {
      checkoutOrderId: checkout.checkoutOrderId,
      invoiceId: invoice.id,
      billingStatus: 'invoiced',
    },
  });
  return { ...checkout, invoiceId: invoice.id };
}

export async function captureDomainAddonPaymentOrder(input = {}, user = {}) {
  const order = await getCheckoutOrder(input.checkoutOrderId, user);
  if (order.type !== 'domain_addon') throw httpError('Checkout order is not for a domain add-on.', 400);
  if (order.status === 'paid') return order.result || order;
  const addon = await prisma.domainAddonService.findFirst({
    where: { checkoutOrderId: order.id, userId: user.id },
  });
  if (!addon) throw httpError('Charged Glondia add-on not found.', 404);
  const providerOrderId = input.providerOrderId || input.orderId || order.providerOrderId;
  const capturePayload = await capturePayPalOrder(providerOrderId);
  const result = {
    status: 'paid',
    checkoutOrderId: order.id,
    addonServiceId: addon.id,
    addonKey: addon.addonKey,
    domainServiceId: addon.domainServiceId,
    amounts: order.amounts,
  };
  await markCheckoutPaid(order.id, providerOrderId, result, user);
  return result;
}

export async function captureHostingPaymentOrder(input = {}, user = {}) {
  const order = await getCheckoutOrder(input.checkoutOrderId, user);
  if (order.type !== 'deployment') throw httpError('Checkout order is not for a hosting invoice.', 400);
  const { captureDeploymentPaypalOrder } = await import('./deploymentPaypalService.js');
  return captureDeploymentPaypalOrder({
    paypalOrderId: input.providerOrderId || input.orderId || order.providerOrderId,
    user,
  });
}

export async function getHostingPaymentStatus(deploymentId, user = {}) {
  const { findDeploymentRecord } = await import('./deploymentBillingService.js');
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment || !user?.id || (deployment.userId && deployment.userId !== user.id)) {
    throw httpError('Deployment not found.', 404);
  }
  const invoice = await prisma.invoice.findFirst({
    where: {
      userId: user.id,
      lineItems: { some: { serviceType: 'hosting', serviceId: deploymentId } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const transactions = invoice
    ? await prisma.paymentTransaction.findMany({ where: { invoiceId: invoice.id }, orderBy: { createdAt: 'desc' } })
    : [];
  return {
    deploymentId,
    invoiceId: invoice?.id || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    paid: invoice?.status === 'paid',
    paymentStatus: transactions[0]?.status || invoice?.status || 'metering',
    dueAt: invoice?.dueAt || null,
    overdue: invoice?.status === 'overdue',
    paidAt: invoice?.paidAt || null,
    amountCents: invoice?.totalCents ?? null,
    currency: invoice?.currency || null,
  };
}
