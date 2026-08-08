import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const isProd = process.env.NODE_ENV === 'production';
const DEV_JWT_SECRET = 'glondia-dev-insecure-jwt-secret-change-me';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);
const JWT_ISSUER = process.env.JWT_ISSUER || 'glondia-sites';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'glondia-dashboard';

/**
 * Resolve the JWT signing secret. In production a real secret MUST be supplied;
 * we refuse to fall back to the insecure dev default there.
 *
 * Accepts JWT_SECRET (canonical) or JWT_ACCESS_SECRET (common alternate name)
 * so a naming mismatch can't silently take down auth in production.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
  if (secret) return secret;
  if (isProd) {
    throw httpError('JWT_SECRET (or JWT_ACCESS_SECRET) is not configured.', 500);
  }
  return DEV_JWT_SECRET;
}

// ─── Password hashing ─────────────────────────────────────────────────────────

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

// ─── Access tokens (JWT) ───────────────────────────────────────────────────────

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'owner', name: user.name || null },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: randomUUID(),
    },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// ─── Refresh tokens (opaque, DB-backed, hashed + rotated) ──────────────────────

function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

export async function issueRefreshToken(userId) {
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt },
  });
  return raw;
}

/** Validate + rotate a refresh token. Returns the owning user or throws. */
async function rotateRefreshToken(rawToken) {
  if (!rawToken) throw httpError('A refresh token is required.', 401);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw httpError('Invalid or expired refresh token.', 401);
  }
  // Rotate: revoke the presented token so it cannot be reused.
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const refreshToken = await issueRefreshToken(record.userId);
  return { user: record.user, refreshToken };
}

// ─── Session shape returned to the frontend ─────────────────────────────────────

// Authenticated-route hint for the caller's own avatar. The browser fetches it
// as a blob (Authorization header required) — it is NOT a public URL, and the
// raw avatarPath/idPhotoPath SSD paths are never exposed.
const OWN_AVATAR_URL = '/api/v1/auth/profile/avatar';

function staleSessionError() {
  return httpError('Your session no longer matches an account. Please sign in again.', 401);
}

function toPublicUser(user) {
  const details = safeJson(user.profileDetails);
  const clientId = user.clientId || null;
  return {
    id: user.id,
    clientId,
    accountUrl: clientId ? `/client/${clientId}` : null,
    email: user.email,
    name: user.name,
    organizationName: details.organizationName || null,
    role: user.role,
    planId: user.planId,
    phone: user.phone || null,
    accountStatus: user.accountStatus || 'active',
    hasAvatar: Boolean(user.avatarPath),
    avatarUrl: user.avatarPath ? OWN_AVATAR_URL : null,
    hasIdPhoto: Boolean(user.idPhotoPath),
  };
}

async function buildSession(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  return {
    user: toPublicUser(user),
    tokens: { accessToken, refreshToken, tokenType: 'Bearer' },
  };
}

// ─── Client IDs (glondiac-XXXX customer reference) ─────────────────────────────

function randomClientId(digits = 4) {
  const max = 10 ** digits;
  const n = Math.floor(Math.random() * max);
  return `glondiac-${String(n).padStart(digits, '0')}`;
}

/**
 * Assign a unique glondiac-XXXX client ID (and, first time only, the signup IP)
 * to a user that doesn't have one yet. Safe to call on every sign-in — it is a
 * no-op when the ID already exists. Retries on collisions and widens to more
 * digits when the 4-digit space gets crowded.
 */
export async function ensureClientId(user, ip = null) {
  if (!user || user.clientId) return user;
  const extra = ip && !user.signupIp ? { signupIp: String(ip).slice(0, 64) } : {};
  for (let attempt = 0; attempt < 30; attempt++) {
    const digits = attempt < 15 ? 4 : attempt < 25 ? 6 : 8;
    try {
      return await prisma.user.update({
        where: { id: user.id },
        data: { clientId: randomClientId(digits), ...extra },
      });
    } catch {
      // Unique collision — try another random ID.
    }
  }
  console.error(`[auth] Could not assign a client ID to user ${user.id} after 30 attempts.`);
  return user;
}

// ─── Public operations ──────────────────────────────────────────────────────────

