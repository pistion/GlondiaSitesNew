/**
 * deploymentBillingAttach.service.js
 *
 * Reusable billing-attach logic shared by:
 *   - billingAttach.middleware.js  (ZIP / GitHub-link route middleware)
 *   - generatedSiteToRender.pipeline.js  (Plan / AI template pipeline)
 *
 * Billing MUST NOT block deployment. All work is non-blocking (setImmediate).
 */

import { createDeploymentOrder } from '../../../services/deploymentBillingService.js';
import { updateDeploymentRecord, addDeploymentLog } from '../../00-SHARED/deploymentRecordStore.js';
import { writeAuditLog } from '../../../services/auditLogService.js';

const BILLABLE_STATUSES = new Set(['building', 'queued', 'deployed', 'live', 'deployed_unverified']);

/**
 * Returns true when a deployment should have billing attached.
 * A deployment is only billable once it has been handed off to Render.
 */
export function shouldAttachDeploymentBilling(d) {
  if (!d || !d.deploymentId || !d.renderServiceId) return false;
  if (!d.renderDeployId && d.buildStatus !== 'queued') return false;
  if (d.status === 'failed') return false;
  if (d.status === 'ready') return false;
  if (d.buildStatus === 'configuration_required') return false;
  return BILLABLE_STATUSES.has(d.status);
}

/**
 * Standard skipped-billing result object.
 */
export function buildBillingSkippedResult(reason = 'deployment_not_queued') {
  return {
    skipped: true,
    reason,
    message: 'Billing will start after the deployment is queued in Render.',
  };
}

/**
 * Queue a non-blocking billing attach for a deployment.
 * Safe to call from pipelines or middleware — never throws, never blocks.
 *
 * @returns {{ status, message } | { skipped, reason, message }}
 */
export function queueDeploymentBillingAttach({ deployment, user = {}, kind = 'deployment' }) {
  if (!shouldAttachDeploymentBilling(deployment)) {
    return buildBillingSkippedResult();
  }

  setImmediate(async () => {
    try {
      await addDeploymentLog(deployment.deploymentId, 'Usage billing registration queued after provider handoff.', 'info');
      const summary = await createDeploymentOrder({ deployment, user, kind });
      await addDeploymentLog(deployment.deploymentId, `Billing status: ${summary?.status || 'metering'}.`, 'ok');
    } catch (error) {
      console.error('[billing] background attach failed:', error.message);
      await recordBackgroundBillingFailure({ deployment, user, kind, error });
    }
  });

  return {
    status: 'billing_pending',
    message: 'Usage billing is being registered in the background.',
  };
}

async function recordBackgroundBillingFailure({ deployment, user = {}, kind, error }) {
  try {
    await updateDeploymentRecord(deployment.deploymentId, {
      billingAttachStatus: 'failed',
      billingErrorMessage: String(error.message || '').slice(0, 500),
      billingErrorAt: new Date().toISOString(),
    });
    await addDeploymentLog(
      deployment.deploymentId,
      `Billing setup needs retry, but free-tier deployment continues: ${error.message}`,
      'warn',
    );
    await writeAuditLog({
      actorUserId: user?.id && user.id !== 'local-user' ? user.id : null,
      action: 'deployment.billing.attach_failed',
      entityType: 'deployment',
      entityId: deployment.deploymentId,
      status: 'error',
      result: { kind, message: String(error.message || '').slice(0, 300), nonBlocking: true },
    });
  } catch (recordErr) {
    console.error('[billing] could not record background billing error:', recordErr.message);
  }
}
