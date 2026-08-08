/**
 * Hosting invoice checkout and payment settlement.
 *
 * This module contains no prices. A hosting charge must first exist as a
 * BillingUsageRecord and be included in an issued Invoice. Checkout orders are
 * payment intents for that immutable invoice total.
 */
import { prisma } from './db.js';
import renderApiService from './renderApiService.js';
import { writeAuditLog } from './auditLogService.js';
import { readHostingStore, nowIso } from './hostingStore.js';
import { updateDeploymentRecord } from '../glondia-engines/00-SHARED/deploymentRecordStore.js';
import * as hostingRepo from '../repositories/hosting.repository.js';
import {
  assertOrderBelongsToDeployment,
  assertOrderPayable,
  assertVerifiedPaymentSignal,
  isAdminVia,
} from './paymentVerificationGuards.js';
import { createUserNotification } from './notificationService.js';
import { recordPaymentTransaction } from './billingRecordsService.js';

function dbUserId(userId) {
  return userId && userId !== 'local-user' ? userId : null;
}

function organizationIdFor(userId) {
  return dbUserId(userId) || 'personal';
}

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export async function findDeploymentRecord(deploymentId) {
  const canonical = await hostingRepo.findById(deploymentId).catch(() => null);
  if (canonical) {
    return {
      deploymentId: canonical.id,
      userId: canonical.createdByUserId,
      organizationId: canonical.organizationId,
      serviceName: canonical.name,
      renderServiceId: canonical.providerServiceId,
      serviceType: canonical.serviceType,
      status: canonical.status,
      paymentStatus: canonical.paymentStatus,
      renderPlan: canonical.plan,
      liveUrl: canonical.url,
    };
  }
  const store = await readHostingStore();
  return (store.deployments || []).find(
    (deployment) => deployment.deploymentId === deploymentId || deployment.id === deploymentId,
  ) || null;
}

export async function getOrderForDeployment(deploymentId) {
  if (!deploymentId) return null;
  return prisma.checkoutOrder.findFirst({
    where: { deploymentId, type: 'deployment' },
    orderBy: { createdAt: 'desc' },
  });
}

async function findPayableInvoice(deploymentId, userId = null) {
  return prisma.invoice.findFirst({
    where: {
      ...(dbUserId(userId) ? { userId: dbUserId(userId) } : {}),
      status: { in: ['issued', 'overdue'] },
      lineItems: { some: { serviceType: 'hosting', serviceId: deploymentId } },
    },
    include: { lineItems: true },
    orderBy: { createdAt: 'desc' },
  });
}

function checkoutSummary(invoice, order = null, message = null) {
  return {
    checkoutOrderId: order?.id || null,
    invoiceId: invoice?.id || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    status: order?.status || invoice?.status || 'metering',
    amountCents: invoice?.totalCents ?? null,
    currency: invoice?.currency || null,
    billingDueAt: invoice?.dueAt?.toISOString?.() || invoice?.dueAt || null,
    message: message || (invoice
      ? 'Payment is based on the recorded invoice total.'
      : 'Usage is being recorded. Payment becomes available after an invoice is issued.'),
  };
}

