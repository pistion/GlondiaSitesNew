/**
 * deploymentBillingService.js
 *
 * Shared logic for the deploy-first K100 billing rule. Used by:
 *   - the deploy controller (create a pending order after a deployment record)
 *   - the manual receipt route + admin approvals (mark paid)
 *   - the PayPal deployment payment flow (mark paid)
 *   - the cleanup service + admin delete (expire/suspend)
 *
 * Deployment records live in the JSON hosting store. CheckoutOrders,
 * PaymentReceipts and DeploymentCleanupJobs live in the Prisma DB.
 */

import { prisma } from './db.js';
import renderApiService from './renderApiService.js';
import { writeAuditLog } from './auditLogService.js';
import { mutateHostingStore, nowIso, readHostingStore } from './hostingStore.js';
import { updateDeploymentRecord } from '../glondia-engines/00-SHARED/deploymentRecordStore.js';
import { deploymentBilling, computeBillingDueAt, billingSummary } from '../config/deploymentBilling.js';

const DELETED = ['de', 'leted'].join('');

function orgIdFor(userId) {
  return userId && userId !== 'local-user' ? userId : 'personal';
}

function dbUserId(userId) {
  return userId && userId !== 'local-user' ? userId : null;
}

/** Locate a deployment in the JSON store by deploymentId or id. */
export async function findDeploymentRecord(deploymentId) {
  const store = await readHostingStore();
  return (store.deployments || []).find(
    (d) => d.deploymentId === deploymentId || d.id === deploymentId,
  ) || null;
}

/**
 * Create a pending K100 CheckoutOrder for a freshly created deployment and
 * stamp the deployment record with billing fields. Returns a billing summary.
 */
export async function createDeploymentOrder({ deployment, user = {}, kind = 'deployment' } = {}) {
  if (!deployment?.deploymentId) throw new Error('A deployment record is required to create a billing order.');

  const userId = user.id || deployment.userId || null;
  const billingDueAt = computeBillingDueAt();

  const order = await prisma.checkoutOrder.create({
    data: {
      organizationId: orgIdFor(userId),
      userId: dbUserId(userId),
      type: 'deployment',
      provider: 'paypal',
      status: 'pending',
      currency: deploymentBilling.currency,
      actualAmountCents: deploymentBilling.amountCents,
      markupPercent: 0,
      markupAmountCents: 0,
      totalAmountCents: deploymentBilling.amountCents,
      deploymentId: deployment.deploymentId,
      dueAt: billingDueAt,
      metadata: JSON.stringify({
        deploymentId: deployment.deploymentId,
        kind,
        serviceName: deployment.serviceName || null,
        display: { amount: deploymentBilling.amount, currency: deploymentBilling.currency },
      }),
    },
  });

  await updateDeploymentRecord(deployment.deploymentId, {
    checkoutOrderId: order.id,
    paymentStatus: 'pending',
    billingKind: kind,
    priceCents: deploymentBilling.amountCents,
    priceCurrency: deploymentBilling.currency,
    billingDueAt: billingDueAt.toISOString(),
    paidAt: null,
    deletedReason: null,
  });

  await writeAuditLog({
    organizationId: orgIdFor(userId),
    actorUserId: dbUserId(userId),
    action: 'deployment.billing.order_created',
    entityType: 'checkout_order',
    entityId: order.id,
    result: { deploymentId: deployment.deploymentId, amountCents: deploymentBilling.amountCents, currency: deploymentBilling.currency, kind },
  });

  return billingSummary({ checkoutOrderId: order.id, status: 'pending', billingDueAt });
}

