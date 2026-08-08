import { prisma } from './db.js';
import { randomUUID } from 'node:crypto';

export const PROJECT_SERVICE_TYPES = [
  { id: 'website', label: 'Website / Site Builder', nextView: 'builder-gallery' },
  { id: 'hosting', label: 'Hosting', nextView: 'hosting-list' },
  { id: 'domain', label: 'Domain', nextView: 'domains' },
  { id: 'email', label: 'Business Email', nextView: 'email' },
  { id: 'vps', label: 'VPS Hosting', nextView: 'vps' },
  { id: 'consultation', label: 'Consultation', nextView: 'service-requests' },
  { id: 'build', label: 'Custom Build', nextView: 'service-requests' },
  { id: 'support', label: 'Support', nextView: 'tickets' },
  { id: 'other', label: 'Other', nextView: 'overview' },
];

const SERVICE_TYPE_IDS = new Set(PROJECT_SERVICE_TYPES.map((item) => item.id));

export function listProjectServiceTypes() {
  return PROJECT_SERVICE_TYPES.map((item) => ({ ...item }));
}

export async function listProjects({ userId, workspaceId, includeArchived = false } = {}) {
  const where = {
    ...(includeArchived ? {} : { archivedAt: null }),
    ...(userId ? { userId } : workspaceId ? { workspaceId } : {}),
  };
  return prisma.clientProject.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createProject({ userId, workspaceId, input = {} } = {}) {
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, clientId: true, name: true, email: true } }) : null;
  const serviceType = normalizeServiceType(input.serviceType || input.type);
  const name = cleanText(input.name) || defaultProjectName(serviceType);
  const slug = await uniqueSlug({ userId: user?.id || null, name });
  const metadata = {
    source: input.source || 'manual',
    nextView: serviceTypeMeta(serviceType).nextView,
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  };

  const clientId = input.clientId || user?.clientId || null;
  const projectId = await uniqueProjectId(clientId);
  metadata.storageNamespace = cleanText(input.storageNamespace)
    || ['clients', clientId || 'unassigned', 'projects', projectId].map(encodeURIComponent).join('/');

  return prisma.clientProject.create({
    data: {
      id: projectId,
      projectCode: await uniqueProjectCode(),
      userId: user?.id || null,
      clientId,
      workspaceId: workspaceId || input.workspaceId || null,
      name,
      slug,
      serviceType,
      status: input.status || 'draft',
      priority: input.priority || 'normal',
      description: cleanText(input.description) || null,
      autoBillingEnabled: Boolean(input.autoBillingEnabled),
      billingAmount: normalizeMoney(input.billingAmount),
      billingCurrency: normalizeCurrency(input.billingCurrency),
      billingInterval: normalizeBillingInterval(input.billingInterval),
      storageNamespace: metadata.storageNamespace,
      metadata: JSON.stringify(metadata),
    },
  });
}

export async function getProject({ projectId, userId, workspaceId } = {}) {
  const project = await prisma.clientProject.findFirst({
    where: {
      id: projectId,
      ...(userId ? { userId } : workspaceId ? { workspaceId } : {}),
    },
  });
  if (!project) throw notFound();
  return project;
}

