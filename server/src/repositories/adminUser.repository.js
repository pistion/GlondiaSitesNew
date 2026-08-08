import { prisma } from '../services/db.js';

export function listOverviewUsers() {
  return prisma.user.findMany({
    select: { accountStatus: true },
  });
}

export function listUsers() {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
}

export function findUserById(userId) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export function updateUser(userId, data) {
  return prisma.user.update({ where: { id: userId }, data });
}

export function revokeRefreshTokens(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function suspendUser(userId, reason) {
  return updateUser(userId, {
    accountStatus: 'suspended',
    disabledAt: new Date(),
    disabledReason: reason ? String(reason).slice(0, 1000) : 'admin_suspended',
  });
}

export function disableUser(userId, reason) {
  return updateUser(userId, {
    accountStatus: 'disabled',
    disabledAt: new Date(),
    disabledReason: reason ? String(reason).slice(0, 1000) : 'admin_disabled',
  });
}

export function reactivateUser(userId) {
  return updateUser(userId, {
    accountStatus: 'active',
    reactivatedAt: new Date(),
    disabledReason: null,
    disabledAt: null,
    deletedAt: null,
  });
}

export function softDeleteUser(userId, reason) {
  return updateUser(userId, {
    accountStatus: 'deleted',
    disabledAt: new Date(),
    deletedAt: new Date(),
    disabledReason: reason ? String(reason).slice(0, 1000) : 'account_deleted',
  });
}

export function setUserIdPhotoPath(userId, filePath) {
  return updateUser(userId, { idPhotoPath: filePath });
}

export function deleteUser(userId) {
  return prisma.user.delete({ where: { id: userId } });
}

export async function purgeUserOwnedRows(userId) {
  const cleaned = {};
  async function tryDelete(label, fn) {
    try {
      const result = await fn();
      cleaned[label] = result?.count ?? result ?? true;
    } catch (err) {
      cleaned[label] = `skip: ${err.message}`;
    }
  }

  await tryDelete('refreshToken', () => prisma.refreshToken.deleteMany({ where: { userId } }));
  await tryDelete('notification', () => prisma.notification.deleteMany({ where: { userId } }));
  await tryDelete('notificationPreference', () => prisma.notificationPreference.deleteMany({ where: { userId } }));
  await tryDelete('adminMfaMethod', () => prisma.adminMfaMethod.deleteMany({ where: { userId } }));
  await tryDelete('ticket', () => prisma.ticket.deleteMany({ where: { userId } }));
  await tryDelete('serviceRequest', () => prisma.serviceRequest.deleteMany({ where: { userId } }));
  await tryDelete('serviceAccess', () => prisma.serviceAccess.deleteMany({ where: { userId } }));
  await tryDelete('watchdogEvent', () => prisma.watchdogEvent.deleteMany({ where: { userId } }));
  await tryDelete('analyticsEvent', () => prisma.analyticsEvent.deleteMany({ where: { userId } }));
  await tryDelete('chatbotInteraction', () => prisma.chatbotInteraction.deleteMany({ where: { userId } }));
  await tryDelete('crmAiSession', () => prisma.crmAiSession.deleteMany({ where: { userId } }));
  await tryDelete('crmEmailListMember', () => prisma.crmEmailListMember.deleteMany({ where: { userId } }));
  await tryDelete('customerLifecycle', () => prisma.customerLifecycle.deleteMany({ where: { userId } }));

  await tryDelete('paymentMethod', () => prisma.paymentMethod.deleteMany({ where: { userId } }));
  await tryDelete('discountRedemption', () => prisma.discountRedemption.deleteMany({ where: { userId } }));
  await tryDelete('invoice', () => prisma.invoice.deleteMany({ where: { userId } }));
  await tryDelete('creditNote', () => prisma.creditNote.deleteMany({ where: { userId } }));
  await tryDelete('paymentReceipt', () => prisma.paymentReceipt.deleteMany({ where: { userId } }));
  await tryDelete('deploymentSubscription', () => prisma.deploymentSubscription.deleteMany({ where: { userId } }));
  await tryDelete('deploymentCleanupJob', () => prisma.deploymentCleanupJob.deleteMany({ where: { userId } }));
  await tryDelete('checkoutOrder', () => prisma.checkoutOrder.deleteMany({ where: { userId } }));

  await tryDelete('vpsService', () => prisma.vpsService.deleteMany({ where: { createdByUserId: userId } }));
  await tryDelete('webHostingService', () => prisma.webHostingService.deleteMany({ where: { createdByUserId: userId } }));
  await tryDelete('businessService', () => prisma.businessService.deleteMany({ where: { createdByUserId: userId } }));

  await tryDelete('adminNote', () => prisma.adminNote.deleteMany({ where: { targetUserId: userId } }));
  await tryDelete('adminCommand', () => prisma.adminCommand.deleteMany({ where: { targetUserId: userId } }));

  return cleaned;
}
