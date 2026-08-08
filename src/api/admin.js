/**
 * Admin API client — deploy-first tiered billing administration.
 * All calls require an authenticated admin (role === 'admin').
 */
import { liveApiRequest, liveApiUrl } from '../api.js';
import { authHeaders } from './auth.js';

export const getAdminOverview      = ()                       => liveApiRequest('/admin/overview');
export const listAdminUsers        = ()                       => liveApiRequest('/admin/users');
export const listAdminDeployments  = ()                       => liveApiRequest('/admin/deployments');
export const listAdminVpsServices  = ()                       => liveApiRequest('/admin/vps-services');
export const listAdminOrders       = ()                       => liveApiRequest('/admin/orders');
export const listAdminReceipts     = ()                       => liveApiRequest('/admin/receipts');
export const getAdminActivity      = (params = {})            => liveApiRequest(`/admin/activity?${new URLSearchParams(params)}`);
export const getAdminConfigStatus  = ()                       => liveApiRequest('/admin/config-status');

export const approveReceipt = (receiptId)        => liveApiRequest(`/admin/receipts/${encodeURIComponent(receiptId)}/approve`, { method: 'POST' });
export const rejectReceipt  = (receiptId, note)  => liveApiRequest(`/admin/receipts/${encodeURIComponent(receiptId)}/reject`, { method: 'POST', body: { note } });

export const markDeploymentPaid = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/mark-paid`, { method: 'POST' });
export const deleteDeployment   = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/delete`, { method: 'POST' });
export const suspendDeployment  = (deploymentId, reason) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/suspend`, { method: 'POST', body: { reason } });
export const reactivateDeployment = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/reactivate`, { method: 'POST' });
export const approveDeploymentBilling = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/approve-billing`, { method: 'POST' });
export const renewDeploymentManually = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/renew-manually`, { method: 'POST' });
export const setDeploymentRenderPlan = (deploymentId, plan, redeploy = false) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/render-plan`, { method: 'POST', body: { plan, redeploy } });

export const deleteOrder = (orderId) => liveApiRequest(`/admin/orders/${encodeURIComponent(orderId)}/delete`, { method: 'POST' });

// ── User detail + account lifecycle ──────────────────────────────────────────
export const getAdminUser   = (userId)          => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}`);
export const updateAdminUser = (userId, patch)  => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: patch });
export const suspendUser    = (userId, reason)  => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}/suspend`, { method: 'POST', body: { reason } });
export const disableUser    = (userId, reason)  => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}/disable`, { method: 'POST', body: { reason } });
export const reactivateUser = (userId, resumeDeployments = false) => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}/reactivate`, { method: 'POST', body: { resumeDeployments } });
export const deleteUser     = (userId, reason)  => liveApiRequest(`/admin/users/${encodeURIComponent(userId)}/delete`, { method: 'POST', body: { reason } });

// ── Authenticated file fetch (receipts + ID photos) ──────────────────────────
// Files are admin-only behind a Bearer token, so a plain <a href> / <img src>
// cannot carry auth. Fetch as a blob with the auth header and hand back an
// object URL the caller is responsible for revoking.
async function fetchBlobUrl(path) {
  const response = await fetch(liveApiUrl(path), { headers: { ...authHeaders() } });
  if (!response.ok) {
    let message = `Request failed with ${response.status}.`;
    try { const j = await response.json(); message = j?.error?.message || message; } catch { /* binary body */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function viewReceipt(receiptId) {
  const url = await fetchBlobUrl(`/admin/receipts/${encodeURIComponent(receiptId)}/view`);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadReceipt(receiptId, fileName) {
  const url = await fetchBlobUrl(`/admin/receipts/${encodeURIComponent(receiptId)}/download`);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `receipt-${receiptId}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Returns an object URL for a user's ID photo (caller revokes when done). */
export function getUserIdPhotoUrl(userId) {
  return fetchBlobUrl(`/admin/users/${encodeURIComponent(userId)}/id-photo`);
}

/** Returns an object URL for a user's profile avatar (caller revokes when done). */
export function getUserAvatarUrl(userId) {
  return fetchBlobUrl(`/admin/users/${encodeURIComponent(userId)}/avatar`);
}

export async function uploadUserIdPhoto(userId, file) {
  const form = new FormData();
  form.append('idPhoto', file);
  const response = await fetch(liveApiUrl(`/admin/users/${encodeURIComponent(userId)}/id-photo`), {
    method: 'POST',
    headers: { ...authHeaders() }, // do NOT set Content-Type; the browser sets the multipart boundary
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `Upload failed with ${response.status}.`);
  return result?.data ?? result;
}
