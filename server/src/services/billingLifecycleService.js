import { prisma } from './db.js';
import { recordPaymentTransaction } from './billingRecordsService.js';
import { createAdminNotification, createUserNotification } from './notificationService.js';
import { writeAuditLog } from './auditLogService.js';
import { reconcileProviderSettlementStates } from './providerSettlementService.js';

const CUSTOMER_FAILURE_MESSAGE = 'Your payment could not be completed. Please review your payment method or try again.';
const DEFAULT_INTERVAL_MS = Math.max(60_000, Number(process.env.BILLING_RECONCILE_INTERVAL_MS || 5 * 60_000));

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function serviceTypeForOrder(order = {}) {
  if (order.type === 'deployment') return 'hosting';
  if (order.type === 'email_plan') return 'email';
  return order.type || 'platform';
}

function safeFailure(error = {}) {
  const details = error?.details || {};
  return {
    code: String(error.code || details.paypalIssue || details.paypalName || 'PAYMENT_FAILED').slice(0, 100),
    internalMessage: String(error.message || 'Payment failed.').slice(0, 500),
    customerMessage: CUSTOMER_FAILURE_MESSAGE,
    providerStatus: details.paypalStatus || error.paypalStatus || null,
    providerDebugId: details.paypalDebugId || error.paypalDebugId || null,
  };
}

async function notificationExists({ userId = null, entityType, entityId, title }) {
  return prisma.notification.findFirst({
    where: { userId, entityType, entityId, title, deletedAt: null },
    select: { id: true },
  });
}

async function notifyPaymentFailure(order, transaction, failure) {
  const entityId = transaction?.id || order.id;
  const title = 'Payment unsuccessful';
  if (order.userId && !(await notificationExists({
    userId: order.userId,
    entityType: 'payment_transaction',
    entityId,
    title,
  }))) {
    await createUserNotification(order.userId, {
      type: 'danger',
      title,
      message: failure.customerMessage,
      actionUrl: '/dashboard/billing',
      entityType: 'payment_transaction',
      entityId,
      metadata: {
        checkoutOrderId: order.id,
        serviceType: serviceTypeForOrder(order),
        serviceId: order.deploymentId || null,
        failureCode: failure.code,
      },
    });
  }
  const adminTitle = 'Customer payment failed';
  if (!(await notificationExists({
    userId: null,
    entityType: 'payment_transaction',
    entityId,
    title: adminTitle,
  }))) {
    await createAdminNotification({
      type: 'danger',
      title: adminTitle,
      message: `A ${serviceTypeForOrder(order)} payment failed and requires review.`,
      actionUrl: '/admin#billing',
      entityType: 'payment_transaction',
      entityId,
      metadata: {
        checkoutOrderId: order.id,
        userId: order.userId || null,
        failureCode: failure.code,
        providerStatus: failure.providerStatus,
        providerDebugId: failure.providerDebugId,
      },
    });
  }
}

async function markRelatedServiceBilling(order, billingStatus) {
  const serviceType = serviceTypeForOrder(order);
  const serviceId = order.deploymentId || safeJson(order.metadata).serviceId || null;
  const where = serviceId
    ? { serviceType, serviceId }
    : {
        ...(order.userId ? { userId: order.userId } : { organizationId: order.organizationId }),
        serviceType,
        checkoutOrderId: order.id,
      };
  await prisma.serviceAccess.updateMany({
    where,
    data: { billingStatus, lastCheckedAt: new Date() },
  });
}

export async function recordFailedPayment({
  order,
  orderId = null,
  provider = 'paypal',
  providerTransactionId = null,
  paymentMethodId = null,
  error = null,
  source = 'payment_check',
} = {}) {
  const resolvedOrder = order || (orderId
    ? await prisma.checkoutOrder.findUnique({ where: { id: orderId } })
    : null);
  if (!resolvedOrder || resolvedOrder.status === 'paid') return null;
  const failure = safeFailure(error || {});
  const transaction = await recordPaymentTransaction({
    order: resolvedOrder,
    provider,
    providerTransactionId: providerTransactionId || `failed:${resolvedOrder.id}:${failure.code}`,
    status: 'failed',
    paymentMethodId,
    failureCode: failure.code,
    failureMessage: failure.internalMessage,
    metadata: {
      source,
      providerStatus: failure.providerStatus,
      providerDebugId: failure.providerDebugId,
    },
  });
  await prisma.checkoutOrder.updateMany({
    where: { id: resolvedOrder.id, status: { not: 'paid' } },
    data: {
      metadata: JSON.stringify({
        ...safeJson(resolvedOrder.metadata),
        lastPaymentFailure: {
          code: failure.code,
          at: new Date().toISOString(),
          transactionId: transaction?.id || null,
        },
      }),
    },
  });
  await markRelatedServiceBilling(resolvedOrder, 'failed');
  await notifyPaymentFailure(resolvedOrder, transaction, failure);
  await writeAuditLog({
    organizationId: resolvedOrder.organizationId,
    actorUserId: resolvedOrder.userId,
    action: 'billing.payment.failed',
    entityType: 'checkout_order',
    entityId: resolvedOrder.id,
    status: 'failed',
    result: { transactionId: transaction?.id || null, failureCode: failure.code, source },
  }).catch(() => {});
  return transaction;
}

