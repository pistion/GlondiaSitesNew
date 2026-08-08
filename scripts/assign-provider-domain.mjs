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
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    result[key] = value;
  }
  return result;
}

function validateAssignment(input) {
  const clientId = String(input.clientId || input.client || '').trim();
  const provider = String(input.provider || '').trim().toLowerCase();
  const name = String(input.name || input.domain || '').trim().toLowerCase();
  const providerResourceId = String(input.providerResourceId || input.resource || (provider === 'spaceship' ? name : '')).trim();
  if (!clientId || !provider || !name || !providerResourceId) {
    throw new Error('Each assignment requires clientId, provider, name/domain, and providerResourceId/resource (SpaceShip defaults resource to the domain name).');
  }
  return { clientId, provider, name, providerResourceId, metadata: input.metadata || {} };
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

const { assignExternalDomain } = await import('../server/src/services/customerDomainService.js');
const { prisma } = await import('../server/src/services/db.js');
try {
  const results = [];
  for (const input of assignments) {
    const assignment = validateAssignment(input);
    const domain = await assignExternalDomain(assignment);
    results.push({ clientId: assignment.clientId, provider: assignment.provider, name: domain.name, serviceId: domain.id });
  }
  console.log(JSON.stringify({ assigned: results.length, results }, null, 2));
} finally {
  await prisma.$disconnect();
}