export async function registerUser({ email, password, name, organizationName, signupIp }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    throw httpError('A valid email address is required.', 400);
  }
  if (!password || String(password).length < 8) {
    throw httpError('Password must be at least 8 characters.', 400);
  }
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw httpError('An account with this email already exists.', 409);

  const passwordHash = await hashPassword(password);

  const orgName = String(organizationName || '').trim() || null;
  let user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: String(name || '').trim() || null,
      profileDetails: JSON.stringify({ organizationName: orgName }),
    },
  });

  // Every new account gets a glondiac-XXXX client reference tied to signup IP.
  user = await ensureClientId(user, signupIp);

  // Capture account email into CRM Client Accounts list (name + database user id).
  try {
    const { captureContactEmail } = await import('./crmContactsService.js');
    await captureContactEmail({
      email: user.email,
      name: user.name || user.email.split('@')[0],
      userId: user.id,
      source: 'registration',
      listType: 'client_accounts',
      role: user.role,
      accountStatus: user.accountStatus || 'active',
    });
  } catch (err) {
    console.warn('[auth] CRM contact capture skipped:', err.message);
  }

  return buildSession(user);
}

export async function loginUser({ email, password, ip }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Always run a compare to reduce user-enumeration timing differences.
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) throw httpError('Invalid email or password.', 401);
  // Account lifecycle: disabled/deleted/suspended accounts cannot log in (MVP).
  const status = user.accountStatus || 'active';
  if (status !== 'active') {
    throw httpError('This account is not active. Please contact support.', 403);
  }
  // Backfill a client ID for accounts created before client IDs existed.
  user = await ensureClientId(user, ip);
  return buildSession(user);
}

export async function refreshSession(rawToken) {
  const { user, refreshToken } = await rotateRefreshToken(rawToken);
  const accessToken = signAccessToken(user);
  return {
    user: toPublicUser(user),
    tokens: { accessToken, refreshToken, tokenType: 'Bearer' },
  };
}

export async function logoutUser(rawToken) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getUserById(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? toPublicUser(user) : null;
}

// ─── Self-service profile (the signed-in customer) ────────────────────────────

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

const BILLING_INFO_KEYS = [
  'billingName',
  'billingEmail',
  'companyName',
  'taxId',
  'country',
  'currency',
  'recurringBillingEnabled',
  'billingCycle',
];

function sanitizeBillingInfo(input = {}, { validate = false } = {}) {
  const out = {};
  for (const key of BILLING_INFO_KEYS) {
    const max = key === 'addressLine2' ? 160 : 120;
    const value = input?.[key];
    out[key] = value == null ? null : String(value).trim().slice(0, max) || null;
  }
  if (validate && out.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.billingEmail)) {
    throw httpError('Enter a valid billing email address.', 400);
  }
  if (out.currency) out.currency = out.currency.toUpperCase().slice(0, 3);
  out.recurringBillingEnabled = input?.recurringBillingEnabled === true
    || String(input?.recurringBillingEnabled || '').toLowerCase() === 'true';
  if (out.billingCycle) {
    const cycle = String(out.billingCycle).toLowerCase();
    out.billingCycle = ['monthly', 'annual'].includes(cycle) ? cycle : null;
  }
  return out;
}

/** Profile shape returned to the account owner — never exposes the raw idPhotoPath. */
function toProfile(user) {
  const details = safeJson(user.profileDetails);
  const billingInfo = sanitizeBillingInfo(details.billingInfo || {});
  return {
    id: user.id,
    clientId: user.clientId || null,
    email: user.email,
    name: user.name || null,
    organizationName: details.organizationName || null,
    phone: user.phone || null,
    role: user.role,
    planId: user.planId,
    accountStatus: user.accountStatus || 'active',
    profileDetails: details,
    billingInfo,
    hasAvatar: Boolean(user.avatarPath),
    avatarUrl: user.avatarPath ? OWN_AVATAR_URL : null,
    hasIdPhoto: Boolean(user.idPhotoPath),
    createdAt: user.createdAt,
  };
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? toProfile(user) : null;
}