export async function createDeploymentOrder({ deployment, user = {}, kind = 'deployment' } = {}) {
  if (!deployment?.deploymentId) {
    throw Object.assign(new Error('A deployment record is required.'), { status: 400, expose: true });
  }
  const userId = user.id || deployment.userId || null;
  const invoice = await findPayableInvoice(deployment.deploymentId, userId);
  if (!invoice) {
    await updateDeploymentRecord(deployment.deploymentId, {
      billingAttachStatus: 'metering',
      billingKind: kind,
      billingErrorMessage: null,
      billingErrorAt: null,
    }).catch(() => {});
    return checkoutSummary(null);
  }

  const existing = await prisma.checkoutOrder.findFirst({
    where: {
      deploymentId: deployment.deploymentId,
      type: 'deployment',
      status: { in: ['pending', 'payment_uploaded'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing && safeJson(existing.metadata).invoiceId === invoice.id) {
    return checkoutSummary(invoice, existing, 'A payment order already exists for this invoice.');
  }

  const order = await prisma.checkoutOrder.create({
    data: {
      organizationId: deployment.organizationId || organizationIdFor(userId),
      userId: dbUserId(userId),
      type: 'deployment',
      provider: 'paypal',
      status: 'pending',
      currency: invoice.currency,
      actualAmountCents: invoice.totalCents,
      markupPercent: 0,
      markupAmountCents: 0,
      totalAmountCents: invoice.totalCents,
      deploymentId: deployment.deploymentId,
      dueAt: invoice.dueAt,
      metadata: JSON.stringify({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        deploymentId: deployment.deploymentId,
        kind,
        pricingSource: 'invoice',
      }),
    },
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { orderId: order.id } });
  await updateDeploymentRecord(deployment.deploymentId, {
    checkoutOrderId: order.id,
    paymentStatus: 'pending',
    billingAttachStatus: 'complete',
    billingKind: kind,
    priceCents: invoice.totalCents,
    priceCurrency: invoice.currency,
    billingDueAt: invoice.dueAt?.toISOString?.() || null,
  }).catch(() => {});
  await writeAuditLog({
    organizationId: deployment.organizationId || organizationIdFor(userId),
    actorUserId: dbUserId(userId),
    action: 'hosting.invoice.checkout_created',
    entityType: 'checkout_order',
    entityId: order.id,
    result: {
      deploymentId: deployment.deploymentId,
      invoiceId: invoice.id,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
    },
  });
  await createUserNotification(userId, {
    type: 'billing',
    title: 'Hosting invoice ready',
    message: `Invoice ${invoice.invoiceNumber} is ready for payment.`,
    actionUrl: '/dashboard/billing',
    entityType: 'invoice',
    entityId: invoice.id,
  });
  return checkoutSummary(invoice, order);
}

export async function createDeploymentRenewalOrder({ deploymentId, user = {} } = {}) {
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment) throw Object.assign(new Error('Deployment not found.'), { status: 404, expose: true });
  if (user?.role !== 'admin' && deployment.userId && deployment.userId !== user?.id) {
    throw Object.assign(new Error('This deployment belongs to another account.'), { status: 403, expose: true });
  }
  return createDeploymentOrder({ deployment, user, kind: 'invoice_payment' });
}

export async function markDeploymentPaid({
  deploymentId,
  checkoutOrderId = null,
  orderId = null,
  actorUserId = null,
  via = 'manual',
  providerCaptureId = null,
} = {}) {
  if (!deploymentId) throw Object.assign(new Error('deploymentId is required.'), { status: 400, expose: true });
  assertVerifiedPaymentSignal({ via, providerCaptureId, actorUserId });
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment) throw Object.assign(new Error('Deployment not found.'), { status: 404 });

  const requestedOrderId = checkoutOrderId || orderId;
  const order = requestedOrderId
    ? await prisma.checkoutOrder.findUnique({ where: { id: requestedOrderId } })
    : await getOrderForDeployment(deploymentId);
  if (!order && !isAdminVia(via)) {
    throw Object.assign(new Error('A checkout order is required to verify this payment.'), { status: 400, expose: true });
  }
  assertOrderBelongsToDeployment(order, deploymentId);
  assertOrderPayable(order);
  if (order?.status === 'paid') {
    return { deploymentId, orderId: order.id, alreadyPaid: true, paidAt: order.paidAt };
  }

  const paidAt = new Date();
  if (order) {
    const paidOrder = await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt,
        providerCaptureId: providerCaptureId || order.providerCaptureId,
        metadata: JSON.stringify({
          ...safeJson(order.metadata),
          paidVia: via,
          verifiedAt: paidAt.toISOString(),
          providerCaptureId: providerCaptureId || order.providerCaptureId || null,
          verifiedBy: actorUserId || null,
        }),
      },
    });
    await recordPaymentTransaction({
      order: paidOrder,
      invoiceId: safeJson(paidOrder.metadata).invoiceId || null,
      providerTransactionId: providerCaptureId || paidOrder.providerCaptureId || `${via}:${paidOrder.id}`,
      provider: via.startsWith('paypal') ? 'paypal' : via,
      status: 'completed',
      metadata: { via, verifiedBy: actorUserId || null },
    });
  }

  let resumed = false;
  if (deployment.renderServiceId && renderApiService.configured()
    && ['suspended', 'payment_expired'].includes(deployment.status)) {
    await renderApiService.resumeService(deployment.renderServiceId)
      .then(() => { resumed = true; })
      .catch((error) => console.error(`[billing] resume after payment failed for ${deploymentId}:`, error.message));
  }
  await hostingRepo.markHostingPaid(deploymentId, { checkoutOrderId: order?.id || null, paidAt }).catch(() => null);
  await updateDeploymentRecord(deploymentId, {
    paymentStatus: 'paid',
    paidAt: paidAt.toISOString(),
    deletedReason: null,
    ...(resumed ? { status: 'deployed', currentStep: 'Live' } : {}),
  }).catch(() => {});
  await writeAuditLog({
    organizationId: deployment.organizationId || organizationIdFor(deployment.userId),
    actorUserId,
    action: 'hosting.invoice.paid',
    entityType: 'deployment',
    entityId: deploymentId,
    result: { via, orderId: order?.id || null, resumed },
  });
  await createUserNotification(deployment.userId, {
    type: 'success',
    title: 'Hosting payment confirmed',
    message: 'Your invoice payment has been confirmed.',
    actionUrl: '/dashboard/billing',
    entityType: 'deployment',
    entityId: deploymentId,
  });
  return { deploymentId, orderId: order?.id || null, resumed, paidAt: paidAt.toISOString() };
}

