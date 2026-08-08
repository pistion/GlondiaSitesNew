import * as repo from '../repositories/adminControlPlane.repository.js';

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function enrich(rows) {
  return rows.map((row) => ({ ...row, metadata: safeJson(row.metadata) }));
}

function billingFor(orders, type, ids) {
  const idSet = new Set(ids);
  return orders.filter((order) => {
    const metadata = safeJson(order.metadata);
    return order.type === type || idSet.has(order.deploymentId) || idSet.has(metadata.serviceId);
  });
}

export async function getClients() {
  const [clients, access, orders] = await Promise.all([repo.listClients(), repo.listServiceAccess(), repo.listOrders()]);
  return { clients, access, billing: orders };
}

export async function getHosting() {
  const [services, access, orders] = await Promise.all([repo.listHosting(), repo.listServiceAccess(['hosting']), repo.listOrders()]);
  const rows = enrich(services);
  return { services: rows, access, billing: billingFor(orders, 'deployment', rows.map((r) => r.id)) };
}

export async function getVps() {
  const [services, access, orders] = await Promise.all([repo.listVps(), repo.listServiceAccess(['vps']), repo.listOrders()]);
  const rows = enrich(services);
  return { services: rows, access, billing: billingFor(orders, 'vps', rows.map((r) => r.id)) };
}

export async function getCloudStorage() {
  const [services, snapshots, access, orders] = await Promise.all([
    repo.listCloudStorage(),
    repo.listCloudStorageCatalogSnapshots(),
    repo.listServiceAccess(['cloud_storage']),
    repo.listOrders(),
  ]);
  const rows = enrich(services).map(({ credentialsCiphertext, ...row }) => row);
  return {
    services: rows,
    catalogSnapshots: snapshots.map((item) => ({ ...item, payload: safeJson(item.payload) })),
    access,
    billing: billingFor(orders, 'cloud_storage', rows.map((row) => row.id)),
    warnings: rows.filter((row) => row.syncStatus === 'error' || row.adminStatus === 'review_required').map((row) => ({
      serviceId: row.id,
      type: row.syncStatus === 'error' ? 'provider_drift' : 'recovery_required',
      status: row.status,
    })),
  };
}

export async function getDomains() {
  const [services, access, orders] = await Promise.all([repo.listDomains(), repo.listServiceAccess(['domain']), repo.listOrders()]);
  const rows = enrich(services);
  return { services: rows, access, billing: billingFor(orders, 'domain', rows.map((r) => r.id)) };
}

export async function getEmail() {
  const [services, access, orders] = await Promise.all([repo.listEmail(), repo.listServiceAccess(['email']), repo.listOrders()]);
  const rows = enrich(services);
  return { services: rows, access, billing: billingFor(orders, 'email', rows.map((r) => r.id)) };
}

export async function getSecurity() {
  return repo.listSecurity();
}
