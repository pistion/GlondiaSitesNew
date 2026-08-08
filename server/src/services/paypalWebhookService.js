/**
 * paypalWebhookService.js
 *
 * Server-to-server safety net for PayPal payments. PayPal calls our webhook
 * (configured in the PayPal dashboard) on payment events, so a deployment is
 * marked paid even if the buyer closes the approval tab before the frontend
 * captures. The webhook URL is /api/v1/payments/paypal/webhook.
 *
 * Every event is signature-verified against PAYPAL_WEBHOOK_ID via PayPal's
 * verify-webhook-signature API before we trust it. Handling is idempotent:
 * markDeploymentPaid / capture are safe to call more than once.
 */
import { prisma } from './db.js';
import { markDeploymentPaid } from './deploymentBillingService.js';
import { writeAuditLog } from './auditLogService.js';
import { assertAmountMatchesTier } from './paymentVerificationGuards.js';
import {
  getPaypalAccessToken,
  getPaypalApiBase,
  captureDeploymentPaypalOrder,
} from './deploymentPaypalService.js';
import { syncServiceAccessOnPayment } from './serviceAccessService.js';
import { recordPaymentTransaction } from './billingRecordsService.js';
import { recordFailedPayment } from './billingLifecycleService.js';

export function webhookConfigured() {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_CLIENT_SECRET &&
    process.env.PAYPAL_WEBHOOK_ID,
  );
}

/**
 * Verify a webhook delivery using PayPal's verify-webhook-signature endpoint.
 * Returns { ok, status, event } — event is the parsed JSON body.
 */
