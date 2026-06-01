/**
 * adminService.js — read + moderation helpers for the simple admin surface.
 *
 * Admins can see all users, deployments, orders and receipts, approve/reject
 * manual receipts, mark deployments paid, and delete/suspend deployments.
 * Deployments are read from the JSON hosting store; everything else is Prisma.
 */
import { prisma } from './db.js';
import { readHostingStore } from './hostingStore.js';
import { writeAuditLog } from './auditLogService.js';
import {
  findDeploymentRecord,
  getOrderForDeployment,
  markDeploymentPaid,
  expireDeployment,
} from './deploymentBillingService.js';
import { updateDeploymentRecord } from '../glondia-engines/00-SHARED/deploymentRecordStore.js';

function deploymentView(d, orderByDeployment = {}) {
  const order = d.checkoutOrderId ? orderByDeployment[d.checkoutOrderId] : orderByDeployment[`dep:${d.deploymentId}`];
  return {
    deploymentId: d.deploymentId,
    userId: d.userId || null,
    serviceName: d.serviceName || null,
    source: d.source || null,
    status: d.status || null,
    paymentStatus: d.paymentStatus || 'none',
    billingDueAt: d.billingDueAt || null,
    paidAt: d.paidAt || null,
    deletedReason: d.deletedReason || null,
    checkoutOrderId: d.checkoutOrderId || null,
    renderServiceId: d.renderServiceId || null,
    liveUrl: d.liveUrl || null,
    platformDeployed: d.platformDeployed === true,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    order: order ? { id: order.id, status: order.status, totalAmountCents: order.totalAmountCents, currency: order.currency } : null,
  };
}

async function loadDeployments() {
  const store = await readHostingStore();
  return (store.deployments || []).filter((d) => d.platformDeployed === true || d.checkoutOrderId);
}

export async function getOverview() {
  const [users, orders, receiptsPending, cleanupJobs, deployments] = await Promise.all([
    prisma.user.count(),
    prisma.checkoutOrder.findMany({ where: { type: 'deployment' }, select: { status: true, totalAmountCents: true, currency: true } }),
    prisma.paymentReceipt.count({ where: { status: 'pending' } }),
    prisma.deploymentCleanupJob.count(),
    loadDeployments(),
  ]);

  const ordersByStatus = {};
  let paidCents = 0;
  let paidCurrency = 'PGK';
  for (const o of orders) {
    ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
    if (o.status === 'paid') { paidCents += o.totalAmountCents || 0; paidCurrency = o.currency || paidCurrency; }
  }

  const deploymentsByPayment = {};
  for (const d of deployments) {
    const k = d.paymentStatus || 'none';
    deploymentsByPayment[k] = (deploymentsByPayment[k] || 0) + 1;
  }

  return {
    users,
    deployments: { total: deployments.length, byPaymentStatus: deploymentsByPayment },
    orders: { total: orders.length, byStatus: ordersByStatus },
    receipts: { pending: receiptsPending },
    cleanupJobs,
    revenue: { paidCents, currency: paidCurrency, paidDisplay: `${paidCurrency} ${(paidCents / 100).toFixed(2)}` },
  };
}

export async function listUsers() {
  return prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, planId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listDeployments() {
  const [deployments, orders] = await Promise.all([
    loadDeployments(),
    prisma.checkoutOrder.findMany({ where: { type: 'deployment' } }),
  ]);
  const byId = {};
  for (const o of orders) {
    byId[o.id] = o;
    if (o.deploymentId) byId[`dep:${o.deploymentId}`] = o;
  }
  return deployments
    .map((d) => deploymentView(d, byId))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function listOrders() {
  return prisma.checkoutOrder.findMany({
    where: { type: 'deployment' },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

export async function listReceipts() {
  return prisma.paymentReceipt.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { checkoutOrder: { select: { id: true, status: true, deploymentId: true, userId: true, totalAmountCents: true, currency: true } } },
  });
}

export async function approveReceipt(receiptId, adminUserId) {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: receiptId }, include: { checkoutOrder: true } });
  if (!receipt) throw Object.assign(new Error('Receipt not found.'), { status: 404, expose: true });

  await prisma.paymentReceipt.update({
    where: { id: receipt.id },
    data: { status: 'approved', reviewedByUserId: adminUserId, reviewedAt: new Date() },
  });

  const order = receipt.checkoutOrder;
  let paidResult = null;
  if (order?.deploymentId) {
    paidResult = await markDeploymentPaid({ deploymentId: order.deploymentId, actorUserId: adminUserId, via: 'manual_receipt' });
  } else if (order) {
    await prisma.checkoutOrder.update({ where: { id: order.id }, data: { status: 'paid', paidAt: new Date() } });
  }

  await writeAuditLog({
    actorUserId: adminUserId,
    action: 'admin.receipt.approved',
    entityType: 'payment_receipt',
    entityId: receipt.id,
    result: { checkoutOrderId: order?.id || null, deploymentId: order?.deploymentId || null },
  });

  return { receiptId: receipt.id, status: 'approved', payment: paidResult };
}

export async function rejectReceipt(receiptId, adminUserId, note = null) {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: receiptId }, include: { checkoutOrder: true } });
  if (!receipt) throw Object.assign(new Error('Receipt not found.'), { status: 404, expose: true });

  await prisma.paymentReceipt.update({
    where: { id: receipt.id },
    data: { status: 'rejected', reviewedByUserId: adminUserId, reviewedAt: new Date(), reviewNote: note ? String(note).slice(0, 1000) : null },
  });

  // Return the order to pending so the user can retry payment within the window.
  const order = receipt.checkoutOrder;
  if (order && order.status !== 'paid') {
    await prisma.checkoutOrder.update({ where: { id: order.id }, data: { status: 'pending' } });
    if (order.deploymentId) {
      const deployment = await findDeploymentRecord(order.deploymentId);
      if (deployment && deployment.paymentStatus !== 'paid') {
        await updateDeploymentRecord(order.deploymentId, { paymentStatus: 'pending' });
      }
    }
  }

  await writeAuditLog({
    actorUserId: adminUserId,
    action: 'admin.receipt.rejected',
    entityType: 'payment_receipt',
    entityId: receipt.id,
    result: { checkoutOrderId: order?.id || null, note: note || null },
  });

  return { receiptId: receipt.id, status: 'rejected' };
}

export async function adminMarkDeploymentPaid(deploymentId, adminUserId) {
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment) throw Object.assign(new Error('Deployment not found.'), { status: 404, expose: true });
  return markDeploymentPaid({ deploymentId, actorUserId: adminUserId, via: 'admin_mark_paid' });
}

export async function adminDeleteDeployment(deploymentId, adminUserId) {
  const deployment = await findDeploymentRecord(deploymentId);
  if (!deployment) throw Object.assign(new Error('Deployment not found.'), { status: 404, expose: true });
  const order = await getOrderForDeployment(deploymentId);
  return expireDeployment({ deployment, order, action: 'delete', reason: 'admin_deleted', actorUserId: adminUserId });
}

export default {
  getOverview,
  listUsers,
  listDeployments,
  listOrders,
  listReceipts,
  approveReceipt,
  rejectReceipt,
  adminMarkDeploymentPaid,
  adminDeleteDeployment,
};
