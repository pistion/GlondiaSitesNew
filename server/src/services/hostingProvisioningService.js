/**
 * hostingProvisioningService.js — canonical DB-first hosting creation flow.
 *
 * The hosting analogue of the VPS `provisionInstance` engine. It sequences the
 * ownership contract so that the local WebHostingService record is authoritative
 * and Render is only ever a provider adapter:
 *
 *   1. validate input,
 *   2. record intent — pending WebHostingService + pending ServiceAccess
 *      (one short transaction, BEFORE any provider call),
 *   3. call Render OUTSIDE the transaction,
 *   4. success  → persist providerServiceId/url/status + activate access,
 *   5. failure  → keep the local row visible as failed/review_required,
 *   6. provider success + DB failure → attempt Render cleanup, and raise an
 *      admin notification if cleanup also fails (never silent loss).
 *
 * The provider call is injected (`deps.providerCreate`) so the flow is unit
 * testable without a live Render account and so the existing deploy engine can
 * adopt it incrementally. No Prisma access here — persistence is delegated to
 * hosting.repository (which owns the short transactions).
 */

import renderApiService from './renderApiService.js';
import * as hostingRepo from '../repositories/hosting.repository.js';
import { createAdminNotification, safeNotify } from './notificationService.js';

function slugify(value) {
  return String(value || 'hosting')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'hosting';
}

// Default provider adapter: create the Render service for the requested type.
async function defaultProviderCreate(input) {
  const type = input.serviceType === 'web_service' ? 'web_service' : 'static_site';
  const created = type === 'web_service'
    ? await renderApiService.createWebService(input.render ?? input)
    : await renderApiService.createStaticSite(input.render ?? input);
  const svc = created?.service || created;
  return {
    providerServiceId: svc?.id ?? null,
    url: svc?.serviceDetails?.url || svc?.url || null,
    raw: created,
  };
}

// Default provider cleanup used for compensation when DB save fails.
async function defaultProviderDelete(providerServiceId) {
  if (!providerServiceId) return;
  await renderApiService.deleteService(providerServiceId);
}

/**
 * Provision a hosting service end-to-end.
 *
 * @param {object} input   { id?, name, slug?, serviceType?, plan?, region?, url?,
 *                           checkoutOrderId?, totalPriceCents?, currency?, metadata?, render? }
 * @param {object} actor   { organizationId, userId }
 * @param {object} [billing] { paid?: boolean }  — paid flows land in review on failure
 * @param {object} [deps]  { providerCreate, providerDelete } — injected for tests
 */
export async function createHostingService(input, actor, billing = {}, deps = {}) {
  if (!actor?.organizationId) throw Object.assign(new Error('organizationId is required.'), { status: 400 });
  if (!input?.name) throw Object.assign(new Error('name is required.'), { status: 400 });

  const providerCreate = deps.providerCreate ?? defaultProviderCreate;
  const providerDelete = deps.providerDelete ?? defaultProviderDelete;
  const paid = billing.paid === true;

  // Step 2 — record intent before any provider call (one short transaction).
  const { record } = await hostingRepo.createPendingBundle({
    service: {
      ...(input.id ? { id: input.id } : {}),
      organizationId: actor.organizationId,
      createdByUserId: actor.userId ?? null,
      checkoutOrderId: input.checkoutOrderId ?? null,
      name: input.name,
      slug: input.slug ?? slugify(input.name),
      serviceType: input.serviceType ?? 'web_service',
      plan: input.plan ?? null,
      region: input.region ?? null,
      totalPriceCents: Number(input.totalPriceCents ?? 0),
      currency: input.currency ?? 'USD',
      paymentStatus: paid ? 'paid' : 'pending',
      status: 'pending',
      metadata: input.metadata ?? {},
    },
    access: {
      userId: actor.userId ?? null,
      organizationId: actor.organizationId,
      accessStatus: 'pending',
      billingStatus: paid ? 'paid' : 'pending',
      checkoutOrderId: input.checkoutOrderId ?? null,
    },
  });

  // Step 3 — provider call, OUTSIDE any transaction.
  let provider;
  try {
    provider = await providerCreate(input);
  } catch (err) {
    // Step 5 — provider refused: keep the record visible as failed. Paid flows
    // land in review_required so a customer-impacting failure reaches an admin.
    console.error('[hosting] Provider createService failed:', err.message);
    await hostingRepo.markProvisionFailedBundle({
      serviceId: record.id,
      error: err.message,
      extraState: paid ? { status: 'review_required' } : {},
      access: paid
        ? { accessStatus: 'suspended', adminStatus: 'review_required', billingStatus: 'paid' }
        : { accessStatus: 'cancelled' },
    }).catch((e) => console.error('[hosting] Failed to persist provision failure:', e.message));
    if (paid) {
      safeNotify('hosting-paid-provision-failed', () => createAdminNotification({
        type: 'error',
        title: 'Paid hosting provisioning failed',
        message: `Hosting service ${record.id} (org ${actor.organizationId}) was paid but Render provisioning failed: ${err.message}. Marked review_required.`,
        entityType: 'web_hosting_service',
        entityId: record.id,
      }));
    }
    throw Object.assign(new Error(`Hosting provisioning failed: ${err.message}`), { status: 502 });
  }

  // Provider intentionally NOT called (e.g. Render credentials / source repo not
  // configured). The pending record + pending access are kept as-is — the local
  // row still exists and is authoritative; access is not activated because no
  // provider resource was created. Returns the pending record.
  if (provider?.skipped) {
    await hostingRepo.mergeMetadata(record.id, {
      ...(input.metadata ?? {}),
      providerSkippedReason: provider.reason ?? 'provider_not_configured',
    }).catch(() => {});
    return hostingRepo.setStatus(record.id, provider.status ?? 'prepared');
  }

  // Step 4 — persist provider result + activate access (one short transaction).
  try {
    const activated = await hostingRepo.activateProvisionedBundle({
      serviceId: record.id,
      providerFields: {
        providerServiceId: provider.providerServiceId,
        url: provider.url ?? null,
        status: provider.status ?? 'building',
        ...(provider.providerFields ?? {}),
      },
      metadata: { ...(input.metadata ?? {}), ...(provider.metadata ?? {}), renderServiceId: provider.providerServiceId },
      access: paid ? { billingStatus: 'paid' } : {},
    });
    console.log(`[hosting] Provisioned ${record.id} — Render ${provider.providerServiceId}`);
    return activated;
  } catch (dbErr) {
    // Step 6 — provider succeeded but persistence failed: compensate.
    console.error('[hosting] DB save failed after provider provision:', dbErr.message);
    await hostingRepo.updateProviderState(record.id, {
      providerServiceId: provider.providerServiceId,
      status: 'error',
    }).catch(() => {});
    let compensated = false;
    try {
      await providerDelete(provider.providerServiceId);
      compensated = true;
      console.warn(`[hosting] Compensated — deleted Render service ${provider.providerServiceId}`);
    } catch (cleanErr) {
      safeNotify('hosting-orphan-service', () => createAdminNotification({
        type: 'error',
        title: 'Orphaned Render service',
        message: `DB save failed after provisioning and cleanup also failed. Render service ${provider.providerServiceId} (hosting ${record.id}, org ${actor.organizationId}) may be live and unbilled — manual cleanup required.`,
        entityType: 'web_hosting_service',
        entityId: record.id,
      }));
    }
    const error = Object.assign(new Error('Hosting created but record save failed. Contact support.'), { status: 500 });
    error.compensated = compensated;
    throw error;
  }
}
