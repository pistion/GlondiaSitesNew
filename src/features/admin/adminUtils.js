// adminUtils.js — data aggregation helpers for admin console

/** Map user id → user object */
export function buildUsersById(users = []) {
  const map = {};
  for (const u of users) map[u.id] = u;
  return map;
}

/** Map deploymentId → order[] */
export function buildOrdersByDeploymentId(orders = []) {
  const map = {};
  for (const o of orders) {
    const key = o.deploymentId;
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(o);
  }
  return map;
}

/** Map order id → order */
export function buildOrdersById(orders = []) {
  const map = {};
  for (const o of orders) map[o.id] = o;
  return map;
}

/** Map checkoutOrderId → receipt[] */
export function buildReceiptsByOrderId(receipts = []) {
  const map = {};
  for (const r of receipts) {
    const key = r.checkoutOrderId;
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return map;
}

/** Map userId → deployment[] */
export function buildDeploymentsByUserId(deployments = []) {
  const map = {};
  for (const d of deployments) {
    const key = d.userId;
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(d);
  }
  return map;
}

/**
 * Build joined billing rows: one row per deployment, augmented with user,
 * most-recent order, and most-recent receipt.
 */
export function buildBillingRows(users = [], deployments = [], orders = [], receipts = []) {
  const usersById = buildUsersById(users);
  const ordersByDeploymentId = buildOrdersByDeploymentId(orders);
  const receiptsByOrderId = buildReceiptsByOrderId(receipts);

  return deployments.map((d) => {
    const user = usersById[d.userId] || null;
    const depOrders = (ordersByDeploymentId[d.deploymentId] || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestOrder = depOrders[0] || null;
    const latestReceipt = latestOrder
      ? ((receiptsByOrderId[latestOrder.id] || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null)
      : null;

    const totalPaid = depOrders
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + (o.totalAmountCents || 0), 0);

    return {
      deployment: d,
      user,
      latestOrder,
      latestReceipt,
      allOrders: depOrders,
      totalPaid,
      currency: latestOrder?.currency || d.priceCurrency || 'PGK',
    };
  });
}

/**
 * Build hosting rows: one row per deployment with user + most-recent order info.
 */
export function buildHostingRows(users = [], deployments = [], orders = []) {
  const usersById = buildUsersById(users);
  const ordersByDeploymentId = buildOrdersByDeploymentId(orders);

  return deployments.map((d) => {
    const user = usersById[d.userId] || null;
    const depOrders = (ordersByDeploymentId[d.deploymentId] || [])
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestOrder = depOrders[0] || null;

    return { deployment: d, user, latestOrder };
  });
}

const STATUS_FILTERS = {
  all: () => true,
  active: (d) => d.status === 'live' || d.status === 'active',
  pending: (d) => d.status === 'building' || d.status === 'pending',
  failed: (d) => d.status === 'failed',
  suspended: (d) => d.status === 'suspended' || d.status === 'overdue_suspended',
  free: (d) => d.renderPlan === 'free',
  paid: (d) => d.paymentStatus === 'paid',
  dns: (d) => {
    const s = String(d.status || '').toLowerCase();
    return s.includes('dns') || s.includes('domain');
  },
};

/** Filter deployments array by a named filter key. */
export function filterDeployments(deployments = [], filter = 'all') {
  const fn = STATUS_FILTERS[filter] || STATUS_FILTERS.all;
  return deployments.filter(fn);
}
