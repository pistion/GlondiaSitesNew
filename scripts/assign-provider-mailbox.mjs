import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';

dotenv.config({ path: '.env.local' });
dotenv.config();

function argsToObject(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    result[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function validateAssignment(input) {
  const clientId = String(input.clientId || input.client || '').trim();
  const provider = String(input.provider || '').trim().toLowerCase();
  const email = String(input.email || '').trim().toLowerCase();
  const providerResourceId = String(input.providerResourceId || input.resource || email).trim();
  if (!clientId || !provider || !email || !providerResourceId) {
    throw new Error('Each assignment requires clientId, provider, email, and providerResourceId/resource.');
  }
  return {
    clientId,
    provider,
    email,
    providerResourceId,
    metadata: input.metadata || {},
    storageLimitBytes: input.storageLimitBytes,
    storageUsedBytes: input.storageUsedBytes,
    status: input.status || 'active',
    paymentStatus: input.paymentStatus || 'external',
    accessBillingStatus: input.accessBillingStatus || 'free',
  };
}

const args = argsToObject(process.argv.slice(2));
let assignments;
if (args.file) {
  const payload = JSON.parse(await readFile(String(args.file), 'utf8'));
  assignments = Array.isArray(payload) ? payload : payload.assignments;
  if (!Array.isArray(assignments)) throw new Error('Assignment file must contain a JSON array or { "assignments": [] }.');
} else {
  assignments = [args];
}

const { assignExternalMailbox } = await import('../server/src/services/customerMailboxService.js');
const { prisma } = await import('../server/src/services/db.js');
try {
  const results = [];
  for (const input of assignments) {
    const assignment = validateAssignment(input);
    const mailbox = await assignExternalMailbox(assignment);
    results.push({
      clientId: assignment.clientId,
      provider: assignment.provider,
      email: mailbox.email,
      mailboxId: mailbox.id,
    });
  }
  console.log(JSON.stringify({ assigned: results.length, results }, null, 2));
} finally {
  await prisma.$disconnect();
}
