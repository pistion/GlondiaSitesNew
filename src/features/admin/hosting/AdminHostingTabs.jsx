// AdminHostingTabs.jsx — hosting management section with sub-tabs
import React, { useState } from 'react';
import { ICN } from '../../../icons';
import { money, when, StatusPill } from '../adminStatus.jsx';
import { buildHostingRows, filterDeployments } from '../adminUtils.js';
import {
  suspendDeployment,
  reactivateDeployment,
  approveDeploymentBilling,
  renewDeploymentManually,
  setDeploymentRenderPlan,
  deleteDeployment,
} from '../../../api/admin.js';

const HOSTING_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'pending',   label: 'Pending' },
  { key: 'failed',    label: 'Failed' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'free',      label: 'Free' },
  { key: 'paid',      label: 'Paid' },
  { key: 'dns',       label: 'DNS Issues' },
];

const VPS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'paid', label: 'Paid' },
];

function filterVpsServices(services = [], filter = 'all') {
  const value = (svc) => String(svc.status || '').toLowerCase();
  if (filter === 'active') return services.filter((svc) => ['active', 'running'].includes(value(svc)));
  if (filter === 'pending') return services.filter((svc) => ['pending', 'provisioning'].includes(value(svc)));
  if (filter === 'failed') return services.filter((svc) => ['error', 'failed', 'provider_missing', 'destroy_failed'].includes(value(svc)));
  if (filter === 'suspended') return services.filter((svc) => ['suspended', 'stopped', 'halted'].includes(value(svc)) || svc.adminStatus === 'blocked');
  if (filter === 'paid') return services.filter((svc) => ['paid', 'completed'].includes(String(svc.billingStatus || svc.paymentStatus || '').toLowerCase()));
  return services;
}

