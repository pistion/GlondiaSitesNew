// AdminBillingTabs.jsx — billing section with sub-tabs
import React, { useState } from 'react';
import { ICN } from '../../../icons';
import { money, when, StatusPill } from '../adminStatus.jsx';
import { buildBillingRows, buildUsersById } from '../adminUtils.js';
import {
  approveReceipt,
  rejectReceipt,
  viewReceipt,
  downloadReceipt,
  markDeploymentPaid,
  renewDeploymentManually,
  deleteOrder,
} from '../../../api/admin.js';

const BILLING_TABS = [
  { key: 'overview',         label: 'Overview' },
  { key: 'paid',             label: 'Paid' },
  { key: 'unpaid',           label: 'Unpaid' },
  { key: 'pending_receipts', label: 'Pending Receipts' },
  { key: 'failed',           label: 'Failed/Expired' },
  { key: 'subscriptions',    label: 'Subscriptions' },
  { key: 'orders',           label: 'Orders' },
  { key: 'receipts',         label: 'All Receipts' },
];

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card card">
      <div className="page-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 26, lineHeight: 1 }}>{value ?? 0}</div>
    </div>
  );
}

export function AdminBillingTabs({ users, deployments, orders, receipts, busyId, onAct, onRefresh }) {
  const [activeTab, setActiveTab] = useState('overview');

  const allRows = buildBillingRows(users, deployments, orders, receipts);
  const usersById = buildUsersById(users);

  const tabRows = {
    paid:             allRows.filter((r) => r.latestOrder?.status === 'paid'),
    unpaid:           allRows.filter((r) => r.latestOrder && r.latestOrder.status !== 'paid'),
    pending_receipts: allRows.filter((r) => r.latestReceipt?.status === 'pending'),
    failed:           allRows.filter((r) => {
      const s = r.latestOrder?.status || '';
      return s === 'expired' || s === 'payment_expired';
    }),
    subscriptions:    allRows.filter((r) => {
      const s = r.deployment.subscriptionStatus;
      return s && s !== 'cancelled';
    }),
    orders:           allRows.filter((r) => r.latestOrder),
    receipts:         allRows.filter((r) => r.latestReceipt),
  };

  // Overview stats
  const paidRevenue = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + (o.totalAmountCents || 0), 0);
  const pendingRevenue = orders.filter((o) => o.status === 'pending' || o.status === 'payment_uploaded').reduce((s, o) => s + (o.totalAmountCents || 0), 0);
  const unpaidBills = orders.filter((o) => o.status !== 'paid' && o.status !== 'expired' && o.status !== 'payment_expired').length;
  const expiredBills = orders.filter((o) => o.status === 'expired' || o.status === 'payment_expired').length;
  const pendingReceipts = receipts.filter((r) => r.status === 'pending').length;
  const settledPayments = orders.filter((o) => o.status === 'paid').length;
  const currency = orders[0]?.currency || 'USD';

  return (
    <div>
      <div className="admin-inner-tabs">
        {BILLING_TABS.map((t) => (
          <button
            key={t.key}
            className={activeTab === t.key ? 'active' : ''}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {t.key === 'pending_receipts' && pendingReceipts > 0 && (
              <span style={{ marginLeft: 5, background: 'var(--danger)', color: '#fff', borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>
                {pendingReceipts}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div>
          <div className="admin-stat-grid" style={{ marginBottom: 14 }}>
            <StatCard label="Total paid revenue" value={money(paidRevenue, currency)} />
            <StatCard label="Pending revenue" value={money(pendingRevenue, currency)} />
            <StatCard label="Unpaid bills" value={unpaidBills} />
            <StatCard label="Expired bills" value={expiredBills} />
            <StatCard label="Pending receipts" value={pendingReceipts} />
            <StatCard label="Settled payments" value={settledPayments} />
          </div>
        </div>
      )}

      {activeTab !== 'overview' && (
        <BillingTable
          rows={tabRows[activeTab] || []}
          busyId={busyId}
          onAct={onAct}
          showReceipts={activeTab === 'receipts' || activeTab === 'pending_receipts'}
        />
      )}
    </div>
  );
}

function BillingTable({ rows, busyId, onAct, showReceipts }) {
  return (
    <div className="card card-flush">
      <div className="admin-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th>Site</th>
              <th>Order ID</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>Order Status</th>
              <th>Payment</th>
              <th>Receipt</th>
              <th>Due Date</th>
              <th>Paid Date</th>
              <th>Next Billing</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={13} className="muted" style={{ padding: 20 }}>No records.</td></tr>
            )}
            {rows.map(({ deployment: d, user, latestOrder: o, latestReceipt: r }) => {
              const depId = d.deploymentId;
              return (
                <tr key={depId}>
                  <td style={{ fontSize: 12 }}>{user?.name || '—'}</td>
                  <td style={{ fontSize: 12 }}>
                    <span title={user?.email}>{(user?.email || d.userId || '—').slice(0, 22)}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{d.serviceName || '—'}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{depId?.slice(0, 10)}</div>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{o?.id?.slice(0, 8) || '—'}</td>
                  <td style={{ fontSize: 12 }}>{o ? money(o.totalAmountCents, o.currency) : '—'}</td>
                  <td style={{ fontSize: 12 }}>{o?.currency || d.priceCurrency || '—'}</td>
                  <td>{o ? <StatusPill value={o.status} /> : <span className="muted">—</span>}</td>
                  <td><StatusPill value={d.paymentStatus} /></td>
                  <td>{r ? <StatusPill value={r.status} /> : <span className="muted">—</span>}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(d.billingDueAt)}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(o?.paidAt)}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(d.nextBillingAt)}</td>
                  <td>
                    <div className="admin-action-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {r && (
                          <>
                            <button className="btn btn-sm btn-outline" disabled={busyId === r.id}
                              onClick={() => onAct(r.id, () => viewReceipt(r.id), 'View receipt', null, true)}>
                              View
                            </button>
                            <button className="btn btn-sm btn-outline" disabled={busyId === r.id}
                              onClick={() => onAct(r.id, () => downloadReceipt(r.id, r.fileName), 'Download receipt', null, true)}>
                              Download
                            </button>
                            {r.status === 'pending' && (
                              <>
                                <button className="btn btn-sm btn-primary" disabled={busyId === r.id}
                                  onClick={() => onAct(r.id, () => approveReceipt(r.id), 'Approve receipt')}>
                                  Approve
                                </button>
                                <button className="btn btn-sm btn-outline" disabled={busyId === r.id}
                                  onClick={() => onAct(r.id, () => rejectReceipt(r.id, 'Rejected by admin'), 'Reject receipt')}>
                                  Reject
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {d.paymentStatus !== 'paid' && (
                          <button className="btn btn-sm btn-outline" disabled={busyId === depId}
                            onClick={() => onAct(depId, () => markDeploymentPaid(depId), 'Mark paid')}>
                            Mark paid
                          </button>
                        )}
                        <button className="btn btn-sm btn-outline" disabled={busyId === depId}
                          onClick={() => onAct(depId, () => renewDeploymentManually(depId), 'Renew')}>
                          Renew
                        </button>
                        {o && (
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            disabled={busyId === o.id}
                            onClick={() => {
                              if (window.confirm(`Delete order ${o.id.slice(0, 8)}? This also deletes linked receipts.`)) {
                                onAct(o.id, () => deleteOrder(o.id), 'Delete order');
                              }
                            }}
                          >
                            <ICN.Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
