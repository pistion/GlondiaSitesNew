// AdminPage.jsx — restructured admin console with section components
import React from 'react';
import { ICN } from '../../icons';
import { getStoredAuth } from '../../api/auth.js';
import {
  getAdminOverview,
  listAdminUsers,
  listAdminDeployments,
  listAdminVpsServices,
  listAdminOrders,
  listAdminReceipts,
  getAdminActivity,
  getAdminConfigStatus,
} from '../../api/admin.js';
import { getAdminTicketsUnreadCount } from '../../api/adminTickets.js';

import { AdminOverviewSection }  from './sections/AdminOverviewSection.jsx';
import { AdminCustomersSection } from './sections/AdminCustomersSection.jsx';
import { AdminCustomerDetail } from './sections/AdminCustomerDetail.jsx';
import { suspendUser as apiSuspendUser, reactivateUser as apiReactivateUser } from '../../api/admin.js';
import { AdminHostingTabs }      from './hosting/AdminHostingTabs.jsx';
import { AdminBillingTabs }      from './billing/AdminBillingTabs.jsx';
import { AdminActivitySection }  from './sections/AdminActivitySection.jsx';
import { AdminSettingsSection }  from './sections/AdminSettingsSection.jsx';
import { AdminTicketsSection }   from './sections/AdminTicketsSection.jsx';

const { useState, useEffect, useCallback } = React;

const TABS = [
  { key: 'overview',   label: 'Overview',   icon: ICN.BarChart2 },
  { key: 'customers',  label: 'Customers',  icon: ICN.Users },
  { key: 'hosting',    label: 'Hosting',    icon: ICN.Server },
  { key: 'billing',    label: 'Billing',    icon: ICN.CreditCard },
  { key: 'tickets',    label: 'Tickets',    icon: ICN.MessageSquare },
  { key: 'activity',   label: 'Activity',   icon: ICN.Activity },
  { key: 'settings',   label: 'Settings',   icon: ICN.Settings },
];

