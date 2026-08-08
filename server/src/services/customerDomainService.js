import { prisma } from './db.js';
import { checkServiceAccess } from './serviceAccessService.js';
import {
  cleanDomainName,
  getSpaceshipDomain,
  getSpaceshipSettings,
  listSpaceshipDnsRecords,
  updateSpaceshipNameservers,
} from './providerSpaceship.service.js';
import {
  createCloudflareZone,
  getCloudflareBotManagement,
  getCloudflareDnssec,
  getCloudflareSettings,
  getCloudflareZone,
  getCloudflareZoneSettings,
  getCloudflareZoneSubscription,
  listCloudflareAvailablePlans,
  listCloudflareHealthChecks,
  listCloudflareDnsRecords,
  requestCloudflareActivationCheck,
  updateCloudflareBotManagement,
} from './providerCloudflare.service.js';
import { randomUUID } from 'node:crypto';

const DEFAULT_PROVIDER_SYNC_CLIENT_IDS = ['glondiac-4108'];
const ACCESS_BILLING_OK = ['paid', 'trial', 'free'];
const CLOUDFLARE_MARKUP_PERCENT = 30;
const CLOUDFLARE_ADDONS = {
  bot_control: {
    label: 'Bot control',
    configuration: { fight_mode: true },
    planAvailability: 'free',
    includedProviderCostCents: 0,
  },
  anti_scraping: {
    label: 'Anti-scraping protection',
    configuration: {
      ai_bots_protection: 'block',
      content_bots_protection: 'block',
    },
    planAvailability: 'free_baseline',
    includedProviderCostCents: 0,
  },
};
const CLOUDFLARE_ADDON_STAGES = [
  'record_request',
  'prepare_cloudflare_zone',
  'record_provider_pricing',
  'delegate_nameservers',
  'request_activation_check',
  'enable_addon',
];

function scheduleCloudflareActivationFollowUps(user) {
  for (const delayMs of [30_000, 120_000, 300_000]) {
    const timer = setTimeout(() => {
      syncCustomerCloudflareDomains(user).catch((error) => {
        console.warn('[domain-addon] Cloudflare activation follow-up failed:', error.message);
      });
    }, delayMs);
    timer.unref?.();
  }
}

function accountId(user = {}) {
  return user.id && user.id !== 'local-user' ? user.id : 'local-user';
}

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function providerSyncClientIds() {
  const configured = String(process.env.DOMAIN_PROVIDER_SYNC_CLIENT_IDS || '').trim();
  return new Set((configured ? configured.split(',') : DEFAULT_PROVIDER_SYNC_CLIENT_IDS)
    .map((value) => value.trim())
    .filter(Boolean));
}

async function requireProviderSyncAccount(user = {}) {
  if (!user.id || user.id === 'local-user') throw notFound('Domain provider sync is not available.');
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, clientId: true, accountStatus: true },
  });
  if (!account || account.accountStatus !== 'active' || !providerSyncClientIds().has(account.clientId)) {
    throw notFound('Domain provider sync is not available.');
  }
  return account;
}

function notFound(message) {
  return Object.assign(new Error(message), { status: 404, expose: true });
}

function conflict(message) {
  return Object.assign(new Error(message), { status: 409, expose: true, code: 'PROVIDER_RESOURCE_ALREADY_ASSIGNED' });
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function domainDnsRecord(record = {}) {
  const type = String(record.type || '').toUpperCase();
  const name = String(record.name || record.host || '@').trim().toLowerCase();
  const value = String(record.value || record.address || record.exchange || record.text || record.content || '').trim();
  const priority = record.priority ?? record.preference ?? null;
  return {
    recordKey: `${type}:${name}:${value}:${priority ?? ''}`.toLowerCase(),
    type,
    name,
    value,
    priority: priority == null ? null : Number(priority),
    ttl: Number(record.ttl || 3600),
    proxied: Boolean(record.proxied),
    metadata: record,
  };
}

async function syncDomainDnsSnapshot(service, provider, providerResourceId) {
  const providerRecords = provider === 'cloudflare'
    ? await listCloudflareDnsRecords(providerResourceId)
    : (await listSpaceshipDnsRecords(service.name)).records || [];
  const records = providerRecords.map(domainDnsRecord);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const keys = records.map((record) => record.recordKey);
    await tx.domainDnsRecord.updateMany({
      where: {
        userId: service.createdByUserId,
        domainServiceId: service.id,
        provider,
        deletedAt: null,
        ...(keys.length ? { recordKey: { notIn: keys } } : {}),
      },
      data: { deletedAt: now, status: 'removed' },
    });
    for (const record of records) {
      await tx.domainDnsRecord.upsert({
        where: {
          userId_domainServiceId_provider_recordKey: {
            userId: service.createdByUserId,
            domainServiceId: service.id,
            provider,
            recordKey: record.recordKey,
          },
        },
        create: {
          userId: service.createdByUserId,
          organizationId: service.organizationId,
          domainServiceId: service.id,
          domain: service.name,
          provider,
          recordKey: record.recordKey,
          type: record.type,
          name: record.name,
          value: record.value,
          priority: record.priority,
          ttl: record.ttl,
          proxied: record.proxied,
          metadata: JSON.stringify(record.metadata),
          lastSyncedAt: now,
        },
        update: {
          type: record.type,
          name: record.name,
          value: record.value,
          priority: record.priority,
          ttl: record.ttl,
          proxied: record.proxied,
          status: 'active',
          metadata: JSON.stringify(record.metadata),
          lastSyncedAt: now,
          deletedAt: null,
        },
      });
    }
  });
  return records.length;
}

