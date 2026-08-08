import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_ID = 'mailbox-owner';
const OTHER_ID = 'mailbox-other';

let tempDir;
let prisma;
let disconnect;
let mailboxService;
let emailService;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-mailbox-tenancy-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  process.env.DATA_DIR = join(tempDir, 'data');
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'ignore',
  });

  mailboxService = await import('../src/services/customerMailboxService.js');
  emailService = await import('../src/services/email.service.js');
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
  await prisma.user.createMany({
    data: [
      { id: OWNER_ID, clientId: 'mailbox-client-owner', email: 'owner@test.local', passwordHash: 'unused' },
      { id: OTHER_ID, clientId: 'mailbox-client-other', email: 'other@test.local', passwordHash: 'unused' },
    ],
  });
  await prisma.serviceAccess.createMany({
    data: [
      {
        userId: OWNER_ID, organizationId: OWNER_ID, serviceType: 'email',
        serviceId: `email-plan:${OWNER_ID}`, serviceName: 'Email plan',
        accessStatus: 'active', billingStatus: 'paid', adminStatus: 'allowed', planId: 'email-5',
        metadata: JSON.stringify({ kind: 'email_plan' }),
      },
      {
        userId: OTHER_ID, organizationId: OTHER_ID, serviceType: 'email',
        serviceId: `email-plan:${OTHER_ID}`, serviceName: 'Email plan',
        accessStatus: 'active', billingStatus: 'paid', adminStatus: 'allowed', planId: 'email-5',
        metadata: JSON.stringify({ kind: 'email_plan' }),
      },
    ],
  });
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('provider mailbox import creates all ownership ledgers for one client', async () => {
  const mailbox = await mailboxService.assignExternalMailbox({
    clientId: 'mailbox-client-owner',
    provider: 'spacemail',
    email: 'hello@example.com',
    providerResourceId: 'provider-mailbox-1',
    storageUsedBytes: '1024',
  });

  const [service, access, resource, transport] = await Promise.all([
    prisma.businessService.findUnique({ where: { id: mailbox.businessServiceId } }),
    prisma.serviceAccess.findUnique({
      where: { serviceType_serviceId: { serviceType: 'email', serviceId: mailbox.businessServiceId } },
    }),
    prisma.providerResource.findUnique({
      where: {
        provider_resourceType_providerResourceId: {
          provider: 'spacemail',
          resourceType: 'mailbox',
          providerResourceId: 'provider-mailbox-1',
        },
      },
    }),
    prisma.emailTransportSetting.findUnique({ where: { emailMailboxId: mailbox.id } }),
  ]);

  assert.equal(mailbox.userId, OWNER_ID);
  assert.equal(service.createdByUserId, OWNER_ID);
  assert.equal(access.userId, OWNER_ID);
  assert.equal(resource.userId, OWNER_ID);
  assert.equal(resource.serviceId, service.id);
  assert.equal(transport.userId, OWNER_ID);
  assert.equal(transport.organizationId, OWNER_ID);
  assert.equal(transport.username, 'hello@example.com');
  assert.equal(transport.imapHost, 'mail.spacemail.com');
  assert.equal(transport.imapPort, 993);
  assert.equal(transport.smtpHost, 'mail.spacemail.com');
  assert.equal(transport.smtpPort, 465);
});

test('mailbox dashboard only returns owned and granted records', async () => {
  await prisma.businessService.create({
    data: {
      id: 'orphan-mailbox-service',
      organizationId: OWNER_ID,
      createdByUserId: OWNER_ID,
      type: 'email',
      provider: 'spacemail',
      providerServiceId: 'orphan@example.com',
      name: 'orphan@example.com',
      status: 'active',
      paymentStatus: 'external',
    },
  });
  await prisma.emailMailbox.create({
    data: {
      userId: OWNER_ID,
      planServiceId: `email-plan:${OWNER_ID}`,
      businessServiceId: 'orphan-mailbox-service',
      email: 'orphan@example.com',
      localPart: 'orphan',
      domain: 'example.com',
      passwordHash: 'unused',
      status: 'active',
    },
  });

  const ownerList = await emailService.listMailboxes(OWNER_ID);
  const otherList = await emailService.listMailboxes(OTHER_ID);
  assert.deepEqual(ownerList.mailboxes.map((item) => item.email), ['hello@example.com']);
  assert.equal(ownerList.mailboxes[0].transportSettings.username, 'hello@example.com');
  assert.deepEqual(otherList.mailboxes, []);
});

test('provider mailbox cannot be reassigned to another client', async () => {
  await assert.rejects(
    mailboxService.assignExternalMailbox({
      clientId: 'mailbox-client-other',
      provider: 'spacemail',
      email: 'hello@example.com',
      providerResourceId: 'provider-mailbox-1',
    }),
    (error) => error.code === 'PROVIDER_RESOURCE_ALREADY_ASSIGNED',
  );
});
