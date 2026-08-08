/**
 * customer.repository.js
 *
 * Database gateway for admin customer-oversight identity reads: the customer
 * account (safe columns only — never passwordHash or raw file paths) and
 * their client projects. Part of the admin oversight flow:
 *
 *   admin route → controller → adminCustomerOversightService → this repo → db.js
 */

import { prisma } from '../services/db.js';

/**
 * Columns that are safe to hand to the oversight service.
 * passwordHash, avatarPath and idPhotoPath are intentionally absent — media is
 * streamed through authed admin routes, never as raw paths.
 */
const SAFE_USER_SELECT = {
  id: true,
  clientId: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  planId: true,
  accountStatus: true,
  profileDetails: true,
  disabledAt: true,
  disabledReason: true,
  deletedAt: true,
  reactivatedAt: true,
  createdAt: true,
  updatedAt: true,
};

export async function findCustomerById(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: SAFE_USER_SELECT,
  });
}

/** Presence flags for admin-served media (streamed via authed routes only). */
export async function getCustomerMediaFlags(userId) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarPath: true, idPhotoPath: true },
  });
  return { hasAvatar: Boolean(row?.avatarPath), hasIdPhoto: Boolean(row?.idPhotoPath) };
}

export async function listCustomerProjects(userId) {
  return prisma.clientProject.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Lightweight enrichment map for admin lists (id → identity). */
export async function findCustomerIdentities(userIds) {
  if (!userIds?.length) return [];
  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true, clientId: true },
  });
}

/** Business services (domains, email, …) reachable from a customer. */
export async function listBusinessServicesForCustomer(userId, organizationIds = []) {
  return prisma.businessService.findMany({
    where: {
      OR: [
        { createdByUserId: userId },
        ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findBusinessServicesByIds(ids) {
  if (!ids?.length) return [];
  return prisma.businessService.findMany({ where: { id: { in: ids } } });
}

/** Relational web-hosting rows (dual-read partner of the JSON hosting store). */
export async function listWebHostingForCustomer(userId, organizationIds = []) {
  return prisma.webHostingService.findMany({
    where: {
      OR: [
        { createdByUserId: userId },
        ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findClientProjectsByIds(ids) {
  if (!ids?.length) return [];
  return prisma.clientProject.findMany({ where: { id: { in: ids } } });
}

export async function listOrganizationIdsForCustomer(userId) {
  const [access, vps, hosting, business, orders, invoices, tickets, requests, providerResources] = await Promise.all([
    prisma.serviceAccess.findMany({ where: { userId, organizationId: { not: null } }, select: { organizationId: true } }),
    prisma.vpsService.findMany({ where: { createdByUserId: userId }, select: { organizationId: true } }),
    prisma.webHostingService.findMany({ where: { createdByUserId: userId }, select: { organizationId: true } }),
    prisma.businessService.findMany({ where: { createdByUserId: userId }, select: { organizationId: true } }),
    prisma.checkoutOrder.findMany({ where: { userId }, select: { organizationId: true } }),
    prisma.invoice.findMany({ where: { userId }, select: { organizationId: true } }),
    prisma.ticket.findMany({ where: { userId, organizationId: { not: null } }, select: { organizationId: true } }),
    prisma.serviceRequest.findMany({ where: { userId, organizationId: { not: null } }, select: { organizationId: true } }),
    prisma.providerResource.findMany({ where: { userId }, select: { organizationId: true } }),
  ]);
  return [...new Set([
    ...access,
    ...vps,
    ...hosting,
    ...business,
    ...orders,
    ...invoices,
    ...tickets,
    ...requests,
    ...providerResources,
  ].map((row) => row.organizationId).filter(Boolean))];
}

/** CRM service requests filed by (or matched to) this customer. */
export async function listServiceRequestsByUser(userId, email = null, { limit = 100 } = {}) {
  return prisma.serviceRequest.findMany({
    where: {
      OR: [
        { userId },
        ...(email ? [{ contactEmail: email }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}

export async function listAnalyticsForCustomer(userId, organizationIds = [], { limit = 100 } = {}) {
  return prisma.analyticsEvent.findMany({
    where: { OR: [{ userId }, ...(organizationIds.length ? [{ organizationId: { in: organizationIds } }] : [])] },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}

export async function listAdminNotesForCustomer(userId, { limit = 100 } = {}) {
  return prisma.adminNote.findMany({
    where: { targetUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });
}