async function writeDomainServiceSnapshot(service, provider, feature, result) {
  const synced = result.status === 'fulfilled';
  const now = new Date().toISOString();
  const errorMessage = synced ? null : String(result.reason?.message || 'Provider feature unavailable.');
  await prisma.$executeRawUnsafe(
    `INSERT INTO "domain_service_snapshots"
      ("id", "user_id", "organization_id", "domain_service_id", "domain", "provider",
       "feature", "status", "payload", "error_message", "last_synced_at", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("domain_service_id", "provider", "feature") DO UPDATE SET
       "status" = excluded."status",
       "payload" = CASE WHEN excluded."status" = 'synced' THEN excluded."payload" ELSE "domain_service_snapshots"."payload" END,
       "error_message" = excluded."error_message",
       "last_synced_at" = excluded."last_synced_at",
       "updated_at" = excluded."updated_at"`,
    randomUUID(),
    service.createdByUserId,
    service.organizationId,
    service.id,
    service.name,
    provider,
    feature,
    synced ? 'synced' : 'unavailable',
    synced ? JSON.stringify(result.value ?? {}) : '{}',
    errorMessage,
    now,
    now,
    now,
  );
}

async function writeCloudflareAddonSnapshot(service, addonId, status, payload = {}, errorMessage = null) {
  return writeDomainServiceSnapshot(service, 'cloudflare', `addon:${addonId}`, status === 'unavailable'
    ? { status: 'rejected', reason: { message: errorMessage || 'Cloudflare add-on unavailable.' } }
    : { status: 'fulfilled', value: { addonId, status, ...payload } });
}

async function writeCloudflareAddonStage(service, addonId, addon, currentStage, completedStages, details = {}) {
  await prisma.domainAddonService.updateMany({
    where: { domainServiceId: service.id, addonKey: addonId },
    data: { provisioningStage: currentStage },
  });
  return writeCloudflareAddonSnapshot(service, addonId, 'provisioning', {
    label: addon.label,
    currentStage,
    completedStages,
    stages: CLOUDFLARE_ADDON_STAGES,
    updatedAt: new Date().toISOString(),
    ...details,
  });
}

async function activatePendingCloudflareAddons(service, zone) {
  if (String(zone?.status || '').toLowerCase() !== 'active') return [];
  const pending = await prisma.$queryRawUnsafe(
    `SELECT "feature", "payload"
     FROM "domain_service_snapshots"
     WHERE "domain_service_id" = ? AND "provider" = 'cloudflare'
       AND "feature" LIKE 'addon:%' AND "status" = 'synced'`,
    service.id,
  );
  const activated = [];
  for (const snapshot of pending) {
    const addonId = String(snapshot.feature).slice('addon:'.length);
    const state = parseJson(snapshot.payload, {});
    const addon = CLOUDFLARE_ADDONS[addonId];
    if (!addon || state.status === 'active') continue;
    const billing = await prisma.domainAddonService.findUnique({
      where: {
        domainServiceId_addonKey: {
          domainServiceId: service.id,
          addonKey: addonId,
        },
      },
      select: { totalAmountCents: true, billingStatus: true, paymentStatus: true },
    });
    const paymentRequired = Number(billing?.totalAmountCents || 0) > 0;
    if (paymentRequired && billing?.paymentStatus !== 'paid') continue;
    try {
      const result = await updateCloudflareBotManagement(zone.id, addon.configuration);
      await writeCloudflareAddonSnapshot(service, addonId, 'active', {
        label: addon.label,
        zoneId: zone.id,
        activatedAt: new Date().toISOString(),
        providerResult: result,
      });
      await prisma.businessService.updateMany({
        where: { id: `domain-addon:${service.id}:${addonId}`, deletedAt: null },
        data: { status: 'active' },
      });
      await prisma.domainAddonService.updateMany({
        where: { domainServiceId: service.id, addonKey: addonId },
        data: { status: 'active', provisioningStage: 'enable_addon', activatedAt: new Date() },
      });
      activated.push(addonId);
    } catch (error) {
      await writeCloudflareAddonSnapshot(service, addonId, 'unavailable', {}, error.message);
      await prisma.businessService.updateMany({
        where: { id: `domain-addon:${service.id}:${addonId}`, deletedAt: null },
        data: { status: 'provisioning_failed' },
      });
      await prisma.domainAddonService.updateMany({
        where: { domainServiceId: service.id, addonKey: addonId },
        data: { status: 'provisioning_failed', provisioningStage: 'enable_addon' },
      });
    }
  }
  return activated;
}