export async function verifyPaypalWebhook({ headers = {}, rawBody } = {}) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || '';
  if (!webhookId) return { ok: false, reason: 'PAYPAL_WEBHOOK_ID is not configured.' };

  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || ''));
  } catch {
    return { ok: false, reason: 'Webhook body was not valid JSON.' };
  }

  const token = await getPaypalAccessToken();
  const res = await fetch(`${getPaypalApiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `verify-webhook-signature failed: ${body}`, event };
  }
  const data = await res.json();
  return { ok: data.verification_status === 'SUCCESS', status: data.verification_status, event };
}

/** Find our CheckoutOrder for a capture/order resource via PayPal order id or custom_id. */
async function findOrderForResource(resource = {}) {
  const paypalOrderId = resource?.supplementary_data?.related_ids?.order_id || (resource?.intent ? resource.id : null);
  if (paypalOrderId) {
    const byOrder = await prisma.checkoutOrder.findFirst({ where: { providerOrderId: paypalOrderId } });
    if (byOrder) return byOrder;
  }
  // custom_id was set to deploymentId || order.id on the purchase unit.
  if (resource?.custom_id) {
    return prisma.checkoutOrder.findFirst({
      where: { OR: [{ deploymentId: resource.custom_id }, { id: resource.custom_id }] },
      orderBy: { createdAt: 'desc' },
    });
  }
  return null;
}

/**
 * Act on a verified webhook event. Idempotent via WebhookEvent table.
 *  - CHECKOUT.ORDER.APPROVED  → capture (completes the payment automatically)
 *  - PAYMENT.CAPTURE.COMPLETED → mark the order + deployment paid + sync ServiceAccess
 */
export async function handlePaypalWebhookEvent(event = {}) {
  const type = event?.event_type;
  const providerEventId = event?.id || null;
  const resource = event?.resource || {};

  // ── WebhookEvent idempotency ──────────────────────────────────────────────
  // Every event gets a record. If we've already processed this providerEventId,
  // short-circuit immediately rather than double-applying the payment.
  let webhookRecord = null;
  if (providerEventId) {
    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_providerEventId: { provider: 'paypal', providerEventId } },
    });
    if (existing?.status === 'processed') {
      return { handled: true, duplicate: true, providerEventId };
    }
    if (!existing) {
      webhookRecord = await prisma.webhookEvent.create({
        data: {
          provider: 'paypal',
          providerEventId,
          eventType: type || 'unknown',
          status: 'received',
          signatureValid: true,
          metadata: JSON.stringify({ eventType: type }),
        },
      }).catch(() => null); // Non-fatal if create races with another process.
    } else {
      webhookRecord = existing;
    }
  }

  const markWebhookStatus = async (status, errorMessage = null) => {
    if (!webhookRecord) return;
    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: { status, processedAt: new Date(), ...(errorMessage ? { errorMessage } : {}) },
    }).catch(() => {});
  };

  // ── Event handling ────────────────────────────────────────────────────────

  if (type === 'CHECKOUT.ORDER.APPROVED') {
    const paypalOrderId = resource.id;
    const order = await prisma.checkoutOrder.findFirst({ where: { providerOrderId: paypalOrderId } });
    if (!order) {
      await markWebhookStatus('ignored');
      return { handled: false, reason: 'order_not_found' };
    }
    if (order.status === 'paid') {
      await markWebhookStatus('processed');
      return { handled: true, alreadyPaid: true };
    }
    // role:'admin' bypasses the per-user owner check for this system-initiated capture.
    let result;
    try {
      result = await captureDeploymentPaypalOrder({ paypalOrderId, user: { id: order.userId || null, role: 'admin' } });
    } catch (error) {
      await recordFailedPayment({
        order,
        provider: 'paypal',
        providerTransactionId: resource.id || paypalOrderId,
        error,
        source: 'paypal_webhook_approved_capture',
      });
      await markWebhookStatus('failed', error.message);
      return { handled: true, captured: false, failed: true };
    }
    await markWebhookStatus('processed');
    return { handled: true, captured: true, result };
  }

  if (['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.REVERSED'].includes(type)) {
    const order = await findOrderForResource(resource);
    if (!order) {
      await markWebhookStatus('ignored');
      return { handled: false, reason: 'order_not_found' };
    }
    await recordFailedPayment({
      order,
      provider: 'paypal',
      providerTransactionId: resource.id || providerEventId || null,
      error: Object.assign(new Error(resource.status_details?.reason || 'PayPal rejected the payment.'), {
        code: resource.status_details?.reason || type.replaceAll('.', '_'),
      }),
      source: 'paypal_webhook',
    });
    await markWebhookStatus('processed');
    return { handled: true, failed: true, orderId: order.id };
  }

  if (type === 'PAYMENT.CAPTURE.COMPLETED') {
    const order = await findOrderForResource(resource);
    if (!order) {
      await markWebhookStatus('ignored');
      return { handled: false, reason: 'order_not_found' };
    }
    if (order.status === 'paid') {
      await markWebhookStatus('processed');
      return { handled: true, alreadyPaid: true };
    }
    if (!resource.id) {
      await markWebhookStatus('failed', 'missing_capture_id');
      return { handled: false, reason: 'missing_capture_id' };
    }

    // The captured amount/currency must match the order's tier processor charge.
    assertAmountMatchesTier({
      order,
      amount: resource.amount?.value,
      currency: resource.amount?.currency_code,
    });

    let result;
    if (order.deploymentId) {
      result = await markDeploymentPaid({
        deploymentId: order.deploymentId,
        checkoutOrderId: order.id,
        via: 'paypal_webhook',
        providerCaptureId: resource.id,
      });
      await syncServiceAccessOnPayment({
        userId: order.userId || null,
        deploymentId: order.deploymentId,
        orderId: order.id,
        via: 'paypal_webhook',
      });
    } else {
      const paidOrder = await prisma.checkoutOrder.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date(), providerCaptureId: resource.id },
      });
      await recordPaymentTransaction({
        order: paidOrder,
        providerTransactionId: resource.id,
        provider: 'paypal',
        status: 'completed',
        metadata: { via: 'paypal_webhook' },
      });
      result = { orderId: order.id };
    }

    await writeAuditLog({
      actorUserId: null,
      action: 'payment.paypal.webhook_captured',
      entityType: 'checkout_order',
      entityId: order.id,
      result: { deploymentId: order.deploymentId || null, captureId: resource.id, via: 'paypal_webhook' },
    });

    if (webhookRecord) {
      await prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
          relatedOrderId: order.id,
          relatedServiceType: order.deploymentId ? 'hosting' : null,
          relatedServiceId: order.deploymentId || null,
        },
      }).catch(() => {});
    }

    return { handled: true, result };
  }

  await markWebhookStatus('ignored');
  return { handled: false, reason: 'ignored_event_type', type };
}

export default { webhookConfigured, verifyPaypalWebhook, handlePaypalWebhookEvent };
