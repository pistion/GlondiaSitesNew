/**
 * notificationService.js
 *
 * User-facing notifications (the Bell dropdown). This is SEPARATE from AuditLog,
 * which stays internal/system history and is never replaced by this.
 *
 * Visibility:
 *   - a normal user sees: their own (userId) + audience 'all'
 *   - an admin user sees:  their own (userId) + audience 'admin' + audience 'all'
 * Soft-delete only (deletedAt); user-deleted rows are never returned.
 *
 * All reads/writes are fail-soft: a missing table or DB hiccup logs and returns
 * an empty/zero result rather than 500-ing the whole app (the bell is non-critical).
 */
import { prisma } from './db.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const VALID_AUDIENCE = new Set(['user', 'admin', 'all']);
const CLIENT_SAFE_PATHS = [
  /^\/dashboard(?:\/(?:billing|hosting|support|tickets|account|settings|projects|vps-services|cloud-servers)(?:[/?#].*)?)?$/i,
  /^\/client\/[^/]+\/(?:billing|hosting|support|tickets|account|settings|projects|vps-services|cloud-servers)(?:[/?#].*)?$/i,
  /^#(?:support|tickets|billing|hosting)$/i,
];

function safeParse(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

/** Real DB user id (the dev/local-user fallback has no row). */
function dbUserId(userId) {
  return userId && userId !== 'local-user' ? userId : null;
}

function view(n, user = null) {
  const isAdmin = user?.role === 'admin';
  const actionUrl = isAdmin ? sanitizeActionUrl(n.actionUrl, n.audience) : null;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    actionUrl,
    entityType: n.entityType || null,
    entityId: n.entityId || null,
    audience: n.audience,
    metadata: safeParse(n.metadata),
    readAt: n.readAt || null,
    read: Boolean(n.readAt),
    createdAt: n.createdAt,
  };
}

function normalizeActionUrl(value) {
  const raw = value ? String(value).trim().slice(0, 500) : '';
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  if (raw.startsWith('/')) return raw.replace(/\/{2,}/g, '/');
  if (raw.startsWith('#')) return raw;
  return null;
}

function isAdminActionUrl(url) {
  const normalized = normalizeActionUrl(url);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return lower.startsWith('/admin')
    || lower.startsWith('/api/admin')
    || lower === '/dashboard#tickets'
    || lower.startsWith('/dashboard/admin')
    || lower.includes('admin-dashboard');
}

function isClientSafeActionUrl(url) {
  const normalized = normalizeActionUrl(url);
  return Boolean(normalized && CLIENT_SAFE_PATHS.some((pattern) => pattern.test(normalized)));
}

export function sanitizeActionUrl(actionUrl, audience = 'user') {
  const normalized = normalizeActionUrl(actionUrl);
  if (!normalized) return null;
  if (audience === 'admin') return normalized;
  if (isAdminActionUrl(normalized)) return null;
  return isClientSafeActionUrl(normalized) ? normalized : null;
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a notification. Best-effort: never throws into the caller's flow
 * (deploy/billing events must not fail because a notification couldn't be saved).
 */
export async function createNotification({
  userId = null,
  audience = 'user',
  type = 'info',
  title,
  message,
  actionUrl = null,
  entityType = null,
  entityId = null,
  metadata = {},
} = {}) {
  try {
    if (!title || !message) return null;
    const aud = VALID_AUDIENCE.has(String(audience)) ? String(audience) : 'user';
    const safeActionUrl = sanitizeActionUrl(actionUrl, aud);
    return await prisma.notification.create({
      data: {
        userId: dbUserId(userId),
        audience: aud,
        type: String(type || 'info'),
        title: String(title).slice(0, 200),
        message: String(message).slice(0, 1000),
        actionUrl: safeActionUrl,
        entityType: entityType ? String(entityType).slice(0, 80) : null,
        entityId: entityId ? String(entityId).slice(0, 120) : null,
        metadata: JSON.stringify(metadata || {}),
      },
    });
  } catch (err) {
    console.error('[notifications] create failed:', err.message);
    return null;
  }
}

/** Create a notification targeted at a specific user. */
export function createUserNotification(userId, payload = {}) {
  if (!dbUserId(userId)) return Promise.resolve(null);
  return createNotification({ ...payload, userId, audience: 'user' });
}

/** Create an admin-audience notification (visible to all admins). */
export function createAdminNotification(payload = {}) {
  return createNotification({ ...payload, userId: null, audience: 'admin' });
}

/** Create an all-audience system notification (visible to everyone). */
export function createSystemNotification(payload = {}) {
  return createNotification({ ...payload, userId: null, audience: 'all' });
}

/**
 * Run any notification-producing function as strictly best-effort. Notifications
 * are UI convenience only — they must NEVER break deployment, billing,
 * subscription, receipt approval, or cleanup. (createNotification itself is
 * already fail-soft; this wraps multi-step notify blocks at call sites.)
 */
export async function safeNotify(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[notifications] ${label} failed:`, error.message);
    return null;
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Prisma `where` clause for what a given user is allowed to see. */
function visibilityWhere(user) {
  const id = dbUserId(user?.id);
  const isAdmin = user?.role === 'admin';
  const or = [{ audience: 'all' }];
  if (isAdmin) {
    if (id) or.push({ userId: id });
    or.push({ audience: 'admin' });
  } else if (id) {
    or.push({ userId: id, audience: { not: 'admin' } });
  }
  return { deletedAt: null, OR: or };
}

export async function listNotifications({ user, unreadOnly = false, limit = DEFAULT_LIMIT, cursor = null } = {}) {
  try {
    const take = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
    const where = visibilityWhere(user);
    if (unreadOnly) where.readAt = null;
    const rows = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return { items: page.map((row) => view(row, user)), nextCursor: hasMore ? page[page.length - 1].id : null };
  } catch (err) {
    console.error('[notifications] list failed:', err.message);
    return { items: [], nextCursor: null };
  }
}

export async function getUnreadCount(user) {
  try {
    const where = visibilityWhere(user);
    where.readAt = null;
    return await prisma.notification.count({ where });
  } catch (err) {
    console.error('[notifications] unread count failed:', err.message);
    return 0;
  }
}

// ── Update / delete ─────────────────────────────────────────────────────────

/** Mark one notification read — only if the caller is allowed to see it. */
export async function markNotificationRead({ user, notificationId }) {
  try {
    const where = visibilityWhere(user);
    where.id = notificationId;
    const result = await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  } catch (err) {
    console.error('[notifications] markRead failed:', err.message);
    return { updated: 0 };
  }
}

export async function markAllNotificationsRead({ user }) {
  try {
    const where = visibilityWhere(user);
    where.readAt = null;
    const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    return { updated: result.count };
  } catch (err) {
    console.error('[notifications] markAll failed:', err.message);
    return { updated: 0 };
  }
}

/** Soft-delete one notification (caller must be allowed to see it). */
export async function deleteNotification({ user, notificationId }) {
  try {
    const where = visibilityWhere(user);
    where.id = notificationId;
    const result = await prisma.notification.updateMany({ where, data: { deletedAt: new Date() } });
    return { deleted: result.count };
  } catch (err) {
    console.error('[notifications] delete failed:', err.message);
    return { deleted: 0 };
  }
}

export default {
  createNotification,
  createUserNotification,
  createAdminNotification,
  createSystemNotification,
  safeNotify,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
};
