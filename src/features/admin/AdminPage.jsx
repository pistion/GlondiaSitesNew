// AdminPage.jsx — simple admin surface for deploy-first K100 billing.
import React from 'react';
import { ICN } from '../../icons';
import {
  getAdminOverview,
  listAdminUsers,
  listAdminDeployments,
  listAdminOrders,
  listAdminReceipts,
  approveReceipt,
  rejectReceipt,
  markDeploymentPaid,
  deleteDeployment,
} from '../../api/admin.js';

const { useState, useEffect, useCallback } = React;

const TABS = [
  { key: 'overview',    label: 'Overview' },
  { key: 'receipts',    label: 'Receipts' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'orders',      label: 'Orders' },
  { key: 'users',       label: 'Users' },
];

function money(cents = 0, currency = 'PGK') {
  return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
}
function when(value) {
  return value ? new Date(value).toLocaleString() : '—';
}
function StatusPill({ value }) {
  const v = String(value || '').toLowerCase();
  const tone = ['paid', 'approved', 'live'].includes(v) ? 'success'
    : ['pending', 'payment_uploaded', 'building'].includes(v) ? 'warn'
    : ['expired', 'rejected', 'payment_expired', 'deleted', 'overdue_suspended', 'suspended'].includes(v) ? 'danger'
    : 'info';
  const colors = {
    success: ['var(--accent-soft)', 'var(--accent)'],
    warn: ['#fdf0d5', '#b8860b'],
    danger: ['#fde2e1', '#c0392b'],
    info: ['var(--bg-deep)', 'var(--text-muted)'],
  }[tone];
  return <span style={{ background: colors[0], color: colors[1], padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{value || '—'}</span>;
}

export function AdminPage() {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ov, us, dep, ord, rec] = await Promise.all([
        getAdminOverview(), listAdminUsers(), listAdminDeployments(), listAdminOrders(), listAdminReceipts(),
      ]);
      setOverview(ov); setUsers(us || []); setDeployments(dep || []); setOrders(ord || []); setReceipts(rec || []);
    } catch (err) {
      setError(err.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const act = async (id, fn, label) => {
    setBusyId(id); setNotice('');
    try {
      await fn();
      setNotice(`${label} done.`);
      await refresh();
    } catch (err) {
      setError(err.message || `${label} failed.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Administration</div>
          <h1>Admin — billing &amp; deployments</h1>
          <p className="sub">Review users, deployments, K100 orders and bank receipts. Approve payments or remove unpaid deployments.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline" onClick={refresh} disabled={loading}>
            <ICN.RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="card" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--danger)' }}>{error}</div>}
      {notice && <div className="card" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--accent)' }}>{notice}</div>}

      <div className="tabs" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'receipts' && overview?.receipts?.pending ? ` (${overview.receipts.pending})` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="card" style={{ padding: 20 }}>Loading…</div>}

      {!loading && tab === 'overview' && overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <StatCard label="Users" value={overview.users} />
          <StatCard label="Deployments" value={overview.deployments?.total} />
          <StatCard label="Pending receipts" value={overview.receipts?.pending} />
          <StatCard label="Revenue (paid)" value={overview.revenue?.paidDisplay} />
          <StatCard label="Orders" value={overview.orders?.total} />
          <StatCard label="Cleanup jobs" value={overview.cleanupJobs} />
          <div className="card" style={{ gridColumn: '1 / -1', padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Deployments by payment status</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(overview.deployments?.byPaymentStatus || {}).map(([k, v]) => (
                <span key={k} className="row" style={{ gap: 6 }}><StatusPill value={k} /> × {v}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'receipts' && (
        <Table cols={['Created', 'User', 'Order', 'Amount', 'File', 'Status', 'Actions']}>
          {receipts.map((r) => (
            <tr key={r.id}>
              <td>{when(r.createdAt)}</td>
              <td className="mono">{r.userId || '—'}</td>
              <td className="mono">{r.checkoutOrderId?.slice(0, 8)}</td>
              <td>{money(r.amountCents, r.currency)}</td>
              <td className="mono" title={r.fileName}>{r.fileName?.slice(0, 22)}</td>
              <td><StatusPill value={r.status} /></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.status === 'pending' ? (
                  <>
                    <button className="btn btn-sm btn-primary" disabled={busyId === r.id}
                      onClick={() => act(r.id, () => approveReceipt(r.id), 'Approve receipt')}>Approve</button>{' '}
                    <button className="btn btn-sm btn-outline" disabled={busyId === r.id}
                      onClick={() => act(r.id, () => rejectReceipt(r.id, 'Rejected by admin'), 'Reject receipt')}>Reject</button>
                  </>
                ) : <span className="muted">{r.reviewedAt ? when(r.reviewedAt) : '—'}</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === 'deployments' && (
        <Table cols={['Created', 'Service', 'User', 'Status', 'Payment', 'Due', 'Paid', 'Actions']}>
          {deployments.map((d) => (
            <tr key={d.deploymentId}>
              <td>{when(d.createdAt)}</td>
              <td>{d.serviceName || '—'}<div className="mono muted" style={{ fontSize: 11 }}>{d.deploymentId?.slice(0, 12)}</div></td>
              <td className="mono">{d.userId || '—'}</td>
              <td><StatusPill value={d.status} /></td>
              <td><StatusPill value={d.paymentStatus} /></td>
              <td style={{ fontSize: 12 }}>{when(d.billingDueAt)}</td>
              <td style={{ fontSize: 12 }}>{when(d.paidAt)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {d.paymentStatus !== 'paid' && (
                  <button className="btn btn-sm btn-primary" disabled={busyId === d.deploymentId}
                    onClick={() => act(d.deploymentId, () => markDeploymentPaid(d.deploymentId), 'Mark paid')}>Mark paid</button>
                )}{' '}
                <button className="btn btn-sm btn-outline" disabled={busyId === d.deploymentId}
                  onClick={() => act(d.deploymentId, () => deleteDeployment(d.deploymentId), 'Delete deployment')}>Delete</button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === 'orders' && (
        <Table cols={['Created', 'Order', 'User', 'Deployment', 'Amount', 'Status', 'Paid at']}>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{when(o.createdAt)}</td>
              <td className="mono">{o.id.slice(0, 8)}</td>
              <td className="mono">{o.userId || '—'}</td>
              <td className="mono">{o.deploymentId?.slice(0, 12) || '—'}</td>
              <td>{money(o.totalAmountCents, o.currency)}</td>
              <td><StatusPill value={o.status} /></td>
              <td style={{ fontSize: 12 }}>{when(o.paidAt)}</td>
            </tr>
          ))}
        </Table>
      )}

      {!loading && tab === 'users' && (
        <Table cols={['Created', 'Email', 'Name', 'Role', 'Plan']}>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{when(u.createdAt)}</td>
              <td>{u.email}</td>
              <td>{u.name || '—'}</td>
              <td><StatusPill value={u.role} /></td>
              <td className="mono">{u.planId}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="page-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1 }}>{value ?? 0}</div>
    </div>
  );
}

function Table({ cols, children }) {
  const rows = React.Children.toArray(children);
  return (
    <div className="card card-flush">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows : <tr><td colSpan={cols.length} style={{ padding: 18 }} className="muted">No records.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default AdminPage;
