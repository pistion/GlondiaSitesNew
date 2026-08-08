/**
 * Notifications API client — the Bell dropdown for the signed-in user.
 * All calls are authenticated; callers must have an access token.
 */
import { liveApiRequest } from '../api.js';
import { getStoredAuth } from './auth.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';
import { sandboxBillingNotifications } from '../features/sandbox/sandboxFixtures.js';

function authed() {
  return Boolean(getStoredAuth()?.accessToken);
}

/** List the caller's notifications (own + audience all/admin). */
export async function listNotifications({ unreadOnly = false, limit = 30 } = {}) {
  if (!authed()) return { items: [], nextCursor: null };
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'billing') {
    const items = sandboxBillingNotifications(sandbox)
      .filter((item) => !unreadOnly || !item.read)
      .slice(0, limit || 30);
    return { items, nextCursor: null };
  }
  const qs = new URLSearchParams();
  if (unreadOnly) qs.set('unread', 'true');
  if (limit) qs.set('limit', String(limit));
  return liveApiRequest(`/notifications?${qs.toString()}`);
}

/** Unread count for the bell badge. */
export async function getUnreadCount() {
  if (!authed()) return { count: 0 };
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'billing') {
    return { count: sandboxBillingNotifications(sandbox).filter((item) => !item.read).length };
  }
  return liveApiRequest('/notifications/unread-count');
}

export function markNotificationRead(id) {
  if (getActiveServiceSandbox()?.service === 'billing') return Promise.resolve({ updated: id ? 1 : 0 });
  return liveApiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead() {
  if (getActiveServiceSandbox()?.service === 'billing') return Promise.resolve({ updated: 1 });
  return liveApiRequest('/notifications/read-all', { method: 'POST' });
}

export function deleteNotification(id) {
  if (getActiveServiceSandbox()?.service === 'billing') return Promise.resolve({ deleted: id ? 1 : 0 });
  return liveApiRequest(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
