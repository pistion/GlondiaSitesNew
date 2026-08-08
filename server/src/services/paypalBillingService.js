import { prisma } from './db.js';
import { calcPricing } from './vpsPricingService.js';
import * as vultr from './vultrApiService.js';
import {
  createPaypalOrderWithOptionalVault,
  savePaymentMethodFromCapture,
} from './paymentMethodService.js';
import { recordPaymentTransaction } from './billingRecordsService.js';

const FRONTEND    = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Creates a PayPal order and a CheckoutOrder DB record (status=pending).
 * Stores provisionDetails server-side so capture never trusts the client.
 */
export async function createOrder(organizationId, userId, dto) {
  const plans = await vultr.listPlans(undefined, { region: dto.region });
  const plan = plans.find((p) => p.id === dto.plan);
  if (!plan) {
    throw Object.assign(
      new Error(`Plan "${dto.plan}" is not available in region "${dto.region}". Choose an available plan for this location.`),
      { status: 400 },
    );
  }

  const { baseCents, mkupCents, totalCents, markup } = calcPricing(plan.monthly_cost);
  const totalAmount = (totalCents / 100).toFixed(2);

  let order;
  let approvalUrl;
  try {
    const created = await createPaypalOrderWithOptionalVault({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `vps-${organizationId}-${Date.now()}`,
        description:  `Glondia VPS – ${dto.label} (${dto.region} / ${dto.plan})`,
        amount: {
          currency_code: 'USD', value: totalAmount,
          breakdown: { item_total: { currency_code: 'USD', value: totalAmount } },
        },
        items: [{
          name: `VPS Server — ${dto.label}`,
          description: `Region: ${dto.region} | Plan: ${dto.plan}`,
          quantity: '1',
          unit_amount: { currency_code: 'USD', value: totalAmount },
          category: 'DIGITAL_GOODS',
        }],
      }],
      application_context: {
        brand_name: 'Glondia', locale: 'en-US',
        shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: `${FRONTEND}/dashboard/hosting?vps=success`,
        cancel_url: `${FRONTEND}/dashboard/hosting?vps=cancelled`,
      },
    });
    order = { id: created.id };
    approvalUrl = created.approvalUrl;
  } catch (err) {
    console.error('[paypal] createOrder failed:', err.message);
    throw Object.assign(new Error('Failed to create PayPal order. Please try again.'), { status: 400 });
  }

  // Store provision details and expected amount server-side
  const provisionDetails = {
    plan: dto.plan, region: dto.region, osId: dto.osId,
    label: dto.label, hostname: dto.hostname ?? dto.label,
    sshKeyId: dto.sshKeyId, sshPublicKey: dto.sshPublicKey, sshKeyName: dto.sshKeyName,
    userData: dto.userData, enableIpv6: dto.enableIpv6,
    backups: dto.backups, ddosProtection: dto.ddosProtection,
  };

  await prisma.checkoutOrder.create({
    data: {
      organizationId,
      userId:           userId === 'local-user' ? null : userId,
      type:             'vps',
      provider:         'paypal',
      providerOrderId:  order.id,
      status:           'pending',
      currency:         'USD',
      actualAmountCents: baseCents,
      markupPercent:    markup,
      markupAmountCents: mkupCents,
      totalAmountCents:  totalCents,
      metadata: JSON.stringify({ provisionDetails }),
    },
  });

  return {
    orderId: order.id,
    approvalUrl,
    // Customer-facing quote: price and currency only — cost and margin stay internal.
    quote: {
      totalMonthlyCostCents: totalCents,
      currency: 'USD',
    },
  };
}

/**
 * Captures a PayPal payment. Verifies amount and currency.
 * Returns { checkoutOrder, captureRecord, provisionDetails }.
 * Throws if the order doesn't belong to this org or capture fails.
 */
export async function captureOrder(organizationId, paypalOrderId) {
  // Load server-side order record — rejects cross-org capture
  const checkoutOrder = await prisma.checkoutOrder.findFirst({
    where: { providerOrderId: paypalOrderId, organizationId },
  });
  if (!checkoutOrder) {
    throw Object.assign(new Error('Order not found or does not belong to this account.'), { status: 404 });
  }

  // Idempotency: already captured
  if (checkoutOrder.status === 'paid') {
    const meta = JSON.parse(checkoutOrder.metadata || '{}');
    return { checkoutOrder, captureRecord: meta.paypalCapture, provisionDetails: meta.provisionDetails };
  }

  const { capturePaypalOrderRaw } = await import('./paymentMethodService.js');
  let capture;
  try {
    capture = await capturePaypalOrderRaw(paypalOrderId);
  } catch (err) {
    console.error('[paypal] capture failed:', err.message);
    throw Object.assign(new Error('PayPal payment capture failed. Please try again.'), { status: 400 });
  }

  const captureRecord = capture.purchase_units?.[0]?.payments?.captures?.[0];

  if (!captureRecord || captureRecord.status !== 'COMPLETED') {
    throw Object.assign(
      new Error(`Payment not completed. Status: ${captureRecord?.status ?? 'unknown'}`),
      { status: 400 },
    );
  }

  // Verify currency and amount
  if (captureRecord.amount?.currency_code !== 'USD') {
    throw Object.assign(new Error('Unexpected payment currency.'), { status: 400 });
  }
  const capturedCents = Math.round(parseFloat(captureRecord.amount.value) * 100);
  if (capturedCents !== checkoutOrder.totalAmountCents) {
    console.error(`[paypal] amount mismatch: expected ${checkoutOrder.totalAmountCents}, got ${capturedCents}`);
    throw Object.assign(new Error('Payment amount mismatch. Contact support.'), { status: 400 });
  }

  const meta = JSON.parse(checkoutOrder.metadata || '{}');
  const updatedMeta = { ...meta, paypalCapture: captureRecord };

  const updated = await prisma.checkoutOrder.update({
    where: { id: checkoutOrder.id },
    data: {
      status:            'paid',
      providerCaptureId: captureRecord.id,
      metadata:          JSON.stringify(updatedMeta),
    },
  });
  await recordPaymentTransaction({
    order: updated,
    providerTransactionId: captureRecord.id,
    provider: 'paypal',
    status: 'completed',
    metadata: { paypalOrderId },
  });

  // Best-effort: save vaulted method for shared wallet reuse.
  await savePaymentMethodFromCapture({
    userId: checkoutOrder.userId,
    organizationId,
    capturePayload: capture,
    productType: 'vps',
  });

  return { checkoutOrder: updated, captureRecord, provisionDetails: meta.provisionDetails };
}

/**
 * Update a checkout order's lifecycle status (e.g. provision_failed, db_error).
 * Owned by the billing service so feature services never touch the orders
 * table directly. Never throws — order-state bookkeeping must not mask the
 * originating failure.
 */
export async function updateOrderStatus(checkoutOrderId, status) {
  try {
    return await prisma.checkoutOrder.update({ where: { id: checkoutOrderId }, data: { status } });
  } catch (err) {
    console.error(`[paypal] Failed to set order ${checkoutOrderId} → ${status}:`, err.message);
    return null;
  }
}
