import { prisma } from './db.js';
import { listSpaceshipDnsRecords } from './providerSpaceship.service.js';
import { listCloudflareDnsRecords } from './providerCloudflare.service.js';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function normalizedRecord(record = {}) {
  const type = String(record.type || '').toUpperCase();
  const name = String(record.name || record.host || '@').trim().toLowerCase();
  const value = String(record.value || record.address || record.exchange || record.text || record.target || '').trim();
  const priority = record.priority ?? record.preference ?? null;
  const ttl = Number(record.ttl || record.ttlSeconds || 3600);
  return {
    recordKey: `${type}:${name}:${value}:${priority ?? ''}`.toLowerCase(),
    type,
    name,
    value,
    priority: priority == null ? null : Number(priority),
    ttl: Number.isFinite(ttl) ? ttl : 3600,
    metadata: record,
  };
}

async function providerRecords(provider, domain, providerMetadata = {}) {
  if (provider === 'spaceship') {
    const result = await listSpaceshipDnsRecords(domain, { take: 500, skip: 0 });
    return result.records || [];
  }
  if (provider === 'cloudflare') {
    const zoneId = providerMetadata.zoneId || providerMetadata.id;
    if (!zoneId) return [];
    return listCloudflareDnsRecords(zoneId);
  }
  return [];
}

async function ownedDomain(userId, domain) {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  const domainService = await prisma.businessService.findFirst({
    where: {
      createdByUserId: userId,
      type: 'domain',
      name: normalizedDomain,
      deletedAt: null,
    },
  });
  if (domainService) return domainService;
  const mailbox = await prisma.emailMailbox.findFirst({
    where: {
      userId,
      domain: normalizedDomain,
      businessService: { deletedAt: null, createdByUserId: userId },
    },
    include: { businessService: true },
  });
  if (!mailbox) return null;
  return {
    organizationId: mailbox.businessService.organizationId,
    createdByUserId: userId,
    name: normalizedDomain,
    provider: 'spaceship',
    metadata: JSON.stringify({ source: 'owned_mailbox_domain' }),
  };
}

export async function syncEmailDnsForDomain(userId, domain) {
  const service = await ownedDomain(userId, domain);
  if (!service) {
    throw Object.assign(new Error('Domain not found.'), { status: 404, code: 'DOMAIN_NOT_FOUND' });
  }
  const metadata = parseJson(service.metadata, {});
  const providers = new Set([service.provider, ...Object.keys(metadata.providers || {})]);
  const snapshots = [];
  for (const provider of providers) {
    if (!['spaceship', 'cloudflare'].includes(provider)) continue;
    const records = await providerRecords(provider, service.name, metadata.providers?.[provider] || {});
    snapshots.push(...records.map((record) => ({ provider, ...normalizedRecord(record) })));
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const provider of providers) {
      if (!['spaceship', 'cloudflare'].includes(provider)) continue;
      const current = snapshots.filter((record) => record.provider === provider);
      const keys = current.map((record) => record.recordKey);
      await tx.emailDnsRecord.updateMany({
        where: {
          userId,
          domain: service.name,
          provider,
          deletedAt: null,
          ...(keys.length ? { recordKey: { notIn: keys } } : {}),
        },
        data: { deletedAt: now, syncStatus: 'removed' },
      });
      for (const record of current) {
        await tx.emailDnsRecord.upsert({
          where: {
            userId_domain_provider_recordKey: {
              userId,
              domain: service.name,
              provider,
              recordKey: record.recordKey,
            },
          },
          create: {
            userId,
            organizationId: service.organizationId,
            domain: service.name,
            provider,
            recordKey: record.recordKey,
            type: record.type,
            name: record.name,
            value: record.value,
            priority: record.priority,
            ttl: record.ttl,
            metadata: JSON.stringify(record.metadata),
            lastSyncedAt: now,
          },
          update: {
            type: record.type,
            name: record.name,
            value: record.value,
            priority: record.priority,
            ttl: record.ttl,
            status: 'active',
            syncStatus: 'synced',
            metadata: JSON.stringify(record.metadata),
            lastSyncedAt: now,
            deletedAt: null,
          },
        });
      }
    }
  });
  return readEmailDnsRecords(userId, service.name);
}

export async function readEmailDnsRecords(userId, domain) {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  const service = await ownedDomain(userId, normalizedDomain);
  if (!service) {
    throw Object.assign(new Error('Domain not found.'), { status: 404, code: 'DOMAIN_NOT_FOUND' });
  }
  const records = await prisma.emailDnsRecord.findMany({
    where: { userId, domain: normalizedDomain, deletedAt: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  return {
    domain: normalizedDomain,
    records: records.map((record) => ({
      id: record.id,
      type: record.type,
      host: record.name,
      name: record.name,
      value: record.value,
      priority: record.priority,
      ttl: record.ttl,
      providerLabel: 'GlondiaMail',
      status: record.status,
      syncStatus: record.syncStatus,
      lastSyncedAt: record.lastSyncedAt,
    })),
    lastSyncedAt: records.reduce(
      (latest, record) => !latest || record.lastSyncedAt > latest ? record.lastSyncedAt : latest,
      null,
    ),
  };
}

export async function syncAllEmailDns() {
  const mailboxes = await prisma.emailMailbox.findMany({
    select: { userId: true, domain: true },
    distinct: ['userId', 'domain'],
  });
  const results = [];
  for (const mailbox of mailboxes) {
    try {
      const result = await syncEmailDnsForDomain(mailbox.userId, mailbox.domain);
      results.push({ domain: mailbox.domain, status: 'synced', count: result.records.length });
    } catch (error) {
      results.push({ domain: mailbox.domain, status: 'failed', error: error.message });
    }
  }
  return results;
}

export function startEmailSyncScheduler() {
  if (String(process.env.EMAIL_SYNC_ENABLED || 'true').toLowerCase() === 'false') return null;
  const intervalMs = Math.max(Number(process.env.EMAIL_SYNC_INTERVAL_MS || 900000), 60000);
  const timer = setInterval(() => {
    syncAllEmailDns().catch((error) => console.error('[email-sync]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
