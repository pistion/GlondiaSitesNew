import { randomBytes } from 'node:crypto';
import { verifyPassword } from './authService.js';
import { prisma } from './db.js';

const sessions = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function getMailProviderConfig() {
  return {
    configured: true,
    transportConfigured: false,
    message: 'GlondiaMail authentication is active. Provider password transport is disabled.',
  };
}

function cookieToken(req) {
  const cookies = String(req?.headers?.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === 'glondia_mail_session') return decodeURIComponent(value.join('='));
  }
  return '';
}

function requireSession(req) {
  const token = cookieToken(req);
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    throw Object.assign(new Error('GlondiaMail session expired.'), { status: 401, code: 'MAIL_SESSION_REQUIRED' });
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

async function findMailbox(email) {
  return prisma.emailMailbox.findUnique({
    where: { email: String(email || '').trim().toLowerCase() },
    include: { businessService: true },
  });
}

function addresses(value) {
  return Array.isArray(value?.value)
    ? value.value.map((item) => ({ name: item.name || '', address: item.address || '' }))
    : [];
}

function parseJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function publicMessage(row, includeBody = false) {
  const from = parseJson(row.fromJson);
  const to = parseJson(row.toJson);
  const cc = parseJson(row.ccJson);
  const replyTo = parseJson(row.replyToJson);
  const flags = parseJson(row.flagsJson);
  return {
    id: row.id,
    subject: row.subject || '(no subject)',
    from: from[0]?.address || '',
    fromName: from[0]?.name || '',
    to: to.map((item) => item.address).filter(Boolean).join(', '),
    addresses: { from, to, cc, replyTo },
    date: row.receivedAt || row.sentAt,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    unread: !flags.includes('\\Seen'),
    flagged: flags.includes('\\Flagged'),
    flags,
    folderRole: row.folder?.role || null,
    folderId: row.folderId,
    sizeBytes: row.sizeBytes,
    hasAttachments: row.hasAttachments,
    ...(includeBody ? {
      textBody: row.textBody,
      htmlBody: row.htmlBody,
      cc: cc.map((item) => item.address).filter(Boolean).join(', '),
      replyTo: replyTo.map((item) => item.address).filter(Boolean).join(', '),
      attachments: row.attachments?.map((item) => ({
        id: item.id,
        filename: item.filename,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        contentId: item.contentId,
      })) || [],
    } : {}),
  };
}

export async function getSession(req) {
  try {
    const session = requireSession(req);
    return { authenticated: true, enabled: true, configured: true, transportConfigured: false, mailbox: session.email, message: 'Signed in to GlondiaMail.' };
  } catch {
    const cfg = getMailProviderConfig();
    return { authenticated: false, enabled: cfg.configured, configured: cfg.configured, mailbox: null, message: 'Sign in with your GlondiaMail password.' };
  }
}

export async function login(body = {}) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const mailbox = await findMailbox(email);
  if (!mailbox || mailbox.status === 'suspended') {
    throw Object.assign(new Error('Mailbox address or GlondiaMail password is incorrect.'), { status: 401, code: 'INVALID_MAILBOX_CREDENTIALS' });
  }
  const valid = await verifyPassword(password, mailbox.passwordHash);
  if (!valid) throw Object.assign(new Error('Mailbox address or GlondiaMail password is incorrect.'), { status: 401, code: 'INVALID_MAILBOX_CREDENTIALS' });
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, {
    email,
    userId: mailbox.userId,
    organizationId: mailbox.businessService.organizationId,
    mailboxId: mailbox.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return { token, mailbox: email, expiresInMs: SESSION_TTL_MS };
}

export async function logout(req) {
  const token = cookieToken(req);
  if (token) sessions.delete(token);
  return { ok: true, message: 'Signed out of GlondiaMail.' };
}

export async function listFolders(req) {
  const session = requireSession(req);
  const rows = await prisma.mailFolder.findMany({
    where: { userId: session.userId, emailMailboxId: session.mailboxId },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  return {
    enabled: true,
    configured: true,
    transportConfigured: false,
    folders: rows.map((row) => ({ id: row.providerFolderId, name: row.name, role: row.role })),
  };
}

export async function listMessages(req, query = {}) {
  const session = requireSession(req);
  const folder = String(query.folder || 'INBOX');
  const folderRole = folder.toLowerCase() === 'spam' ? 'junk' : folder.toLowerCase();
  const rows = await prisma.mailMessage.findMany({
    where: {
      userId: session.userId,
      emailMailboxId: session.mailboxId,
      folder: {
        OR: [
          { providerFolderId: folder },
          { role: folderRole },
        ],
      },
    },
    include: { folder: true },
    orderBy: [{ receivedAt: 'desc' }, { importedAt: 'desc' }],
    take: 250,
  });
  return { enabled: true, configured: true, transportConfigured: false, folder, messages: rows.map((row) => publicMessage(row)) };
}

export async function getMessage(req, id) {
  const session = requireSession(req);
  const row = await prisma.mailMessage.findFirst({
    where: { id: String(id || ''), userId: session.userId, emailMailboxId: session.mailboxId },
    include: { attachments: true, folder: true },
  });
  if (!row) throw Object.assign(new Error('Message not found.'), { status: 404, code: 'NOT_FOUND' });
  return publicMessage(row, true);
}

function updateFlag(flags, name, enabled) {
  const next = new Set(Array.isArray(flags) ? flags : []);
  if (enabled) next.add(name); else next.delete(name);
  return [...next];
}

export async function updateMessage(req, id, body = {}) {
  const session = requireSession(req);
  const row = await prisma.mailMessage.findFirst({
    where: { id: String(id || ''), userId: session.userId, emailMailboxId: session.mailboxId },
  });
  if (!row) throw Object.assign(new Error('Message not found.'), { status: 404, code: 'NOT_FOUND' });
  let flags = parseJson(row.flagsJson);
  if (typeof body.seen === 'boolean') flags = updateFlag(flags, '\\Seen', body.seen);
  if (typeof body.flagged === 'boolean') flags = updateFlag(flags, '\\Flagged', body.flagged);
  const updated = await prisma.mailMessage.update({
    where: { id: row.id },
    data: { flagsJson: JSON.stringify(flags) },
    include: { attachments: true, folder: true },
  });
  return publicMessage(updated, true);
}

export async function moveMessage(req, id, body = {}) {
  const session = requireSession(req);
  const destinationRole = String(body.folderRole || '').trim().toLowerCase();
  if (!destinationRole) throw Object.assign(new Error('Destination folder role is required.'), { status: 400, code: 'FOLDER_ROLE_REQUIRED' });
  const [message, folder] = await Promise.all([
    prisma.mailMessage.findFirst({ where: { id: String(id || ''), userId: session.userId, emailMailboxId: session.mailboxId } }),
    prisma.mailFolder.findFirst({ where: { userId: session.userId, emailMailboxId: session.mailboxId, role: destinationRole } }),
  ]);
  if (!message) throw Object.assign(new Error('Message not found.'), { status: 404, code: 'NOT_FOUND' });
  if (!folder) throw Object.assign(new Error(`The ${destinationRole} folder is unavailable.`), { status: 404, code: 'FOLDER_NOT_FOUND' });
  const updated = await prisma.mailMessage.update({
    where: { id: message.id },
    data: { folderId: folder.id },
    include: { attachments: true, folder: true },
  });
  return publicMessage(updated, true);
}

export async function getAttachment(req, messageId, attachmentId) {
  const session = requireSession(req);
  const row = await prisma.mailAttachment.findFirst({
    where: {
      id: String(attachmentId || ''),
      messageId: String(messageId || ''),
      message: {
        userId: session.userId,
        emailMailboxId: session.mailboxId,
      },
    },
  });
  if (!row || !row.content) {
    throw Object.assign(new Error('Attachment not found.'), { status: 404, code: 'ATTACHMENT_NOT_FOUND' });
  }
  return row;
}

export async function sendMail(req, body = {}) {
  requireSession(req);
  void body;
  throw Object.assign(new Error('Sending is unavailable because provider password transport is disabled.'), {
    status: 503,
    code: 'MAIL_TRANSPORT_DISABLED',
  });
}
