import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';

const SANDBOX_MODE = 'sandbox';

const SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'email.status',
    service: 'email',
    label: 'Email status check',
    method: 'GET',
    path: '/api/v1/email/status',
    description: 'Simulates loading the customer Business Email setup status.',
    payload: {},
  }),
  Object.freeze({
    id: 'email.mailbox.request',
    service: 'email',
    label: 'Mailbox creation request',
    method: 'POST',
    path: '/api/v1/email/mailboxes/request',
    description: 'Validates the mailbox request shape without creating a mailbox.',
    payload: { domain: 'example.com', mailboxName: 'info', password: 'SandboxPass123!' },
  }),
  Object.freeze({
    id: 'domains.list',
    service: 'domains',
    label: 'Customer domains list',
    method: 'GET',
    path: '/api/v1/domains',
    description: 'Simulates loading domains owned by the current customer.',
    payload: {},
  }),
  Object.freeze({
    id: 'hosting.deploy',
    service: 'hosting',
    label: 'Hosting deployment',
    method: 'POST',
    path: '/api/hosting/deployments',
    description: 'Walks through a deploy request without creating provider resources.',
    payload: { projectName: 'sandbox-site', source: 'zip', plan: 'starter' },
  }),
  Object.freeze({
    id: 'vps.provision',
    service: 'vps',
    label: 'VPS provision',
    method: 'POST',
    path: '/api/v1/vps-hosting/servers',
    description: 'Simulates VPS validation, billing lock, and provider handoff.',
    payload: { region: 'syd', plan: 'vc2-1c-1gb', label: 'sandbox-vps' },
  }),
  Object.freeze({
    id: 'cloud-storage.provision',
    service: 'cloud-storage',
    label: 'Cloud Storage provision',
    method: 'POST',
    path: '/api/cloud-storage/services',
    description: 'Simulates catalog validation, billing records, provider handoff and active service state.',
    payload: { serviceKind: 'private_vault', tenancy: 'shared', planSize: 'smallest', region: 'syd', name: 'Sandbox File Storage' },
  }),
  Object.freeze({
    id: 'billing.checkout',
    service: 'billing',
    label: 'Checkout session',
    method: 'POST',
    path: '/api/v1/workspaces/default/billing/checkout',
    description: 'Simulates checkout creation and payment-provider readiness.',
    payload: { serviceType: 'email', amountCents: 500, currency: 'USD' },
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scenarioById(id) {
  return SCENARIOS.find((scenario) => scenario.id === String(id || '').trim()) || null;
}

function envConfigured(names) {
  return names.some((name) => Boolean(String(process.env[name] || '').trim()));
}

async function safeCount(modelName, where = undefined) {
  try {
    if (!prisma[modelName]?.count) return null;
    return await prisma[modelName].count(where ? { where } : undefined);
  } catch {
    return null;
  }
}

export async function listSandboxServices(userId) {
  const [
    emailMailboxes,
    businessServices,
    checkoutOrders,
    customerDomains,
    deployments,
    cloudStorageServices,
  ] = await Promise.all([
    safeCount('emailMailbox', userId ? { userId } : undefined),
    safeCount('businessService', userId ? { createdByUserId: userId, deletedAt: null } : { deletedAt: null }),
    safeCount('checkoutOrder', userId ? { userId } : undefined),
    safeCount('customerDomain', userId ? { userId } : undefined),
    safeCount('deployment', userId ? { userId } : undefined),
    safeCount('cloudStorageService', userId ? { createdByUserId: userId } : undefined),
  ]);

  const serviceState = {
    email: {
      label: 'Business Email',
      icon: 'Mail',
      configured: true,
      status: 'sandbox-ready',
      records: emailMailboxes,
      note: 'Safe simulation for plans, DNS, and mailbox requests.',
    },
    domains: {
      label: 'Domains',
      icon: 'Globe',
      configured: envConfigured(['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET', 'SPACESHIP_API_BASE_URL']),
      status: envConfigured(['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET']) ? 'provider-configured' : 'sandbox-only',
      records: customerDomains,
      note: 'Registrar writes are simulated; no domain is registered.',
    },
    hosting: {
      label: 'Hosting',
      icon: 'Server',
      configured: envConfigured(['RENDER_API_KEY']),
      status: envConfigured(['RENDER_API_KEY']) ? 'provider-configured' : 'sandbox-only',
      records: deployments ?? businessServices,
      note: 'Deployment pipeline checks are simulated without provider calls.',
    },
    vps: {
      label: 'VPS',
      icon: 'Cpu',
      configured: envConfigured(['VULTR_API_KEY']),
      status: envConfigured(['VULTR_API_KEY']) ? 'provider-configured' : 'sandbox-only',
      records: businessServices,
      note: 'Provisioning, ownership, and billing handoff are simulated.',
    },
    'cloud-storage': {
      label: 'Cloud Storage',
      icon: 'Database',
      configured: envConfigured(['VULTR_API_KEY']),
      status: envConfigured(['VULTR_API_KEY']) ? 'provider-configured' : 'sandbox-only',
      records: cloudStorageServices,
      note: 'Catalog, provisioning, files, backups, repositories, usage and billing are simulated.',
    },
    billing: {
      label: 'Billing',
      icon: 'CreditCard',
      configured: envConfigured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']),
      status: envConfigured(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) ? 'provider-configured' : 'sandbox-only',
      records: checkoutOrders,
      note: 'Checkout and receipt flows are simulated without charges.',
    },
  };

  return {
    mode: SANDBOX_MODE,
    userId: userId || 'anonymous',
    services: Object.entries(serviceState).map(([id, service]) => ({ id, ...service })),
    scenarios: SCENARIOS.map(clone),
  };
}

function validatePayload(scenario, payload) {
  const issues = [];
  if (scenario.id === 'email.mailbox.request') {
    if (!String(payload?.domain || '').includes('.')) issues.push('domain must look like a valid domain.');
    if (!/^[a-z0-9._-]+$/i.test(String(payload?.mailboxName || ''))) issues.push('mailboxName may contain letters, numbers, dots, dashes, and underscores.');
    if (String(payload?.password || '').length < 10) issues.push('password must be at least 10 characters.');
  }
  if (scenario.id === 'hosting.deploy' && !String(payload?.projectName || '').trim()) issues.push('projectName is required.');
  if (scenario.id === 'vps.provision' && !String(payload?.plan || '').trim()) issues.push('plan is required.');
  if (scenario.id === 'cloud-storage.provision' && !String(payload?.serviceKind || '').trim()) issues.push('serviceKind is required.');
  if (scenario.id === 'billing.checkout' && Number(payload?.amountCents || 0) <= 0) issues.push('amountCents must be greater than zero.');
  return issues;
}

export async function simulateSandboxCall(userId, scenarioId, payload = {}) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) {
    const err = new Error('Choose a valid sandbox scenario.');
    err.status = 404;
    err.code = 'SANDBOX_SCENARIO_NOT_FOUND';
    throw err;
  }

  const startedAt = Date.now();
  const requestId = `sandbox-${randomUUID()}`;
  const safePayload = typeof payload === 'object' && payload !== null ? payload : {};
  const validationIssues = validatePayload(scenario, safePayload);
  const ok = validationIssues.length === 0;
  const status = ok ? (scenario.method === 'GET' ? 200 : 202) : 422;

  const trace = [
    { step: 'auth.context', status: 'passed', detail: `Scoped to user ${userId || 'anonymous'}.` },
    { step: 'request.shape', status: ok ? 'passed' : 'blocked', detail: ok ? 'Payload accepted by sandbox validator.' : validationIssues.join(' ') },
    { step: 'provider.write', status: 'skipped', detail: 'Sandbox mode never calls external provider mutation APIs.' },
    { step: 'database.write', status: 'skipped', detail: 'No records were created, updated, or deleted.' },
  ];

  return {
    mode: SANDBOX_MODE,
    scenario: clone(scenario),
    request: {
      id: requestId,
      method: scenario.method,
      path: scenario.path,
      userId: userId || 'anonymous',
      payload: safePayload,
    },
    response: {
      status,
      ok,
      body: ok
        ? {
            success: true,
            simulated: true,
            message: `${scenario.label} completed in sandbox mode.`,
            reference: requestId,
          }
        : {
            success: false,
            simulated: true,
            error: { code: 'SANDBOX_VALIDATION_FAILED', message: validationIssues.join(' ') },
          },
    },
    trace,
    durationMs: Date.now() - startedAt,
    createdAt: new Date().toISOString(),
  };
}
