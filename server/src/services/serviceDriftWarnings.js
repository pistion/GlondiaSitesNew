/**
 * serviceDriftWarnings.js — pure drift/consistency checks for admin oversight.
 *
 * Operates on the already-resolved AdminService DTOs (see
 * adminCustomerOversightService.resolveCustomerServices) — no I/O, no Prisma —
 * so it is fully unit-testable. Admin views SHOW every record; these warnings
 * annotate them without hiding anything (customers only ever see their own
 * owned services elsewhere).
 *
 * Codes (Phase 10):
 *   PAYMENT_ACCESS_MISMATCH   paid billing but inactive access, or active access
 *                             with failed/overdue/cancelled billing
 *   PROVIDER_MISSING          local record points at a provider resource that
 *                             reconciliation could not find
 *   SERVICE_OWNER_SCOPE_MISMATCH  service org/user is outside the customer scope
 *
 * (MISSING_SERVICE_ACCESS, ORPHAN_SERVICE_ACCESS and HOSTING_DUAL_SOURCE_MISMATCH
 * are emitted inline during resolution and are not duplicated here.)
 */

const BILLING_OK = new Set(['paid', 'trial', 'free']);
const BILLING_BAD = new Set(['failed', 'overdue', 'cancelled']);
const ACCESS_LIVE = new Set(['active', 'pending']);
const PROVIDER_MISSING_STATES = new Set(['provider_missing', 'record_missing']);

/**
 * @param {Array} services  normalized AdminService DTOs
 * @param {{ userId?: string, organizationIds?: string[] }} [scope]
 * @returns {Array<{ section: string, code: string, message: string }>}
 */
export function computeServiceWarnings(services = [], scope = {}) {
  const warnings = [];
  const orgIds = new Set((scope.organizationIds ?? []).filter(Boolean));

  for (const s of services) {
    const label = `${s.serviceType} ${s.serviceName ?? s.id} (${s.id})`;

    // Payment ↔ access consistency.
    if (s.accessStatus != null || s.billingStatus != null) {
      const paidButInactive = BILLING_OK.has(s.billingStatus) && s.accessStatus && !ACCESS_LIVE.has(s.accessStatus);
      const activeButUnpaid = s.accessStatus === 'active' && BILLING_BAD.has(s.billingStatus);
      if (paidButInactive) {
        warnings.push({ section: 'services', code: 'PAYMENT_ACCESS_MISMATCH', message: `${label}: billing is "${s.billingStatus}" but access is "${s.accessStatus}".` });
      } else if (activeButUnpaid) {
        warnings.push({ section: 'services', code: 'PAYMENT_ACCESS_MISMATCH', message: `${label}: access is active but billing is "${s.billingStatus}".` });
      }
    }

    // Provider reconciliation flagged the resource as gone.
    if (PROVIDER_MISSING_STATES.has(s.status) || PROVIDER_MISSING_STATES.has(s.providerStatus)) {
      warnings.push({ section: 'services', code: 'PROVIDER_MISSING', message: `${label}: provider resource not found during reconciliation. Local record retained.` });
    }

    // Owner scope: the service's org must be within the customer's ownership set
    // (only checked when we actually have a scope and the DTO carries an org).
    if (orgIds.size && s.details?.organizationId && !orgIds.has(s.details.organizationId)) {
      warnings.push({ section: 'services', code: 'SERVICE_OWNER_SCOPE_MISMATCH', message: `${label}: organization ${s.details.organizationId} is outside the customer ownership scope.` });
    }
  }

  return warnings;
}

export default { computeServiceWarnings };
