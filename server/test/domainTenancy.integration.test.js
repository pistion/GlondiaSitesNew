import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_A = 'domain-user-a';
const USER_B = 'domain-user-b';
let tempDir;
let prisma;
let disconnect;
let domains;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-domain-tenancy-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'ignore',
  });
  domains = await import('../src/services/customerDomainService.js');
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
  await prisma.user.createMany({
    data: [
      { id: USER_A, clientId: 'glondiac-test-a', email: 'domain-a@test.local', passwordHash: 'unused' },
      { id: USER_B, clientId: 'glondiac-test-b', email: 'domain-b@test.local', passwordHash: 'unused' },
    ],
  });
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('paid domain provisioning atomically records service, access, and provider ownership', async () => {
  const [created] = await domains.recordRegisteredDomains({
    user: { id: USER_A },
    order: {
      id: 'order-domain-a',
      userId: USER_A,
      organizationId: USER_A,
      totalAmountCents: 1500,
      markupPercent: 30,
      markupAmountCents: 300,
      currency: 'USD',
      metadata: { autoRenew: true },
    },
    domains: [{ name: 'owned-example.com', years: 1, actualAmountCents: 1200 }],
    operations: [{ domain: 'owned-example.com', operationId: 'operation-1', status: 'completed' }],
  });

  const [service, access, resource] = await Promise.all([
    prisma.businessService.findUnique({ where: { id: created.id } }),
    prisma.serviceAccess.findUnique({ where: { serviceType_serviceId: { serviceType: 'domain', serviceId: created.id } } }),
    prisma.providerResource.findUnique({
      where: { provider_resourceType_providerResourceId: { provider: 'spaceship', resourceType: 'domain', providerResourceId: 'owned-example.com' } },
    }),
  ]);
  assert.equal(service.createdByUserId, USER_A);
  assert.equal(service.paymentStatus, 'paid');
  assert.equal(access.userId, USER_A);
  assert.equal(access.billingStatus, 'paid');
  assert.equal(access.accessStatus, 'active');
  assert.equal(resource.userId, USER_A);
  assert.equal(resource.organizationId, USER_A);
  assert.equal(resource.serviceId, service.id);
});

test('database access index prevents cross-customer domain reads', async () => {
  const own = await domains.listCustomerDomains({ id: USER_A });
  const other = await domains.listCustomerDomains({ id: USER_B });
  assert.deepEqual(own.items.map((item) => item.name), ['owned-example.com']);
  assert.equal(other.total, 0);
  await assert.rejects(
    () => domains.getCustomerDomain({ id: USER_B }, 'owned-example.com'),
    (error) => error.status === 404,
  );
});

test('domain settings are assembled only from persisted service data', async () => {
  const result = await domains.getCustomerDomainSettings({ id: USER_A }, 'owned-example.com');
  assert.equal(result.domain.name, 'owned-example.com');
  assert.equal(result.billing.amountCents, 1500);
  assert.equal(result.billing.paymentStatus, 'paid');
  assert.equal(result.records.total, 0);
  assert.deepEqual(result.providerServices, []);
  assert.equal(Object.hasOwn(result, 'attachedServices'), false);
  await assert.rejects(
    () => domains.getCustomerDomainSettings({ id: USER_B }, 'owned-example.com'),
    (error) => error.status === 404,
  );
});

test('provider resource cannot be reassigned to another customer', async () => {
  await assert.rejects(
    () => domains.assignExternalDomain({
      clientId: 'glondiac-test-b',
      provider: 'spaceship',
      providerResourceId: 'owned-example.com',
      name: 'owned-example.com',
    }),
    (error) => error.status === 409 && error.code === 'PROVIDER_RESOURCE_ALREADY_ASSIGNED',
  );
  const leaked = await prisma.businessService.findFirst({ where: { createdByUserId: USER_B, name: 'owned-example.com' } });
  assert.equal(leaked, null);
});

test('paid-looking service without ServiceAccess is never listed', async () => {
  await prisma.businessService.create({
    data: {
      id: 'orphan-domain', organizationId: USER_B, createdByUserId: USER_B,
      type: 'domain', provider: 'spaceship', providerServiceId: 'orphan.example', name: 'orphan.example',
      status: 'active', paymentStatus: 'paid', metadata: '{}',
    },
  });
  const result = await domains.listCustomerDomains({ id: USER_B });
  assert.equal(result.total, 0);
});

test('order ownership mismatch is rejected before persistence', async () => {
  await assert.rejects(
    () => domains.recordRegisteredDomains({
      user: { id: USER_B },
      order: { id: 'order-a', userId: USER_A, organizationId: USER_A, metadata: {} },
      domains: [{ name: 'mismatch.example' }],
    }),
    (error) => error.status === 404,
  );
});
