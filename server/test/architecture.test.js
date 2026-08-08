/**
 * Architecture boundary tests for the VPS feature.
 *
 * Controllers speak HTTP. Services contain business logic. Repositories speak
 * to the database. Provider adapters speak to the provider. Only repositories
 * and approved database infrastructure may import Prisma / the shared client.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const importsSharedDb = (src) => /from\s+['"][^'"]*\/db\.js['"]/.test(src);
const importsPrismaPkg = (src) => /from\s+['"]@prisma\/client['"]/.test(src);

const MUST_NOT_TOUCH_DB = [
  'services/vpsHostingService.js',
  'services/vpsSyncService.js',
  'services/vpsDto.js',
  'services/vpsPricingService.js',
  'services/serviceAccessService.js',
  'services/vultrApiService.js',
  'controllers/vpsHostingController.js',
  'routes/vpsHostingRoutes.js',
  'middleware/serviceAccess.middleware.js',
  'routes/admin.routes.js',
  'services/adminService.js',
  'services/adminCustomerOversightService.js',
  'controllers/adminCustomerController.js',
  'services/hostingRelationshipRepairService.js',
  'controllers/adminHostingRepairController.js',
];

for (const rel of MUST_NOT_TOUCH_DB) {
  test(`${rel} does not import Prisma or the database client`, () => {
    const src = read(rel);
    assert.equal(importsSharedDb(src), false, `${rel} imports the shared db client`);
    assert.equal(importsPrismaPkg(src), false, `${rel} imports @prisma/client`);
    assert.doesNotMatch(src, /\bprisma\./, `${rel} references the prisma client directly`);
  });
}

const REPOSITORIES = [
  'repositories/vps.repository.js',
  'repositories/vpsAction.repository.js',
  'repositories/serviceAccess.repository.js',
  'repositories/providerResource.repository.js',
  'repositories/customer.repository.js',
  'repositories/adminUser.repository.js',
  'repositories/adminDashboard.repository.js',
  'repositories/hostingRepair.repository.js',
  'repositories/hosting.repository.js',
  'repositories/billing.repository.js',
  'repositories/operations.repository.js',
  'repositories/audit.repository.js',
];

for (const rel of REPOSITORIES) {
  test(`${rel} uses the shared Prisma singleton`, () => {
    const src = read(rel);
    assert.equal(importsSharedDb(src), true, `${rel} must import the shared db client`);
    assert.equal(importsPrismaPkg(src), false, `${rel} must not construct its own Prisma client`);
  });
}

test('only the shared bootstrap instantiates PrismaClient', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && /new\s+PrismaClient\s*\(/.test(readFileSync(full, 'utf8'))) {
        offenders.push(full);
      }
    }
  };
  walk(root);
  assert.equal(offenders.length, 1, `expected exactly one PrismaClient construction, found: ${offenders.join(', ')}`);
  assert.match(offenders[0].replaceAll('\\', '/'), /services\/db\.js$/);
});

test('VPS service talks to the provider only through the adapter', () => {
  const src = read('services/vpsHostingService.js');
  assert.doesNotMatch(src, /api\.vultr\.com/, 'provider URLs belong in the adapter');
  assert.doesNotMatch(src, /VULTR_API_KEY/, 'provider credentials belong in the adapter');
});
