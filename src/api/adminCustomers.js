/**
 * Admin customer-oversight API client — the unified one-customer view.
 * All calls require an authenticated admin (role === 'admin').
 */
import { liveApiRequest } from '../api.js';

export function getCustomerOverview(userId) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/overview`);
}

function query(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length ? `?${new URLSearchParams(Object.fromEntries(entries))}` : '';
}

export function getCustomerServices(userId, params = {}) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/services${query(params)}`);
}

export function getCustomerBilling(userId, params = {}) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/billing${query(params)}`);
}

export function getCustomerSupport(userId, params = {}) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/support${query(params)}`);
}

export function getCustomerOperations(userId, params = {}) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/operations${query(params)}`);
}

export function getCustomerActivity(userId, params = {}) {
  return liveApiRequest(`/admin/customers/${encodeURIComponent(userId)}/activity${query({ limit: 50, offset: 0, ...params })}`);
}
