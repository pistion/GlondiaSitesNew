import { mutateHostingStore, readHostingStore } from './hostingStore.js';
import { writeAuditLog } from './auditLogService.js';
import { resolveCustomerOwnershipScope } from './adminCustomerScope.js';
import * as customerRepo from '../repositories/customer.repository.js';
import * as repairRepo from '../repositories/hostingRepair.repository.js';

function slugify(value) {
  return String(value || 'hosting')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'hosting';
}

function uniqueSlug(base, existing, organizationId) {
  const root = slugify(base);
  let slug = root;
  let i = 2;
  while (existing.some((row) => row.organizationId === organizationId && row.slug === slug)) {
    slug = `${root}-${i++}`;
  }
  return slug;
}

function deploymentKey(deployment) {
  return deployment?.deploymentId || deployment?.id || null;
}

function isDeleted(deployment) {
  return deployment?.status === 'deleted' || deployment?.recordStatus === 'deleted';
}

function statusFromDeployment(deployment) {
  if (isDeleted(deployment)) return 'deleted';
  return deployment.status || deployment.providerStatus || 'pending';
}

function billingStatusFromDeployment(deployment) {
  const raw = deployment.paymentStatus || deployment.subscriptionStatus || null;
  if (raw === 'paid') return 'paid';
  if (raw === 'overdue' || raw === 'failed' || raw === 'cancelled') return raw;
  if (raw === 'pending' || raw === 'payment_uploaded') return 'pending';
  if (deployment.priceCents === 0 || deployment.priceCents == null) return 'free';
  return 'pending';
}

function accessStatusFromDeployment(deployment) {
  if (isDeleted(deployment)) return 'deleted';
  if (['suspended', 'account_suspended'].includes(deployment.status)) return 'suspended';
  if (['live', 'deployed'].includes(deployment.status)) return 'active';
  return 'pending';
}

function planned(action, data) {
  return { action, data };
}

async function updateLegacyOwnership(deploymentId, organizationId) {
  await mutateHostingStore((store) => {
    const record = (store.deployments || []).find((row) => deploymentKey(row) === deploymentId);
    if (record && !record.organizationId) record.organizationId = organizationId;
  });
}

async function ownerScopeFor(deployment) {
  const userId = deployment.userId || null;
  if (!userId) return { unresolved: { code: 'MISSING_USER_ID', message: 'Hosting deployment has no userId.' } };

  const customer = await customerRepo.findCustomerById(userId);
  if (!customer) return { unresolved: { code: 'UNKNOWN_USER', message: `No customer exists for userId ${userId}.` } };

  const discovered = await customerRepo.listOrganizationIdsForCustomer(userId);
  const scope = resolveCustomerOwnershipScope(customer, discovered);
  const ambiguous = scope.warnings.find((warning) => warning.code === 'AMBIGUOUS_CUSTOMER_ORGANIZATIONS');
  if (ambiguous) return { conflict: { code: ambiguous.code, message: ambiguous.message } };

  if (deployment.organizationId && !scope.organizationIds.includes(deployment.organizationId)) {
    return {
      conflict: {
        code: 'ORGANIZATION_OWNER_MISMATCH',
        message: `Deployment organization ${deployment.organizationId} is not in customer ${userId} ownership scope.`,
      },
    };
  }

  return {
    userId,
    customer,
    organizationId: deployment.organizationId || customer.clientId || userId,
    warnings: scope.warnings,
  };
}

