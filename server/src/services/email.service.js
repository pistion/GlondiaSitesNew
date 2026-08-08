/**
 * email.service.js — Dashboard Business Email (setup only).
 *
 * Mailbox lists, setup requests, and DNS record guidance.
 * Never stores mailbox passwords or provider secrets.
 * Webmail reading lives in glondia-mail.service.js.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { prisma } from './db.js';
import { createNotification } from './notificationService.js';
import { requireCustomerDomain } from './customerDomainService.js';
import { hashPassword } from './authService.js';
import { readEmailDnsRecords, syncEmailDnsForDomain } from './emailSyncService.js';

const rootDir = resolve(process.cwd());
const dataDir = resolve(process.env.DATA_DIR || join(rootDir, '.glondia-data'));
const storePath = join(dataDir, 'email-services.json');

const VALID_STATUSES = new Set(['active', 'pending_setup', 'setup_required', 'suspended']);
export const MAILBOX_STORAGE_LIMIT_BYTES = 5n * 1024n * 1024n * 1024n;

export const EMAIL_PLANS = Object.freeze([
  Object.freeze({ id: 'email-5', name: 'Starter Mail', mailboxLimit: 5, unitPriceCents: 100, monthlyPriceCents: 500, currency: 'USD' }),
  Object.freeze({ id: 'email-15', name: 'Business Mail', mailboxLimit: 15, unitPriceCents: 100, monthlyPriceCents: 1500, currency: 'USD' }),
  Object.freeze({ id: 'email-25', name: 'Team Mail', mailboxLimit: 25, unitPriceCents: 100, monthlyPriceCents: 2500, currency: 'USD' }),
]);

function publicPlan(plan) {
  return plan ? { ...plan, billingCycle: 'monthly' } : null;
}

function emailPlanServiceId(userId) {
  return `email-plan:${userId}`;
}

function emailPlanOrderId(userId) {
  return `email-plan-order:${userId}`;
}

function findPlan(planId) {
  return EMAIL_PLANS.find((plan) => plan.id === String(planId || '').trim()) || null;
}

async function getSelectedEmailPlan(userId) {
  if (!userId) return null;
  const serviceId = emailPlanServiceId(userId);
  const access = await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId } },
  });
  if (!access?.planId) return null;
  const plan = findPlan(access.planId);
  if (!plan) return null;
  return {
    ...publicPlan(plan),
    accessStatus: access.accessStatus,
    billingStatus: access.billingStatus,
    checkoutOrderId: access.checkoutOrderId || null,
    selectedAt: access.startsAt || access.createdAt,
  };
}

export async function listEmailPlans(userId) {
  return {
    plans: EMAIL_PLANS.map(publicPlan),
    selectedPlan: await getSelectedEmailPlan(userId),
  };
}

function mailboxCapacity(selectedPlan, used) {
  const allowed = selectedPlan?.mailboxLimit || 0;
  const safeUsed = Math.max(0, Number(used || 0));
  return {
    planId: selectedPlan?.id || null,
    planName: selectedPlan?.name || null,
    used: safeUsed,
    allowed,
    remaining: Math.max(0, allowed - safeUsed),
    percentUsed: allowed ? Math.min(100, Math.round((safeUsed / allowed) * 100)) : 0,
    atLimit: allowed > 0 && safeUsed >= allowed,
    hasPlan: Boolean(selectedPlan),
  };
}

export async function getEmailMailboxCapacity(userId) {
  const [selectedPlan, list] = await Promise.all([
    getSelectedEmailPlan(userId),
    listMailboxes(userId),
  ]);
  return mailboxCapacity(selectedPlan, (list.mailboxes || []).length);
}

export async function selectEmailPlan(userId, planId) {
  if (!userId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    err.code = 'AUTH_REQUIRED';
    throw err;
  }
  const plan = findPlan(planId);
  if (!plan) {
    const err = new Error('Choose a valid Business Email plan.');
    err.status = 400;
    err.code = 'INVALID_EMAIL_PLAN';
    throw err;
  }

  const currentPlan = await getSelectedEmailPlan(userId);
  if (currentPlan?.id === plan.id) {
    return {
      selectedPlan: currentPlan,
      message: `${plan.name} is already selected. Continue with your domain and DNS setup.`,
    };
  }

  const currentMailboxes = await listMailboxes(userId);
  if ((currentMailboxes.mailboxes || []).length > plan.mailboxLimit) {
    const err = new Error(`This account already has more than ${plan.mailboxLimit} mailboxes. Choose a larger plan.`);
    err.status = 409;
    err.code = 'EMAIL_PLAN_TOO_SMALL';
    throw err;
  }

  // Existing service tables already provide the billing, catalog, and access
  // ledgers we need. Deterministic ids make repeated clicks safe/idempotent.
  const organizationId = userId === 'local-user' ? 'local-org' : userId;
  const serviceId = emailPlanServiceId(userId);
  const orderId = emailPlanOrderId(userId);
  const now = new Date();
  const metadata = JSON.stringify({
    kind: 'email_plan',
    planId: plan.id,
    planName: plan.name,
    mailboxLimit: plan.mailboxLimit,
    unitPriceCents: plan.unitPriceCents,
    monthlyPriceCents: plan.monthlyPriceCents,
  });

  await prisma.$transaction([
    prisma.checkoutOrder.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        organizationId,
        userId,
        type: 'email_plan',
        provider: 'manual',
        status: 'pending',
        currency: plan.currency,
        actualAmountCents: plan.monthlyPriceCents,
        markupPercent: 0,
        markupAmountCents: 0,
        totalAmountCents: plan.monthlyPriceCents,
        metadata,
      },
      update: {
        organizationId,
        userId,
        status: 'pending',
        currency: plan.currency,
        actualAmountCents: plan.monthlyPriceCents,
        markupPercent: 0,
        markupAmountCents: 0,
        totalAmountCents: plan.monthlyPriceCents,
        metadata,
      },
    }),
    prisma.businessService.upsert({
      where: { id: serviceId },
      create: {
        id: serviceId,
        organizationId,
        createdByUserId: userId,
        checkoutOrderId: orderId,
        type: 'email_plan',
        provider: 'spacemail',
        name: plan.name,
        status: 'pending_setup',
        billingCycle: 'monthly',
        billingAmountCents: plan.monthlyPriceCents,
        markupPercent: 0,
        markupAmountCents: 0,
        totalPriceCents: plan.monthlyPriceCents,
        currency: plan.currency,
        paymentStatus: 'pending',
        metadata,
      },
      update: {
        organizationId,
        createdByUserId: userId,
        checkoutOrderId: orderId,
        name: plan.name,
        status: 'pending_setup',
        billingCycle: 'monthly',
        billingAmountCents: plan.monthlyPriceCents,
        markupPercent: 0,
        markupAmountCents: 0,
        totalPriceCents: plan.monthlyPriceCents,
        currency: plan.currency,
        paymentStatus: 'pending',
        metadata,
      },
    }),
    prisma.serviceAccess.upsert({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId } },
      create: {
        userId,
        organizationId,
        serviceType: 'email',
        serviceId,
        serviceName: plan.name,
        accessStatus: 'pending',
        billingStatus: 'pending',
        adminStatus: 'allowed',
        planId: plan.id,
        checkoutOrderId: orderId,
        startsAt: now,
        metadata,
      },
      update: {
        userId,
        organizationId,
        serviceName: plan.name,
        accessStatus: 'pending',
        billingStatus: 'pending',
        adminStatus: 'allowed',
        planId: plan.id,
        checkoutOrderId: orderId,
        startsAt: now,
        metadata,
      },
    }),
  ]);

  return {
    selectedPlan: await getSelectedEmailPlan(userId),
    message: `${plan.name} selected. Continue with your domain and DNS setup.`,
  };
}

function emptyStore() {
  return { mailboxes: [], requests: [], dnsChecks: {} };
}

async function ensureStore() {
  if (existsSync(storePath)) return;
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(emptyStore(), null, 2));
}

async function readStore() {
  await ensureStore();
  try {
    const raw = JSON.parse(await readFile(storePath, 'utf8'));
    return {
      mailboxes: Array.isArray(raw.mailboxes) ? raw.mailboxes : [],
      requests: Array.isArray(raw.requests) ? raw.requests : [],
      dnsChecks: raw.dnsChecks && typeof raw.dnsChecks === 'object' ? raw.dnsChecks : {},
    };
  } catch {
    return emptyStore();
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function safeParse(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function byteString(value, fallback = 0n) {
  try { return BigInt(value ?? fallback).toString(); } catch { return fallback.toString(); }
}

export function getWebmailConfig() {
  const url = String(process.env.EMAIL_WEBMAIL_URL || '/mailboxes').trim() || '/mailboxes';
  return {
    webmailUrl: url,
    webmailConfigured: true,
  };
}

/** True when email DNS / provider env is present enough to guide setup. */
export function isEmailProviderConfigured() {
  const provider = String(process.env.EMAIL_PROVIDER || '').trim();
  const mx = String(process.env.EMAIL_MX_HOST || '').trim();
  return Boolean(provider || mx);
}

