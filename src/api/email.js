/**
 * Dashboard Business Email API client.
 * Setup / DNS / mailbox requests only — never passwords or provider secrets.
 */
import { liveApiRequest } from '../api.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';
import {
  sandboxEmailCapacity,
  sandboxEmailDns,
  sandboxEmailMailbox,
  sandboxEmailMailboxes,
  sandboxEmailPlansResponse,
  sandboxEmailStatus,
  sandboxEmailUsage,
} from '../features/sandbox/sandboxFixtures.js';

function emailSandbox() {
  const sandbox = getActiveServiceSandbox();
  return sandbox?.service === 'email' || sandbox?.service === 'email-mailboxes' ? sandbox : null;
}

function soft(err, fallback) {
  if (err?.status === 503 || err?.status === 404 || err?.status === 401) {
    return { ...fallback, error: err.message };
  }
  throw err;
}

export async function getEmailStatus() {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailStatus(sandbox);
  return liveApiRequest('/v1/email/status');
}

export async function getEmailPlans() {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailPlansResponse(sandbox);
  return liveApiRequest('/v1/email/plans');
}

export async function getEmailMailboxCapacity() {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailCapacity(sandbox);
  return liveApiRequest('/v1/email/capacity');
}

export async function selectEmailPlan(planId) {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailPlansResponse({ ...sandbox, payload: { ...(sandbox.payload || {}), plan: planId } });
  return liveApiRequest('/v1/email/plans/select', {
    method: 'POST',
    body: JSON.stringify({ planId: String(planId || '').trim() }),
  });
}

export async function listEmailMailboxes() {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailMailboxes(sandbox);
  const data = await liveApiRequest('/v1/email/mailboxes');
  return {
    mailboxes: Array.isArray(data?.mailboxes) ? data.mailboxes : (Array.isArray(data) ? data : []),
    webmailUrl: data?.webmailUrl || '/mailboxes',
    webmailConfigured: Boolean(data?.webmailConfigured ?? true),
  };
}

export async function getEmailMailbox(mailboxId) {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailMailbox(sandbox, mailboxId);
  return liveApiRequest(`/v1/email/mailboxes/${encodeURIComponent(String(mailboxId || '').trim())}`);
}

export async function getEmailMailboxUsage(mailboxId) {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailUsage(sandbox, mailboxId);
  return liveApiRequest(`/v1/email/mailboxes/${encodeURIComponent(String(mailboxId || '').trim())}/usage`);
}

export async function changeEmailMailboxPassword(mailboxId, newPassword) {
  const sandbox = emailSandbox();
  if (sandbox) return { ok: true, mailboxId, updatedAt: new Date().toISOString(), sandbox: true };
  return liveApiRequest(`/v1/email/mailboxes/${encodeURIComponent(String(mailboxId || '').trim())}/password`, {
    method: 'PATCH',
    body: JSON.stringify({ newPassword: String(newPassword || '') }),
  });
}

/** @deprecated use listEmailMailboxes */
export async function listMailboxes() {
  return listEmailMailboxes();
}

export async function requestEmailMailbox(body) {
  const sandbox = emailSandbox();
  if (sandbox) {
    const domain = String(body.domain || sandbox.payload?.domain || 'glondia-sandbox.com').trim();
    const mailboxName = String(body.mailboxName || 'info').trim();
    return {
      mailbox: {
        id: `sandbox-mailbox-${mailboxName}`,
        email: `${mailboxName}@${domain}`,
        mailboxName,
        domain,
        status: 'pending_setup',
        storageLimitBytes: 5 * 1024 ** 3,
        storageUsedBytes: 0,
      },
      capacity: sandboxEmailCapacity(sandbox),
      sandbox: true,
    };
  }
  return liveApiRequest('/v1/email/mailboxes/request', {
    method: 'POST',
    body: JSON.stringify({
      domain: String(body.domain || '').trim(),
      mailboxName: String(body.mailboxName || '').trim(),
      password: String(body.password || ''),
    }),
  });
}

/** @deprecated use requestEmailMailbox */
export async function requestMailbox(body) {
  return requestEmailMailbox(body);
}

export async function getEmailDnsRecords(domain) {
  const sandbox = emailSandbox();
  if (sandbox) return sandboxEmailDns(domain || sandbox.payload?.domain);
  const d = encodeURIComponent(String(domain || '').trim());
  return liveApiRequest(`/v1/email/dns/${d}`);
}

export async function checkEmailDns(domain) {
  const sandbox = emailSandbox();
  if (sandbox) return { ...sandboxEmailDns(domain || sandbox.payload?.domain), checkedAt: new Date().toISOString(), found: 2, total: 4, status: 'partial' };
  const d = encodeURIComponent(String(domain || '').trim());
  return liveApiRequest(`/v1/email/dns/${d}/check`, { method: 'POST', body: '{}' });
}
