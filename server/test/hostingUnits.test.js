/**
 * Pure unit tests for the hosting DB-first ownership helpers. No I/O — these
 * cover the reconciliation diff, the DB-first/legacy merge, the DB summary
 * mapper, and the admin drift warnings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffRenderState } from '../src/services/hostingSyncService.js';
import { mergeHostingSources, toDbHostingSummary } from '../src/services/hostingReadService.js';
import { computeServiceWarnings } from '../src/services/serviceDriftWarnings.js';

// ─── hostingSyncService.diffRenderState ───────────────────────────────────────

test('diffRenderState maps a live deploy + url change', () => {
  const record = { status: 'building', url: null };
  const snapshot = { service: { url: 'https://a.example' }, latestDeploy: { status: 'live' } };
  assert.deepEqual(diffRenderState(record, snapshot), { status: 'live', url: 'https://a.example' });
});

test('diffRenderState treats a suspended service as suspended', () => {
  const record = { status: 'live', url: 'https://a.example' };
  const snapshot = { service: { suspended: 'suspended', url: 'https://a.example' }, latestDeploy: { status: 'live' } };
  assert.deepEqual(diffRenderState(record, snapshot), { status: 'suspended' });
});

test('diffRenderState returns no change when nothing moved', () => {
  const record = { status: 'live', url: 'https://a.example' };
  const snapshot = { service: { url: 'https://a.example' }, latestDeploy: { status: 'live' } };
  assert.deepEqual(diffRenderState(record, snapshot), {});
});

test('diffRenderState leaves status untouched on an unknown provider status', () => {
  const record = { status: 'live', url: 'https://a.example' };
  const snapshot = { service: { url: 'https://a.example' }, latestDeploy: { status: 'something_new' } };
  assert.deepEqual(diffRenderState(record, snapshot), {});
});

// ─── hostingReadService.toDbHostingSummary ────────────────────────────────────

test('toDbHostingSummary maps a WebHostingService row and falls back to metadata renderServiceId', () => {
  const row = {
    id: 'dep_1', providerServiceId: null, name: 'Site', serviceType: 'web_service',
    status: 'live', paymentStatus: 'paid', url: 'https://s.example', provider: 'render',
    plan: 'starter', metadata: JSON.stringify({ renderServiceId: 'srv_meta' }),
    updatedAt: 't1', createdAt: 't0',
  };
  const dto = toDbHostingSummary(row);
  assert.equal(dto.deploymentId, 'dep_1');
  assert.equal(dto.renderServiceId, 'srv_meta');
  assert.equal(dto.source, 'relational');
  assert.equal(dto.liveUrl, 'https://s.example');
});

test('toDbHostingSummary tolerates invalid metadata JSON', () => {
  const dto = toDbHostingSummary({ id: 'x', name: 'X', metadata: '{not json' });
  assert.equal(dto.deploymentId, 'x');
  assert.equal(dto.renderServiceId, null);
});

// ─── hostingReadService.mergeHostingSources ───────────────────────────────────

test('mergeHostingSources: DB is authoritative on conflict, legacy detail preserved', () => {
  const db = [{ deploymentId: 'd1', serviceId: 'srv1', renderServiceId: 'srv1', status: 'live', liveUrl: null, source: 'relational' }];
  const legacy = [{ deploymentId: 'd1', renderServiceId: 'srv1', status: 'building', liveUrl: 'https://legacy.example', serviceName: 'Legacy' }];
  const merged = mergeHostingSources(db, legacy);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'live', 'DB status wins');
  assert.equal(merged[0].liveUrl, 'https://legacy.example', 'legacy url preserved when DB has none');
  assert.equal(merged[0].serviceName, 'Legacy', 'legacy detail layered under DB');
  assert.equal(merged[0].source, 'relational');
  assert.equal(merged[0].drift, null);
});

test('mergeHostingSources: legacy-only row flagged missing_in_db, db-only flagged missing_in_legacy', () => {
  const db = [{ deploymentId: 'd3', status: 'live', source: 'relational' }];
  const legacy = [{ deploymentId: 'd2', status: 'live', serviceName: 'Orphan' }];
  const merged = mergeHostingSources(db, legacy);
  const byId = Object.fromEntries(merged.map((m) => [m.deploymentId, m]));
  assert.equal(byId.d2.source, 'legacy');
  assert.equal(byId.d2.drift, 'missing_in_db');
  assert.equal(byId.d3.drift, 'missing_in_legacy');
});

test('mergeHostingSources matches by renderServiceId when deploymentId differs', () => {
  const db = [{ deploymentId: 'canonical', renderServiceId: 'srv9', status: 'live', source: 'relational' }];
  const legacy = [{ deploymentId: 'legacy-id', renderServiceId: 'srv9', status: 'building' }];
  const merged = mergeHostingSources(db, legacy);
  assert.equal(merged.length, 1, 'matched by renderServiceId — not duplicated');
  assert.equal(merged[0].status, 'live');
});

// ─── serviceDriftWarnings.computeServiceWarnings ──────────────────────────────

test('computeServiceWarnings flags paid-but-inactive and active-but-unpaid', () => {
  const services = [
    { id: 'a', serviceType: 'hosting', serviceName: 'A', accessStatus: 'suspended', billingStatus: 'paid' },
    { id: 'b', serviceType: 'hosting', serviceName: 'B', accessStatus: 'active', billingStatus: 'failed' },
    { id: 'c', serviceType: 'hosting', serviceName: 'C', accessStatus: 'active', billingStatus: 'paid' },
  ];
  const codes = computeServiceWarnings(services).map((w) => `${w.code}:${w.message.split(' ')[1]}`);
  assert.ok(codes.includes('PAYMENT_ACCESS_MISMATCH:A'));
  assert.ok(codes.includes('PAYMENT_ACCESS_MISMATCH:B'));
  assert.equal(codes.filter((c) => c.startsWith('PAYMENT_ACCESS_MISMATCH')).length, 2, 'C (active+paid) is clean');
});

test('computeServiceWarnings flags PROVIDER_MISSING', () => {
  const services = [{ id: 'a', serviceType: 'vps', serviceName: 'A', status: 'provider_missing' }];
  const w = computeServiceWarnings(services);
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'PROVIDER_MISSING');
});

test('computeServiceWarnings flags owner-scope mismatch only when org is outside scope', () => {
  const services = [
    { id: 'a', serviceType: 'vps', serviceName: 'A', details: { organizationId: 'org-out' } },
    { id: 'b', serviceType: 'vps', serviceName: 'B', details: { organizationId: 'org-in' } },
  ];
  const w = computeServiceWarnings(services, { organizationIds: ['org-in'] });
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'SERVICE_OWNER_SCOPE_MISMATCH');
  assert.match(w[0].message, /org-out/);
});
