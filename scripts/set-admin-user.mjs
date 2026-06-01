/**
 * set-admin-user.mjs — promote (or demote) a user's role.
 *
 * Usage:
 *   node scripts/set-admin-user.mjs <email>            # set role = admin
 *   node scripts/set-admin-user.mjs <email> owner      # set role = owner
 *
 * Honours DATABASE_URL exactly like the running server.
 */
import { PrismaClient } from '@prisma/client';

function normalizeSqliteUrl(url) {
  if (!url || !url.startsWith('file:')) return url;
  if (url.startsWith('file:///') || url.startsWith('file://')) return url;
  const path = url.slice('file:'.length);
  return path.startsWith('/') ? `file://${path}` : url;
}

const email = (process.argv[2] || '').trim().toLowerCase();
const role = (process.argv[3] || 'admin').trim().toLowerCase();

if (!email) {
  console.error('Usage: node scripts/set-admin-user.mjs <email> [role=admin|owner]');
  process.exit(1);
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = normalizeSqliteUrl(process.env.DATABASE_URL);
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(2);
  }
  const updated = await prisma.user.update({ where: { email }, data: { role } });
  console.log(`✓ ${updated.email} role is now "${updated.role}" (id: ${updated.id}).`);
} catch (err) {
  console.error('Failed to update user role:', err.message);
  process.exit(3);
} finally {
  await prisma.$disconnect();
}
