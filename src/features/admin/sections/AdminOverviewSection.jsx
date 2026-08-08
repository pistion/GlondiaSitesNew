// AdminOverviewSection.jsx — platform-wide stat cards
import React from 'react';
import { money, StatusPill } from '../adminStatus.jsx';

function StatCard({ label, value, sub }) {
  return (
    <div className="admin-stat-card card">
      <div className="page-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 1, color: 'var(--text)' }}>
        {value ?? 0}
      </div>
      {sub && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SummaryBlock({ title, children }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>{title}</h3>
      {children}
    </div>
  );
}

export function AdminOverviewSection({ overview, deployments, orders, receipts, users }) {
  if (!overview) return <div className="card" style={{ padding: 20 }}>No overview data.</div>;

  const ov = overview;

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => (u.accountStatus || 'active') === 'active').length;
  const suspendedUsers = users.filter((u) => ['suspended', 'disabled'].includes(u.accountStatus)).length;

  const totalDep = deployments.length;
  const activeDep = deployments.filter((d) => d.status === 'live' || d.status === 'active').length;
  const suspendedDep = deployments.filter((d) => d.status === 'suspended' || d.status === 'overdue_suspended').length;
  const failedDep = deployments.filter((d) => d.status === 'failed').length;
  const freeDep = deployments.filter((d) => d.renderPlan === 'free').length;
  const paidDep = deployments.filter((d) => d.paymentStatus === 'paid').length;

  const pendingReceipts = receipts.filter((r) => r.status === 'pending').length;
  const paidRevCents = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + (o.totalAmountCents || 0), 0);
  const pendingBills = orders.filter((o) => o.status === 'pending' || o.status === 'payment_uploaded').length;
  const expiredBills = orders.filter((o) => o.status === 'expired' || o.status === 'payment_expired').length;


  const depByPayment = deployments.reduce((acc, d) => {
    const k = d.paymentStatus || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const ordersByStatus = orders.reduce((acc, o) => {
    const k = o.status || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="admin-stat-grid">
        <StatCard label="Total users" value={totalUsers} />
        <StatCard label="Active users" value={activeUsers} />
        <StatCard label="Suspended users" value={suspendedUsers} />
        <StatCard label="Total sites" value={totalDep} />
        <StatCard label="Active hosting" value={activeDep} />
        <StatCard label="Suspended hosting" value={suspendedDep} />
        <StatCard label="Failed hosting" value={failedDep} />
        <StatCard label="Free hosting" value={freeDep} />
        <StatCard label="Paid hosting" value={paidDep} />
        <StatCard label="Pending receipts" value={pendingReceipts} />
        <StatCard label="Paid revenue" value={ov.revenue?.paidDisplay || money(paidRevCents)} />
        <StatCard label="Pending bills" value={pendingBills} />
        <StatCard label="Expired bills" value={expiredBills} />
        <StatCard label="Est. provider cost" value={ov.providerCost?.display || '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 14 }}>
        <SummaryBlock title="Deployments by payment status">
          {Object.entries(depByPayment).map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <StatusPill value={k} />
              <strong>{v}</strong>
            </div>
          ))}
        </SummaryBlock>

        <SummaryBlock title="Orders by status">
          {Object.entries(ordersByStatus).map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <StatusPill value={k} />
              <strong>{v}</strong>
            </div>
          ))}
        </SummaryBlock>

        {ov.platformMargin && (
          <SummaryBlock title="Platform margin">
            <div className="muted" style={{ fontSize: 13 }}>
              Revenue {ov.revenue?.paidDisplay} · Cost {ov.providerCost?.display}
            </div>
            {ov.platformMargin.note && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{ov.platformMargin.note}</div>
            )}
          </SummaryBlock>
        )}
      </div>
    </div>
  );
}