export function AdminHostingTabs({ deployments, vpsServices = [], users, orders, busyId, onAct, onRefresh }) {
  const [mode, setMode] = useState('sites');
  const [activeTab, setActiveTab] = useState('all');
  const [activeVpsTab, setActiveVpsTab] = useState('all');

  const filtered = filterDeployments(deployments, activeTab);
  const rows = buildHostingRows(users, filtered, orders);
  const filteredVps = filterVpsServices(vpsServices, activeVpsTab);

  return (
    <div>
      <div className="admin-inner-tabs" style={{ marginBottom: 8 }}>
        <button className={mode === 'sites' ? 'active' : ''} onClick={() => setMode('sites')}>
          Sites <span style={{ marginLeft: 5 }} className="mono">{deployments.length}</span>
        </button>
        <button className={mode === 'vps' ? 'active' : ''} onClick={() => setMode('vps')}>
          VPS <span style={{ marginLeft: 5 }} className="mono">{vpsServices.length}</span>
        </button>
      </div>
      {mode === 'vps' ? (
        <>
          <div className="admin-inner-tabs">
            {VPS_TABS.map((t) => {
              const count = filterVpsServices(vpsServices, t.key).length;
              return (
                <button
                  key={t.key}
                  className={activeVpsTab === t.key ? 'active' : ''}
                  onClick={() => setActiveVpsTab(t.key)}
                >
                  {t.label}
                  {t.key !== 'all' && count > 0 && (
                    <span style={{
                      marginLeft: 5, background: 'var(--bg-deep)',
                      borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 600,
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <VpsTable services={filteredVps} />
        </>
      ) : (
        <>
      <div className="admin-inner-tabs">
        {HOSTING_TABS.map((t) => {
          const count = filterDeployments(deployments, t.key).length;
          return (
            <button
              key={t.key}
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              {t.key !== 'all' && count > 0 && (
                <span style={{
                  marginLeft: 5, background: 'var(--bg-deep)',
                  borderRadius: 999, padding: '0 5px', fontSize: 10, fontWeight: 600,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <HostingTable rows={rows} busyId={busyId} onAct={onAct} />
        </>
      )}
    </div>
  );
}

function formatResources(service) {
  const cpu = service.vcpuCount ? `${service.vcpuCount} vCPU` : null;
  const ram = service.ramMb ? `${service.ramMb.toLocaleString()} MB` : null;
  const disk = service.diskGb ? `${service.diskGb} GB` : null;
  return [cpu, ram, disk].filter(Boolean).join(' / ') || '—';
}

function VpsTable({ services }) {
  return (
    <div className="card card-flush">
      <div className="admin-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Service</th>
              <th>IP / Region</th>
              <th>Status</th>
              <th>Access</th>
              <th>Billing</th>
              <th>Plan</th>
              <th>Resources</th>
              <th>OS</th>
              <th>Price</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr><td colSpan={11} className="muted" style={{ padding: 20 }}>No VPS services.</td></tr>
            )}
            {services.map((svc) => (
              <tr key={svc.id}>
                <td style={{ fontSize: 12 }}>
                  {svc.customer ? (
                    <>
                      <div title={svc.customer.email}>{svc.customer.name || svc.customer.email}</div>
                      <div className="mono muted" style={{ fontSize: 10 }}>{svc.customer.clientId || svc.customer.id}</div>
                    </>
                  ) : (
                    <span className="mono muted">{(svc.userId || svc.organizationId || '').slice(0, 14) || '—'}</span>
                  )}
                </td>
                <td style={{ fontSize: 12 }}>
                  <div><b>{svc.label || svc.hostname || 'VPS'}</b></div>
                  <div className="mono muted" style={{ fontSize: 10 }}>{svc.id.slice(0, 12)}</div>
                </td>
                <td style={{ fontSize: 12 }}>
                  <div className="mono">{svc.mainIp || '—'}</div>
                  <div className="muted" style={{ fontSize: 10 }}>{svc.region || '—'}</div>
                </td>
                <td><StatusPill value={svc.status} /></td>
                <td>{svc.accessStatus ? <StatusPill value={svc.accessStatus} /> : <span className="muted" style={{ fontSize: 11 }}>none</span>}</td>
                <td>{svc.billingStatus || svc.paymentStatus ? <StatusPill value={svc.billingStatus || svc.paymentStatus} /> : <span className="muted">—</span>}</td>
                <td className="mono" style={{ fontSize: 11 }}>{svc.plan || '—'}</td>
                <td style={{ fontSize: 11 }}>{formatResources(svc)}</td>
                <td style={{ fontSize: 11 }}>{svc.osName || svc.osId || '—'}</td>
                <td style={{ fontSize: 12 }}>{svc.totalPriceCents != null ? money(svc.totalPriceCents, svc.currency) : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(svc.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HostingTable({ rows, busyId, onAct }) {
  return (
    <div className="card card-flush">
      <div className="admin-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Site Name</th>
              <th>Live URL</th>
              <th>Source</th>
              <th>Infrastructure</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Plan</th>
              <th>Due Date</th>
              <th>Last Paid</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={12} className="muted" style={{ padding: 20 }}>No deployments.</td></tr>
            )}
            {rows.map(({ deployment: d, user, latestOrder }) => {
              const id = d.deploymentId;
              return (
                <tr key={id}>
                  <td style={{ fontSize: 12 }}>
                    {user ? (
                      <span title={user.email}>{(user.email || '').slice(0, 22)}</span>
                    ) : (
                      <span className="mono muted">{(d.userId || '').slice(0, 10)}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{d.serviceName || '—'}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{id?.slice(0, 12)}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {d.liveUrl
                      ? <a href={d.liveUrl} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 4, color: 'var(--accent)' }}>
                          <ICN.Globe size={11} /> {d.liveUrl.replace(/^https?:\/\//, '').slice(0, 28)}
                        </a>
                      : <span className="muted">—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{d.source || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    <div className="mono">{d.provider || 'unknown'}</div>
                    {d.providerFailover && (
                      <div title={d.providerFailover.reason || ''} style={{ color: 'var(--warning)', marginTop: 2 }}>
                        Failover: {d.providerFailover.from} → {d.providerFailover.to}
                      </div>
                    )}
                  </td>
                  <td><StatusPill value={d.status} /></td>
                  <td><StatusPill value={d.paymentStatus} /></td>
                  <td style={{ fontSize: 12 }}>
                    <span>{d.renderPlan || '—'}</span>
                    {d.renderPlanTargetAfterPayment && (
                      <span className="muted"> → {d.renderPlanTargetAfterPayment}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(d.billingDueAt)}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(d.lastPaidAt)}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{when(d.createdAt)}</td>
                  <td>
                    <div className="admin-action-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {d.liveUrl && (
                          <a className="btn btn-sm btn-outline" href={d.liveUrl} target="_blank" rel="noopener noreferrer">
                            <ICN.ExternalLink size={11} />
                          </a>
                        )}
                        {d.status === 'suspended' || d.status === 'overdue_suspended' ? (
                          <button className="btn btn-sm btn-primary" disabled={busyId === id}
                            onClick={() => onAct(id, () => reactivateDeployment(id), 'Reactivate')}>
                            Reactivate
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-outline" disabled={busyId === id}
                            onClick={() => onAct(id, () => suspendDeployment(id, 'admin_suspended'), 'Suspend')}>
                            Suspend
                          </button>
                        )}
                        {d.paymentStatus !== 'paid' && (
                          <button className="btn btn-sm btn-primary" disabled={busyId === id}
                            onClick={() => onAct(id, () => approveDeploymentBilling(id), 'Approve billing')}>
                            Approve billing
                          </button>
                        )}
                        <button className="btn btn-sm btn-outline" disabled={busyId === id}
                          onClick={() => onAct(id, () => renewDeploymentManually(id), 'Renew')}>
                          Renew
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                          disabled={busyId === id}
                          onClick={() => {
                            if (window.confirm('Delete this deployment permanently?')) {
                              onAct(id, () => deleteDeployment(id), 'Delete deployment');
                            }
                          }}
                        >
                          <ICN.Trash2 size={11} />
                        </button>
                      </div>
                      <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
                        <span className="muted" style={{ fontSize: 10, marginRight: 2 }}>Plan:</span>
                        {['free', 'starter', 'standard'].map((p) => (
                          <button
                            key={p}
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: 10, height: 22, padding: '0 6px', fontWeight: d.renderPlan === p ? 700 : 400 }}
                            disabled={busyId === id || d.renderPlan === p}
                            onClick={() => onAct(id, () => setDeploymentRenderPlan(id, p, false), `Set plan ${p}`)}
                          >
                            {p}
                          </button>
                        ))}
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ fontSize: 10, height: 22, padding: '0 6px' }}
                          disabled={busyId === id}
                          onClick={() => onAct(id, () => setDeploymentRenderPlan(id, d.renderPlan || 'free', true), 'Redeploy')}
                        >
                          redeploy
                        </button>
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
