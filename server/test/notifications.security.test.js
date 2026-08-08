import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let tempDir;
let prisma;
let notifications;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-notifications-test-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;

  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'ignore',
  });

  ({ prisma } = await import('../src/services/db.js'));
  notifications = await import('../src/services/notificationService.js');
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows may hold SQLite handles briefly */ }
  }
});

test('customers never see admin-audience notifications, even when userId is set', async () => {
  await notifications.createNotification({
    userId: 'cust-sec',
    audience: 'admin',
    type: 'warning',
    title: 'Admin only',
    message: 'Internal dashboard event',
    actionUrl: '/admin',
  });

  const customer = await notifications.listNotifications({ user: { id: 'cust-sec', role: 'owner' } });
  assert.equal(customer.items.length, 0);

  const admin = await notifications.listNotifications({ user: { id: 'admin-sec', role: 'admin' } });
  assert.equal(admin.items.length, 1);
  assert.equal(admin.items[0].actionUrl, '/admin');
});

test('customer notification responses are static and expose no action links', async () => {
  await notifications.createUserNotification('cust-sec', {
    type: 'billing',
    title: 'Billing safe',
    message: 'Open billing',
    actionUrl: '/dashboard/billing',
  });
  await notifications.createUserNotification('cust-sec', {
    type: 'danger',
    title: 'Bad admin link',
    message: 'Should not link',
    actionUrl: '/api/admin/users',
  });
  await notifications.createSystemNotification({
    type: 'info',
    title: 'Bad all link',
    message: 'Should not link everyone to admin',
    actionUrl: '/dashboard#tickets',
  });

  const customer = await notifications.listNotifications({ user: { id: 'cust-sec', role: 'owner' } });
  const byTitle = new Map(customer.items.map((item) => [item.title, item]));

  assert.equal(byTitle.get('Billing safe').actionUrl, null);
  assert.equal(byTitle.get('Bad admin link').actionUrl, null);
  assert.equal(byTitle.get('Bad all link').actionUrl, null);
});

test('admins keep action links for admin notifications', async () => {
  await notifications.createAdminNotification({
    type: 'ticket',
    title: 'Admin ticket link',
    message: 'Open admin tickets',
    actionUrl: '/dashboard#tickets',
  });

  const admin = await notifications.listNotifications({ user: { id: 'admin-sec', role: 'admin' } });
  const item = admin.items.find((row) => row.title === 'Admin ticket link');
  assert.ok(item);
  assert.equal(item.actionUrl, '/dashboard#tickets');
});