/** Update the caller's own editable profile fields (name, phone, personal details). */
export async function updateUserProfile(userId, patch = {}) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw staleSessionError();

  const data = {};
  if (patch.name !== undefined) data.name = patch.name ? String(patch.name).trim().slice(0, 200) : null;
  if (patch.phone !== undefined) data.phone = patch.phone ? String(patch.phone).trim().slice(0, 50) : null;

  // Merge profileDetails so partial saves never wipe organizationName / address fields.
  const prevDetails = safeJson(existing.profileDetails);
  let nextDetails = { ...prevDetails };
  let detailsDirty = false;

  if (patch.profileDetails !== undefined) {
    const incoming = typeof patch.profileDetails === 'string'
      ? safeJson(patch.profileDetails)
      : (patch.profileDetails || {});
    nextDetails = { ...prevDetails, ...incoming };
    // Deep-merge nested displayPreferences so a theme save never wipes other prefs.
    if (incoming.displayPreferences && typeof incoming.displayPreferences === 'object') {
      nextDetails.displayPreferences = {
        ...(prevDetails.displayPreferences && typeof prevDetails.displayPreferences === 'object' ? prevDetails.displayPreferences : {}),
        ...incoming.displayPreferences,
      };
    }
    if (incoming.billingInfo && typeof incoming.billingInfo === 'object') {
      nextDetails.billingInfo = {
        ...sanitizeBillingInfo(prevDetails.billingInfo || {}),
        ...sanitizeBillingInfo(incoming.billingInfo, { validate: true }),
      };
    }
    detailsDirty = true;
  }
  if (patch.billingInfo !== undefined) {
    nextDetails.billingInfo = {
      ...sanitizeBillingInfo(prevDetails.billingInfo || {}),
      ...sanitizeBillingInfo(
        typeof patch.billingInfo === 'string' ? safeJson(patch.billingInfo) : (patch.billingInfo || {}),
        { validate: true }
      ),
    };
    detailsDirty = true;
  }
  if (patch.organizationName !== undefined) {
    nextDetails.organizationName = patch.organizationName
      ? String(patch.organizationName).trim().slice(0, 200)
      : null;
    detailsDirty = true;
  }
  if (detailsDirty) {
    // Normalize empty strings to null for known detail keys
    for (const key of Object.keys(nextDetails)) {
      if (typeof nextDetails[key] === 'string' && !nextDetails[key].trim()) nextDetails[key] = null;
    }
    data.profileDetails = JSON.stringify(nextDetails);
  }

  if (!Object.keys(data).length) return toProfile(existing);

  const user = await prisma.user.update({ where: { id: userId }, data });
  return toProfile(user);
}

/** Record the SSD path of the caller's own uploaded ID photo. */
export async function setOwnIdPhotoPath(userId, filePath) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw staleSessionError();
  const user = await prisma.user.update({ where: { id: userId }, data: { idPhotoPath: filePath } });
  return toProfile(user);
}

/** Change the caller's own password. Requires current password unless the account has no password yet. */
export async function changePassword(userId, currentPassword, newPassword) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);
  if (!newPassword || String(newPassword).length < 8) {
    throw httpError('New password must be at least 8 characters.', 400);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw staleSessionError();
  if (user.passwordHash) {
    if (!currentPassword) throw httpError('Current password is required.', 400);
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw httpError('Current password is incorrect.', 401);
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { success: true };
}

/**
 * Change the caller's own sign-in email. Requires the current password.
 * Normalizes to lowercase and rejects addresses already in use.
 */
export async function updateUserEmail(userId, newEmail, currentPassword) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);
  const normalized = String(newEmail || '').trim().toLowerCase();
  if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw httpError('A valid email address is required.', 400);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw staleSessionError();
  if (user.passwordHash) {
    if (!currentPassword) throw httpError('Current password is required.', 400);
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw httpError('Current password is incorrect.', 401);
  }
  if (normalized === user.email) return toProfile(user);
  const taken = await prisma.user.findUnique({ where: { email: normalized } });
  if (taken) throw httpError('An account with this email already exists.', 409);
  const updated = await prisma.user.update({ where: { id: userId }, data: { email: normalized } });
  return toProfile(updated);
}

/**
 * Self-service soft delete. Requires the current password, marks the account
 * deleted, and revokes every refresh token so all sessions end.
 */
export async function deleteOwnAccount(userId, currentPassword) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw staleSessionError();
  if (user.passwordHash) {
    if (!currentPassword) throw httpError('Current password is required.', 400);
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw httpError('Current password is incorrect.', 401);
  }
  await prisma.user.update({
    where: { id: userId },
    data: { accountStatus: 'deleted', deletedAt: new Date() },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { success: true };
}

/** Record the SSD path of the caller's own profile avatar/headshot. */
export async function setOwnAvatarPath(userId, filePath) {
  if (!userId || userId === 'local-user') throw httpError('A real account is required.', 401);
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw staleSessionError();
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarPath: filePath } });
  return toProfile(user);
}

/**
 * Lightweight account-status lookup for per-request enforcement in authMiddleware.
 * Returns the accountStatus string, or null when no matching DB row exists
 * (e.g. the dev/local-user fallback, which is intentionally allowed through).
 */
export async function getUserAccountStatus(userId) {
  if (!userId || userId === 'local-user') return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountStatus: true } });
  return user ? (user.accountStatus || 'active') : null;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}
