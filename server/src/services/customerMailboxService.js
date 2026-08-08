import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { hashPassword } from './authService.js';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function conflict(message) {
  return Object.assign(new Error(message), {
    status: 409,
    expose: true,
    code: 'PROVIDER_RESOURCE_ALREADY_ASSIGNED',
  });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw Object.assign(new Error('A valid mailbox email address is required.'), {
      status: 400,
      expose: true,
      code: 'INVALID_MAILBOX_EMAIL',
    });
  }
  return { email, localPart: parts[0], domain: parts[1] };
}

function mailboxAccessStatus(status) {
  if (status === 'active') return 'active';
  if (status === 'suspended') return 'suspended';
  return 'pending';
}

export async function persistOwnedMailbox({
  ownerId,
  organizationId = ownerId,
  email: rawEmail,
  provider,
  providerId,
  planServiceId,
  status = 'active',
  paymentStatus = 'external',
  accessBillingStatus = 'free',
  storageLimitBytes = '5368709120',
  storageUsedBytes = '0',
  providerMetadata = {},
  source = 'provider_import',
}) {
  const { email, localPart, domain } = normalizeEmail(rawEmail);
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedProviderId = String(providerId || email).trim();
  if (!ownerId || !normalizedProvider || !normalizedProviderId || !planServiceId) {
    throw new Error('ownerId, provider, providerId, and planServiceId are required.');
  }

  const unusablePasswordHash = await hashPassword(randomUUID());
  return prisma.$transaction(async (tx) => {
    const resourceKey = {
      provider: normalizedProvider,
      resourceType: 'mailbox',
      providerResourceId: normalizedProviderId,
    };
    const mapped = await tx.providerResource.findUnique({
      where: { provider_resourceType_providerResourceId: resourceKey },
    });
    if (mapped && (mapped.organizationId !== organizationId || (mapped.userId && mapped.userId !== ownerId))) {
      throw conflict('This provider mailbox is already assigned to another customer account.');
    }

    const existingMailbox = await tx.emailMailbox.findUnique({ where: { email } });
    if (existingMailbox && existingMailbox.userId !== ownerId) {
      throw conflict('This mailbox is already assigned to another customer account.');
    }
    const existingService = existingMailbox
      ? await tx.businessService.findUnique({ where: { id: existingMailbox.businessServiceId } })
      : await tx.businessService.findFirst({
        where: { createdByUserId: ownerId, type: 'email', name: email, deletedAt: null },
      });
    const existingMetadata = parseJson(existingService?.metadata, {});
    const serviceData = {
      organizationId,
      createdByUserId: ownerId,
      type: 'email',
      provider: normalizedProvider,
      providerServiceId: normalizedProviderId,
      name: email,
      status,
      billingCycle: 'monthly',
      paymentStatus,
      metadata: JSON.stringify({
        ...existingMetadata,
        source,
        email,
        domain,
        localPart,
        providerResourceId: normalizedProviderId,
        provider: normalizedProvider,
        providerMetadata,
        lastProviderSyncAt: new Date().toISOString(),
      }),
      deletedAt: null,
    };
    const service = existingService
      ? await tx.businessService.update({ where: { id: existingService.id }, data: serviceData })
      : await tx.businessService.create({ data: serviceData });

    const mailbox = existingMailbox
      ? await tx.emailMailbox.update({
        where: { id: existingMailbox.id },
        data: {
          userId: ownerId,
          planServiceId,
          businessServiceId: service.id,
          status,
          storageLimitBytes: String(storageLimitBytes),
          storageUsedBytes: String(storageUsedBytes),
          usageSource: 'provider_api',
          lastUsageSyncAt: new Date(),
        },
      })
      : await tx.emailMailbox.create({
        data: {
          userId: ownerId,
          planServiceId,
          businessServiceId: service.id,
          email,
          localPart,
          domain,
          passwordHash: unusablePasswordHash,
          status,
          storageLimitBytes: String(storageLimitBytes),
          storageUsedBytes: String(storageUsedBytes),
          usageSource: 'provider_api',
          lastUsageSyncAt: new Date(),
        },
      });

    if (normalizedProvider === 'spacemail') {
      await tx.emailTransportSetting.upsert({
        where: { emailMailboxId: mailbox.id },
        create: {
          userId: ownerId,
          organizationId,
          emailMailboxId: mailbox.id,
          provider: normalizedProvider,
          username: email,
          imapHost: 'mail.spacemail.com',
          imapPort: 993,
          imapSecurity: 'SSL/TLS',
          smtpHost: 'mail.spacemail.com',
          smtpPort: 465,
          smtpSecurity: 'SSL/TLS',
          authenticationRequired: true,
          source: 'provider_catalog',
          lastSyncedAt: new Date(),
        },
        update: {
          userId: ownerId,
          organizationId,
          provider: normalizedProvider,
          username: email,
          imapHost: 'mail.spacemail.com',
          imapPort: 993,
          imapSecurity: 'SSL/TLS',
          smtpHost: 'mail.spacemail.com',
          smtpPort: 465,
          smtpSecurity: 'SSL/TLS',
          authenticationRequired: true,
          source: 'provider_catalog',
          lastSyncedAt: new Date(),
        },
      });
    }

    await tx.serviceAccess.upsert({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId: service.id } },
      create: {
        userId: ownerId,
        organizationId,
        serviceType: 'email',
        serviceId: service.id,
        serviceName: email,
        accessStatus: mailboxAccessStatus(status),
        billingStatus: accessBillingStatus,
        adminStatus: 'allowed',
        planId: planServiceId,
        startsAt: new Date(),
        metadata: JSON.stringify({ kind: 'mailbox', source, email, domain, provider: normalizedProvider }),
      },
      update: {
        userId: ownerId,
        organizationId,
        serviceName: email,
        accessStatus: mailboxAccessStatus(status),
        billingStatus: accessBillingStatus,
        adminStatus: 'allowed',
        planId: planServiceId,
      },
    });

    await tx.providerResource.upsert({
      where: { provider_resourceType_providerResourceId: resourceKey },
      create: {
        organizationId,
        userId: ownerId,
        serviceId: service.id,
        provider: normalizedProvider,
        resourceType: 'mailbox',
        providerResourceId: normalizedProviderId,
        name: email,
        status,
        metadata: JSON.stringify(providerMetadata),
      },
      update: {
        serviceId: service.id,
        name: email,
        status,
        deletedAt: null,
        metadata: JSON.stringify(providerMetadata),
      },
    });

    return mailbox;
  });
}

export async function assignExternalMailbox({
  clientId,
  provider,
  email,
  providerResourceId,
  metadata = {},
  storageLimitBytes,
  storageUsedBytes,
  status = 'active',
  paymentStatus = 'external',
  accessBillingStatus = 'free',
}) {
  const user = await prisma.user.findUnique({
    where: { clientId },
    select: { id: true, accountStatus: true },
  });
  if (!user || user.accountStatus !== 'active') {
    throw Object.assign(new Error('Active client account not found.'), { status: 404, expose: true });
  }
  const planServiceId = `email-plan:${user.id}`;
  const planAccess = await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId: planServiceId } },
  });
  if (!planAccess || planAccess.userId !== user.id) {
    throw conflict('The client must have an email plan before a provider mailbox can be assigned.');
  }
  return persistOwnedMailbox({
    ownerId: user.id,
    email,
    provider,
    providerId: providerResourceId,
    planServiceId,
    providerMetadata: metadata,
    storageLimitBytes,
    storageUsedBytes,
    status,
    paymentStatus,
    accessBillingStatus,
  });
}