export async function getProjectSummary({ projectId, userId, workspaceId } = {}) {
  const project = await getProject({ projectId, userId, workspaceId });
  const [accessRows, hosting, vps, storage, business, mailboxes, builder, activity] = await Promise.all([
    prisma.serviceAccess.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.webHostingService.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.vpsService.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.cloudStorageService.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.businessService.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.emailMailbox.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.builderProject.findMany({ where: { clientProjectId: projectId }, orderBy: { updatedAt: 'desc' } }),
    prisma.auditLog.findMany({ where: { entityId: projectId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);

  const direct = [
    ...hosting.map((row) => serviceDto('hosting', row)),
    ...vps.map((row) => serviceDto('vps', row)),
    ...storage.map((row) => serviceDto('storage', row)),
    ...business.map((row) => serviceDto(row.type || 'business', row)),
    ...mailboxes.map((row) => serviceDto('email', row)),
    ...builder.map((row) => serviceDto('website', row)),
  ];
  const accessByService = new Map(accessRows.map((row) => [`${normalizeManagedServiceType(row.serviceType)}:${row.serviceId}`, row]));
  const visibleDirect = direct.filter((row) => accessByService.get(`${normalizeManagedServiceType(row.type)}:${row.id}`)?.accessStatus !== 'deleted').map((row) => {
    const access = accessByService.get(`${normalizeManagedServiceType(row.type)}:${row.id}`);
    return access ? { ...row, name: access.serviceName || row.name, status: access.accessStatus, billingStatus: access.billingStatus, adminStatus: access.adminStatus } : row;
  });
  const seen = new Set(visibleDirect.map((row) => `${normalizeManagedServiceType(row.type)}:${row.id}`));
  const services = [...visibleDirect, ...accessRows.filter((row) => row.accessStatus !== 'deleted' && !seen.has(`${normalizeManagedServiceType(row.serviceType)}:${row.serviceId}`)).map((row) => ({
    id: row.serviceId, type: row.serviceType, name: row.serviceName || row.serviceId,
    status: row.accessStatus, billingStatus: row.billingStatus, updatedAt: row.updatedAt,
  }))];

  return {
    project: projectDto({ ...project, serviceCount: services.length }),
    services,
    metrics: { visitors30d: 0, bandwidth30d: 0, requests30d: 0 },
    recentDeployments: [],
    recentActivity: activity.map((row) => ({ id: row.id, message: row.action, status: row.status, createdAt: row.createdAt, metadata: parseJson(row.metadata) })),
  };
}

function serviceDto(type, row) {
  return {
    id: row.id,
    type,
    name: row.name || row.label || row.email || row.hostname || row.slug || row.id,
    status: row.status || row.serviceStatus || 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function updateProject({ projectId, userId, workspaceId, patch = {} } = {}) {
  await getProject({ projectId, userId, workspaceId });
  const data = {};
  if (patch.name !== undefined) {
    data.name = cleanText(patch.name) || 'Untitled project';
    data.slug = await uniqueSlug({ userId, name: data.name, projectId });
  }
  if (patch.serviceType !== undefined || patch.type !== undefined) data.serviceType = normalizeServiceType(patch.serviceType || patch.type);
  if (patch.status !== undefined) data.status = cleanText(patch.status) || 'draft';
  if (patch.priority !== undefined) data.priority = cleanText(patch.priority) || 'normal';
  if (patch.description !== undefined) data.description = cleanText(patch.description) || null;
  if (patch.autoBillingEnabled !== undefined) data.autoBillingEnabled = Boolean(patch.autoBillingEnabled);
  if (patch.billingAmount !== undefined) data.billingAmount = normalizeMoney(patch.billingAmount);
  if (patch.billingCurrency !== undefined) data.billingCurrency = normalizeCurrency(patch.billingCurrency);
  if (patch.billingInterval !== undefined) data.billingInterval = normalizeBillingInterval(patch.billingInterval);
  if (patch.metadata && typeof patch.metadata === 'object') {
    const current = await getProject({ projectId, userId, workspaceId });
    data.metadata = JSON.stringify({ ...parseJson(current.metadata), ...patch.metadata });
  }
  return prisma.clientProject.update({ where: { id: projectId }, data });
}

export async function archiveProject({ projectId, userId, workspaceId } = {}) {
  await getProject({ projectId, userId, workspaceId });
  return prisma.clientProject.update({
    where: { id: projectId },
    data: { status: 'archived', archivedAt: new Date() },
  });
}

const SERVICE_ACTIONS = new Set(['mark', 'edit', 'stop', 'flag', 'report', 'delete']);

export async function manageProjectService({ projectId, userId, workspaceId, serviceType, serviceId, action, input = {} } = {}) {
  await getProject({ projectId, userId, workspaceId });
  const normalizedType = normalizeManagedServiceType(serviceType);
  const normalizedAction = cleanText(action).toLowerCase();
  if (!SERVICE_ACTIONS.has(normalizedAction)) throw serviceActionError('Unsupported service action.', 400);
  const service = await findAttachedService(projectId, normalizedType, serviceId);
  if (!service) throw serviceActionError('Service is not attached to this project.', 404);

  const now = new Date();
  const base = {
    clientProjectId: projectId,
    userId: userId || null,
    serviceName: service.name,
    lastActivityAt: now,
  };
  const update = { ...base };
  if (normalizedAction === 'mark') Object.assign(update, { accessStatus: 'active', adminStatus: 'allowed', suspendedAt: null, suspendedReason: null });
  if (normalizedAction === 'edit') update.serviceName = cleanText(input.name) || service.name;
  if (normalizedAction === 'stop') Object.assign(update, { accessStatus: 'suspended', suspendedAt: now, suspendedReason: cleanText(input.reason) || 'Stopped from project workspace' });
  if (normalizedAction === 'flag' || normalizedAction === 'report') Object.assign(update, { adminStatus: 'review_required' });
  if (normalizedAction === 'delete') Object.assign(update, { accessStatus: 'deleted', adminStatus: 'blocked', suspendedAt: now, suspendedReason: 'Removed from project workspace' });

  const access = await prisma.serviceAccess.upsert({
    where: { serviceType_serviceId: { serviceType: normalizedType, serviceId } },
    create: {
      ...base,
      serviceType: normalizedType,
      serviceId,
      accessStatus: update.accessStatus || 'active',
      billingStatus: service.billingStatus || 'pending',
      adminStatus: update.adminStatus || 'allowed',
      suspendedAt: update.suspendedAt,
      suspendedReason: update.suspendedReason,
      metadata: JSON.stringify({ managedFromProject: true }),
    },
    update,
  });
  await prisma.auditLog.create({ data: {
    organizationId: service.organizationId || null,
    actorUserId: userId || null,
    action: `project.service.${normalizedAction}`,
    entityType: normalizedType,
    entityId: serviceId,
    status: normalizedAction === 'report' ? 'reported' : 'success',
    metadata: JSON.stringify({ projectId, serviceId, serviceType: normalizedType, reason: cleanText(input.reason) || null }),
  } });
  return { projectId, serviceId, serviceType: normalizedType, action: normalizedAction, access };
}

async function findAttachedService(projectId, type, serviceId) {
  const access = await prisma.serviceAccess.findFirst({ where: { clientProjectId: projectId, serviceType: type, serviceId } });
  if (access) return { name: access.serviceName || serviceId, billingStatus: access.billingStatus, organizationId: access.organizationId };
  const model = {
    hosting: prisma.webHostingService,
    vps: prisma.vpsService,
    cloud_storage: prisma.cloudStorageService,
    email: prisma.emailMailbox,
    domain: prisma.businessService,
    website: prisma.builderProject,
  }[type];
  if (!model) return null;
  const row = await model.findFirst({ where: { id: serviceId, clientProjectId: projectId } });
  return row ? { name: row.name || row.label || row.email || row.slug || serviceId, organizationId: row.organizationId || null } : null;
}

function normalizeManagedServiceType(value) {
  return ({ storage: 'cloud_storage', builder: 'website' })[value] || cleanText(value).toLowerCase();
}

function serviceActionError(message, status) {
  return Object.assign(new Error(message), { status, code: 'PROJECT_SERVICE_ACTION_INVALID' });
}

export function projectDto(project) {
  const meta = parseJson(project.metadata);
  return {
    id: project.id,
    projectId: project.id,
    projectCode: project.projectCode,
    userId: project.userId,
    clientId: project.clientId,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    serviceType: project.serviceType,
    serviceTypeLabel: serviceTypeMeta(project.serviceType).label,
    status: project.status,
    priority: project.priority,
    description: project.description,
    storageNamespace: project.storageNamespace,
    autoBillingEnabled: project.autoBillingEnabled,
    billingAmount: Number(project.billingAmount || 0),
    billingCurrency: project.billingCurrency,
    billingInterval: project.billingInterval,
    metadata: meta,
    nextView: meta.nextView || serviceTypeMeta(project.serviceType).nextView,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt,
    serviceCount: Number(project.serviceCount || 0),
  };
}

function normalizeMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

function normalizeCurrency(value) {
  const currency = cleanText(value || 'PGK').toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : 'PGK';
}

function normalizeBillingInterval(value) {
  return ['monthly', 'quarterly', 'yearly'].includes(value) ? value : 'monthly';
}

function normalizeServiceType(value) {
  const id = String(value || 'website').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return SERVICE_TYPE_IDS.has(id) ? id : 'other';
}

function serviceTypeMeta(serviceType) {
  return PROJECT_SERVICE_TYPES.find((item) => item.id === serviceType) || PROJECT_SERVICE_TYPES.at(-1);
}

function defaultProjectName(serviceType) {
  return `${serviceTypeMeta(serviceType).label} project`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function slugify(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

async function uniqueSlug({ userId, name, projectId = null }) {
  const base = slugify(name);
  for (let i = 0; i < 50; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.clientProject.findFirst({
      where: {
        slug,
        userId: userId || null,
        ...(projectId ? { id: { not: projectId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function uniqueProjectCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = `GLP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const existing = await prisma.clientProject.findUnique({ where: { projectCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  return randomUUID();
}

async function uniqueProjectId(clientId) {
  const clientPart = cleanText(clientId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'project';
  for (let i = 0; i < 30; i += 1) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const id = `${clientPart}-p-${digits}`;
    const existing = await prisma.clientProject.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return id;
  }
  return `${clientPart}-p-${Date.now().toString().slice(-6)}`;
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function notFound() {
  const err = new Error('Project not found.');
  err.status = 404;
  err.code = 'PROJECT_NOT_FOUND';
  return err;
}