async function scanDeployment(deployment, context, { dryRun }) {
  const id = deploymentKey(deployment);
  const item = {
    deploymentId: id,
    userId: deployment.userId || null,
    organizationId: deployment.organizationId || null,
    checkoutOrderId: deployment.checkoutOrderId || null,
    providerServiceId: deployment.renderServiceId || null,
    serviceStatus: statusFromDeployment(deployment),
    billingStatus: billingStatusFromDeployment(deployment),
    relational: null,
    serviceAccess: null,
    plans: [],
  };

  if (!id) {
    context.unresolved.push({ ...item, code: 'MISSING_DEPLOYMENT_ID', message: 'Hosting deployment has no deploymentId.' });
    return item;
  }

  const owner = await ownerScopeFor(deployment);
  if (owner.unresolved) {
    context.unresolved.push({ ...item, ...owner.unresolved });
    return item;
  }
  if (owner.conflict) {
    context.conflicts.push({ ...item, ...owner.conflict });
    return item;
  }
  item.organizationId = owner.organizationId;

  const access = context.accessRows.find((row) => row.serviceId === id) || null;
  item.serviceAccess = access?.id || null;
  if (access?.userId && access.userId !== owner.userId) {
    context.conflicts.push({ ...item, code: 'SERVICE_ACCESS_USER_MISMATCH', message: `ServiceAccess ${access.id} belongs to ${access.userId}.` });
    return item;
  }
  if (access?.organizationId && access.organizationId !== owner.organizationId) {
    context.conflicts.push({ ...item, code: 'SERVICE_ACCESS_ORGANIZATION_MISMATCH', message: `ServiceAccess ${access.id} belongs to ${access.organizationId}.` });
    return item;
  }

  const needsLegacyOwnership = !deployment.organizationId;

  const providerMatches = deployment.renderServiceId
    ? context.webRows.filter((row) => row.providerServiceId === deployment.renderServiceId)
    : [];
  const idMatches = context.webRows.filter((row) => row.id === id);
  const matches = [...new Map([...idMatches, ...providerMatches].map((row) => [row.id, row])).values()];

  if (matches.length > 1) {
    context.conflicts.push({ ...item, code: 'MULTIPLE_RELATIONAL_ROWS', message: `Deployment maps to ${matches.length} web hosting rows.` });
    return item;
  }

  let webRow = matches[0] || null;
  if (webRow) {
    item.relational = webRow.id;
    if (webRow.createdByUserId && webRow.createdByUserId !== owner.userId) {
      context.conflicts.push({ ...item, code: 'USER_OWNER_MISMATCH', message: `WebHostingService ${webRow.id} belongs to ${webRow.createdByUserId}.` });
      return item;
    }
    if (webRow.organizationId !== owner.organizationId) {
      context.conflicts.push({ ...item, code: 'ORGANIZATION_OWNER_MISMATCH', message: `WebHostingService ${webRow.id} belongs to organization ${webRow.organizationId}.` });
      return item;
    }
    if (deployment.renderServiceId && webRow.providerServiceId && webRow.providerServiceId !== deployment.renderServiceId) {
      context.conflicts.push({ ...item, code: 'PROVIDER_SERVICE_MISMATCH', message: `WebHostingService ${webRow.id} points to provider ${webRow.providerServiceId}.` });
      return item;
    }
    if (needsLegacyOwnership) {
      item.plans.push(planned('updateLegacyHostingOwnership', { deploymentId: id, organizationId: owner.organizationId }));
    }

    const patch = {};
    if (!webRow.checkoutOrderId && deployment.checkoutOrderId) patch.checkoutOrderId = deployment.checkoutOrderId;
    if (!webRow.providerServiceId && deployment.renderServiceId) patch.providerServiceId = deployment.renderServiceId;
    if (webRow.status !== item.serviceStatus) patch.status = item.serviceStatus;
    if (webRow.paymentStatus !== (deployment.paymentStatus || 'pending')) patch.paymentStatus = deployment.paymentStatus || 'pending';
    if (Object.keys(patch).length) {
      item.plans.push(planned('updateWebHostingService', { id: webRow.id, ...patch }));
      if (!dryRun) {
        webRow = await repairRepo.updateWebHostingService(webRow.id, patch);
        context.updated += 1;
      }
    } else {
      context.matched += 1;
    }
  } else {
    const providerConflict = deployment.renderServiceId
      ? context.webRows.find((row) => row.providerServiceId === deployment.renderServiceId)
      : null;
    if (providerConflict) {
      context.conflicts.push({ ...item, code: 'PROVIDER_SERVICE_CONFLICT', message: `Provider service ${deployment.renderServiceId} is already linked to ${providerConflict.id}.` });
      return item;
    }
    if (needsLegacyOwnership) {
      item.plans.push(planned('updateLegacyHostingOwnership', { deploymentId: id, organizationId: owner.organizationId }));
    }

    const data = {
      id,
      organizationId: owner.organizationId,
      createdByUserId: owner.userId,
      checkoutOrderId: deployment.checkoutOrderId || null,
      provider: 'render',
      providerServiceId: deployment.renderServiceId || null,
      name: deployment.serviceName || deployment.siteName || id,
      slug: uniqueSlug(deployment.serviceName || id, context.webRows, owner.organizationId),
      serviceType: deployment.serviceType || 'web_service',
      status: item.serviceStatus,
      plan: deployment.renderPlan || null,
      url: deployment.liveUrl || deployment.verifiedUrl || null,
      totalPriceCents: Number(deployment.priceCents || 0),
      currency: deployment.priceCurrency || 'PGK',
      paymentStatus: deployment.paymentStatus || 'pending',
      billingDueAt: deployment.billingDueAt ? new Date(deployment.billingDueAt) : null,
      paidAt: deployment.paidAt ? new Date(deployment.paidAt) : null,
      metadata: JSON.stringify({ repairedFromDeploymentStore: true, deploymentId: id }),
    };
    item.plans.push(planned('createWebHostingService', data));
    if (!dryRun) {
      webRow = await repairRepo.createWebHostingService(data);
      context.webRows.push(webRow);
      context.created += 1;
    }
  }

  if (access) {
    context.matched += webRow ? 1 : 0;
    if (!dryRun && needsLegacyOwnership) {
      await updateLegacyOwnership(id, owner.organizationId);
      context.updated += 1;
    }
    return item;
  }

  const accessData = {
    userId: owner.userId,
    organizationId: owner.organizationId,
    serviceId: id,
    serviceName: deployment.serviceName || deployment.siteName || id,
    accessStatus: accessStatusFromDeployment(deployment),
    billingStatus: item.billingStatus,
    adminStatus: 'allowed',
    planId: deployment.renderPlan || null,
    checkoutOrderId: deployment.checkoutOrderId || null,
    startsAt: deployment.createdAt ? new Date(deployment.createdAt) : new Date(),
    metadata: JSON.stringify({ repairedFromDeploymentStore: true, deploymentId: id }),
  };
  item.plans.push(planned('createServiceAccess', accessData));
  if (!dryRun) {
    const created = await repairRepo.createHostingAccess(accessData);
    context.accessRows.push(created);
    context.created += 1;
    if (needsLegacyOwnership) {
      await updateLegacyOwnership(id, owner.organizationId);
      context.updated += 1;
    }
  }

  return item;
}

