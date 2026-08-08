/**
 * Business Email plan persistence integration tests.
 *
 * Verifies that a selected plan is represented consistently in the billing,
 * business-service, and service-access ledgers without requiring a new schema.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_ID = 'email-plan-user';
const MAILBOX_USER_ID = 'email-mailbox-user';
const LIMIT_USER_ID = 'email-limit-user';

let tempDir;
let emailService;
let prisma;
let disconnect;
let glondiaMailService;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-email-plan-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  process.env.DATA_DIR = join(tempDir, 'data');
  process.env.GLONDIA_MAIL_IMAP_HOST = '';
  process.env.GLONDIA_MAIL_SMTP_HOST = '';

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'ignore',
  });

  emailService = await import('../src/services/email.service.js');
  glondiaMailService = await import('../src/services/glondia-mail.service.js');
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
  await prisma.user.createMany({
    data: [
      { id: USER_ID, email: 'email-plan@test.local', passwordHash: 'unused' },
      { id: MAILBOX_USER_ID, email: 'email-mailbox@test.local', passwordHash: 'unused' },
      { id: LIMIT_USER_ID, email: 'email-limit@test.local', passwordHash: 'unused' },
    ],
  });
  await prisma.businessService.create({
    data: {
      id: 'email-test-domain', organizationId: MAILBOX_USER_ID, createdByUserId: MAILBOX_USER_ID,
      type: 'domain', provider: 'spaceship', providerServiceId: 'example.com', name: 'example.com',
      status: 'active', paymentStatus: 'paid', metadata: '{}',
    },
  });
  await prisma.businessService.create({
    data: {
      id: 'email-limit-domain', organizationId: LIMIT_USER_ID, createdByUserId: LIMIT_USER_ID,
      type: 'domain', provider: 'spaceship', providerServiceId: 'limit.example.com', name: 'limit.example.com',
      status: 'active', paymentStatus: 'paid', metadata: '{}',
    },
  });
  await prisma.serviceAccess.createMany({
    data: [
      {
        userId: MAILBOX_USER_ID, organizationId: MAILBOX_USER_ID, serviceType: 'domain', serviceId: 'email-test-domain',
        serviceName: 'example.com', accessStatus: 'active', billingStatus: 'paid', adminStatus: 'allowed',
      },
      {
        userId: LIMIT_USER_ID, organizationId: LIMIT_USER_ID, serviceType: 'domain', serviceId: 'email-limit-domain',
        serviceName: 'limit.example.com', accessStatus: 'active', billingStatus: 'paid', adminStatus: 'allowed',
      },
    ],
  });
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('catalog exposes 5, 15, and 25 mailbox plans at one dollar per mailbox', async () => {
  const catalog = await emailService.listEmailPlans(USER_ID);
  assert.deepEqual(catalog.plans.map((plan) => plan.mailboxLimit), [5, 15, 25]);
  for (const plan of catalog.plans) {
    assert.equal(plan.unitPriceCents, 100);
    assert.equal(plan.monthlyPriceCents, plan.mailboxLimit * 100);
    assert.equal(plan.currency, 'USD');
    assert.equal(plan.billingCycle, 'monthly');
  }
  assert.equal(catalog.selectedPlan, null);
});

test('selection persists matching billing, service, and access records', async () => {
  const result = await emailService.selectEmailPlan(USER_ID, 'email-15');
  assert.equal(result.selectedPlan.id, 'email-15');
  assert.equal(result.selectedPlan.mailboxLimit, 15);

  const [order, service, access] = await Promise.all([
    prisma.checkoutOrder.findUnique({ where: { id: `email-plan-order:${USER_ID}` } }),
    prisma.businessService.findUnique({ where: { id: `email-plan:${USER_ID}` } }),
    prisma.serviceAccess.findUnique({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId: `email-plan:${USER_ID}` } },
    }),
  ]);

  assert.equal(order.type, 'email_plan');
  assert.equal(order.totalAmountCents, 1500);
  assert.equal(order.currency, 'USD');
  assert.equal(service.type, 'email_plan');
  assert.equal(service.checkoutOrderId, order.id);
  assert.equal(service.totalPriceCents, 1500);
  assert.equal(access.planId, 'email-15');
  assert.equal(access.checkoutOrderId, order.id);
  assert.equal(JSON.parse(access.metadata).mailboxLimit, 15);
});

test('same-plan selection is idempotent and an upgrade updates all ledgers', async () => {
  await prisma.checkoutOrder.update({
    where: { id: `email-plan-order:${USER_ID}` },
    data: { status: 'paid' },
  });
  await prisma.serviceAccess.update({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId: `email-plan:${USER_ID}` } },
    data: { billingStatus: 'paid', accessStatus: 'active' },
  });

  await emailService.selectEmailPlan(USER_ID, 'email-15');
  const unchanged = await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId: `email-plan:${USER_ID}` } },
  });
  assert.equal(unchanged.billingStatus, 'paid');
  assert.equal(unchanged.accessStatus, 'active');

  await emailService.selectEmailPlan(USER_ID, 'email-25');
  const [order, service, access] = await Promise.all([
    prisma.checkoutOrder.findUnique({ where: { id: `email-plan-order:${USER_ID}` } }),
    prisma.businessService.findUnique({ where: { id: `email-plan:${USER_ID}` } }),
    prisma.serviceAccess.findUnique({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId: `email-plan:${USER_ID}` } },
    }),
  ]);
  assert.equal(order.totalAmountCents, 2500);
  assert.equal(service.totalPriceCents, 2500);
  assert.equal(access.planId, 'email-25');
  assert.equal(access.billingStatus, 'pending');
});

test('mailbox setup is rejected until a plan is selected', async () => {
  await assert.rejects(
    () => emailService.createMailboxRequest('email-no-plan', {
      domain: 'example.com',
      mailboxName: 'info',
      password: 'SecurePass123!',
    }),
    (err) => err.status === 409 && err.code === 'EMAIL_PLAN_REQUIRED',
  );
});

test('mailbox creation stores only a password hash linked to the customer and plan', async () => {
  await emailService.selectEmailPlan(MAILBOX_USER_ID, 'email-5');
  const result = await emailService.createMailboxRequest(MAILBOX_USER_ID, {
    domain: 'example.com',
    mailboxName: 'sales',
    password: 'SecurePass123!',
  });

  assert.equal(result.email, 'sales@example.com');
  assert.equal(result.capacity.used, 1);
  assert.equal(result.capacity.allowed, 5);
  assert.equal(result.capacity.remaining, 4);
  assert.equal('password' in result, false);
  assert.equal('passwordHash' in result, false);

  const mailbox = await prisma.emailMailbox.findUnique({ where: { email: result.email } });
  assert.equal(mailbox.userId, MAILBOX_USER_ID);
  assert.equal(mailbox.planServiceId, `email-plan:${MAILBOX_USER_ID}`);
  assert.equal(mailbox.storageLimitBytes, '5368709120');
  assert.equal(mailbox.storageUsedBytes, '0');
  assert.equal(mailbox.usageSource, 'pending_provider');
  assert.notEqual(mailbox.passwordHash, 'SecurePass123!');
  assert.match(mailbox.passwordHash, /^\$2[aby]\$/);

  const linkedService = await prisma.businessService.findUnique({ where: { id: mailbox.businessServiceId } });
  assert.equal(linkedService.createdByUserId, MAILBOX_USER_ID);
  assert.equal(JSON.parse(linkedService.metadata).planId, 'email-5');
  assert.equal(linkedService.metadata.includes('SecurePass123!'), false);
});

test('stored mailbox password is verified server-side and rejects a wrong password', async () => {
  await assert.rejects(
    () => glondiaMailService.login({ email: 'sales@example.com', password: 'WrongPass123!' }),
    (err) => err.status === 401 && err.code === 'INVALID_MAILBOX_CREDENTIALS',
  );
  const session = await glondiaMailService.login({ email: 'sales@example.com', password: 'SecurePass123!' });
  assert.equal(session.mailbox, 'sales@example.com');
  assert.ok(session.token);
});

test('mail reader DTO, flags, and folder moves remain mailbox-scoped', async () => {
  const mailbox = await prisma.emailMailbox.findUnique({ where: { email: 'sales@example.com' } });
  const [inbox, archive] = await Promise.all([
    prisma.mailFolder.create({ data: { userId: MAILBOX_USER_ID, organizationId: MAILBOX_USER_ID, emailMailboxId: mailbox.id, providerFolderId: 'INBOX', name: 'Inbox', role: 'inbox' } }),
    prisma.mailFolder.create({ data: { userId: MAILBOX_USER_ID, organizationId: MAILBOX_USER_ID, emailMailboxId: mailbox.id, providerFolderId: 'Archive', name: 'Archive', role: 'archive' } }),
  ]);
  const row = await prisma.mailMessage.create({ data: {
    userId: MAILBOX_USER_ID, organizationId: MAILBOX_USER_ID, emailMailboxId: mailbox.id, folderId: inbox.id,
    providerMessageId: 'reader-test-1', subject: 'Reader contract', fromJson: JSON.stringify([{ name: 'Sender', address: 'sender@example.net' }]),
    toJson: JSON.stringify([{ name: 'Sales', address: 'sales@example.com' }]), ccJson: JSON.stringify([{ name: 'Team', address: 'team@example.com' }]),
    replyToJson: JSON.stringify([{ name: 'Replies', address: 'reply@example.net' }]), textBody: 'Plain body', htmlBody: '<p>Formatted body</p>', flagsJson: '[]', sizeBytes: 42,
  } });
  const login = await glondiaMailService.login({ email: 'sales@example.com', password: 'SecurePass123!' });
  const req = { headers: { cookie: `glondia_mail_session=${encodeURIComponent(login.token)}` } };
  const detail = await glondiaMailService.getMessage(req, row.id);
  assert.equal(detail.textBody, 'Plain body');
  assert.equal(detail.htmlBody, '<p>Formatted body</p>');
  assert.equal(detail.addresses.cc[0].address, 'team@example.com');
  assert.equal(detail.unread, true);
  const seen = await glondiaMailService.updateMessage(req, row.id, { seen: true, flagged: true });
  assert.equal(seen.unread, false);
  assert.equal(seen.flagged, true);
  const moved = await glondiaMailService.moveMessage(req, row.id, { folderRole: 'archive' });
  assert.equal(moved.folderRole, 'archive');
  assert.equal(moved.folderId, archive.id);
});

test('mailbox detail, usage, and password changes are customer-owned', async () => {
  const mailbox = await prisma.emailMailbox.findUnique({ where: { email: 'sales@example.com' } });

  const detail = await emailService.getMailbox(MAILBOX_USER_ID, mailbox.id);
  assert.equal(detail.email, 'sales@example.com');
  assert.equal(detail.storageLimitBytes, '5368709120');
  assert.equal(detail.storageUsedBytes, null);
  assert.equal(detail.usageAvailable, false);

  const usage = await emailService.getMailboxUsage(MAILBOX_USER_ID, mailbox.id);
  assert.equal(usage.limitBytes, '5368709120');
  assert.equal(usage.usedBytes, null);
  assert.equal(usage.usageAvailable, false);

  await assert.rejects(
    () => emailService.getMailbox(USER_ID, mailbox.id),
    (err) => err.status === 404 && err.code === 'EMAIL_MAILBOX_NOT_FOUND',
  );

  await emailService.changeMailboxPassword(MAILBOX_USER_ID, mailbox.id, 'NewSecurePass123!');
  await assert.rejects(
    () => glondiaMailService.login({ email: 'sales@example.com', password: 'SecurePass123!' }),
    (err) => err.status === 401 && err.code === 'INVALID_MAILBOX_CREDENTIALS',
  );
  const session = await glondiaMailService.login({ email: 'sales@example.com', password: 'NewSecurePass123!' });
  assert.equal(session.mailbox, 'sales@example.com');
  assert.ok(session.token);
});

test('five-mailbox plan permits five records and rejects the sixth', async () => {
  await emailService.selectEmailPlan(LIMIT_USER_ID, 'email-5');
  for (let index = 1; index <= 5; index += 1) {
    await emailService.createMailboxRequest(LIMIT_USER_ID, {
      domain: 'limit.example.com',
      mailboxName: `mail${index}`,
      password: `SecurePass${index}!`,
    });
  }
  assert.equal(await prisma.emailMailbox.count({ where: { userId: LIMIT_USER_ID } }), 5);
  const capacity = await emailService.getEmailMailboxCapacity(LIMIT_USER_ID);
  assert.deepEqual(
    { used: capacity.used, allowed: capacity.allowed, remaining: capacity.remaining, atLimit: capacity.atLimit },
    { used: 5, allowed: 5, remaining: 0, atLimit: true },
  );
  await assert.rejects(
    () => emailService.createMailboxRequest(LIMIT_USER_ID, {
      domain: 'limit.example.com', mailboxName: 'mail6', password: 'SecurePass6!',
    }),
    (err) => err.status === 409 && err.code === 'EMAIL_PLAN_LIMIT_REACHED',
  );
});

test('mailbox capacity middleware blocks a full plan before the controller runs', async () => {
  const { requireEmailMailboxCapacity } = await import('../src/middleware/emailMailboxCapacity.middleware.js');
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  await requireEmailMailboxCapacity(
    { user: { id: LIMIT_USER_ID }, id: 'capacity-test' },
    res,
    () => { nextCalled = true; },
  );

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 409);
  assert.equal(payload.error.code, 'EMAIL_PLAN_LIMIT_REACHED');
  assert.equal(payload.capacity.remaining, 0);
});