async function recordCloudflareAddonService(domainService, addonId, addon, zone, subscription) {
  const ratePlan = subscription?.rate_plan || {};
  const includedCost = Number(addon.includedProviderCostCents);
  const { providerAmountCents, markupAmountCents, amountCents } = Number.isFinite(includedCost)
    ? { providerAmountCents: includedCost, markupAmountCents: 0, amountCents: includedCost }
    : calculateCloudflareAddonPrice(subscription);
  const addonServiceId = `domain-addon:${domainService.id}:${addonId}`;
  const existingAddonBilling = await prisma.domainAddonService.findUnique({
    where: { id: addonServiceId },
    select: { billingStatus: true, paymentStatus: true },
  });
  const alreadyPaid = existingAddonBilling?.paymentStatus === 'paid';
  const currency = ratePlan.currency || subscription?.currency || 'USD';
  const metadata = JSON.stringify({
    parentDomainServiceId: domainService.id,
    domain: domainService.name,
    addonId,
    zoneId: zone.id,
    providerSubscriptionId: subscription?.id || null,
    providerRatePlanId: ratePlan.id || null,
    pricingSource: 'cloudflare_api',
    planAvailability: addon.planAvailability,
    pricingEvidence: Number.isFinite(includedCost) ? 'included_feature' : 'zone_subscription',
  });

  await prisma.$transaction(async (tx) => {
    await tx.domainAddonService.upsert({
      where: {
        domainServiceId_addonKey: {
          domainServiceId: domainService.id,
          addonKey: addonId,
        },
      },
      create: {
        id: addonServiceId,
        userId: domainService.createdByUserId || domainService.organizationId,
        organizationId: domainService.organizationId,
        domainServiceId: domainService.id,
        addonKey: addonId,
        name: addon.label,
        status: 'provisioning',
        provisioningStage: 'record_provider_pricing',
        internalProvider: 'cloudflare',
        providerZoneId: zone.id,
        providerSubscriptionId: subscription?.id || null,
        providerRatePlanId: ratePlan.id || null,
        providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        totalAmountCents: amountCents,
        currency,
        billingCycle: ratePlan.frequency || 'monthly',
        billingStatus: alreadyPaid ? 'paid' : amountCents > 0 ? 'unbilled' : 'free',
        paymentStatus: alreadyPaid ? 'paid' : amountCents > 0 ? 'pending' : 'paid',
        metadata,
      },
      update: {
        name: addon.label,
        status: 'provisioning',
        provisioningStage: 'record_provider_pricing',
        providerZoneId: zone.id,
        providerSubscriptionId: subscription?.id || null,
        providerRatePlanId: ratePlan.id || null,
        providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        totalAmountCents: amountCents,
        currency,
        billingCycle: ratePlan.frequency || 'monthly',
        billingStatus: alreadyPaid ? 'paid' : amountCents > 0 ? 'unbilled' : 'free',
        paymentStatus: alreadyPaid ? 'paid' : amountCents > 0 ? 'pending' : 'paid',
        metadata,
      },
    });
    await tx.businessService.upsert({
      where: { id: addonServiceId },
      create: {
        id: addonServiceId,
        organizationId: domainService.organizationId,
        createdByUserId: domainService.createdByUserId,
        type: 'domain_addon',
        provider: 'cloudflare',
        providerServiceId: `${zone.id}:${addonId}`,
        name: `${addon.label} · ${domainService.name}`,
        status: 'provisioning',
        billingCycle: ratePlan.frequency || 'monthly',
        billingAmountCents: providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        totalPriceCents: amountCents,
        currency,
        paymentStatus: 'pending',
        metadata,
      },
      update: {
        providerServiceId: `${zone.id}:${addonId}`,
        status: 'provisioning',
        billingCycle: ratePlan.frequency || 'monthly',
        billingAmountCents: providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        totalPriceCents: amountCents,
        currency,
        metadata,
        deletedAt: null,
      },
    });
    await tx.serviceAccess.upsert({
      where: { serviceType_serviceId: { serviceType: 'domain_addon', serviceId: addonServiceId } },
      create: {
        userId: domainService.createdByUserId,
        organizationId: domainService.organizationId,
        serviceType: 'domain_addon',
        serviceId: addonServiceId,
        serviceName: `${addon.label} · ${domainService.name}`,
        accessStatus: 'active',
        billingStatus: amountCents > 0 ? 'pending' : 'free',
        adminStatus: 'allowed',
        metadata,
      },
      update: {
        serviceName: `${addon.label} · ${domainService.name}`,
        accessStatus: 'active',
        billingStatus: amountCents > 0 ? 'pending' : 'free',
        adminStatus: 'allowed',
        metadata,
      },
    });
    await tx.billingLedger.upsert({
      where: {
        sourceTable_sourceId_billingType: {
          sourceTable: 'business_services',
          sourceId: addonServiceId,
          billingType: 'charge',
        },
      },
      create: {
        userId: domainService.createdByUserId,
        organizationId: domainService.organizationId,
        scope: 'item',
        serviceType: 'domain_addon',
        serviceId: addonServiceId,
        serviceName: `${addon.label} · ${domainService.name}`,
        billingType: 'charge',
        classification: 'recurring_charge',
        stage: 'rated',
        direction: 'debit',
        sourceTable: 'domain_addon_services',
        sourceId: addonServiceId,
        description: `${addon.label} for ${domainService.name}`,
        providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        unitCents: amountCents,
        amountCents,
        currency,
        status: amountCents > 0 ? 'pending' : 'paid',
        metadata,
      },
      update: {
        providerAmountCents,
        markupPercent: CLOUDFLARE_MARKUP_PERCENT,
        markupAmountCents,
        unitCents: amountCents,
        amountCents,
        currency,
        metadata,
      },
    });
  });
  return { addonServiceId, providerAmountCents, markupAmountCents, amountCents, currency, alreadyPaid };
}

export function calculateCloudflareAddonPrice(subscription = {}, markupPercent = CLOUDFLARE_MARKUP_PERCENT) {
  const ratePlan = subscription?.rate_plan || {};
  const providerAmountCents = Math.max(0, Math.round(Number(ratePlan.providerPrice ?? ratePlan.price ?? 0) * 100));
  const markupAmountCents = Math.round(providerAmountCents * markupPercent / 100);
  return {
    providerAmountCents,
    markupPercent,
    markupAmountCents,
    amountCents: providerAmountCents + markupAmountCents,
  };
}

async function syncCloudflareFeatureSnapshots(service, zoneId, zone, dnsRecordCount) {
  const features = [
    ['zone', Promise.resolve(zone)],
    ['dns_summary', Promise.resolve({ recordCount: dnsRecordCount })],
    ['zone_settings', getCloudflareZoneSettings(zoneId)],
    ['dnssec', getCloudflareDnssec(zoneId)],
    ['bot_management', getCloudflareBotManagement(zoneId)],
    ['health_checks', listCloudflareHealthChecks(zoneId)],
    ['available_plans', listCloudflareAvailablePlans(zoneId, CLOUDFLARE_MARKUP_PERCENT)],
    ['zone_subscription', getCloudflareZoneSubscription(zoneId, CLOUDFLARE_MARKUP_PERCENT)],
  ];
  const results = await Promise.allSettled(features.map(([, request]) => request));
  await Promise.all(features.map(([feature], index) =>
    writeDomainServiceSnapshot(service, 'cloudflare', feature, results[index])));
}

function snapshotDto(row) {
  const data = parseJson(row.payload, {});
  if (data.pricingSource === 'cloudflare_api') data.pricingSource = 'glondia_api';
  return {
    feature: row.feature,
    provider: 'glondia',
    status: row.status,
    data,
    error: row.error_message ? 'This Glondia service is temporarily unavailable.' : null,
    lastSyncedAt: row.last_synced_at || null,
  };
}