export async function auditHostingRelationships({ dryRun = true, deploymentId = null, actorUserId = null, request = null } = {}) {
  const store = await readHostingStore();
  const deployments = (store.deployments || []).filter((deployment) => !deploymentId || deploymentKey(deployment) === deploymentId);
  if (deploymentId && deployments.length === 0) {
    throw Object.assign(new Error('Hosting deployment not found.'), {
      status: 404,
      code: 'ADMIN_HOSTING_DEPLOYMENT_NOT_FOUND',
      expose: true,
    });
  }
  const context = {
    webRows: await repairRepo.listWebHostingServices(),
    accessRows: await repairRepo.listHostingAccessRows(),
    scanned: deployments.length,
    matched: 0,
    created: 0,
    updated: 0,
    conflicts: [],
    unresolved: [],
    errors: [],
    items: [],
  };

  for (const deployment of deployments) {
    try {
      context.items.push(await scanDeployment(deployment, context, { dryRun }));
    } catch (err) {
      context.errors.push({ deploymentId: deploymentKey(deployment), message: err.message });
    }
  }

  const result = {
    scanned: context.scanned,
    matched: context.matched,
    created: context.created,
    updated: context.updated,
    conflicts: context.conflicts,
    unresolved: context.unresolved,
    errors: context.errors,
    items: context.items,
    skipped: context.items.filter((item) => item.plans.length === 0
      && !context.conflicts.some((conflict) => conflict.deploymentId === item.deploymentId)
      && !context.unresolved.some((entry) => entry.deploymentId === item.deploymentId)
      && !context.errors.some((entry) => entry.deploymentId === item.deploymentId)).length,
    conflicting: context.conflicts.length,
    unresolvedCount: context.unresolved.length,
    failed: context.errors.length,
    dryRun,
  };

  await writeAuditLog({
    actorUserId,
    action: dryRun ? 'admin.hosting_repair.audit' : 'admin.hosting_repair.run',
    entityType: deploymentId ? 'hosting_deployment' : 'hosting_relationships',
    entityId: deploymentId,
    method: request?.method || null,
    path: request?.originalUrl || request?.path || null,
    result: {
      dryRun,
      scanned: result.scanned,
      created: result.created,
      updated: result.updated,
      conflicts: result.conflicts.length,
      unresolved: result.unresolved.length,
      errors: result.errors.length,
    },
  });

  return result;
}
