// AdminCustomersSection.jsx — customer table with slide-in user detail drawer
import React, { useState, useEffect } from 'react';
import { Avatar } from '../../../components.jsx';
import { ICN } from '../../../icons';
import { money, when, StatusPill } from '../adminStatus.jsx';
import { buildDeploymentsByUserId, buildOrdersByDeploymentId, buildReceiptsByOrderId } from '../adminUtils.js';
import {
  getAdminUser, suspendUser, reactivateUser, disableUser, deleteUser,
  viewReceipt, getUserIdPhotoUrl, getUserAvatarUrl,
} from '../../../api/admin.js';

function AdminAvatar({ user, size = 28 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!user?.hasAvatar) { setUrl(null); return; }
    let revoked = false; let current = null;
    (async () => {
      try {
        const u = await getUserAvatarUrl(user.id);
        if (revoked) { URL.revokeObjectURL(u); return; }
        current = u; setUrl(u);
      } catch { setUrl(null); }
    })();
    return () => { revoked = true; if (current) URL.revokeObjectURL(current); };
  }, [user?.id, user?.hasAvatar]);
  return <Avatar name={user?.name || user?.email || ''} imageUrl={url} size={size} />;
}

export function AdminCustomersSection({ users, deployments, vpsServices = [], orders, receipts, busyId, onAct, onView }) {
  const depByUser = buildDeploymentsByUserId(deployments);
  const ordersByDep = buildOrdersByDeploymentId(orders);
  const receiptsByOrder = buildReceiptsByOrderId(receipts);

  const rows = users.map((u) => {
    const userDeps = depByUser[u.id] || [];
    const userVps = vpsServices.filter((svc) => svc.userId === u.id || svc.customer?.id === u.id);
    const activeDeps = userDeps.filter((d) => d.status === 'live' || d.status === 'active').length;
    const activeVps = userVps.filter((svc) => ['active', 'running'].includes(String(svc.status || '').toLowerCase())).length;
    const userOrders = userDeps.flatMap((d) => ordersByDep[d.deploymentId] || []);
    const paidOrders = userOrders.filter((o) => o.status === 'paid');
    const totalSpent = paidOrders.reduce((s, o) => s + (o.totalAmountCents || 0), 0);
    const currency = paidOrders[0]?.currency || 'PGK';
    return {
      user: u,
      sites: userDeps.length,
      vps: userVps.length,
      activeServices: activeDeps + activeVps,
      paidBills: paidOrders.length,
      totalSpent,
      currency,
    };
  });

  const inactive = (u) => ['suspended', 'disabled', 'deleted'].includes(u.accountStatus);

  return (
    <div className="card card-flush">
      <div className="admin-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Services</th>
              <th>Sites</th>
              <th>VPS</th>
              <th>Active</th>
              <th>Paid Bills</th>
              <th>Total Spent</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={13} className="muted" style={{ padding: 20 }}>No users found.</td></tr>
            )}
            {rows.map(({ user: u, sites, vps, activeServices, paidBills, totalSpent, currency }) => (
              <tr key={u.id}>
                <td style={{ width: 40 }}><AdminAvatar user={u} /></td>
                <td style={{ fontSize: 12 }}>{u.email}</td>
                <td style={{ fontSize: 12 }}>{u.name || '—'}</td>
                <td><StatusPill value={u.role || 'user'} /></td>
                <td><StatusPill value={u.accountStatus || 'active'} /></td>
                <td className="mono">{sites + vps}</td>
                <td className="mono">{sites}</td>
                <td className="mono">{vps}</td>
                <td className="mono">{activeServices}</td>
                <td className="mono">{paidBills}</td>
                <td style={{ fontSize: 12 }}>{totalSpent > 0 ? money(totalSpent, currency) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(u.createdAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div className="admin-action-row">
                    <button className="btn btn-sm btn-outline" onClick={() => onView(u.id)}>View</button>
                    {u.accountStatus === 'deleted' ? (
                      <span className="muted" style={{ fontSize: 11 }}>History preserved</span>
                    ) : inactive(u) ? (
                      <button className="btn btn-sm btn-primary" disabled={busyId === u.id}
                        onClick={() => onAct(u.id, () => reactivateUser(u.id, false), 'Reactivate')}>
                        Reactivate
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-outline" disabled={busyId === u.id}
                          onClick={() => onAct(u.id, () => suspendUser(u.id, 'admin_suspended'), 'Suspend')}>
                          Suspend
                        </button>
                        <button className="btn btn-sm btn-outline" disabled={busyId === u.id}
                          onClick={() => onAct(u.id, () => disableUser(u.id, 'admin_disabled'), 'Disable')}>
                          Disable
                        </button>
                      </>
                    )}
                    {u.accountStatus !== 'deleted' && (
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        disabled={busyId === u.id}
                        onClick={() => {
                          if (window.confirm('Delete this account? All sites will be brought down. History is preserved.')) {
                            onAct(u.id, () => deleteUser(u.id, 'admin_deleted'), 'Delete account');
                          }
                        }}
                      >
                        <ICN.Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── User Detail Drawer ────────────────────────────────────────────────────────

export function UserDetailDrawer({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let revoked = false;
    let currentPhoto = null;
    setData(null); setError(null); setPhotoUrl(null);
    (async () => {
      try {
        const detail = await getAdminUser(userId);
        if (revoked) return;
        setData(detail);
        if (detail?.user?.hasIdPhoto) {
          try {
            currentPhoto = await getUserIdPhotoUrl(userId);
            if (!revoked) setPhotoUrl(currentPhoto);
          } catch { /* photo optional */ }
        }
      } catch (err) {
        if (!revoked) setError(err.message || 'Failed to load user.');
      }
    })();
    return () => { revoked = true; if (currentPhoto) URL.revokeObjectURL(currentPhoto); };
  }, [userId]);

  if (!userId) return null;

  const u = data?.user;

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} />
      <div className="admin-drawer">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '0 20px', paddingTop: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>User detail</h2>
          <button className="btn btn-sm btn-outline" onClick={onClose}>
            <ICN.X size={14} /> Close
          </button>
        </div>

        <div style={{ padding: '0 20px 20px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
          {!data && !error && <div className="muted">Loading…</div>}

          {u && (
            <>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <div style={{ marginBottom: 4 }}><b>Email:</b> {u.email}</div>
                  <div style={{ marginBottom: 4 }}><b>Name:</b> {u.name || '—'}</div>
                  <div style={{ marginBottom: 4 }}><b>Phone:</b> {u.phone || '—'}</div>
                  <div className="row" style={{ marginBottom: 4, gap: 6 }}><b>Account:</b> <StatusPill value={u.accountStatus} /></div>
                  <div className="row" style={{ marginBottom: 4, gap: 6 }}><b>Role:</b> <StatusPill value={u.role} /></div>
                  <div style={{ marginBottom: 4 }}><b>Created:</b> {when(u.createdAt)}</div>
                  {u.disabledReason && (
                    <div style={{ marginBottom: 4, color: 'var(--danger)' }}><b>Disabled reason:</b> {u.disabledReason}</div>
                  )}
                </div>
                <div style={{ flex: '0 0 120px' }}>
                  <div style={{ marginBottom: 8 }}><b style={{ fontSize: 12 }}>Avatar</b></div>
                  <AdminAvatar user={u} size={64} />
                  {u.hasIdPhoto && (
                    <>
                      <div style={{ marginTop: 12, marginBottom: 6 }}><b style={{ fontSize: 12 }}>ID photo</b></div>
                      {photoUrl
                        ? <img src={photoUrl} alt="ID" style={{ maxWidth: 120, borderRadius: 6, border: '1px solid var(--border)' }} />
                        : <span className="muted" style={{ fontSize: 12 }}>Loading…</span>}
                    </>
                  )}
                </div>
              </div>

              <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                <span><b>Paid:</b> {data.totals?.paid ?? 0}</span>
                <span><b>Pending:</b> {data.totals?.pending ?? 0}</span>
                <span><b>Uploaded:</b> {data.totals?.uploaded ?? 0}</span>
                <span><b>Expired:</b> {data.totals?.expired ?? 0}</span>
              </div>

              <DrawerSection title={`Deployments (${data.deployments?.length || 0})`}>
                {(data.deployments || []).map((d) => (
                  <div key={d.deploymentId} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{d.serviceName || d.deploymentId?.slice(0, 14)}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <StatusPill value={d.status} />
                      <StatusPill value={d.paymentStatus} />
                    </span>
                  </div>
                ))}
              </DrawerSection>

              <DrawerSection title={`Orders (${data.orders?.length || 0})`}>
                {(data.orders || []).map((o) => (
                  <div key={o.id} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="mono" style={{ fontSize: 12 }}>{o.id.slice(0, 8)}</span>
                    <span style={{ fontSize: 12 }}>{money(o.totalAmountCents, o.currency)}</span>
                    <StatusPill value={o.status} />
                  </div>
                ))}
              </DrawerSection>

              <DrawerSection title={`Receipts (${data.receipts?.length || 0})`}>
                {(data.receipts || []).map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="mono" style={{ fontSize: 12 }} title={r.fileName}>{(r.fileName || '').slice(0, 20)}</span>
                    <span style={{ fontSize: 12 }}>{money(r.amountCents, r.currency)}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <StatusPill value={r.status} />
                      <button className="btn btn-sm btn-outline" onClick={() => viewReceipt(r.id)}>View</button>
                    </span>
                  </div>
                ))}
              </DrawerSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function DrawerSection({ title, children }) {
  const items = React.Children.toArray(children);
  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>{title}</h4>
      {items.length ? items : <span className="muted" style={{ fontSize: 12 }}>None.</span>}
    </div>
  );
}
