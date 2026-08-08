/**
 * GlondiaMail API client — webmail only.
 * Passwords are sent only to the server over HTTPS and never stored in localStorage.
 */
import { liveApiRequest } from '../api.js';

export async function loginMail({ email, password }) {
  return liveApiRequest('/v1/glondia-mail/login', {
    method: 'POST',
    body: JSON.stringify({
      email: String(email || '').trim(),
      password: String(password || ''),
    }),
  });
}

export async function logoutMail() {
  try {
    return await liveApiRequest('/v1/glondia-mail/logout', { method: 'POST', body: '{}' });
  } catch {
    return { ok: true };
  }
}

export async function getMailSession() {
  try {
    return await liveApiRequest('/v1/glondia-mail/session');
  } catch (err) {
    return {
      authenticated: false,
      enabled: false,
      configured: false,
      message: err.message || 'GlondiaMail connection is being prepared.',
      mailbox: null,
    };
  }
}

export async function listMailFolders() {
  try {
    return await liveApiRequest('/v1/glondia-mail/folders');
  } catch (err) {
    return {
      enabled: false,
      configured: false,
      folders: [],
      message: err.message || 'GlondiaMail connection is being prepared.',
    };
  }
}

export async function listMailMessages(folder = 'inbox') {
  try {
    return await liveApiRequest(`/v1/glondia-mail/messages?folder=${encodeURIComponent(folder)}`);
  } catch (err) {
    return {
      enabled: false,
      messages: [],
      folder,
      message: err.message || 'GlondiaMail connection is being prepared.',
    };
  }
}

export async function getMailMessage(id) {
  return liveApiRequest(`/v1/glondia-mail/messages/${encodeURIComponent(id)}`);
}

export async function updateMailMessage(id, changes) {
  return liveApiRequest(`/v1/glondia-mail/messages/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(changes || {}),
  });
}

export async function moveMailMessage(id, folderRole) {
  return liveApiRequest(`/v1/glondia-mail/messages/${encodeURIComponent(id)}/move`, {
    method: 'POST', body: JSON.stringify({ folderRole }),
  });
}

export function getMailAttachmentUrl(messageId, attachmentId, download = false) {
  const suffix = download ? '?download=1' : '';
  return `/api/v1/glondia-mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}${suffix}`;
}

export async function sendMail(payload) {
  return liveApiRequest('/v1/glondia-mail/send', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}
