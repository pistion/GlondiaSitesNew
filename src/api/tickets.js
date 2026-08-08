/**
 * Tickets API client — the customer's in-app support conversations.
 * All calls are authenticated; liveApiRequest unwraps { data }.
 */
import { liveApiRequest } from '../api.js';
import { getStoredAuth } from './auth.js';
import { getActiveServiceSandbox } from '../features/sandbox/sandboxState.js';
import { sandboxTicket, sandboxTickets } from '../features/sandbox/sandboxFixtures.js';

function authed() {
  return Boolean(getStoredAuth()?.accessToken);
}

/** List the caller's tickets (with last message + unread count per ticket). */
export function listTickets({ status, limit = 50, offset = 0 } = {}) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return Promise.resolve(sandboxTickets());
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (limit) qs.set('limit', String(limit));
  if (offset) qs.set('offset', String(offset));
  return liveApiRequest(`/v1/tickets?${qs.toString()}`);
}

/** Create a ticket with its first message. */
export function createTicket({ subject, category, priority, relatedServiceType, relatedServiceId, body }) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return Promise.resolve({ ...sandboxTicket('sandbox-ticket-new'), subject, category, priority, relatedServiceType, relatedServiceId, body });
  return liveApiRequest('/v1/tickets', {
    method: 'POST',
    body: { subject, category, priority, relatedServiceType, relatedServiceId, body },
  });
}

/** Full conversation, messages ascending. */
export function getTicket(ticketId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return Promise.resolve(sandboxTicket(ticketId));
  return liveApiRequest(`/v1/tickets/${encodeURIComponent(ticketId)}`);
}

/** Send a customer message. */
export function sendTicketMessage(ticketId, body) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return Promise.resolve({ id: `sandbox-message-${Date.now()}`, ticketId, body, status: 'sent', sandbox: true });
  return liveApiRequest(`/v1/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    body: { body },
  });
}

/** Mark admin messages seen + reset the caller's unread counter. */
export function markTicketSeen(ticketId) {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return Promise.resolve({ ok: true, ticketId, sandbox: true });
  return liveApiRequest(`/v1/tickets/${encodeURIComponent(ticketId)}/seen`, { method: 'POST' });
}

/** Unread admin replies across all tickets — sidebar badge. */
export async function getTicketsUnreadCount() {
  const sandbox = getActiveServiceSandbox();
  if (sandbox?.service === 'support') return { count: 1 };
  if (!authed()) return { count: 0 };
  return liveApiRequest('/v1/tickets/unread-count');
}
