/**
 * providerResource.repository.js
 *
 * Database gateway for the ProviderResource ownership map (SSH keys,
 * snapshots, backups…). The shared Vultr account holds resources for every
 * customer, so services must resolve ownership through this repository before
 * listing, deleting or restoring any provider-account-level resource.
 *
 * Repository layer rules: this file owns the Prisma access for the model —
 * services call these functions and never query provider_resources directly.
 */

import { prisma } from '../services/db.js';

/**
 * Record a provider resource as owned by an organization.
 * Upsert keyed on (provider, resourceType, providerResourceId) so re-recording
 * an existing resource (e.g. after a retried create) never duplicates rows.
 */
export async function recordResource({
  organizationId,
  userId = null,
  serviceId = null,
  provider = 'vultr',
  resourceType,
  providerResourceId,
  name = null,
  status = 'active',
  metadata = {},
}) {
  return prisma.providerResource.upsert({
    where: {
      provider_resourceType_providerResourceId: {
        provider, resourceType, providerResourceId,
      },
    },
    update: {
      organizationId,
      userId,
      serviceId,
      name,
      status,
      deletedAt: null,
      metadata: JSON.stringify(metadata ?? {}),
    },
    create: {
      organizationId,
      userId,
      serviceId,
      provider,
      resourceType,
      providerResourceId,
      name,
      status,
      metadata: JSON.stringify(metadata ?? {}),
    },
  });
}

/** Admin oversight: every resource (any type, incl. deleted) for a set of owners. */
export async function listByOwners({ organizationIds = [], userId = null } = {}) {
  const or = [];
  if (organizationIds.length) or.push({ organizationId: { in: organizationIds } });
  if (userId) or.push({ userId });
  if (!or.length) return [];
  return prisma.providerResource.findMany({
    where: { OR: or },
    orderBy: { createdAt: 'desc' },
  });
}

/** All live (not deleted) resources of one type owned by an organization. */
export async function listOwnedResources(organizationId, resourceType, provider = 'vultr') {
  return prisma.providerResource.findMany({
    where: { organizationId, resourceType, provider, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listOwnedServiceResources(organizationId, serviceId, resourceType, provider = 'vultr') {
  return prisma.providerResource.findMany({
    where: { organizationId, serviceId, resourceType, provider, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Look up the ownership row for a provider resource id (regardless of owner). */
export async function findByProviderResourceId(resourceType, providerResourceId, provider = 'vultr') {
  return prisma.providerResource.findUnique({
    where: {
      provider_resourceType_providerResourceId: {
        provider, resourceType, providerResourceId,
      },
    },
  });
}

/**
 * Assert that `organizationId` owns the given provider resource.
 * Throws 404 when unmapped (never confirm the resource exists for others) and
 * 403 only for soft-deleted rows still traceable to another org.
 */
export async function requireOwnedResource(organizationId, resourceType, providerResourceId, provider = 'vultr') {
  const row = await findByProviderResourceId(resourceType, providerResourceId, provider);
  if (!row || row.deletedAt || row.organizationId !== organizationId) {
    throw Object.assign(
      new Error(`${resourceType === 'ssh_key' ? 'SSH key' : 'Resource'} not found.`),
      { status: 404, code: 'VPS_RESOURCE_OWNERSHIP_MISMATCH' },
    );
  }
  return row;
}

/** Soft-delete an ownership row after the provider resource is removed. */
export async function markResourceDeleted(id) {
  return prisma.providerResource.update({
    where: { id },
    data: { status: 'deleted', deletedAt: new Date() },
  });
}
