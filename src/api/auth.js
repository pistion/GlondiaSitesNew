import { isLiveMode } from '../app/config.js';

const TOKEN_KEY     = 'glondia.accessToken';
const REFRESH_KEY   = 'glondia.refreshToken';
const SESSION_KEY   = 'glondia.sessionId';
const ORG_KEY       = 'glondia.organizationId';
const USER_KEY      = 'glondia.user';
const ACTIVITY_KEY  = 'glondia.lastActivityAt';

export const AUTH_CHANGED_EVENT = 'glondia:auth-changed';

let refreshInFlight = null;
const IDLE_TIMEOUT_MS = Math.max(60_000, Number(import.meta.env.VITE_SESSION_IDLE_TIMEOUT_MS || 30 * 60_000));
const REFRESH_WINDOW_MS = Math.max(30_000, Number(import.meta.env.VITE_SESSION_REFRESH_WINDOW_MS || 5 * 60_000));

// ─── Storage helpers ──────────────────────────────────────────────────────────

export function getStoredAuth() {
  const userJson = window.localStorage.getItem(USER_KEY);
  return {
    accessToken:    window.localStorage.getItem(TOKEN_KEY),
    refreshToken:   window.localStorage.getItem(REFRESH_KEY),
    sessionId:      window.localStorage.getItem(SESSION_KEY),
    organizationId: window.localStorage.getItem(ORG_KEY),
    user: userJson ? safeParseJson(userJson) : null,
  };
}

export function isAuthenticated() {
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (isLiveMode() && token === 'local-demo-token') return false;
  // An expired access JWT is recoverable while its rotated refresh token is
  // still valid. Session restoration performs that refresh asynchronously.
  if (token && isAccessTokenExpired(token)) return Boolean(window.localStorage.getItem(REFRESH_KEY));
  return Boolean(token);
}

export function getAccessTokenExpiry(token = getStoredAuth().accessToken) {
  if (!token || token === 'local-demo-token') return null;
  try {
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1] || ''));
    const expiresAt = Number(payload?.exp) * 1000;
    return Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

export function isAccessTokenExpired(token, now = Date.now()) {
  const expiresAt = getAccessTokenExpiry(token);
  // A malformed live token is not a valid session.
  return expiresAt === null ? isLiveMode() : expiresAt <= now;
}

/**
 * Keep logout synchronized with the JWT's exp claim, including after a reload
 * or when another browser tab changes the stored session.
 */
