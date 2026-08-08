/**
 * attachBilling.handler.js — BILLING_ATTACH.
 *
 * Durable replacement for the engine's process-local setImmediate billing
 * attach: registers a deployment with database-backed usage billing after the
 * deployment is actually billable
 * (shouldAttachDeploymentBilling — the central billable predicate). Retries
 * transient failures; a restart re-runs from the job table.
 */

import * as repo from '../../../repositories/builder.repository.js';
import { readHostingStore } from '../../../services/hostingStore.js';
import { shouldAttachDeploymentBilling } from '../../../glondia-engines/01-HOSTING-DEPLOY-ENGINE/00-SHARED/deploymentBillingAttach.service.js';
import { createDeploymentOrder } from '../../../services/deploymentBillingService.js';

function permanent(code, message) {
  const err = new Error(message);
  err.code = code;
  err.retryable = false;
  return err;
}

function retryable(code, message) {
  const err = new Error(message);
  err.code = code;
  err.retryable = true;
  return err;
}

async function findHostingDeployment(hostingDeploymentId) {
  const store = await readHostingStore();
  return (store.deployments || []).find(
    (d) => d.deploymentId === hostingDeploymentId || d.id === hostingDeploymentId,
  ) || null;
}

export async function run(ctx) {
  const { job } = ctx;
  const payload = job.payload?.data ?? job.payload ?? {};
  const { hostingDeploymentId, linkId, userId } = payload;
  if (!hostingDeploymentId) throw permanent('BILLING_PAYLOAD_INVALID', 'hostingDeploymentId is required.');

  await ctx.setStage('VERIFY_BILLABLE');
  const deployment = await findHostingDeployment(hostingDeploymentId);
  if (!deployment) throw permanent('BILLING_DEPLOYMENT_MISSING', 'Hosting deployment record not found.');

  if (deployment.status === 'failed' || deployment.status === 'deleted') {
    // Never bill a failed/removed deployment — succeed as a recorded no-op.
    await ctx.emit('Deployment is not billable (failed/deleted); billing skipped.', { status: deployment.status });
    return { skipped: true, reason: deployment.status };
  }
  if (!shouldAttachDeploymentBilling(deployment)) {
    // Not billable YET (still queuing at the provider) — retry later.
    throw retryable('BILLING_NOT_BILLABLE_YET', `Deployment ${hostingDeploymentId} is not billable yet (${deployment.status}).`);
  }

  if (deployment.checkoutOrderId) {
    await ctx.emit('Billing already attached; reusing existing order.', { checkoutOrderId: deployment.checkoutOrderId });
    if (linkId) await repo.updateDeploymentLink(linkId, { metadata: { billing: 'attached', checkoutOrderId: deployment.checkoutOrderId } });
    return { reused: true, checkoutOrderId: deployment.checkoutOrderId };
  }

  await ctx.setStage('ATTACH_BILLING');
  const summary = await createDeploymentOrder({
    deployment,
    user: { id: userId || deployment.userId },
    kind: 'builder-revision',
  });

  if (linkId) {
    await repo.updateDeploymentLink(linkId, {
      metadata: { billing: summary?.status || 'metering', invoiceId: summary?.invoiceId || null },
    });
  }
  return { attached: true, status: summary?.status || 'metering', invoiceId: summary?.invoiceId || null };
}

export async function onPermanentFailure(ctx) {
  const { job } = ctx;
  const payload = job.payload?.data ?? job.payload ?? {};
  if (payload.linkId) {
    await repo.updateDeploymentLink(payload.linkId, {
      metadata: { billing: 'failed' },
    }).catch(() => {});
  }
  // Deployment stays live on the free tier; billing failure is surfaced on
  // the project so it can be retried — money state must stay accurate.
  const project = await repo.getProjectById(job.projectId);
  if (project && project.status === 'LIVE') {
    // LIVE with failed billing is handled by reconciliation/ops; no illegal jump.
    return;
  }
  if (project && project.status === 'BUILDING') {
    await repo.transitionProject({
      projectId: job.projectId, from: 'BUILDING', to: 'BILLING_SETUP_FAILED',
      actorType: 'worker', actorId: ctx.workerId, reason: 'billing_attach_failed', jobId: job.id,
    });
  }
}
