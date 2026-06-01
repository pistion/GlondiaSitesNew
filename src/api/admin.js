/**
 * Admin API client — deploy-first K100 billing administration.
 * All calls require an authenticated admin (role === 'admin').
 */
import { liveApiRequest } from '../api.js';

export const getAdminOverview    = ()           => liveApiRequest('/admin/overview');
export const listAdminUsers      = ()           => liveApiRequest('/admin/users');
export const listAdminDeployments = ()          => liveApiRequest('/admin/deployments');
export const listAdminOrders     = ()           => liveApiRequest('/admin/orders');
export const listAdminReceipts   = ()           => liveApiRequest('/admin/receipts');

export const approveReceipt = (receiptId)        => liveApiRequest(`/admin/receipts/${encodeURIComponent(receiptId)}/approve`, { method: 'POST' });
export const rejectReceipt  = (receiptId, note)  => liveApiRequest(`/admin/receipts/${encodeURIComponent(receiptId)}/reject`, { method: 'POST', body: { note } });

export const markDeploymentPaid = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/mark-paid`, { method: 'POST' });
export const deleteDeployment   = (deploymentId) => liveApiRequest(`/admin/deployments/${encodeURIComponent(deploymentId)}/delete`, { method: 'POST' });