/**
 * Explicit admin/service action retained for historical operations. Automated
 * flat-fee grace cleanup no longer calls this function.
 */
export async function expireDeployment({
  deployment,
  order = null,
  action = 'suspend',
  reason = 'invoice_overdue',
  actorUserId = null,
} = {}) {
  if (!deployment?.deploymentId) throw new Error('A deployment record is required to suspend.');
  const deploymentId = deployment.deploymentId;
  const resolvedOrder = order || await getOrderForDeployment(deploymentId);
  let providerAction = 'skip';
  let status = 'done';
  if (deployment.renderServiceId && renderApiService.configured()) {
    try {
      if (action === 'delete') {
        await renderApiService.deleteService(deployment.renderServiceId);
        providerAction = 'delete';
      } else {
        await renderApiService.suspendService(deployment.renderServiceId);
        providerAction = 'suspend';
      }
    } catch (error) {
      status = 'failed';
    }
  }
  await updateDeploymentRecord(deploymentId, {
    paymentStatus: 'overdue',
    status: action === 'delete' ? 'deleted' : 'suspended',
    deletedReason: reason,
    ...(action === 'delete' ? { deletedAt: nowIso() } : { suspendedAt: nowIso() }),
  }).catch(() => {});
  await prisma.deploymentCleanupJob.create({
    data: {
      deploymentId,
      checkoutOrderId: resolvedOrder?.id || null,
      userId: dbUserId(deployment.userId),
      action: providerAction,
      reason,
      renderServiceId: deployment.renderServiceId || null,
      status,
      detail: JSON.stringify({ source: 'explicit_action' }),
    },
  });
  return { deploymentId, action: providerAction, status };
}

export default {
  findDeploymentRecord,
  createDeploymentOrder,
  createDeploymentRenewalOrder,
  getOrderForDeployment,
  markDeploymentPaid,
  expireDeployment,
};