export function watchAccessTokenExpiry() {
  let timer = null;
  let stopped = false;

  const lastActivityAt = () => Number(window.localStorage.getItem(ACTIVITY_KEY) || Date.now());
  const isActive = () => document.visibilityState === 'visible'
    && Date.now() - lastActivityAt() < IDLE_TIMEOUT_MS;

  const schedule = async () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    const { accessToken, refreshToken } = getStoredAuth();
    if (!accessToken || accessToken === 'local-demo-token') return;
    const expiresAt = getAccessTokenExpiry(accessToken);
    const idleAt = lastActivityAt() + IDLE_TIMEOUT_MS;
    if (Date.now() >= idleAt) {
      clearAuthSession();
      return;
    }
    if (isActive() && refreshToken && (!expiresAt || expiresAt - Date.now() <= REFRESH_WINDOW_MS)) {
      try {
        await refreshAccessToken();
      } catch {
        clearAuthSession();
        return;
      }
      if (stopped) return;
      return schedule();
    }
    const nextCheckAt = isActive() && expiresAt
      ? Math.min(idleAt, Math.max(Date.now() + 1_000, expiresAt - REFRESH_WINDOW_MS))
      : idleAt;
    timer = window.setTimeout(schedule, Math.min(nextCheckAt - Date.now(), 2_147_000_000));
  };

  let activityQueued = false;
  const onActivity = () => {
    if (document.visibilityState !== 'visible' || activityQueued || !getStoredAuth().accessToken) return;
    activityQueued = true;
    window.setTimeout(() => {
      activityQueued = false;
      window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      schedule();
    }, 500);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onActivity();
    else {
      // Changing windows begins a fresh inactivity period. It does not revoke
      // the session or affect the backend process.
      window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      schedule();
    }
  };

  const onStorage = (event) => {
    if (event.key && ![TOKEN_KEY, REFRESH_KEY, SESSION_KEY, USER_KEY, ACTIVITY_KEY].includes(event.key)) return;
    schedule();
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  };

  window.addEventListener(AUTH_CHANGED_EVENT, schedule);
  window.addEventListener('storage', onStorage);
  window.addEventListener('pointerdown', onActivity, { passive: true });
  window.addEventListener('keydown', onActivity);
  window.addEventListener('mousemove', onActivity, { passive: true });
  window.addEventListener('touchstart', onActivity, { passive: true });
  window.addEventListener('focus', onActivity);
  document.addEventListener('visibilitychange', onVisibility);
  if (!window.localStorage.getItem(ACTIVITY_KEY)) {
    window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  }
  schedule();
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    window.removeEventListener(AUTH_CHANGED_EVENT, schedule);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pointerdown', onActivity);
    window.removeEventListener('keydown', onActivity);
    window.removeEventListener('mousemove', onActivity);
    window.removeEventListener('touchstart', onActivity);
    window.removeEventListener('focus', onActivity);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function storeAuthSession(session) {
  if (session?.tokens?.accessToken)  window.localStorage.setItem(TOKEN_KEY, session.tokens.accessToken);
  if (session?.tokens?.refreshToken) window.localStorage.setItem(REFRESH_KEY, session.tokens.refreshToken);
  if (session?.session?.id)          window.localStorage.setItem(SESSION_KEY, session.session.id);
  if (session?.organization?.id)     window.localStorage.setItem(ORG_KEY, session.organization.id);
  if (session?.user)                 window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  window.localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

export function clearAuthSession() {
  [TOKEN_KEY, REFRESH_KEY, SESSION_KEY, ORG_KEY, USER_KEY, ACTIVITY_KEY].forEach(k => window.localStorage.removeItem(k));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

/**
 * Merge a patch into the stored auth user and notify listeners. Lets pages
 * (e.g. ProfilePage) reflect saved name/phone/avatar in the topbar immediately
 * without a full re-login. No-op when there is no stored user.
 */
export function updateStoredAuthUser(patch = {}) {
  const current = getStoredAuth().user;
  if (!current) return null;
  const merged = { ...current, ...patch };
  window.localStorage.setItem(USER_KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  return merged;
}

// ─── Auth API calls ───────────────────────────────────────────────────────────

export async function login(email, password) {
  if (!isLiveMode()) {
    const session = makeSession({ email });
    storeAuthSession(session);
    return session;
  }
  const session = await authPost('/v1/auth/login', { email, password });
  storeAuthSession(session);
  return session;
}

export async function register({ name, email, password, organizationName }) {
  if (!isLiveMode()) {
    const session = makeSession({ name, email, organizationName });
    storeAuthSession(session);
    return session;
  }
  const session = await authPost('/v1/auth/register', { name, email, password, organizationName });
  storeAuthSession(session);
  return session;
}

export async function refreshAccessToken() {
  const { refreshToken } = getStoredAuth();
  if (!refreshToken) throw new Error('No refresh token stored.');
  if (!refreshInFlight) {
    refreshInFlight = authPost('/v1/auth/refresh-token', { refreshToken })
      .then((data) => {
        storeAuthSession(data);
        return data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function logout() {
  try {
    const { refreshToken, sessionId } = getStoredAuth();
    if (isLiveMode() && refreshToken) {
      await authPost('/v1/auth/logout', { refreshToken, sessionId });
    }
  } finally {
    clearAuthSession();
  }
}

export async function getMe() {
  let { accessToken } = getStoredAuth();
  if (!accessToken) return null;
  if (isAccessTokenExpired(accessToken)) {
    try {
      await refreshAccessToken();
      accessToken = getStoredAuth().accessToken;
    } catch {
      clearAuthSession();
      return null;
    }
  }
  const base = liveApiBase();
  const res = await fetch(`${base}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    clearAuthSession();
    return null;
  }
  if (res.status === 403) return null;
  if (!res.ok) {
    const error = new Error(`Session verification unavailable (${res.status}).`);
    error.status = res.status;
    throw error;
  }
  const envelope = await res.json();
  return envelope?.data ?? envelope;
}

export async function restoreSession({ attempts = 4 } = {}) {
  if (!isAuthenticated()) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await getMe();
      const user = result?.user || result || null;
      if (user) updateStoredAuthUser(user);
      return user;
    } catch (error) {
      const transient = [429, 500, 502, 503, 504].includes(Number(error?.status));
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (2 ** attempt)));
    }
  }
  return null;
}

// ─── Social auth ──────────────────────────────────────────────────────────────

export function socialAuthUrl(provider) {
  const base = liveApiBase();
  if (provider === 'github') return `${base}/v1/auth/github`;
  if (provider === 'google') return `${base}/v1/auth/google`;
  return null;
}

export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Continue with Google', faClass: 'fa-brands fa-google' },
  { id: 'github', label: 'Continue with GitHub', faClass: 'fa-brands fa-github' },
];

// ─── Auth header helper (used by API clients) ─────────────────────────────────

export function authHeaders() {
  const { accessToken } = getStoredAuth();
  if (!accessToken) return {};
  if (isLiveMode() && accessToken === 'local-demo-token') return {};
  if (isAccessTokenExpired(accessToken)) {
    // Synchronous callers cannot rotate a token. Do not destroy the refresh
    // session here; authFetch performs the refresh and retries safely.
    return {};
  }
  return { Authorization: `Bearer ${accessToken}` };
}

export async function authFetch(input, options = {}) {
  const { accessToken, refreshToken } = getStoredAuth();
  if (accessToken && isAccessTokenExpired(accessToken)) {
    if (!refreshToken) {
      clearAuthSession();
      return fetch(input, withFreshAuthHeaders(options));
    }
    try {
      await refreshAccessToken();
    } catch {
      clearAuthSession();
      return fetch(input, withFreshAuthHeaders(options));
    }
  }
  let response = await fetch(input, withFreshAuthHeaders(options));
  // 401 means the JWT is no longer accepted. A 403 is a service/access
  // decision and must never tear down the customer's valid account session.
  if (response.status === 401 && getStoredAuth().refreshToken) {
    try {
      await refreshAccessToken();
      response = await fetch(input, withFreshAuthHeaders(options));
    } catch {
      clearAuthSession();
    }
  } else if (response.status === 401) {
    clearAuthSession();
  }
  return response;
}

// ─── Demo session factory (kept for non-live mode) ────────────────────────────

export function makeSession(input = {}) {
  const user = {
    id:    'local-user',
    clientId: 'local-client',
    accountUrl: '/client/local-client',
    name:  input.name || input.email?.split('@')[0] || 'Glondia User',
    email: input.email || 'local@glondia.app',
  };
  return {
    user,
    organization: { id: 'local-org', name: input.organizationName || 'Local Workspace', slug: 'local-workspace' },
    membership:   { id: 'local-member', roleId: 'owner' },
    session:      { id: 'local-session', expiresAt: new Date(Date.now() + 86400_000).toISOString() },
    tokens: {
      accessToken:  'local-demo-token',
      refreshToken: 'local-refresh-token',
      tokenType:    'Bearer',
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function liveApiBase() {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  return base || '/api';
}

async function authPost(path, body) {
  const base = liveApiBase();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error?.message || `Auth request failed (${res.status}).`);
  }
  return json?.data ?? json;
}

function safeParseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return decodeURIComponent(Array.from(window.atob(padded))
    .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .join(''));
}

function withFreshAuthHeaders(options = {}) {
  return {
    ...options,
    headers: {
      ...plainHeaders(options.headers),
      ...authHeaders(),
    },
  };
}

function plainHeaders(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}