export async function reconcilePaymentOrder(orderId) {
  if (!orderId) return { checked: false, reason: 'missing_order_id' };
  const order = await prisma.checkoutOrder.findUnique({ where: { id: orderId } });
  if (!order) return { checked: false, reason: 'order_not_found' };
  if (order.status === 'paid' && order.providerCaptureId) {
    const transaction = await recordPaymentTransaction({
      order,
      provider: order.provider || 'manual',
      providerTransactionId: order.providerCaptureId,
      status: 'completed',
      metadata: { source: 'async_reconciliation' },
    });
    await markRelatedServiceBilling(order, 'paid');
    return { checked: true, status: 'paid', transactionId: transaction?.id || null };
  }
  if (order.status === 'failed') {
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { checkoutOrderId: order.id, status: 'failed' },
      orderBy: { createdAt: 'desc' },
    });
    if (!transaction) await recordFailedPayment({ order, provider: order.provider, source: 'async_reconciliation' });
    return { checked: true, status: 'failed' };
  }
  return { checked: true, status: order.status };
}

export async function reconcileOverdueInvoices({ now = new Date(), userId = null } = {}) {
  const overdue = await prisma.invoice.findMany({
    where: { status: 'issued', dueAt: { lt: now }, ...(userId ? { userId } : {}) },
    include: { lineItems: true },
  });
  for (const invoice of overdue) {
    await prisma.$transaction([
      prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'overdue' } }),
      prisma.billingLedger.updateMany({
        where: { invoiceId: invoice.id, billingType: 'invoice' },
        data: { status: 'overdue' },
      }),
    ]);
    for (const line of invoice.lineItems) {
      if (!line.serviceType || !line.serviceId) continue;
      await prisma.serviceAccess.updateMany({
        where: { serviceType: line.serviceType, serviceId: line.serviceId },
        data: { billingStatus: 'overdue', lastCheckedAt: now },
      });
    }
    const title = 'Invoice overdue';
    if (invoice.userId && !(await notificationExists({
      userId: invoice.userId,
      entityType: 'invoice',
      entityId: invoice.id,
      title,
    }))) {
      await createUserNotification(invoice.userId, {
        type: 'danger',
        title,
        message: `Invoice ${invoice.invoiceNumber} is overdue. Please make payment to avoid service interruption.`,
        actionUrl: '/dashboard/billing',
        entityType: 'invoice',
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, dueAt: invoice.dueAt },
      });
    }
  }
  return { checked: true, overdue: overdue.length };
}

export async function runBillingReconciliation() {
  const invoices = await reconcileOverdueInvoices();
  const candidates = await prisma.checkoutOrder.findMany({
    where: { status: { in: ['paid', 'failed'] } },
    select: { id: true },
    take: 500,
    orderBy: { updatedAt: 'desc' },
  });
  for (const candidate of candidates) await reconcilePaymentOrder(candidate.id);
  const providerSettlements = await reconcileProviderSettlementStates();
  return { invoices, paymentsChecked: candidates.length, providerSettlements };
}

export function queueBillingCheck(orderId) {
  if (!orderId) return;
  setImmediate(() => {
    reconcilePaymentOrder(orderId).catch((error) => {
      console.error('[billing] async payment check failed:', error.message);
    });
  });
}

export function startBillingReconciliationScheduler() {
  if (String(process.env.BILLING_RECONCILIATION_ENABLED ?? 'true').toLowerCase() === 'false') return null;
  const run = () => runBillingReconciliation().catch((error) => {
    console.error('[billing] reconciliation failed:', error.message);
  });
  run();
  const timer = setInterval(run, DEFAULT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export default {
  recordFailedPayment,
  reconcilePaymentOrder,
  reconcileOverdueInvoices,
  runBillingReconciliation,
  queueBillingCheck,
  startBillingReconciliationScheduler,
};
