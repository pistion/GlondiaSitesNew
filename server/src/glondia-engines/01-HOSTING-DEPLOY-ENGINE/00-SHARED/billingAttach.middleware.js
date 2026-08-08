/**
 * billingAttach.middleware.js - attach service billing after any provider handoff.
 *
 * No Render service means no billing and no trial timer.
 */
import { createDeploymentOrder } from '../../../services/deploymentBillingService.js';
import { updateDeploymentRecord, addDeploymentLog } from '../../00-SHARED/deploymentRecordStore.js';
import { writeAuditLog } from '../../../services/auditLogService.js';
import { appendDeployStep, appendDeployWarning } from './deployFlowState.middleware.js';

const BILLABLE_STATUSES = new Set(['building', 'queued', 'deployed', 'live', 'deployed_unverified']);

function isProviderDeployed(d) {
  if (!d || !d.deploymentId || d.platformDeployed !== true) return false;
  if (!d.providerServiceId && !d.renderServiceId) return false;
  return BILLABLE_STATUSES.has(d.status);
}

export function attachDeploymentBilling(kind) {
  return (req, _res, next) => {
    const d = req.deployFlow?.deployment;
    if (
      !d
      || !d.deploymentId
      || d.status === 'failed'
      || d.status === 'ready'
      || d.buildStatus === 'configuration_required'
      || !isProviderDeployed(d)
    ) {
      const skipped = {
        skipped: true,
        reason: 'deployment_not_queued',
        message: 'Billing will start after the hosting provider accepts the deployment.',
      };
      req.deployFlow.billing = skipped;
      req.deployFlow.skippedBilling = skipped;
      appendDeployWarning(req, skipped.message);
      appendDeployStep(req, { name: 'billing_attach', status: 'skipped', message: skipped.reason });
      return next();
    }

    req.deployFlow.billing = {
      status: 'billing_pending',
      message: 'Usage billing is being registered in the background.',
    };
    appendDeployStep(req, { name: 'billing_attach', status: 'queued', message: 'background' });

    queueBillingAttach({
      deployment: d,
      user: req.user || {},
      kind,
    });
    next();
  };
}

function queueBillingAttach({ deployment, user, kind }) {
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
}

async function recordBackgroundBillingFailure({ deployment, user, kind, error }) {
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

export default { attachDeploymentBilling };