function domainDto(row) {
  const metadata = parseJson(row.metadata, {});
  return {
    id: row.id,
    name: row.name,
    hostname: row.name,
    domain: row.name,
    provider: 'glondia',
    providers: ['glondia'],
    status: row.status || 'active',
    lifecycleStatus: row.status || 'active',
    autoRenew: row.autoRenew,
    expiresAt: row.expiresAt,
    renewsAt: row.renewsAt,
    price: row.billingAmountCents != null ? row.billingAmountCents / 100 : null,
    currency: row.currency || 'USD',
    checkoutOrderId: row.checkoutOrderId || null,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function authoritativeDnsProvider(row) {
  const metadata = parseJson(row.metadata, {});
  return metadata.providers?.cloudflare?.zoneId ? 'cloudflare' : row.provider;
}

async function persistOwnedDomain({
  ownerId,
  organizationId = ownerId,
  name,
  provider,
  providerId,
  status = 'active',
  autoRenew,
  expiresAt,
  checkoutOrderId = null,
  paymentStatus = 'external',
  accessBillingStatus = 'free',
  billingAmountCents = 0,
  markupPercent = 0,
  markupAmountCents = 0,
  totalPriceCents = 0,
  currency = 'USD',
  providerMetadata = {},
  source = 'provider_sync',
}) {
  const normalizedName = cleanDomainName(name);
  const normalizedProviderId = String(providerId || normalizedName).trim();

  return prisma.$transaction(async (tx) => {
    const resourceKey = {
      provider,
      resourceType: 'domain',
      providerResourceId: normalizedProviderId,
    };
    const mapped = await tx.providerResource.findUnique({
      where: { provider_resourceType_providerResourceId: resourceKey },
    });
    if (mapped && (mapped.organizationId !== organizationId || (mapped.userId && mapped.userId !== ownerId))) {
      throw conflict('This provider domain is already assigned to another customer account.');
    }

    const existing = await tx.businessService.findFirst({
      where: { createdByUserId: ownerId, type: 'domain', name: normalizedName, deletedAt: null },
    });
    const existingMetadata = parseJson(existing?.metadata, {});
    const providers = {
      ...(existingMetadata.providers || {}),
      [provider]: providerMetadata,
    };
    const primaryProvider = existing?.provider === 'spaceship' || provider === 'spaceship'
      ? 'spaceship'
      : provider;
    const data = {
      organizationId,
      createdByUserId: ownerId,
      checkoutOrderId: checkoutOrderId || existing?.checkoutOrderId || null,
      type: 'domain',
      provider: primaryProvider,
      providerServiceId: primaryProvider === provider ? normalizedProviderId : existing?.providerServiceId,
      name: normalizedName,
      status: status || existing?.status || 'active',
      billingCycle: 'annual',
      billingAmountCents: Number(billingAmountCents || existing?.billingAmountCents || 0),
      markupPercent: Number(markupPercent || existing?.markupPercent || 0),
      markupAmountCents: Number(markupAmountCents || existing?.markupAmountCents || 0),
      totalPriceCents: Number(totalPriceCents || existing?.totalPriceCents || 0),
      currency: currency || existing?.currency || 'USD',
      paymentStatus: paymentStatus === 'paid' ? 'paid' : (existing?.paymentStatus || paymentStatus),
      autoRenew: autoRenew ?? existing?.autoRenew ?? false,
      expiresAt: expiresAt ?? existing?.expiresAt ?? null,
      deletedAt: null,
      metadata: JSON.stringify({
        ...existingMetadata,
        source,
        providers,
        lastProviderSyncAt: new Date().toISOString(),
      }),
    };
    const service = existing
      ? await tx.businessService.update({ where: { id: existing.id }, data })
      : await tx.businessService.create({ data });

    const existingAccess = await tx.serviceAccess.findUnique({
      where: { serviceType_serviceId: { serviceType: 'domain', serviceId: service.id } },
    });
    const billingStatus = accessBillingStatus === 'paid'
      ? 'paid'
      : (existingAccess?.billingStatus || accessBillingStatus);
    await tx.serviceAccess.upsert({
      where: { serviceType_serviceId: { serviceType: 'domain', serviceId: service.id } },
      create: {
        userId: ownerId,
        organizationId,
        serviceType: 'domain',
        serviceId: service.id,
        serviceName: normalizedName,
        accessStatus: 'active',
        billingStatus,
        adminStatus: 'allowed',
        checkoutOrderId,
        startsAt: new Date(),
        expiresAt: expiresAt || null,
        metadata: JSON.stringify({ source, provider, providerResourceId: normalizedProviderId }),
      },
      update: {
        userId: ownerId,
        organizationId,
        serviceName: normalizedName,
        accessStatus: 'active',
        billingStatus,
        adminStatus: 'allowed',
        ...(checkoutOrderId ? { checkoutOrderId } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      },
    });

    await tx.providerResource.upsert({
      where: { provider_resourceType_providerResourceId: resourceKey },
      create: {
        organizationId,
        userId: ownerId,
        serviceId: service.id,
        provider,
        resourceType: 'domain',
        providerResourceId: normalizedProviderId,
        name: normalizedName,
        status: 'active',
        metadata: JSON.stringify(providerMetadata),
      },
      update: {
        serviceId: service.id,
        name: normalizedName,
        status: 'active',
        deletedAt: null,
        metadata: JSON.stringify(providerMetadata),
      },
    });

    return service;
  });
}

export async function listCustomerDomains(user = {}) {
  const ownerId = accountId(user);
  const access = await prisma.serviceAccess.findMany({
    where: {
      userId: ownerId,
      serviceType: 'domain',
      accessStatus: 'active',
      billingStatus: { in: ACCESS_BILLING_OK },
      adminStatus: 'allowed',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { serviceId: true },
  });
  const serviceIds = access.map((row) => row.serviceId);
  if (!serviceIds.length) return { items: [], total: 0, source: 'customer-domain-ledger' };
  const rows = await prisma.businessService.findMany({
    where: {
      id: { in: serviceIds },
      createdByUserId: ownerId,
      type: 'domain',
      paymentStatus: { in: ['paid', 'external', 'free'] },
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  return { items: rows.map(domainDto), total: rows.length, source: 'customer-domain-ledger' };
}

export async function requireCustomerDomain(user = {}, idOrName) {
  const ownerId = accountId(user);
  const key = String(idOrName || '').trim();
  if (!key) throw Object.assign(new Error('Domain is required.'), { status: 400 });
  const row = await prisma.businessService.findFirst({
    where: {
      createdByUserId: ownerId,
      type: 'domain',
      paymentStatus: { in: ['paid', 'external', 'free'] },
      deletedAt: null,
      OR: [
        { id: key },
        { name: key.toLowerCase() },
        { providerServiceId: key.toLowerCase() },
      ],
    },
  });
  if (!row) throw notFound('Domain not found for this account.');
  const access = await checkServiceAccess(ownerId, 'domain', row.id, { adminBypass: false });
  if (!access.allowed) throw notFound('Domain not found for this account.');
  return row;
}

export async function getCustomerDomain(user = {}, idOrName) {
  return domainDto(await requireCustomerDomain(user, idOrName));
}

export async function listCustomerDomainDnsRecords(user = {}, idOrName) {
  const row = await requireCustomerDomain(user, idOrName);
  const provider = authoritativeDnsProvider(row);
  const records = await prisma.domainDnsRecord.findMany({
    where: { userId: accountId(user), domainServiceId: row.id, provider, deletedAt: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  return records.map((record) => ({
    id: record.id,
    type: record.type,
    name: record.name,
    host: record.name,
    value: record.value,
    priority: record.priority,
    ttl: record.ttl,
    proxied: record.proxied,
    provider: 'glondia',
    status: record.status,
    lastSyncedAt: record.lastSyncedAt,
  }));
}

export async function getCustomerDomainSettings(user = {}, idOrName) {
  const row = await requireCustomerDomain(user, idOrName);
  const ownerId = accountId(user);
  const dnsProvider = authoritativeDnsProvider(row);
  const [records, snapshots, ledger, addons] = await Promise.all([
    prisma.domainDnsRecord.findMany({
      where: { userId: ownerId, domainServiceId: row.id, provider: dnsProvider, deletedAt: null },
      select: { type: true, provider: true, proxied: true, lastSyncedAt: true },
    }),
    prisma.$queryRawUnsafe(
      `SELECT "feature", "provider", "status", "payload", "error_message", "last_synced_at"
       FROM "domain_service_snapshots"
       WHERE "user_id" = ? AND "domain_service_id" = ?
       ORDER BY "feature" ASC`,
      ownerId,
      row.id,
    ),
    prisma.billingLedger.findMany({
      where: { userId: ownerId, serviceType: 'domain', serviceId: row.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.domainAddonService.findMany({
      where: { userId: ownerId, domainServiceId: row.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const byType = records.reduce((summary, record) => {
    summary[record.type] = (summary[record.type] || 0) + 1;
    return summary;
  }, {});
  const cloudflareZone = snapshots.find((item) => item.provider === 'cloudflare' && item.feature === 'zone');
  const dnssec = snapshots.find((item) => item.provider === 'cloudflare' && item.feature === 'dnssec');
  const zoneData = parseJson(cloudflareZone?.payload, {});
  const dnssecData = parseJson(dnssec?.payload, {});
  const metadata = parseJson(row.metadata, {});
  const providerNameservers = metadata.providers?.cloudflare?.nameServers
    || metadata.providers?.spaceship?.nameservers
    || [];

  return {
    domain: domainDto(row),
    records: {
      provider: 'glondia',
      total: records.length,
      byType,
      proxied: records.filter((record) => record.proxied).length,
      lastSyncedAt: records.reduce((latest, record) => {
        const value = record.lastSyncedAt ? new Date(record.lastSyncedAt).getTime() : 0;
        return value > latest ? value : latest;
      }, 0) || null,
    },
    billing: {
      cycle: row.billingCycle,
      amountCents: row.totalPriceCents || row.billingAmountCents,
      currency: row.currency,
      paymentStatus: row.paymentStatus,
      checkoutOrderId: row.checkoutOrderId,
      renewsAt: row.renewsAt,
      expiresAt: row.expiresAt,
      autoRenew: row.autoRenew,
      ledger,
      addons: addons.map((item) => ({
        id: item.id,
        addonKey: item.addonKey,
        name: item.name,
        status: item.status,
        provisioningStage: item.provisioningStage,
        billingCycle: item.billingCycle,
        billingStatus: item.billingStatus,
        paymentStatus: item.paymentStatus,
        providerAmountCents: item.providerAmountCents,
        markupPercent: item.markupPercent,
        markupAmountCents: item.markupAmountCents,
        totalAmountCents: item.totalAmountCents,
        currency: item.currency,
        checkoutOrderId: item.checkoutOrderId,
        invoiceId: item.invoiceId,
        paymentTransactionId: item.paymentTransactionId,
        renewsAt: item.renewsAt,
        activatedAt: item.activatedAt,
      })),
      addonAmountCents: addons.reduce((total, item) => total + item.totalAmountCents, 0),
      combinedRecurringAmountCents: (row.totalPriceCents || row.billingAmountCents)
        + addons.reduce((total, item) => total + item.totalAmountCents, 0),
      addonMarkupPercent: CLOUDFLARE_MARKUP_PERCENT,
    },
    nameservers: providerNameservers,
    providerServices: snapshots.map(snapshotDto),
    checker: {
      zoneActive: String(zoneData.status || row.status).toLowerCase() === 'active',
      dnsPresent: records.length > 0,
      nameserversAssigned: providerNameservers.length >= 2,
      dnssecStatus: dnssecData.status || (dnssec?.status === 'unavailable' ? 'unavailable' : 'unknown'),
      cloudflareConnected: snapshots.some((item) => item.provider === 'cloudflare' && item.status === 'synced'),
      checkedAt: snapshots.reduce((latest, item) => {
        const value = item.last_synced_at ? new Date(item.last_synced_at).getTime() : 0;
        return value > latest ? value : latest;
      }, 0) || null,
    },
  };
}

export async function getCustomerDomainProviderAccess(user = {}) {
  const account = await requireProviderSyncAccount(user);
  const resources = await prisma.providerResource.groupBy({
    by: ['provider'],
    where: { organizationId: account.id, resourceType: 'domain', deletedAt: null },
    _count: { _all: true },
  });
  const mapped = Object.fromEntries(resources.map((row) => [row.provider, row._count._all]));
  return {
    clientId: account.clientId,
    services: {
      domains: { ...getSpaceshipSettings(), mappedDomains: mapped.spaceship || 0 },
      protection: { ...getCloudflareSettings(), mappedDomains: mapped.cloudflare || 0 },
    },
  };
}

export async function syncCustomerSpaceshipDomains(user = {}) {
  const account = await requireProviderSyncAccount(user);
  const resources = await prisma.providerResource.findMany({
    where: { organizationId: account.id, userId: account.id, provider: 'spaceship', resourceType: 'domain', deletedAt: null },
  });
  const imported = [];
  for (const resource of resources) {
    const item = await getSpaceshipDomain(resource.providerResourceId);
    const name = cleanDomainName(item.name || item.domain || resource.name || resource.providerResourceId);
    const row = await persistOwnedDomain({
      ownerId: account.id,
      name,
      provider: 'spaceship',
      providerId: resource.providerResourceId,
      status: item.lifecycleStatus || item.status || 'active',
      autoRenew: item.autoRenew,
      expiresAt: dateOrNull(item.expirationDate || item.expiresAt),
      providerMetadata: {
        domainId: name,
        lifecycleStatus: item.lifecycleStatus || null,
        verificationStatus: item.verificationStatus || null,
        registrationDate: item.registrationDate || null,
        expirationDate: item.expirationDate || null,
        nameservers: item.nameservers || null,
      },
    });
    await syncDomainDnsSnapshot(row, 'spaceship', resource.providerResourceId);
    imported.push(domainDto(row));
  }
  return { service: 'domains', imported: imported.length, total: resources.length, items: imported };
}

export async function syncCustomerCloudflareDomains(user = {}) {
  const account = await requireProviderSyncAccount(user);
  const resources = await prisma.providerResource.findMany({
    where: { organizationId: account.id, userId: account.id, provider: 'cloudflare', resourceType: 'domain', deletedAt: null },
  });
  const imported = [];
  for (const resource of resources) {
    const zone = await getCloudflareZone(resource.providerResourceId);
    const name = cleanDomainName(zone.name || resource.name);
    const row = await persistOwnedDomain({
      ownerId: account.id,
      name,
      provider: 'cloudflare',
      providerId: resource.providerResourceId,
      status: zone.status || 'active',
      providerMetadata: {
        zoneId: zone.id,
        accountId: zone.account?.id || null,
        accountName: zone.account?.name || null,
        status: zone.status || null,
        type: zone.type || null,
        nameServers: zone.name_servers || [],
        originalNameServers: zone.original_name_servers || [],
        originalRegistrar: zone.original_registrar || null,
        activatedOn: zone.activated_on || null,
        modifiedOn: zone.modified_on || null,
      },
    });
    await syncDomainDnsSnapshot(row, 'cloudflare', resource.providerResourceId);
    const dnsRecordCount = await prisma.domainDnsRecord.count({
      where: { domainServiceId: row.id, provider: 'cloudflare', deletedAt: null },
    });
    await syncCloudflareFeatureSnapshots(row, resource.providerResourceId, zone, dnsRecordCount);
    await activatePendingCloudflareAddons(row, zone);
    imported.push(domainDto(row));
  }
  return { service: 'protection', imported: imported.length, total: resources.length, items: imported };
}

async function processCustomerDomainAddon(user = {}, idOrName, requestedAddonId) {
  const service = await requireCustomerDomain(user, idOrName);
  const addonId = String(requestedAddonId || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const addon = CLOUDFLARE_ADDONS[addonId];
  if (!addon) {
    throw Object.assign(new Error('Unsupported Cloudflare domain add-on.'), {
      status: 400,
      expose: true,
      code: 'UNSUPPORTED_DOMAIN_ADDON',
    });
  }

  const metadata = parseJson(service.metadata, {});
  const completedStages = ['record_request'];
  await prisma.domainAddonService.updateMany({
    where: { domainServiceId: service.id, addonKey: addonId, status: 'queued' },
    data: { status: 'provisioning', provisioningStage: 'prepare_cloudflare_zone' },
  });
  await writeCloudflareAddonStage(service, addonId, addon, 'prepare_cloudflare_zone', completedStages, {
    requestedAt: new Date().toISOString(),
  });

  // Stage 2 — create or reuse the customer's full Cloudflare zone.
  let resource = await prisma.providerResource.findFirst({
    where: {
      organizationId: service.organizationId,
      userId: service.createdByUserId,
      provider: 'cloudflare',
      resourceType: 'domain',
      name: service.name,
      deletedAt: null,
    },
  });
  let zone;
  if (resource) {
    zone = await getCloudflareZone(resource.providerResourceId);
  } else {
    zone = await createCloudflareZone(service.name);
    resource = await prisma.providerResource.upsert({
      where: {
        provider_resourceType_providerResourceId: {
          provider: 'cloudflare',
          resourceType: 'domain',
          providerResourceId: zone.id,
        },
      },
      create: {
        organizationId: service.organizationId,
        userId: service.createdByUserId,
        serviceId: service.id,
        provider: 'cloudflare',
        resourceType: 'domain',
        providerResourceId: zone.id,
        name: service.name,
        status: zone.status || 'pending',
        metadata: JSON.stringify({ source: 'domain_addon_activation' }),
      },
      update: {
        serviceId: service.id,
        name: service.name,
        status: zone.status || 'pending',
        deletedAt: null,
      },
    });
  }
  const assignedNameservers = Array.isArray(zone.name_servers) ? zone.name_servers.filter(Boolean) : [];
  completedStages.push('prepare_cloudflare_zone');
  await writeCloudflareAddonStage(service, addonId, addon, 'record_provider_pricing', completedStages, {
    zoneId: zone.id,
    zoneStatus: zone.status || 'pending',
    assignedNameservers,
    evidenceRecordedAt: new Date().toISOString(),
  });

  // Stage 3 — capture the real Cloudflare rate and create item billing.
  const subscription = await getCloudflareZoneSubscription(zone.id, CLOUDFLARE_MARKUP_PERCENT);
  const billing = await recordCloudflareAddonService(service, addonId, addon, zone, subscription);
  completedStages.push('record_provider_pricing');
  if (billing.amountCents > 0 && !billing.alreadyPaid) {
    await prisma.domainAddonService.update({
      where: { id: billing.addonServiceId },
      data: {
        status: 'awaiting_payment',
        provisioningStage: 'payment_required',
        billingStatus: 'payment_required',
        paymentStatus: 'pending',
      },
    });
    await writeCloudflareAddonSnapshot(service, addonId, 'awaiting_payment', {
      label: addon.label,
      zoneId: zone.id,
      currentStage: 'payment_required',
      completedStages,
      stages: [...CLOUDFLARE_ADDON_STAGES.slice(0, 3), 'payment_required', ...CLOUDFLARE_ADDON_STAGES.slice(3)],
      billing,
    });
    return {
      domainId: service.id,
      domain: service.name,
      addonId,
      addon: addon.label,
      status: 'payment_required',
      billing,
    };
  }
  await writeCloudflareAddonStage(service, addonId, addon, 'delegate_nameservers', completedStages, {
    zoneId: zone.id,
    assignedNameservers,
    evidenceRecordedAt: new Date().toISOString(),
    billing,
  });

  // Stage 4 — delegate the registrar to the exact nameservers Cloudflare issued.
  const nameserverEvidence = await prisma.$queryRawUnsafe(
    `SELECT "payload" FROM "domain_service_snapshots"
     WHERE "domain_service_id" = ? AND "provider" = 'cloudflare' AND "feature" = ?
     LIMIT 1`,
    service.id,
    `addon:${addonId}`,
  );
  const storedEvidence = parseJson(nameserverEvidence?.[0]?.payload, {});
  const nameservers = Array.isArray(storedEvidence.assignedNameservers)
    ? storedEvidence.assignedNameservers.filter(Boolean)
    : [];
  if (nameservers.length < 2) {
    await writeCloudflareAddonSnapshot(service, addonId, 'unavailable', {}, 'Cloudflare did not assign nameservers to this zone.');
    throw Object.assign(new Error('Cloudflare did not assign nameservers to this zone.'), { status: 502, expose: true });
  }

  let registrarConfirmation = null;
  if (metadata.providers?.spaceship || service.provider === 'spaceship') {
    registrarConfirmation = await updateSpaceshipNameservers(
      service.name,
      { provider: 'custom', hosts: nameservers },
    );
  } else if (service.provider !== 'cloudflare') {
    await writeCloudflareAddonSnapshot(service, addonId, 'unavailable', {}, 'The registrar does not support automatic nameserver updates.');
    throw Object.assign(new Error('This registrar requires a manual nameserver update before Cloudflare add-ons can activate.'), {
      status: 409,
      expose: true,
      code: 'MANUAL_NAMESERVER_UPDATE_REQUIRED',
    });
  }
  completedStages.push('delegate_nameservers');
  await writeCloudflareAddonStage(service, addonId, addon, 'request_activation_check', completedStages, {
    zoneId: zone.id,
    nameservers,
    registrarConfirmation,
    delegationConfirmedAt: new Date().toISOString(),
    billing,
  });

  // Stage 5 — persist delegation and ask Cloudflare to check authoritative DNS.
  const row = await persistOwnedDomain({
    ownerId: service.createdByUserId,
    organizationId: service.organizationId,
    name: service.name,
    provider: 'cloudflare',
    providerId: zone.id,
    status: service.status,
    providerMetadata: {
      zoneId: zone.id,
      status: zone.status || 'pending',
      nameServers: nameservers,
      delegatedAt: new Date().toISOString(),
    },
    source: 'domain_addon_activation',
  });
  await requestCloudflareActivationCheck(zone.id);
  completedStages.push('request_activation_check');
  await writeCloudflareAddonSnapshot(row, addonId, zone.status === 'active' ? 'activating' : 'pending_activation', {
    label: addon.label,
    zoneId: zone.id,
    nameservers,
    delegatedAt: new Date().toISOString(),
    currentStage: 'enable_addon',
    completedStages,
    stages: CLOUDFLARE_ADDON_STAGES,
    billing,
  });

  // Stage 6 — enable only after Cloudflare confirms the zone is active.
  if (zone.status === 'active') await activatePendingCloudflareAddons(row, zone);
  else scheduleCloudflareActivationFollowUps(user);

  return {
    domainId: row.id,
    domain: row.name,
    addonId,
    addon: addon.label,
    status: zone.status === 'active' ? 'activating' : 'pending_activation',
    nameservers,
    zoneStatus: zone.status || 'pending',
    billing,
  };
}

export async function requestCustomerCloudflareAddon(user = {}, idOrName, requestedAddonId) {
  const service = await requireCustomerDomain(user, idOrName);
  const addonId = String(requestedAddonId || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const addon = CLOUDFLARE_ADDONS[addonId];
  if (!addon) {
    throw Object.assign(new Error('Unsupported Glondia domain add-on.'), {
      status: 400,
      expose: true,
      code: 'UNSUPPORTED_DOMAIN_ADDON',
    });
  }
  const queuedAt = new Date();
  await prisma.domainAddonService.upsert({
    where: { domainServiceId_addonKey: { domainServiceId: service.id, addonKey: addonId } },
    create: {
      id: `domain-addon:${service.id}:${addonId}`,
      userId: service.createdByUserId || service.organizationId,
      organizationId: service.organizationId,
      domainServiceId: service.id,
      addonKey: addonId,
      name: addon.label,
      status: 'queued',
      provisioningStage: 'record_request',
      internalProvider: 'cloudflare',
      billingStatus: 'pending_quote',
      paymentStatus: 'pending',
      metadata: JSON.stringify({ queuedAt: queuedAt.toISOString(), source: 'glondia_domain_addon_request' }),
    },
    update: {
      name: addon.label,
      status: 'queued',
      provisioningStage: 'record_request',
      billingStatus: 'pending_quote',
      metadata: JSON.stringify({ queuedAt: queuedAt.toISOString(), source: 'glondia_domain_addon_request' }),
    },
  });
  await writeCloudflareAddonSnapshot(service, addonId, 'queued', {
    label: addon.label,
    currentStage: 'record_request',
    completedStages: ['record_request'],
    stages: CLOUDFLARE_ADDON_STAGES,
    queuedAt: queuedAt.toISOString(),
  });
  setImmediate(() => {
    processCustomerDomainAddon(user, service.id, addonId).catch(async (error) => {
      console.error('[domain-addon-worker]', error.message);
      await prisma.domainAddonService.updateMany({
        where: { domainServiceId: service.id, addonKey: addonId },
        data: { status: 'provisioning_failed' },
      }).catch(() => {});
      await writeCloudflareAddonSnapshot(
        service,
        addonId,
        'provisioning_failed',
        {},
        'Glondia could not complete this protection request.',
      ).catch(() => {});
    });
  });
  return {
    domainId: service.id,
    domain: service.name,
    addonId,
    addon: addon.label,
    status: 'queued',
    currentStage: 'record_request',
  };
}

export async function resumePaidDomainAddon(domainServiceId, addonId) {
  const row = await prisma.domainAddonService.findUnique({
    where: {
      domainServiceId_addonKey: {
        domainServiceId,
        addonKey: addonId,
      },
    },
  });
  if (!row || row.paymentStatus !== 'paid' || row.totalAmountCents <= 0) return false;
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) return false;
  await prisma.domainAddonService.update({
    where: { id: row.id },
    data: { status: 'queued', provisioningStage: 'payment_confirmed', billingStatus: 'paid' },
  });
  setImmediate(() => {
    processCustomerDomainAddon(user, domainServiceId, addonId).catch((error) => {
      console.error('[domain-addon-paid-worker]', error.message);
    });
  });
  return true;
}

export async function recordRegisteredDomains({ user = {}, order = {}, domains = [], operations = [], contact = {} } = {}) {
  const ownerId = accountId(user);
  if (ownerId === 'local-user') throw Object.assign(new Error('A real customer account is required.'), { status: 401 });
  if (order.userId && order.userId !== ownerId) throw notFound('Checkout order not found.');
  const organizationId = order.organizationId || ownerId;
  const opByDomain = new Map((operations || []).map((op) => [String(op.domain || '').toLowerCase(), op]));
  const rows = [];

  for (const item of domains || []) {
    const name = cleanDomainName(item.name || item.domain || item.hostname);
    const op = opByDomain.get(name) || null;
    const metadata = {
      domainId: name,
      operationId: op?.operationId || null,
      operationStatus: op?.status || null,
      contact: { email: contact.email || null, country: contact.country || null },
      years: item.years || 1,
    };
    const row = await persistOwnedDomain({
      ownerId,
      organizationId,
      name,
      provider: 'spaceship',
      providerId: name,
      status: op?.status === 'failed' ? 'pending' : 'active',
      autoRenew: order.metadata?.autoRenew !== false,
      checkoutOrderId: order.id || order.checkoutOrderId || null,
      paymentStatus: 'paid',
      accessBillingStatus: 'paid',
      billingAmountCents: Math.round(Number(item.actualAmountCents || 0)),
      markupPercent: Number(order.markupPercent || 0),
      markupAmountCents: Math.round(Number(order.markupAmountCents || 0)),
      totalPriceCents: Math.round(Number(order.totalAmountCents || 0)),
      currency: order.currency || 'USD',
      providerMetadata: metadata,
      source: 'spaceship_reseller',
    });
    rows.push(domainDto(row));
  }
  return rows;
}

export async function assignExternalDomain({ clientId, provider, providerResourceId, name, status = 'active', metadata = {} } = {}) {
  const account = await prisma.user.findUnique({ where: { clientId }, select: { id: true, accountStatus: true } });
  if (!account || account.accountStatus !== 'active') throw notFound('Client account not found.');
  if (!['spaceship', 'cloudflare'].includes(provider)) throw Object.assign(new Error('Provider must be spaceship or cloudflare.'), { status: 400 });
  return domainDto(await persistOwnedDomain({
    ownerId: account.id,
    name,
    provider,
    providerId: providerResourceId,
    status,
    providerMetadata: metadata,
    source: 'admin_external_assignment',
  }));
}

async function performMappedCustomerDomainSync() {
  const resources = await prisma.providerResource.findMany({
    where: { resourceType: 'domain', deletedAt: null, userId: { not: null } },
    select: { userId: true, provider: true },
    distinct: ['userId', 'provider'],
  });
  const results = [];
  for (const resource of resources) {
    try {
      const user = await prisma.user.findUnique({ where: { id: resource.userId } });
      if (!user) continue;
      const result = resource.provider === 'cloudflare'
        ? await syncCustomerCloudflareDomains(user)
        : await syncCustomerSpaceshipDomains(user);
      results.push({ userId: resource.userId, provider: resource.provider, imported: result.imported });
    } catch (error) {
      results.push({ userId: resource.userId, provider: resource.provider, error: error.message });
    }
  }
  return results;
}

let mappedDomainSyncPromise = null;

export async function syncAllMappedCustomerDomains() {
  if (mappedDomainSyncPromise) return mappedDomainSyncPromise;
  mappedDomainSyncPromise = performMappedCustomerDomainSync();
  try {
    return await mappedDomainSyncPromise;
  } finally {
    mappedDomainSyncPromise = null;
  }
}

export function startDomainSyncScheduler() {
  if (String(process.env.DOMAIN_SYNC_ENABLED || 'true').toLowerCase() === 'false') return null;
  const intervalMs = Math.max(Number(process.env.DOMAIN_SYNC_INTERVAL_MS || 900000), 60000);
  const initial = setTimeout(() => {
    syncAllMappedCustomerDomains().catch((error) => console.error('[domain-sync]', error.message));
  }, 3000);
  initial.unref?.();
  const timer = setInterval(() => {
    syncAllMappedCustomerDomains().catch((error) => console.error('[domain-sync]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export default {
  listCustomerDomains,
  getCustomerDomain,
  listCustomerDomainDnsRecords,
  getCustomerDomainSettings,
  getCustomerDomainProviderAccess,
  syncCustomerSpaceshipDomains,
  syncCustomerCloudflareDomains,
  requestCustomerCloudflareAddon,
  recordRegisteredDomains,
  assignExternalDomain,
};