export function AdminPage() {
  // Role guard — read from stored auth
  const storedAuth = getStoredAuth();
  const currentUser = storedAuth?.user;
  const isAdmin = currentUser?.role === 'admin';

  const [tab, setTab] = useState('overview');
  const [overview, setOverview]       = useState(null);
  const [users, setUsers]             = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [vpsServices, setVpsServices] = useState([]);
  const [orders, setOrders]           = useState([]);
  const [receipts, setReceipts]       = useState([]);
  const [activity, setActivity]       = useState([]);
  const [configStatus, setConfigStatus] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [busyId, setBusyId]           = useState(null);
  const [notice, setNotice]           = useState('');
  const [detailUserId, setDetailUserId] = useState(null);
  const [ticketUnreadCount, setTicketUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ov, us, dep, vps, ord, rec, act, cfg] = await Promise.all([
        getAdminOverview(),
        listAdminUsers(),
        listAdminDeployments(),
        listAdminVpsServices(),
        listAdminOrders(),
        listAdminReceipts(),
        getAdminActivity({ limit: 200 }).catch(() => []),
        getAdminConfigStatus().catch(() => null),
      ]);
      setOverview(ov);
      setUsers(us || []);
      setDeployments(dep || []);
      setVpsServices(vps || []);
      setOrders(ord || []);
      setReceipts(rec || []);
      setActivity(act || []);
      setConfigStatus(cfg);
      getAdminTicketsUnreadCount()
        .then((r) => setTicketUnreadCount(Number(r?.count) || 0))
        .catch(() => setTicketUnreadCount(0));
    } catch (err) {
      setError(err.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  /**
   * Generic action helper.
   * @param {string} id         - busy key (row id, deployment id, etc.)
   * @param {function} fn       - async API call
   * @param {string} label      - human label for notice/error
   * @param {function|null} after - optional optimistic update
   * @param {boolean} fileOnly  - if true, skip refresh (file-open actions)
   */
  const act = async (id, fn, label, after = null, fileOnly = false) => {
    setBusyId(id); setNotice(''); setError(null);
    try {
      const result = await fn();
      after?.(result);
      setNotice(`${label} done.`);
      if (!fileOnly) await refresh();
    } catch (err) {
      setError(err.message || `${label} failed.`);
    } finally {
      setBusyId(null);
    }
  };

  // Access denied guard
  if (!isAdmin) {
    return (
      <div className="card" style={{ padding: '40px 24px', maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
        <ICN.Shield size={40} style={{ color: 'var(--danger)', marginBottom: 16 }} />
        <h2 style={{ margin: '0 0 8px' }}>Access denied</h2>
        <p className="muted" style={{ margin: 0 }}>
          You do not have permission to access the admin console.
          Only users with the <strong>admin</strong> role can view this page.
        </p>
      </div>
    );
  }

  const pendingReceiptCount = receipts.filter((r) => r.status === 'pending').length;

  return (
    <div className="admin-console">
      {/* Admin direction banner — primary admin work belongs at /dashboard */}
      <div className="card" style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--surface-2, #f8f9fa)', borderLeft: '3px solid var(--accent)' }}>
        <div style={{ fontSize: 13 }}>
          <strong>GlondiaSites Admin Dashboard</strong> is the primary admin control center.
          {' '}This in-app console is a legacy surface and will be migrated.
        </div>
        <a href="/dashboard" className="btn btn-outline" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          <ICN.ExternalLink size={13} style={{ marginRight: 4 }} />Open Dashboard
        </a>
      </div>

      <div className="page-head">
        <div>
          <div className="page-eyebrow">Administration (Legacy)</div>
          <h1>Admin console</h1>
          <p className="sub">Manage users, hosting, billing, receipts and platform settings.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline" onClick={refresh} disabled={loading}>
            <ICN.RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          <ICN.AlertCircle size={14} style={{ marginRight: 6 }} />{error}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 12, color: 'var(--danger)' }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {notice && !error && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--accent)', borderColor: 'var(--accent)' }}>
          <ICN.Check size={14} style={{ marginRight: 6 }} />{notice}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 12, color: 'var(--accent)' }} onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 16, flexWrap: 'wrap', display: 'flex', gap: 2 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon size={13} />
              {t.label}
              {t.key === 'billing' && pendingReceiptCount > 0 && (
                <span style={{
                  background: 'var(--danger)', color: '#fff',
                  borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700,
                }}>
                  {pendingReceiptCount}
                </span>
              )}
              {t.key === 'tickets' && ticketUnreadCount > 0 && (
                <span style={{
                  background: 'var(--danger)', color: '#fff',
                  borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 700,
                }}>
                  {ticketUnreadCount > 99 ? '99+' : ticketUnreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="card" style={{ padding: 24 }}>
          <div className="muted">Loading admin data…</div>
        </div>
      )}

      {!loading && tab === 'overview' && (
        <AdminOverviewSection
          overview={overview}
          deployments={deployments}
          vpsServices={vpsServices}
          orders={orders}
          receipts={receipts}
          users={users}
        />
      )}

      {!loading && tab === 'customers' && (
        <AdminCustomersSection
          users={users}
          deployments={deployments}
          orders={orders}
          receipts={receipts}
          busyId={busyId}
          onAct={act}
          onView={(userId) => setDetailUserId(userId)}
        />
      )}

      {!loading && tab === 'hosting' && (
        <AdminHostingTabs
          deployments={deployments}
          vpsServices={vpsServices}
          users={users}
          orders={orders}
          busyId={busyId}
          onAct={act}
          onRefresh={refresh}
        />
      )}

      {!loading && tab === 'billing' && (
        <AdminBillingTabs
          users={users}
          deployments={deployments}
          orders={orders}
          receipts={receipts}
          busyId={busyId}
          onAct={act}
          onRefresh={refresh}
        />
      )}

      {!loading && tab === 'tickets' && (
        <AdminTicketsSection onUnreadChange={setTicketUnreadCount} />
      )}

      {!loading && tab === 'activity' && (
        <AdminActivitySection
          auditLogs={activity}
          users={users}
          deployments={deployments}
          orders={orders}
          receipts={receipts}
        />
      )}

      {!loading && tab === 'settings' && (
        <AdminSettingsSection overview={overview} configStatus={configStatus} />
      )}

      {detailUserId && (
        <AdminCustomerDetail
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          busy={busyId === detailUserId}
          onLifecycleAction={(action) => {
            if (action === 'suspend') act(detailUserId, () => apiSuspendUser(detailUserId, 'admin_suspended'), 'Suspend');
            if (action === 'reactivate') act(detailUserId, () => apiReactivateUser(detailUserId, false), 'Reactivate');
          }}
        />
      )}
    </div>
  );
}

export default AdminPage;
