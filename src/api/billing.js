/**
 * Billing API client — deploy-first tiered billing summary.
 */
import { liveApiRequest } from '../api.js';
import { getStoredAuth } from './auth.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';
import { sandboxBillingSummary } from '../features/sandbox/sandboxFixtures.js';

/**
 * The deploy-first billing summary for the signed-in user:
 *   { pricing, orders, deployments, provider }
 *
 * The backend route is workspace-scoped, but the summary is filtered by the
 * authenticated user, not the workspace id — so the stored organization id (or
 * a placeholder) is sufficient.
 */
export function getBillingSummary({ serviceType = null, serviceId = null } = {}) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'billing') return Promise.resolve(sandboxBillingSummary(sandbox));
  const workspaceId = getStoredAuth()?.organizationId || 'me';
  const query = new URLSearchParams();
  if (serviceType) query.set('serviceType', serviceType);
  if (serviceId) query.set('serviceId', serviceId);
  const suffix = query.size ? `?${query.toString()}` : '';
  return liveApiRequest(`/v1/workspaces/${encodeURIComponent(workspaceId)}/billing/summary${suffix}`);
}

/** Admin-only: all-tenant billing overview. Caller must be an admin. */
export function getAdminBillingOverview() {
  return liveApiRequest('/admin/overview');
}
