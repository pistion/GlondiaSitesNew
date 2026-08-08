/**
 * vpsDto.js — response contracts for the VPS feature.
 *
 * Customer DTO: what an ordinary customer may see. Never includes provider
 * base cost, markup, provider/PayPal identifiers, raw metadata, or the root
 * password (credentials go through the protected reveal endpoint).
 *
 * Admin DTO: full internal view for admin/support tooling.
 *
 * Raw Prisma records must never leave the service layer — everything returned
 * to a controller goes through one of these.
 */

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export function isDummyRecord(record) {
  return String(record?.providerInstanceId || '').startsWith('dummy-vultr-')
    || safeJson(record?.metadata)?.testMode === true;
}

/** Customer-safe view of a VpsService record. */
export function toCustomerVpsDto(r) {
  const isDummy = isDummyRecord(r);
  const meta = safeJson(r.metadata);
  return {
    id:              r.id,
    label:           r.label,
    hostname:        r.hostname,
    region:          r.region,
    plan:            r.plan,
    osId:            r.osId,
    osName:          r.osName ?? null,
    status:          r.status,
    mainIp:          r.mainIp ?? null,
    vcpuCount:       r.vcpuCount ?? null,
    ramMb:           r.ramMb ?? null,
    diskGb:          r.diskGb ?? null,
    // Customer price only — provider cost and margin stay internal.
    totalPriceCents: r.totalPriceCents,
    currency:        r.currency || 'USD',
    paymentStatus:   r.paymentStatus,
    connectionUsername: meta.connectionUsername || 'root',
    backupsEnabled:  Boolean(meta.backupsEnabled),
    backupSchedule:  meta.backupSchedule ?? null,
    ddosProtection:  Boolean(meta.ddosProtectionEnabled),
    ipv6Enabled:     Boolean(meta.ipv6Enabled),
    userDataPresent: Boolean(meta.userDataPresent),
    tags:            Array.isArray(meta.tags) ? meta.tags : [],
    sshKeyAttached:  Boolean(meta.sshKeyId),
    bandwidthUsedGb: Number(meta.bandwidthUsedGb ?? 0),
    bandwidthUpdatedAt: meta.bandwidthUpdatedAt ?? null,
    providerSyncedAt: meta.providerSyncedAt ?? null,
    testMode:        isDummy,
    createdAt:       r.createdAt,
    updatedAt:       r.updatedAt,
  };
}

/** Full internal view — admin/support surfaces only. */
export function toAdminVpsDto(r) {
  const meta = safeJson(r.metadata);
  return {
    ...toCustomerVpsDto(r),
    organizationId:     r.organizationId,
    createdByUserId:    r.createdByUserId ?? null,
    checkoutOrderId:    r.checkoutOrderId ?? null,
    provider:           r.provider,
    providerInstanceId: r.providerInstanceId,
    monthlyCostCents:   r.monthlyCostCents,
    markupPercent:      r.markupPercent,
    markupAmountCents:  r.markupAmountCents,
    paypalOrderId:      r.paypalOrderId ?? null,
    paypalCaptureId:    r.paypalCaptureId ?? null,
    deletedAt:          r.deletedAt ?? null,
    metadata:           meta,
  };
}

/**
 * Connection credentials for the protected reveal endpoint. Returned only
 * behind auth + ownership + active ServiceAccess, never in list/get payloads.
 */
export function toCredentialsDto(r) {
  const meta = safeJson(r.metadata);
  const isDummy = isDummyRecord(r);
  return {
    username: meta.connectionUsername || 'root',
    password: meta.connectionPassword || (isDummy ? `Glo-test-${String(r.id).slice(0, 8)}` : null),
    host:     r.mainIp ?? null,
  };
}