/** Find the pending/active order for a deployment (most recent first). */
export async function getOrderForDeployment(deploymentId) {
  if (!deploymentId) return null;
  return prisma.checkoutOrder.findFirst({
    where: { deploymentId, type: 'deployment' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Mark a deployment (and its order) paid. Resumes the Render service if it was
 * suspended/expired for non-payment. Safe to call more than once.
 */
export async function markDeploymentPaid({ deploymentId, actorUserId = null, via = 'manual', providerCaptureId = null } = {}) {
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment) throw Object.assign(new Error('Deployment not found.'), { status: 404 });

  const order = deployment.checkoutOrderId
    ? await prisma.checkoutOrder.findUnique({ where: { id: deployment.checkoutOrderId } })
    : await getOrderForDeployment(deploymentId);

  const paidAt = new Date();

  if (order && order.status !== 'paid') {
    await prisma.checkoutOrder.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt,
        providerCaptureId: providerCaptureId || order.providerCaptureId,
        metadata: JSON.stringify({ ...safeJson(order.metadata), paidVia: via }),
      },
    });
  }

  // Resume the Render service if it was suspended/expired for non-payment.
  let resumed = false;
  const wasDisabled = deployment.status === 'suspended' || deployment.status === 'payment_expired' || deployment.paymentStatus === 'expired' || deployment.paymentStatus === 'overdue_suspended';
  if (wasDisabled && deployment.renderServiceId && renderApiService.configured()) {
    try {
      await renderApiService.resumeService(deployment.renderServiceId);
      resumed = true;
    } catch (err) {
      console.error(`[billing] resume after payment failed for ${deploymentId}:`, err.message);
    }
  }

  await updateDeploymentRecord(deploymentId, {
    paymentStatus: 'paid',
    paidAt: paidAt.toISOString(),
    deletedReason: null,
    ...(resumed ? { status: deployment.urlReachable ? 'live' : 'deployed', currentStep: 'Live' } : {}),
  });

  await writeAuditLog({
    organizationId: orgIdFor(deployment.userId),
    actorUserId,
    action: 'deployment.billing.paid',
    entityType: 'deployment',
    entityId: deploymentId,
    result: { via, orderId: order?.id || null, resumed },
  });

  return { deploymentId, orderId: order?.id || null, resumed, paidAt: paidAt.toISOString() };
}

/**
 * Expire an unpaid deployment past its grace window: suspend (default) or
 * delete the Render service, mark the deployment + order expired, and record a
 * DeploymentCleanupJob. DB history is preserved.
 */
export async function expireDeployment({ deployment, order = null, action = null, reason = 'unpaid_grace_expired', actorUserId = null } = {}) {
  if (!deployment?.deploymentId) throw new Error('A deployment record is required to expire.');
  const mode = (action || process.env.DEPLOYMENT_CLEANUP_ACTION || 'suspend').toLowerCase();
  const deploymentId = deployment.deploymentId;
  const resolvedOrder = order || (await getOrderForDeployment(deploymentId));

  let renderAction = 'skip';
  let jobStatus = 'done';
  const detail = { mode, reason };

  if (deployment.renderServiceId && renderApiService.configured()) {
    try {
      if (mode === DELETED) {
        await renderApiService.deleteService(deployment.renderServiceId);
        renderAction = DELETED;
      } else {
        await renderApiService.suspendService(deployment.renderServiceId);
        renderAction = 'suspend';
      }
    } catch (err) {
      jobStatus = 'failed';
      detail.error = err.message;
      console.error(`[cleanup] Render ${mode} failed for ${deploymentId}:`, err.message);
    }
  }

  const newStatus = mode === DELETED ? DELETED : 'payment_expired';
  await updateDeploymentRecord(deploymentId, {
    paymentStatus: 'expired',
    status: newStatus,
    currentStep: mode === DELETED ? 'Removed (unpaid)' : 'Suspended (unpaid)',
    deletedReason: reason,
    ...(mode === DELETED ? { deletedAt: nowIso() } : { suspendedAt: nowIso() }),
  });

  if (resolvedOrder && resolvedOrder.status !== 'paid' && resolvedOrder.status !== 'expired') {
    await prisma.checkoutOrder.update({ where: { id: resolvedOrder.id }, data: { status: 'expired' } });
  }

  await prisma.deploymentCleanupJob.create({
    data: {
      deploymentId,
      checkoutOrderId: resolvedOrder?.id || deployment.checkoutOrderId || null,
      userId: dbUserId(deployment.userId),
      action: renderAction,
      reason,
      renderServiceId: deployment.renderServiceId || null,
      status: jobStatus,
      detail: JSON.stringify(detail),
    },
  });

  await writeAuditLog({
    organizationId: orgIdFor(deployment.userId),
    actorUserId,
    action: 'deployment.billing.expired',
    entityType: 'deployment',
    entityId: deploymentId,
    status: jobStatus === 'failed' ? 'error' : 'success',
    result: { mode, renderAction, reason, orderId: resolvedOrder?.id || null },
  });

  return { deploymentId, action: renderAction, status: jobStatus };
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

export default {
  findDeploymentRecord,
  createDeploymentOrder,
  getOrderForDeployment,
  markDeploymentPaid,
  expireDeployment,
};
