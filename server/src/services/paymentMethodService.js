/**
 * paymentMethodService.js
 *
 * Shared wallet for vaulted PayPal / card payment methods.
 *
 * We never store raw card numbers. PayPal holds the card; we store only a
 * provider vault token (providerMethodId) plus display-safe metadata
 * (brand, last4, expiry). That token is the reusable variable for hosting,
 * VPS, domain, email, and other checkouts.
 *
 * Existing one-time PayPal approval flows stay intact. When a capture returns
 * a vault id we save it. When a user pays with a saved method we charge the
 * vault server-side without opening a new PayPal tab.
 */

import { prisma } from './db.js';
import { writeAuditLog } from './auditLogService.js';
import { randomUUID } from 'node:crypto';

const SANDBOX = String(process.env.PAYPAL_SANDBOX ?? 'true').toLowerCase() !== 'false';
const BASE = SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
const RECURRING_USAGE_PATTERN = process.env.PAYPAL_RECURRING_USAGE_PATTERN || 'SUBSCRIPTION_PREPAID';
const SETUP_USAGE_PATTERN = process.env.PAYPAL_SETUP_USAGE_PATTERN || 'IMMEDIATE';
const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5173';

let _token = null;
let _tokenExpiry = 0;

function vaultEnabled() {
  // Default ON. Set PAYPAL_VAULT_ENABLED=false to skip vault request attributes
  // (checkout still works; methods just will not be saved for reuse).
  return String(process.env.PAYPAL_VAULT_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function httpError(message, status = 400, extras = {}) {
  return Object.assign(new Error(message), { status, expose: true, ...extras });
}

function paypalErrorDetails(res, payload = {}) {
  const detail = Array.isArray(payload?.details) ? payload.details[0] : null;
  return {
    provider: 'paypal',
    paypalStatus: res?.status || null,
    paypalDebugId: res?.headers?.get?.('paypal-debug-id') || payload?.debug_id || null,
    paypalName: payload?.name || null,
    paypalMessage: payload?.message || null,
    paypalIssue: detail?.issue || null,
    paypalDescription: detail?.description || null,
  };
}

function paypalErrorMessage(res, payload = {}, fallback = 'PayPal request failed.') {
  const details = paypalErrorDetails(res, payload);
  const parts = [
    payload?.message,
    details.paypalDescription,
    details.paypalIssue ? `Issue: ${details.paypalIssue}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : `${fallback} PayPal returned HTTP ${res?.status || 'error'}.`;
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function dbUserId(userId) {
  return userId && userId !== 'local-user' ? userId : null;
}

function orgIdFor(userId, organizationId) {
  if (organizationId && organizationId !== 'local-org') return organizationId;
  return userId && userId !== 'local-user' ? userId : 'personal';
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const id = process.env.PAYPAL_CLIENT_ID || '';
  const sec = process.env.PAYPAL_CLIENT_SECRET || '';
  if (!id || !sec) throw httpError('PayPal is not configured.', 503);
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${sec}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw httpError('Failed to authenticate with PayPal.', 400);
  const data = await res.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (Number(data.expires_in || 300) - 60) * 1000;
  return _token;
}

async function paypalHeaders() {
  return {
    Authorization: `Bearer ${await getToken()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// ── Public helpers for order builders ─────────────────────────────────────────

/** Whether vault-on-success should be requested for new PayPal orders. */
export function isPaypalVaultEnabled() {
  return vaultEnabled() && Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * Attach PayPal vault attributes to an Orders API body without breaking the
 * classic application_context redirect flow when vault is disabled.
 *
 * When vault is enabled we switch to payment_source.paypal (required by PayPal
 * for vaulting) and map application_context → experience_context.
 */
export function attachVaultRequest(orderBody = {}) {
  if (!isPaypalVaultEnabled()) return orderBody;
  const app = orderBody.application_context || {};
  return {
    intent: orderBody.intent || 'CAPTURE',
    purchase_units: orderBody.purchase_units,
    payment_source: {
      paypal: {
        attributes: {
          vault: {
            store_in_vault: 'ON_SUCCESS',
            usage_type: 'MERCHANT',
            customer_type: 'CONSUMER',
            usage_pattern: RECURRING_USAGE_PATTERN,
          },
        },
        experience_context: {
          brand_name: app.brand_name || 'Glondia',
          shipping_preference: app.shipping_preference || 'NO_SHIPPING',
          user_action: app.user_action || 'PAY_NOW',
          return_url: app.return_url,
          cancel_url: app.cancel_url,
          locale: app.locale || 'en-US',
        },
      },
    },
  };
}

/**
 * Create a PayPal order. Tries vault-enabled body first; on failure falls back
 * to the original body so checkout still works if vault is not approved yet.
 */
export async function createPaypalOrderWithOptionalVault(orderBody) {
  const headers = await paypalHeaders();
  const vaultBody = attachVaultRequest(orderBody);
  const attempt = async (body) => {
    const res = await fetch(`${BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, payload };
  };

  let result = await attempt(vaultBody);
  if (!result.ok && vaultBody !== orderBody) {
    console.warn(
      '[payment-methods] Vault-enabled order create failed; retrying without vault:',
      result.payload?.message || result.status,
    );
    result = await attempt(orderBody);
  }
  if (!result.ok) {
    const msg = result.payload?.message || result.payload?.details?.[0]?.description || 'PayPal order creation failed.';
    throw httpError(msg, result.status >= 400 ? result.status : 400);
  }
  const approvalUrl = result.payload.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href || null;
  return { id: result.payload.id, approvalUrl, payload: result.payload, vaultRequested: vaultBody !== orderBody };
}

export async function capturePaypalOrderRaw(providerOrderId) {
  const id = String(providerOrderId || '').trim();
  if (!id) throw httpError('PayPal order id is required.', 400);
  const res = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify({}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw httpError(payload?.message || 'PayPal capture failed.', res.status >= 400 ? res.status : 400);
  }
  return payload;
}

// ── Extract vault metadata from a capture / order payload ─────────────────────

function pickVaultFromSource(source = {}) {
  const vault = source?.attributes?.vault || source?.vault || null;
  if (!vault?.id) return null;
  return {
    vaultId: vault.id,
    status: vault.status || 'VAULTED',
    customerId: vault.customer?.id || source.attributes?.customer?.id || null,
  };
}

/**
 * Parse a completed PayPal order/capture payload for a vaulted payment source.
 * Returns null when nothing was vaulted (safe — payment still succeeded).
 */
export function extractVaultFromCapture(payload = {}) {
  const paymentSource = payload.payment_source || {};
  if (paymentSource.card) {
    const vault = pickVaultFromSource(paymentSource.card);
    if (!vault) return null;
    return {
      ...vault,
      methodType: 'card',
      brand: String(paymentSource.card.brand || paymentSource.card.name || 'card').toLowerCase(),
      last4: paymentSource.card.last_digits || paymentSource.card.last_digits_number || null,
      expiryMonth: paymentSource.card.expiry
        ? Number(String(paymentSource.card.expiry).split('-')[1]) || null
        : null,
      expiryYear: paymentSource.card.expiry
        ? Number(String(paymentSource.card.expiry).split('-')[0]) || null
        : null,
      email: null,
    };
  }
  if (paymentSource.paypal) {
    const vault = pickVaultFromSource(paymentSource.paypal);
    if (!vault) return null;
    return {
      ...vault,
      methodType: 'paypal',
      brand: 'paypal',
      last4: null,
      expiryMonth: null,
      expiryYear: null,
      email: paymentSource.paypal.email_address || null,
    };
  }
  // Some webhook shapes nest under purchase_units / payer only — no vault.
  return null;
}

function toPublicMethod(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    methodType: row.methodType,
    brand: row.brand,
    last4: row.last4,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    isDefault: row.isDefault,
    status: row.status,
    label: formatMethodLabel(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatMethodLabel(row) {
  if (!row) return 'Payment method';
  if (row.methodType === 'paypal' || row.brand === 'paypal') {
    const meta = safeJson(row.metadata);
    return meta.email ? `PayPal (${meta.email})` : 'PayPal account';
  }
  const brand = (row.brand || 'Card').replace(/^./, (c) => c.toUpperCase());
  return row.last4 ? `${brand} •••• ${row.last4}` : brand;
}

// ── Persist / manage methods ──────────────────────────────────────────────────

/**
 * Save (or refresh) a vaulted method after a successful capture.
 * Never throws into the payment path — vault save failures must not undo paid orders.
 */
function approvalLink(payload = {}) {
  return payload.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href || null;
}

function paymentTokenToMethodPayload(payload = {}) {
  const paypal = payload.payment_source?.paypal || {};
  const card = payload.payment_source?.card || {};
  if (paypal && Object.keys(paypal).length) {
    return {
      vaultId: payload.id,
      methodType: 'paypal',
      brand: 'paypal',
      last4: null,
      expiryMonth: null,
      expiryYear: null,
      metadata: {
        paypalCustomerId: payload.customer?.id || null,
        email: paypal.email_address || null,
        payerId: paypal.payer_id || paypal.account_id || null,
        setupTokenSavedAt: new Date().toISOString(),
      },
    };
  }
  if (card && Object.keys(card).length) {
    return {
      vaultId: payload.id,
      methodType: 'card',
      brand: String(card.brand || card.name || 'card').toLowerCase(),
      last4: card.last_digits || card.last_digits_number || null,
      expiryMonth: card.expiry ? Number(String(card.expiry).split('-')[1]) || null : null,
      expiryYear: card.expiry ? Number(String(card.expiry).split('-')[0]) || null : null,
      metadata: {
        paypalCustomerId: payload.customer?.id || null,
        setupTokenSavedAt: new Date().toISOString(),
      },
    };
  }
  return null;
}

async function savePaymentMethodToken({ userId, organizationId = null, tokenPayload, productType = 'paypal_setup' } = {}) {
  const uid = dbUserId(userId);
  if (!uid) throw httpError('A signed-in account is required to save a payment method.', 401);
  const extracted = paymentTokenToMethodPayload(tokenPayload);
  if (!extracted?.vaultId) throw httpError('PayPal did not return a vault payment token.', 400);

  const existing = await prisma.paymentMethod.findFirst({
    where: { userId: uid, provider: 'paypal', providerMethodId: extracted.vaultId },
  });
  const hasDefault = existing ? null : await prisma.paymentMethod.findFirst({
    where: { userId: uid, isDefault: true, status: 'active' },
    select: { id: true },
  });
  const metadata = JSON.stringify({
    ...(existing ? safeJson(existing.metadata) : {}),
    ...extracted.metadata,
    lastProductType: productType,
  });

  let method = existing
    ? await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: {
          methodType: extracted.methodType,
          brand: extracted.brand,
          last4: extracted.last4,
          expiryMonth: extracted.expiryMonth,
          expiryYear: extracted.expiryYear,
          status: 'active',
          isDefault: true,
          metadata,
        },
      })
    : await prisma.paymentMethod.create({
        data: {
          userId: uid,
          organizationId: orgIdFor(uid, organizationId),
          provider: 'paypal',
          providerMethodId: extracted.vaultId,
          methodType: extracted.methodType,
          brand: extracted.brand,
          last4: extracted.last4,
          expiryMonth: extracted.expiryMonth,
          expiryYear: extracted.expiryYear,
          isDefault: !hasDefault,
          status: 'active',
          metadata,
        },
      });

  await prisma.paymentMethod.updateMany({
    where: { userId: uid, id: { not: method.id }, isDefault: true },
    data: { isDefault: false },
  });
  method = await prisma.paymentMethod.update({ where: { id: method.id }, data: { isDefault: true } });

  await writeAuditLog({
    organizationId: orgIdFor(uid, organizationId),
    actorUserId: uid,
    action: existing ? 'payment_method.connected_refreshed' : 'payment_method.connected',
    entityType: 'payment_method',
    entityId: method.id,
    status: 'success',
    result: { methodType: method.methodType, brand: method.brand, productType },
  }).catch(() => {});

  return toPublicMethod(method);
}

export async function createPaypalVaultSetup({ user = {}, returnUrl = null, cancelUrl = null, source = 'paypal' } = {}) {
  const uid = dbUserId(user?.id);
  if (!uid) throw httpError('A signed-in account is required to connect PayPal.', 401);

  const existing = await getDefaultPaymentMethod(uid);
  const existingMeta = existing ? safeJson(existing.metadata) : {};
  const sourceType = String(source || 'paypal').toLowerCase();
  const appReturn = returnUrl || `${FRONTEND}/dashboard/profile?paypalVault=approved`;
  const appCancel = cancelUrl || `${FRONTEND}/dashboard/profile?paypalVault=cancelled`;
  const body = sourceType === 'card'
    ? {
        payment_source: { card: {} },
        ...(existingMeta.paypalCustomerId ? { customer: { id: existingMeta.paypalCustomerId } } : {}),
      }
    : {
        payment_source: {
          paypal: {
        description: 'Glondia automatic renewal payments',
        permit_multiple_payment_tokens: false,
        usage_pattern: SETUP_USAGE_PATTERN,
        usage_type: 'MERCHANT',
        customer_type: 'CONSUMER',
        ...(existingMeta.paypalCustomerId ? { customer: { id: existingMeta.paypalCustomerId } } : {}),
        experience_context: {
          brand_name: 'Glondia',
          locale: 'en-US',
          shipping_preference: 'NO_SHIPPING',
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          return_url: appReturn,
          cancel_url: appCancel,
        },
      },
        },
      };

  const res = await fetch(`${BASE}/v3/vault/setup-tokens`, {
    method: 'POST',
    headers: {
      ...(await paypalHeaders()),
      'PayPal-Request-Id': `glondia-setup-${uid}-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = paypalErrorDetails(res, payload);
    throw httpError(
      paypalErrorMessage(res, payload, 'Could not start PayPal connection.'),
      res.status >= 400 ? res.status : 400,
      { code: 'PAYPAL_VAULT_SETUP_FAILED', details },
    );
  }
  return {
    setupTokenId: payload.id,
    status: payload.status,
    approvalUrl: approvalLink(payload),
    paypalCustomerId: payload.customer?.id || existingMeta.paypalCustomerId || null,
  };
}

export async function completePaypalVaultSetup({ user = {}, setupTokenId } = {}) {
  const uid = dbUserId(user?.id);
  if (!uid) throw httpError('A signed-in account is required to connect PayPal.', 401);
  const id = String(setupTokenId || '').trim();
  if (!id) throw httpError('PayPal setup token is required.', 400);

  const res = await fetch(`${BASE}/v3/vault/payment-tokens`, {
    method: 'POST',
    headers: {
      ...(await paypalHeaders()),
      'PayPal-Request-Id': `glondia-token-${uid}-${id}`,
    },
    body: JSON.stringify({ payment_source: { token: { id, type: 'SETUP_TOKEN' } } }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = paypalErrorDetails(res, payload);
    throw httpError(
      paypalErrorMessage(res, payload, 'Could not finish PayPal connection.'),
      res.status >= 400 ? res.status : 400,
      { code: 'PAYPAL_VAULT_COMPLETE_FAILED', details },
    );
  }
  const method = await savePaymentMethodToken({
    userId: uid,
    organizationId: user?.organizationId || null,
    tokenPayload: payload,
  });
  return { paymentMethod: method };
}

export async function savePaymentMethodFromCapture({
  userId,
  organizationId = null,
  capturePayload = null,
  productType = null,
  setDefault = true,
} = {}) {
  try {
    const uid = dbUserId(userId);
    if (!uid) return null;
    const extracted = extractVaultFromCapture(capturePayload || {});
    if (!extracted?.vaultId) return null;

    const existing = await prisma.paymentMethod.findFirst({
      where: {
        userId: uid,
        provider: 'paypal',
        providerMethodId: extracted.vaultId,
      },
    });

    const metadata = {
      ...(existing ? safeJson(existing.metadata) : {}),
      paypalCustomerId: extracted.customerId || null,
      email: extracted.email || null,
      lastProductType: productType || null,
      lastVaultStatus: extracted.status || null,
      lastCapturedAt: new Date().toISOString(),
    };

    let method;
    if (existing) {
      method = await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: {
          methodType: extracted.methodType || existing.methodType,
          brand: extracted.brand || existing.brand,
          last4: extracted.last4 || existing.last4,
          expiryMonth: extracted.expiryMonth ?? existing.expiryMonth,
          expiryYear: extracted.expiryYear ?? existing.expiryYear,
          status: 'active',
          metadata: JSON.stringify(metadata),
          ...(setDefault ? { isDefault: true } : {}),
        },
      });
    } else {
      const hasDefault = await prisma.paymentMethod.findFirst({
        where: { userId: uid, isDefault: true, status: 'active' },
        select: { id: true },
      });
      method = await prisma.paymentMethod.create({
        data: {
          userId: uid,
          organizationId: orgIdFor(uid, organizationId),
          provider: 'paypal',
          providerMethodId: extracted.vaultId,
          methodType: extracted.methodType || 'unknown',
          brand: extracted.brand || null,
          last4: extracted.last4 || null,
          expiryMonth: extracted.expiryMonth,
          expiryYear: extracted.expiryYear,
          isDefault: setDefault || !hasDefault,
          status: 'active',
          metadata: JSON.stringify(metadata),
        },
      });
    }

    if (setDefault || method.isDefault) {
      await prisma.paymentMethod.updateMany({
        where: { userId: uid, id: { not: method.id }, isDefault: true },
        data: { isDefault: false },
      });
      method = await prisma.paymentMethod.update({
        where: { id: method.id },
        data: { isDefault: true },
      });
      await syncProfileBillingDisplay(uid, method).catch(() => {});
    }

    await writeAuditLog({
      organizationId: orgIdFor(uid, organizationId),
      actorUserId: uid,
      action: existing ? 'payment_method.refreshed' : 'payment_method.saved',
      entityType: 'payment_method',
      entityId: method.id,
      status: 'success',
      result: {
        methodType: method.methodType,
        brand: method.brand,
        last4: method.last4,
        productType,
      },
    }).catch(() => {});

    return toPublicMethod(method);
  } catch (err) {
    console.warn('[payment-methods] Failed to save vaulted method:', err.message);
    return null;
  }
}

/** Payment method display comes from payment_methods, not profile billingInfo. */
async function syncProfileBillingDisplay() {
  return null;
}

export async function listPaymentMethodsForUser(userId) {
  const uid = dbUserId(userId);
  if (!uid) return [];
  const rows = await prisma.paymentMethod.findMany({
    where: { userId: uid, status: { not: 'deleted' } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toPublicMethod);
}

export async function getDefaultPaymentMethod(userId) {
  const uid = dbUserId(userId);
  if (!uid) return null;
  const row = await prisma.paymentMethod.findFirst({
    where: { userId: uid, status: 'active', isDefault: true },
  }) || await prisma.paymentMethod.findFirst({
    where: { userId: uid, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  return row;
}

export async function getOwnedPaymentMethod(userId, paymentMethodId) {
  const uid = dbUserId(userId);
  if (!uid || !paymentMethodId) return null;
  return prisma.paymentMethod.findFirst({
    where: { id: paymentMethodId, userId: uid, status: { not: 'deleted' } },
  });
}

export async function setDefaultPaymentMethod(userId, paymentMethodId) {
  const method = await getOwnedPaymentMethod(userId, paymentMethodId);
  if (!method) throw httpError('Payment method not found.', 404);
  if (method.status !== 'active') throw httpError('That payment method is not active.', 400);

  await prisma.paymentMethod.updateMany({
    where: { userId: method.userId, isDefault: true },
    data: { isDefault: false },
  });
  const updated = await prisma.paymentMethod.update({
    where: { id: method.id },
    data: { isDefault: true },
  });
  await syncProfileBillingDisplay(method.userId, updated).catch(() => {});
  return toPublicMethod(updated);
}

export async function removePaymentMethod(userId, paymentMethodId) {
  const method = await getOwnedPaymentMethod(userId, paymentMethodId);
  if (!method) throw httpError('Payment method not found.', 404);

  await prisma.paymentMethod.update({
    where: { id: method.id },
    data: { status: 'deleted', isDefault: false },
  });

  // Promote another active method if we removed the default.
  if (method.isDefault) {
    const next = await prisma.paymentMethod.findFirst({
      where: { userId: method.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (next) {
      await prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
      await syncProfileBillingDisplay(method.userId, next).catch(() => {});
    } else {
      // Nothing to mirror into profile billingInfo.
    }
  }
  return { removed: true, id: method.id };
}

// ── Charge a vaulted method (MIT) ─────────────────────────────────────────────

/**
 * Create + capture a PayPal order using a saved vault token.
 * Returns { paypalOrderId, captureId, capture, amount, currency }.
 */
export async function chargeVaultedPaymentMethod({
  paymentMethod,
  amountValue,
  currency = 'USD',
  description = 'Glondia payment',
  referenceId = null,
  customId = null,
  itemName = null,
} = {}) {
  if (!paymentMethod?.providerMethodId) {
    throw httpError('This payment method has no vault token. Pay with PayPal once to save it.', 400);
  }
  if (paymentMethod.provider !== 'paypal') {
    throw httpError('Only PayPal-vaulted methods can be charged here.', 400);
  }
  if (paymentMethod.status !== 'active') {
    throw httpError('That payment method is not active.', 400);
  }

  const value = String(amountValue);
  const cur = String(currency || 'USD').toUpperCase();
  const meta = safeJson(paymentMethod.metadata);
  const isCard = paymentMethod.methodType === 'card';

  const storedCredential = {
    payment_initiator: 'MERCHANT',
    usage: 'SUBSEQUENT',
    usage_pattern: RECURRING_USAGE_PATTERN,
  };

  const payment_source = isCard
    ? {
        card: {
          vault_id: paymentMethod.providerMethodId,
          stored_credential: storedCredential,
        },
      }
    : {
        paypal: {
          vault_id: paymentMethod.providerMethodId,
          stored_credential: storedCredential,
          ...(meta.paypalCustomerId ? { attributes: { customer: { id: meta.paypalCustomerId } } } : {}),
        },
      };

  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: String(referenceId || paymentMethod.id).slice(0, 256),
      custom_id: String(customId || referenceId || paymentMethod.id).slice(0, 127),
      description: String(description || 'Glondia payment').slice(0, 127),
      amount: {
        currency_code: cur,
        value,
        breakdown: { item_total: { currency_code: cur, value } },
      },
      items: [{
        name: String(itemName || description || 'Glondia payment').slice(0, 127),
        quantity: '1',
        unit_amount: { currency_code: cur, value },
        category: 'DIGITAL_GOODS',
      }],
    }],
    payment_source,
  };

  const createRes = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: await paypalHeaders(),
    body: JSON.stringify(body),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const msg = created?.message || created?.details?.[0]?.description || 'Could not charge the saved payment method.';
    console.error('[payment-methods] vault charge create failed:', JSON.stringify(created).slice(0, 800));
    throw httpError(msg, createRes.status >= 400 ? createRes.status : 400);
  }

  let capturePayload = created;
  if (created.status !== 'COMPLETED') {
    capturePayload = await capturePaypalOrderRaw(created.id);
  }

  const captureRecord = capturePayload.purchase_units?.[0]?.payments?.captures?.[0];
  if (!captureRecord || captureRecord.status !== 'COMPLETED') {
    throw httpError(
      `Saved-method payment not completed. Status: ${captureRecord?.status || capturePayload.status || 'unknown'}`,
      400,
    );
  }

  // Touch last-used metadata.
  try {
    await prisma.paymentMethod.update({
      where: { id: paymentMethod.id },
      data: {
        metadata: JSON.stringify({
          ...meta,
          lastChargedAt: new Date().toISOString(),
          lastChargeCaptureId: captureRecord.id,
        }),
      },
    });
  } catch { /* non-fatal */ }

  return {
    paypalOrderId: created.id || capturePayload.id,
    captureId: captureRecord.id,
    capture: captureRecord,
    capturePayload,
    amount: captureRecord.amount?.value || value,
    currency: captureRecord.amount?.currency_code || cur,
  };
}

/**
 * Resolve a user's payment method (explicit id or default) and charge it.
 */
export async function chargeUserPaymentMethod({
  userId,
  paymentMethodId = null,
  amountValue,
  currency = 'USD',
  description,
  referenceId,
  customId,
  itemName,
  productType = null,
} = {}) {
  const uid = dbUserId(userId);
  if (!uid) throw httpError('A signed-in account is required to use a saved payment method.', 401);

  let method = paymentMethodId
    ? await getOwnedPaymentMethod(uid, paymentMethodId)
    : await getDefaultPaymentMethod(uid);

  if (!method || method.status !== 'active') {
    throw httpError(
      'No saved payment method on file. Complete a PayPal checkout once to save a card or PayPal account for reuse.',
      400,
    );
  }

  const result = await chargeVaultedPaymentMethod({
    paymentMethod: method,
    amountValue,
    currency,
    description,
    referenceId,
    customId,
    itemName,
  });

  await writeAuditLog({
    organizationId: orgIdFor(uid, method.organizationId),
    actorUserId: uid,
    action: 'payment_method.charged',
    entityType: 'payment_method',
    entityId: method.id,
    status: 'success',
    result: {
      productType,
      captureId: result.captureId,
      amount: result.amount,
      currency: result.currency,
      referenceId,
    },
  }).catch(() => {});

  return { ...result, paymentMethod: toPublicMethod(method) };
}

export default {
  isPaypalVaultEnabled,
  attachVaultRequest,
  createPaypalOrderWithOptionalVault,
  capturePaypalOrderRaw,
  extractVaultFromCapture,
  savePaymentMethodFromCapture,
  listPaymentMethodsForUser,
  getDefaultPaymentMethod,
  getOwnedPaymentMethod,
  setDefaultPaymentMethod,
  removePaymentMethod,
  createPaypalVaultSetup,
  completePaypalVaultSetup,
  chargeVaultedPaymentMethod,
  chargeUserPaymentMethod,
};