export function getEmailDnsTemplate(domain) {
  const d = String(domain || '').trim().toLowerCase() || 'yourdomain.com';
  const mxHost = String(process.env.EMAIL_MX_HOST || 'mail.glondia.com').trim() || 'mail.glondia.com';
  const spf = String(process.env.EMAIL_SPF_RECORD || `v=spf1 include:${mxHost} ~all`).trim();
  const dkimSelector = String(process.env.EMAIL_DKIM_SELECTOR || 'glondia').trim() || 'glondia';
  const dkimRecord = String(process.env.EMAIL_DKIM_RECORD || `${dkimSelector}._domainkey.${d} CNAME ${dkimSelector}._domainkey.${mxHost}.`).trim();
  const dmarc = String(process.env.EMAIL_DMARC_RECORD || `v=DMARC1; p=none; rua=mailto:dmarc@${d}`).trim();

  return {
    domain: d,
    configured: isEmailProviderConfigured(),
    message: isEmailProviderConfigured()
      ? 'Add these records at your DNS host, then run Check DNS.'
      : 'Email DNS templates are shown as guidance. Set EMAIL_MX_HOST / EMAIL_PROVIDER on the server for your live values.',
    records: [
      {
        id: 'mx',
        type: 'MX',
        host: '@',
        value: mxHost,
        priority: 10,
        ttl: 3600,
        purpose: 'Routes inbound mail for your domain.',
      },
      {
        id: 'spf',
        type: 'TXT',
        host: '@',
        value: spf,
        priority: null,
        ttl: 3600,
        purpose: 'SPF — authorizes Glondia to send mail for this domain.',
      },
      {
        id: 'dkim',
        type: 'TXT/CNAME',
        host: `${dkimSelector}._domainkey`,
        value: dkimRecord,
        priority: null,
        ttl: 3600,
        purpose: 'DKIM — signs outbound messages to reduce spoofing.',
      },
      {
        id: 'dmarc',
        type: 'TXT',
        host: '_dmarc',
        value: dmarc,
        priority: null,
        ttl: 3600,
        purpose: 'DMARC — reporting policy for failed authentication.',
      },
    ],
    instructions: [
      'Open your domain DNS panel (Spaceship, Cloudflare, or your registrar).',
      'Add the MX, SPF, DKIM, and DMARC records exactly as shown.',
      'Wait for DNS to propagate (often 5–60 minutes).',
      'Return here and click Check DNS.',
      'After DNS verifies, request mailboxes — an admin will prepare them.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Real DNS resolution for the propagation check.
// Queries public resolvers so results reflect what the world can see, not a
// local cache. Every lookup is time-boxed and failure-tolerant: a lookup that
// errors is reported as "missing", never as a false "verified".
// ---------------------------------------------------------------------------

const DNS_TIMEOUT_MS = Number(process.env.EMAIL_DNS_TIMEOUT_MS || 6000);
const PUBLIC_DNS_SERVERS = String(process.env.EMAIL_DNS_SERVERS || '1.1.1.1,8.8.8.8')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function makeResolver() {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  if (PUBLIC_DNS_SERVERS.length > 0) {
    try { resolver.setServers(PUBLIC_DNS_SERVERS); } catch { /* fall back to system resolver */ }
  }
  return resolver;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stripDot(value) {
  return String(value || '').trim().replace(/\.$/, '').toLowerCase();
}

function flattenTxt(chunks) {
  // resolveTxt returns string[][] — each record is an array of segments.
  return (Array.isArray(chunks) ? chunks : []).map((entry) =>
    (Array.isArray(entry) ? entry.join('') : String(entry || '')).trim(),
  );
}

async function safeResolve(resolver, method, host) {
  try {
    const value = await withTimeout(resolver[method](host), DNS_TIMEOUT_MS, `${method} ${host}`);
    return { ok: true, value };
  } catch (err) {
    // ENODATA / ENOTFOUND are normal "record not present yet" outcomes.
    return { ok: false, code: err.code || 'LOOKUP_FAILED', value: null };
  }
}

/**
 * Resolve the four email records for a domain against the expected template
 * and return a per-record status the wizard can render truthfully.
 */
async function resolveEmailDns(domain, template) {
  const resolver = makeResolver();
  const d = stripDot(domain);
  const mxHost = stripDot(template.records.find((r) => r.id === 'mx')?.value);
  const dkimHost = `${template.records.find((r) => r.id === 'dkim')?.host || 'glondia._domainkey'}.${d}`;
  const dkimTarget = stripDot(String(template.records.find((r) => r.id === 'dkim')?.value || '').split(/\s+/).pop());

  const [mx, spfTxt, dkimCname, dkimTxt, dmarcTxt] = await Promise.all([
    safeResolve(resolver, 'resolveMx', d),
    safeResolve(resolver, 'resolveTxt', d),
    safeResolve(resolver, 'resolveCname', dkimHost),
    safeResolve(resolver, 'resolveTxt', dkimHost),
    safeResolve(resolver, 'resolveTxt', `_dmarc.${d}`),
  ]);

  // MX
  const mxExchanges = (mx.ok ? mx.value : []).map((r) => stripDot(r.exchange));
  const mxStatus = !mx.ok || mxExchanges.length === 0
    ? 'missing'
    : (mxHost && mxExchanges.some((ex) => ex === mxHost || ex.endsWith(`.${mxHost}`)) ? 'found' : 'incorrect');

  // SPF
  const spfEntries = flattenTxt(spfTxt.ok ? spfTxt.value : []).filter((t) => /v=spf1/i.test(t));
  const spfStatus = spfEntries.length === 0
    ? 'missing'
    : (spfEntries.some((t) => !mxHost || t.toLowerCase().includes(mxHost)) ? 'found' : 'incorrect');

  // DKIM — CNAME to the provider selector, or a TXT public key at the selector host.
  const dkimCnameVal = dkimCname.ok ? stripDot(Array.isArray(dkimCname.value) ? dkimCname.value[0] : dkimCname.value) : '';
  const dkimTxtEntries = flattenTxt(dkimTxt.ok ? dkimTxt.value : []).filter((t) => /(v=DKIM1|k=rsa|p=)/i.test(t));
  let dkimStatus = 'missing';
  if (dkimCnameVal) {
    dkimStatus = (!dkimTarget || dkimCnameVal === dkimTarget || dkimCnameVal.endsWith(`.${dkimTarget}`)) ? 'found' : 'incorrect';
  } else if (dkimTxtEntries.length > 0) {
    dkimStatus = 'found';
  }

  // DMARC
  const dmarcEntries = flattenTxt(dmarcTxt.ok ? dmarcTxt.value : []).filter((t) => /v=DMARC1/i.test(t));
  const dmarcStatus = dmarcEntries.length > 0 ? 'found' : 'missing';

  const byId = {
    mx: { status: mxStatus, observed: mxExchanges.join(', ') || null },
    spf: { status: spfStatus, observed: spfEntries[0] || null },
    dkim: { status: dkimStatus, observed: dkimCnameVal || dkimTxtEntries[0] || null },
    dmarc: { status: dmarcStatus, observed: dmarcEntries[0] || null },
  };

  return byId;
}

function normalizeStatus(value) {
  const s = String(value || 'pending_setup').toLowerCase().replace(/\s+/g, '_');
  if (s === 'pending' || s === 'provisioning' || s === 'setup' || s === 'setup_required') return 'pending_setup';
  if (s === 'disabled' || s === 'blocked' || s === 'cancelled') return 'suspended';
  if (VALID_STATUSES.has(s)) return s === 'setup_required' ? 'pending_setup' : s;
  if (s === 'active' || s === 'paid' || s === 'allowed') return 'active';
  return 'pending_setup';
}

function publicMailbox(row) {
  const meta = typeof row.metadata === 'string' ? safeParse(row.metadata) : (row.metadata || {});
  const email = row.email || meta.email || row.name || null;
  const domain = row.domain || meta.domain || (email && String(email).includes('@') ? String(email).split('@')[1] : null);
  const { webmailUrl } = getWebmailConfig();
  const baseWebmailUrl = row.webmailUrl || meta.webmailUrl || webmailUrl || '/mailboxes';
  const mailboxWebmailUrl = email
    ? `${baseWebmailUrl}${baseWebmailUrl.includes('?') ? '&' : '?'}mailbox=${encodeURIComponent(email)}`
    : baseWebmailUrl;
  return {
    id: row.id,
    email: email || null,
    domain: domain || null,
    displayName: row.displayName || meta.displayName || null,
    status: normalizeStatus(row.status || row.accessStatus),
    storageLimitBytes: byteString(row.storageLimitBytes, MAILBOX_STORAGE_LIMIT_BYTES),
    storageUsedBytes: row.usageSource && row.usageSource !== 'pending_provider'
      ? byteString(row.storageUsedBytes)
      : null,
    usageAvailable: Boolean(row.usageSource && row.usageSource !== 'pending_provider'),
    usageSource: row.usageSource || 'pending_provider',
    lastUsageSyncAt: row.lastUsageSyncAt || null,
    webmailUrl: mailboxWebmailUrl,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    transportSettings: row.transportSettings && row.transportSettings.userId === row.userId
      ? {
        provider: row.transportSettings.provider,
        username: row.transportSettings.username,
        authenticationRequired: row.transportSettings.authenticationRequired,
        imap: {
          host: row.transportSettings.imapHost,
          port: row.transportSettings.imapPort,
          security: row.transportSettings.imapSecurity,
        },
        smtp: {
          host: row.transportSettings.smtpHost,
          port: row.transportSettings.smtpPort,
          security: row.transportSettings.smtpSecurity,
        },
        source: row.transportSettings.source,
        lastSyncedAt: row.transportSettings.lastSyncedAt,
      }
      : null,
  };
}

async function fromEmailMailboxRecords(userId) {
  if (!userId) return [];
  const rows = await prisma.emailMailbox.findMany({
    where: {
      userId,
      businessService: {
        deletedAt: null,
        createdByUserId: userId,
      },
    },
    include: { transportSettings: true },
    orderBy: [{ domain: 'asc' }, { email: 'asc' }],
    take: 250,
  });
  const accessRows = await prisma.serviceAccess.findMany({
    where: {
      userId,
      serviceType: 'email',
      serviceId: { in: rows.map((row) => row.businessServiceId) },
      adminStatus: 'allowed',
      accessStatus: { in: ['active', 'pending', 'suspended'] },
      billingStatus: { in: ['paid', 'trial', 'free', 'pending', 'overdue'] },
    },
    select: { serviceId: true },
  });
  const allowedServiceIds = new Set(accessRows.map((row) => row.serviceId));
  return rows.filter((row) => allowedServiceIds.has(row.businessServiceId)).map(publicMailbox);
}

async function fromBusinessServices(userId) {
  if (!userId || userId === 'local-user') return [];
  try {
    const rows = await prisma.businessService.findMany({
      where: { type: 'email', deletedAt: null, createdByUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => {
      const meta = safeParse(row.metadata);
      return publicMailbox({
        id: row.id,
        email: meta.email || row.name,
        domain: meta.domain || null,
        displayName: meta.displayName,
        status: row.status,
        webmailUrl: meta.webmailUrl || null,
        metadata: meta,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });
  } catch (err) {
    console.warn('[email] BusinessService lookup skipped:', err.message);
    return [];
  }
}

async function fromServiceAccess(userId) {
  try {
    const rows = await prisma.serviceAccess.findMany({
      where: { userId, serviceType: 'email' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.filter((row) => safeParse(row.metadata).kind !== 'email_plan').map((row) => {
      const meta = safeParse(row.metadata);
      return publicMailbox({
        id: row.id,
        email: meta.email || row.serviceName || row.serviceId,
        domain: meta.domain || null,
        displayName: meta.displayName,
        status: row.accessStatus === 'active' ? 'active'
          : row.accessStatus === 'suspended' ? 'suspended'
          : 'pending_setup',
        webmailUrl: meta.webmailUrl || null,
        metadata: meta,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });
  } catch (err) {
    console.warn('[email] ServiceAccess lookup skipped:', err.message);
    return [];
  }
}

function dedupeMailboxes(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item.email || item.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function listMailboxes(userId) {
  const webmail = getWebmailConfig();
  const persisted = await fromEmailMailboxRecords(userId);

  return {
    mailboxes: dedupeMailboxes(persisted),
    ...webmail,
  };
}

async function requireOwnedMailbox(userId, mailboxId) {
  const mailbox = await prisma.emailMailbox.findFirst({
    where: {
      id: String(mailboxId || ''),
      userId,
      businessService: {
        deletedAt: null,
        createdByUserId: userId,
      },
    },
    include: { transportSettings: true },
  });
  const access = mailbox
    ? await prisma.serviceAccess.findUnique({
      where: {
        serviceType_serviceId: {
          serviceType: 'email',
          serviceId: mailbox.businessServiceId,
        },
      },
    })
    : null;
  if (
    !mailbox
    || access?.userId !== userId
    || access.adminStatus !== 'allowed'
    || !['active', 'pending', 'suspended'].includes(access.accessStatus)
    || !['paid', 'trial', 'free', 'pending', 'overdue'].includes(access.billingStatus)
  ) {
    const err = new Error('Mailbox not found.');
    err.status = 404;
    err.code = 'EMAIL_MAILBOX_NOT_FOUND';
    throw err;
  }
  return mailbox;
}

export async function getMailbox(userId, mailboxId) {
  return publicMailbox(await requireOwnedMailbox(userId, mailboxId));
}

export async function getMailboxUsage(userId, mailboxId) {
  const mailbox = await requireOwnedMailbox(userId, mailboxId);
  const usageAvailable = mailbox.usageSource !== 'pending_provider';
  const limitBytes = byteString(mailbox.storageLimitBytes, MAILBOX_STORAGE_LIMIT_BYTES);
  const usedBytes = usageAvailable ? byteString(mailbox.storageUsedBytes) : null;
  const used = usedBytes == null ? null : Number(usedBytes);
  const limit = Number(limitBytes);
  return {
    mailboxId: mailbox.id,
    limitBytes,
    usedBytes,
    remainingBytes: used == null ? null : Math.max(0, limit - used).toString(),
    percentUsed: used == null || !limit ? null : Math.min(100, Math.round((used / limit) * 100)),
    usageAvailable,
    usageSource: mailbox.usageSource,
    lastUsageSyncAt: mailbox.lastUsageSyncAt,
    message: usageAvailable
      ? 'Mailbox storage usage is synchronized from the mail provider.'
      : 'The 5 GB mailbox limit is active. Live usage will appear after provider quota synchronization is enabled.',
  };
}

export async function changeMailboxPassword(userId, mailboxId, newPassword) {
  const password = String(newPassword || '');
  if (password.length < 10 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    const err = new Error('Password must be 10-128 characters and include uppercase, lowercase, and a number.');
    err.status = 400;
    err.code = 'INVALID_MAILBOX_PASSWORD';
    throw err;
  }
  const mailbox = await requireOwnedMailbox(userId, mailboxId);
  const passwordHash = await hashPassword(password);
  await prisma.emailMailbox.update({
    where: { id: mailbox.id },
    data: { passwordHash },
  });
  await createNotification({
    userId,
    audience: 'user',
    type: 'info',
    title: 'Mailbox password changed',
    message: `The password for ${mailbox.email} was changed.`,
    entityType: 'email_mailbox',
    entityId: mailbox.id,
    metadata: { email: mailbox.email },
  });
  return { mailboxId: mailbox.id, email: mailbox.email, changed: true, changedAt: new Date().toISOString() };
}

export async function getEmailStatus(userId) {
  const [list, selectedPlan] = await Promise.all([
    listMailboxes(userId),
    getSelectedEmailPlan(userId),
  ]);
  const domains = new Set(
    (list.mailboxes || []).map((m) => m.domain).filter(Boolean)
  );
  const dnsVerifiedCount = userId && userId !== 'local-user'
    ? await prisma.emailDnsRecord.count({
      where: { userId, deletedAt: null, type: 'MX', status: 'active' },
    })
    : 0;

  const configured = isEmailProviderConfigured();
  const capacity = mailboxCapacity(selectedPlan, (list.mailboxes || []).length);
  return {
    configured,
    provider: String(process.env.EMAIL_PROVIDER || '').trim() || null,
    message: !selectedPlan
      ? 'Choose a mailbox plan to begin Business Email setup.'
      : configured
        ? `${selectedPlan.name} is selected. Continue with domain, DNS, and mailbox setup.`
        : `${selectedPlan.name} is selected. DNS templates use defaults until EMAIL_MX_HOST is configured on the server.`,
    dnsVerified: dnsVerifiedCount > 0,
    dnsStatus: dnsVerifiedCount > 0 ? 'verified' : 'setup_required',
    mailboxCount: (list.mailboxes || []).length,
    capacity,
    selectedPlan,
    domainCount: domains.size,
    webmailUrl: list.webmailUrl || '/glondiamail',
  };
}

export async function createMailboxRequest(userId, body = {}) {
  const domain = String(body.domain || '').trim().toLowerCase();
  const mailboxName = String(body.mailboxName || '').trim().toLowerCase().replace(/@.*$/, '');
  const password = String(body.password || '');

  if (!domain) {
    const err = new Error('Domain name is required.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (!mailboxName) {
    const err = new Error('Mailbox name is required.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    const err = new Error('Enter a valid domain name (e.g. example.com).');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (!/^[a-z0-9._+-]+$/i.test(mailboxName)) {
    const err = new Error('Mailbox name may only contain letters, numbers, and . _ + -');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (password.length < 10 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    const err = new Error('Password must be 10-128 characters and include uppercase, lowercase, and a number.');
    err.status = 400;
    err.code = 'INVALID_MAILBOX_PASSWORD';
    throw err;
  }

  if (!userId) {
    const err = new Error('Authentication required.');
    err.status = 401;
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  const selectedPlan = await getSelectedEmailPlan(userId);
  if (!selectedPlan) {
    const err = new Error('Choose a Business Email plan before configuring mailboxes.');
    err.status = 409;
    err.code = 'EMAIL_PLAN_REQUIRED';
    throw err;
  }

  const existingMailboxes = await listMailboxes(userId);
  if ((existingMailboxes.mailboxes || []).length >= selectedPlan.mailboxLimit) {
    const err = new Error(`Your ${selectedPlan.name} plan supports up to ${selectedPlan.mailboxLimit} mailboxes.`);
    err.status = 409;
    err.code = 'EMAIL_PLAN_LIMIT_REACHED';
    throw err;
  }

  await requireCustomerDomain({ id: userId }, domain);

  // The local dashboard uses a synthetic account. Materialize it only when a
  // developer actually creates a mailbox so the relational credential row
  // follows the same constraints as production customers.
  if (userId === 'local-user') {
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: 'local-mailbox-owner@glondia.local',
        passwordHash: 'local-mailbox-owner-no-login',
        name: 'Local Mailbox Owner',
      },
      update: {},
    });
  }

  const now = new Date().toISOString();
  const email = `${mailboxName}@${domain}`;
  if ((existingMailboxes.mailboxes || []).some((mailbox) => String(mailbox.email || '').toLowerCase() === email)) {
    const err = new Error('That mailbox already exists.');
    err.status = 409;
    err.code = 'MAILBOX_ALREADY_EXISTS';
    throw err;
  }
  const passwordHash = await hashPassword(password);
  const request = {
    id: randomUUID(),
    userId: userId || null,
    domain,
    mailboxName,
    email,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const serviceMetadata = JSON.stringify({
    source: 'spacemail_reseller', email, domain, mailboxName,
    requestId: request.id, planId: selectedPlan.id,
    planServiceId: emailPlanServiceId(userId),
    webmailUrl: getWebmailConfig().webmailUrl,
  });

  const persistedMailbox = await prisma.$transaction(async (tx) => {
    const planAccess = await tx.serviceAccess.findUnique({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId: emailPlanServiceId(userId) } },
    });
    if (!planAccess || planAccess.planId !== selectedPlan.id) {
      const err = new Error('Your selected email plan changed. Refresh and try again.');
      err.status = 409;
      err.code = 'EMAIL_PLAN_CHANGED';
      throw err;
    }
    const persistedCount = await tx.emailMailbox.count({ where: { userId } });
    if (Math.max(persistedCount, (existingMailboxes.mailboxes || []).length) >= selectedPlan.mailboxLimit) {
      const err = new Error(`Your ${selectedPlan.name} plan supports up to ${selectedPlan.mailboxLimit} mailboxes.`);
      err.status = 409;
      err.code = 'EMAIL_PLAN_LIMIT_REACHED';
      throw err;
    }
    await tx.businessService.create({
      data: {
        id: request.id,
        organizationId: userId === 'local-user' ? 'local-org' : userId,
        createdByUserId: userId,
        type: 'email',
        provider: 'spaceship',
        providerServiceId: email,
        name: email,
        status: 'pending_setup',
        billingCycle: 'monthly',
        billingAmountCents: 0,
        markupPercent: 0,
        markupAmountCents: 0,
        totalPriceCents: 0,
        currency: 'USD',
        paymentStatus: 'pending',
        metadata: serviceMetadata,
      },
    });
    const mailbox = await tx.emailMailbox.create({
      data: {
        id: randomUUID(), userId, planServiceId: emailPlanServiceId(userId),
        businessServiceId: request.id, email, localPart: mailboxName, domain,
        passwordHash, status: 'pending_setup',
      },
    });
    await tx.emailTransportSetting.create({
      data: {
        userId,
        organizationId: userId === 'local-user' ? 'local-org' : userId,
        emailMailboxId: mailbox.id,
        provider: 'spacemail',
        username: email,
        imapHost: 'mail.spacemail.com',
        imapPort: 993,
        imapSecurity: 'SSL/TLS',
        smtpHost: 'mail.spacemail.com',
        smtpPort: 465,
        smtpSecurity: 'SSL/TLS',
        authenticationRequired: true,
        source: 'provider_catalog',
      },
    });
    await tx.serviceAccess.create({
      data: {
        userId,
        organizationId: userId === 'local-user' ? 'local-org' : userId,
        serviceType: 'email',
        serviceId: request.id,
        serviceName: email,
        accessStatus: 'pending',
        billingStatus: 'pending',
        adminStatus: 'allowed',
        planId: selectedPlan.id,
        metadata: JSON.stringify({ kind: 'mailbox', source: 'mailbox_request', email, domain }),
      },
    });
    return mailbox;
  });

  try {
    const store = await readStore();
    store.requests = [request, ...(store.requests || [])].slice(0, 500);
    store.mailboxes = store.mailboxes || [];
    if (!store.mailboxes.some((m) => String(m.email).toLowerCase() === email)) {
      store.mailboxes.unshift({ id: request.id, userId, email, domain, status: 'pending_setup', createdAt: now, updatedAt: now });
    }
    await writeStore(store);
  } catch (err) {
    console.error('[email] Failed to mirror mailbox request:', err.message);
  }

  console.log(`[email] Mailbox request from user=${userId || 'unknown'}: ${email}`);

  await createNotification({
    userId,
    audience: 'user',
    type: 'info',
    title: 'Mailbox request received',
    message: `We received your request for ${email}. An admin will prepare it shortly.`,
    entityType: 'email_request',
    entityId: request.id,
    metadata: { domain, mailboxName },
  });
  await createNotification({
    audience: 'admin',
    type: 'info',
    title: 'New mailbox request',
    message: `${email} requested by user ${userId || 'unknown'}.`,
    entityType: 'email_request',
    entityId: request.id,
    metadata: { domain, mailboxName, userId, planId: selectedPlan.id },
  });

  return {
    id: persistedMailbox.id,
    businessServiceId: request.id,
    email,
    domain,
    mailboxName,
    status: request.status,
    planId: selectedPlan.id,
    capacity: await getEmailMailboxCapacity(userId),
    message: 'Mailbox request submitted. An admin will prepare it for your domain.',
    createdAt: request.createdAt,
  };
}

export async function getEmailDns(domain, userId) {
  const cached = await readEmailDnsRecords(userId, domain);
  if (cached.records.length) return cached;
  try {
    return await syncEmailDnsForDomain(userId, domain);
  } catch (error) {
    if (error.status === 404) throw error;
    return cached;
  }
}

/**
 * DNS check — resolves the domain's live public records (MX / SPF / DKIM /
 * DMARC) and reports the real per-record state. A record is only reported as
 * "found" when it is actually observed in public DNS; lookups that error or
 * return nothing are reported as "missing", never as a false "verified".
 */
export async function checkEmailDns(domain, userId) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(d)) {
    const err = new Error('A valid domain is required for DNS check.');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const snapshot = await syncEmailDnsForDomain(userId, d);
  const hasMx = snapshot.records.some((record) => record.type === 'MX');
  return {
    ...snapshot,
    status: hasMx ? 'verified' : 'setup_required',
    checkedAt: new Date().toISOString(),
    verified: hasMx,
    foundCount: snapshot.records.length,
    total: snapshot.records.length,
    message: hasMx
      ? 'Provider DNS records synchronized to the database.'
      : 'DNS synchronized, but no MX record is currently configured.',
  };
}

// Back-compat re-exports used by older imports
export { listMailboxes as listEmailMailboxes };
