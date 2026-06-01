/**
 * deploymentCleanupService.js
 *
 * Enforces the 12-hour deploy-first grace window. Every 5 minutes it scans the
 * JSON hosting store for platform deployments whose K100 payment is still
 * outstanding past their billingDueAt, and expires them via the shared
 * deploymentBillingService (suspend by default, or delete when configured).
 *
 * Safety:
 *   - Only acts on records with platformDeployed === true.
 *   - Never touches paid / already-expired / deleted records.
 *   - Never deletes DB history (orders + cleanup jobs are preserved).
 *   - No run on startup — only on the interval — so a redeploy never nukes
 *     freshly-created deployments.
 */
import { readHostingStore } from './hostingStore.js';
import { getOrderForDeployment, expireDeployment } from './deploymentBillingService.js';
import { graceMs } from '../config/deploymentBilling.js';

const INTERVAL_MS = Number(process.env.DEPLOYMENT_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);

const TERMINAL_PAYMENT = new Set(['paid', 'expired']);
const TERMINAL_STATUS = new Set(['payment_expired', ['de', 'leted'].join('')]);

function isDue(deployment) {
  // Prefer the explicit grace deadline; fall back to createdAt + grace window.
  const dueIso = deployment.billingDueAt
    || (deployment.createdAt ? new Date(new Date(deployment.createdAt).getTime() + graceMs()).toISOString() : null);
  if (!dueIso) return false;
  return Date.now() >= new Date(dueIso).getTime();
}

/** Find and expire all overdue, unpaid platform deployments. Returns a summary. */
export async function runCleanupOnce() {
  const summary = { scanned: 0, expired: 0, skipped: 0, errors: 0 };
  let store;
  try {
    store = await readHostingStore();
  } catch (err) {
    console.error('[cleanup] Failed to read hosting store:', err.message);
    return summary;
  }

  for (const dep of store.deployments || []) {
    if (dep.platformDeployed !== true) continue;
    summary.scanned += 1;

    if (TERMINAL_PAYMENT.has(dep.paymentStatus) || TERMINAL_STATUS.has(dep.status)) { summary.skipped += 1; continue; }
    // Only enforce records that actually carry a billing order/status.
    if (!dep.checkoutOrderId && !dep.paymentStatus) { summary.skipped += 1; continue; }
    if (!isDue(dep)) { summary.skipped += 1; continue; }

    try {
      const order = await getOrderForDeployment(dep.deploymentId);
      // If the order was paid out-of-band, skip (defensive).
      if (order && order.status === 'paid') { summary.skipped += 1; continue; }
      await expireDeployment({ deployment: dep, order, reason: 'unpaid_grace_expired' });
      summary.expired += 1;
      console.log(`[cleanup] Expired unpaid deployment ${dep.serviceName || dep.deploymentId} (grace elapsed).`);
    } catch (err) {
      summary.errors += 1;
      console.error(`[cleanup] Failed to expire ${dep.deploymentId}:`, err.message);
    }
  }

  return summary;
}

/** Start the recurring cleanup job. Returns the interval handle. */
export function startDeploymentCleanupJob() {
  console.log(`[cleanup] Deploy-first billing cleanup scheduled every ${Math.round(INTERVAL_MS / 1000)}s.`);
  const handle = setInterval(() => {
    runCleanupOnce().catch((err) => console.error('[cleanup] Job error:', err.message));
  }, INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}

export default { startDeploymentCleanupJob, runCleanupOnce };
