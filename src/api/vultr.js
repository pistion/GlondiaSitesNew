import { authFetch } from './auth.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';
import {
  sandboxVpsOperatingSystems,
  sandboxVpsPlans,
  sandboxVpsRegions,
  sandboxVpsServices,
  sandboxVpsSettings,
  sandboxVpsSummary,
} from '../features/sandbox/sandboxFixtures.js';

function vpsSandbox() {
  const sandbox = getActiveServiceSandbox();
  return sandbox?.service === 'vps' ? sandbox : null;
}

function liveApiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : `/api${path}`;
}

async function vpsRequest(path, options = {}) {
  const response = await authFetch(liveApiUrl(path), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.message || result?.error?.message || `VPS request failed (${response.status}).`);
  }
  return result?.data ?? result;
}

// ─── Settings / catalog ────────────────────────────────────────────────────────

export function getVultrSettings() {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsSettings());
  return vpsRequest('/v1/vps-hosting/settings');
}

export function listVultrRegions() {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsRegions());
  return vpsRequest('/v1/vps-hosting/regions');
}

export function listVultrPlans(type, options = {}) {
  if (vpsSandbox()) {
    const plans = sandboxVpsPlans().filter((plan) => !type || plan.type === type);
    return Promise.resolve(plans);
  }
  const qs = new URLSearchParams();
  if (type) qs.set('type', type);
  if (options.region) qs.set('region', options.region);
  if (options.curated) qs.set('curated', 'true');
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return vpsRequest(`/v1/vps-hosting/plans${query}`);
}

export function listVultrOperatingSystems() {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsOperatingSystems());
  return vpsRequest('/v1/vps-hosting/os');
}

// ─── Quote ─────────────────────────────────────────────────────────────────────

export function getVpsQuote({ region, plan, osId }) {
  if (vpsSandbox()) return Promise.resolve({ region, plan, osId, currency: 'USD', monthlyCost: 6, displayAmount: 'USD 6.00', sandbox: true });
  return vpsRequest('/v1/vps-hosting/quote', {
    method: 'POST',
    body: { region, plan, osId },
  });
}

// ─── Deploy (usage-billed) ─────────────────────────────────────────────────────

export function deployVpsService(provisionDetails) {
  if (vpsSandbox()) return Promise.resolve({ ...sandboxVpsServices()[0], ...provisionDetails, status: 'provisioning', sandbox: true });
  return vpsRequest('/v1/vps-hosting/services', {
    method: 'POST',
    body: provisionDetails,
  });
}

// ─── VPS service management ────────────────────────────────────────────────────

export function listVpsServices() {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsServices());
  return vpsRequest('/v1/vps-hosting/services');
}

export function getVpsService(id) {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsServices().find((item) => item.id === id) || sandboxVpsServices()[0]);
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}`);
}

export function getVpsServiceSummary(id) {
  if (vpsSandbox()) return Promise.resolve(sandboxVpsSummary(id));
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/summary`);
}

export function updateVpsServiceSettings(id, settings) {
  if (vpsSandbox()) return Promise.resolve({ id, ...settings, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/settings`, {
    method: 'PATCH',
    body: settings,
  });
}

export function startVpsService(id) {
  if (vpsSandbox()) return Promise.resolve({ id, status: 'running', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/start`, { method: 'POST' });
}

export function haltVpsService(id) {
  if (vpsSandbox()) return Promise.resolve({ id, status: 'stopped', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/halt`, { method: 'POST' });
}

export function rebootVpsService(id) {
  if (vpsSandbox()) return Promise.resolve({ id, status: 'rebooting', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/reboot`, { method: 'POST' });
}

export function destroyVpsService(id) {
  if (vpsSandbox()) return Promise.resolve({ id, deleted: true, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Resize & reinstall ────────────────────────────────────────────────────────

export function resizeVpsService(id, plan) {
  if (vpsSandbox()) return Promise.resolve({ id, plan, status: 'resizing', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/resize`, {
    method: 'PATCH',
    body: { plan },
  });
}

export function reinstallVpsService(id, osId) {
  if (vpsSandbox()) return Promise.resolve({ id, osId, status: 'reinstalling', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/reinstall`, {
    method: 'POST',
    body: osId != null ? { osId } : {},
  });
}

// Protected reveal — root credentials are no longer part of the service payload.
export function getVpsCredentials(id) {
  if (vpsSandbox()) return Promise.resolve({ id, username: 'root', passwordAvailable: false, message: 'Credentials hidden in sandbox mode.' });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/credentials`);
}

// ─── SSH keys ──────────────────────────────────────────────────────────────────

export function listVpsSshKeys() {
  if (vpsSandbox()) return Promise.resolve([]);
  return vpsRequest('/v1/vps-hosting/ssh-keys');
}

export function createVpsSshKey({ name, publicKey }) {
  if (vpsSandbox()) return Promise.resolve({ id: `sandbox-key-${Date.now()}`, name, ssh_key: publicKey, sandbox: true });
  return vpsRequest('/v1/vps-hosting/ssh-keys', {
    method: 'POST',
    body: { name, publicKey },
  });
}

export function deleteVpsSshKey(keyId) {
  if (vpsSandbox()) return Promise.resolve({ ok: true, keyId, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/ssh-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
}

// ─── Bandwidth ─────────────────────────────────────────────────────────────────

export function getVpsBandwidth(id) {
  if (vpsSandbox()) return Promise.resolve({ id, usedGb: 42, includedGb: 1000, percentUsed: 4 });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/bandwidth`);
}

// ─── Snapshots ─────────────────────────────────────────────────────────────────

export function listVpsSnapshots() {
  if (vpsSandbox()) return Promise.resolve([]);
  return vpsRequest('/v1/vps-hosting/snapshots');
}

export function listVpsServiceSnapshots(id) {
  if (vpsSandbox()) return Promise.resolve([]);
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/snapshots`);
}

export function createVpsSnapshot(id, description) {
  if (vpsSandbox()) return Promise.resolve({ id: `sandbox-snapshot-${Date.now()}`, serviceId: id, description, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/snapshots`, {
    method: 'POST',
    body: { description },
  });
}

export function deleteVpsSnapshot(snapshotId) {
  if (vpsSandbox()) return Promise.resolve({ ok: true, snapshotId, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
}

export function restoreVpsFromSnapshot(id, snapshotId) {
  if (vpsSandbox()) return Promise.resolve({ id, snapshotId, status: 'restoring', sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: { snapshotId },
  });
}

// ─── Backup schedule ───────────────────────────────────────────────────────────

export function getVpsBackupSchedule(id) {
  if (vpsSandbox()) return Promise.resolve({ id, enabled: true, frequency: 'weekly', nextRunAt: new Date(Date.now() + 86400000).toISOString() });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/backup-schedule`);
}

export function setVpsBackupSchedule(id, schedule) {
  if (vpsSandbox()) return Promise.resolve({ id, ...schedule, sandbox: true });
  return vpsRequest(`/v1/vps-hosting/services/${encodeURIComponent(id)}/backup-schedule`, {
    method: 'POST',
    body: schedule,
  });
}
