import React, { useEffect, useState } from 'react';
import { ICN } from '../../icons';
import { addHostingDomain, deleteHostingDomain, listHostingDomains, verifyHostingDomain } from '../../api';
import { EmptyRows, Notice } from './SectionShell';
import { normalizeList } from './shared';

export default function DomainsSection({ deploymentId, onNeedsRedeploy }) {
  const [items, setItems] = useState([]);
  const [domain, setDomain] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = (openDomainId = null) => listHostingDomains(deploymentId)
    .then((rows) => {
      const normalized = normalizeList(rows, ['items', 'domains']).map(normalizeDomain);
      setItems(normalized);
      if (openDomainId) setSelectedId(openDomainId);
      else setSelectedId((current) => normalized.some((item) => item.domainId === current) ? current : '');
      return normalized;
    })
    .catch((error) => setMsg(error.message || 'Could not load domains.'));
  useEffect(() => { load(); }, [deploymentId]);

  const add = async () => {
    if (!domain.trim()) return;
    setBusy('add'); setMsg('');
    try {
      const created = normalizeDomain(await addHostingDomain(deploymentId, { domain }));
      setDomain('');
      setSelectedId(created.domainId);
      setMsg('Domain added. Copy the DNS records in the opened settings, then verify propagation.');
      onNeedsRedeploy?.('Custom domains');
      await load(created.domainId);
    }
    catch (error) { setMsg(error.message || 'Could not add domain.'); }
    finally { setBusy(''); }
  };

  const verify = async (item) => {
    setBusy(item.domainId); setMsg('');
    try { await verifyHostingDomain(deploymentId, item.domainId); setMsg('Domain verification refreshed.'); load(); }
    catch (error) { setMsg(error.message || 'Could not verify domain.'); }
    finally { setBusy(''); }
  };

  const remove = async (item = pendingRemove) => {
    if (!item) return;
    setBusy(item.domainId); setMsg('');
    try {
      await deleteHostingDomain(deploymentId, item.domainId);
      setMsg('Domain removed.');
      onNeedsRedeploy?.('Custom domains');
      setPendingRemove(null);
      if (selectedId === item.domainId) setSelectedId('');
      load();
    }
    catch (error) { setMsg(error.message || 'Could not remove domain.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Custom domains</h2>
      {items.length === 0 && (
        <>
          <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>Add a domain, then open its settings to copy DNS records into your registrar.</p>
          <div className="hosting-form-row">
            <input className="input mono" placeholder="www.glondia.com" value={domain} onChange={(event) => setDomain(event.target.value)} />
            <button className="btn btn-primary" disabled={busy === 'add'} onClick={add}>{busy === 'add' ? 'Adding...' : 'Add domain'}</button>
          </div>
        </>
      )}
      <Notice>{msg}</Notice>
      <div className="hosting-card-list">
        {items.length === 0 ? <EmptyRows message="No custom domains attached yet." /> : items.map((item) => {
          const isOpen = selectedId === item.domainId;
          return (
            <div className={`hosting-domain-card${isOpen ? ' is-open' : ''}`} key={item.domainId}>
              <div className="hosting-row-card hosting-domain-row">
                <div className="hosting-domain-main">
                  <span className="mono">{item.name || item.domain}</span>
                  {item.providerError && <div className="muted" style={{ fontSize: 12 }}>{item.providerError}</div>}
                  <div className="muted" style={{ fontSize: 12 }}>{item.provider === 'glondia-main-server' ? 'Main Glondia cloud server' : item.provider || 'Hosting provider'}</div>
                </div>
                <span className="hosting-domain-status">{item.providerSyncStatus === 'pending_provider' ? 'Pending provider sync' : item.status || item.verificationStatus || 'pending_dns'}</span>
                <div className="hosting-domain-actions">
                  <button className="btn btn-sm btn-outline" disabled={busy === item.domainId} onClick={() => setSelectedId(isOpen ? '' : item.domainId)}>
                    {isOpen ? 'Close settings' : 'Settings'}
                  </button>
                  <button className="btn btn-sm btn-outline" disabled={busy === item.domainId} onClick={() => verify(item)}>Verify</button>
                  <button className="btn btn-sm btn-outline" disabled={busy === item.domainId} onClick={() => setPendingRemove(item)}>Remove</button>
                </div>
              </div>
              {isOpen && (
                <DomainSettings
                  domain={item}
                  busy={busy === item.domainId}
                  onVerify={() => verify(item)}
                />
              )}
            </div>
          );
        })}
      </div>
      {pendingRemove && (
        <DomainRemovePopup
          domain={pendingRemove}
          busy={busy === pendingRemove.domainId}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => remove(pendingRemove)}
        />
      )}
    </div>
  );
}

function normalizeDomain(item = {}) {
  return {
    ...item,
    domainId: item.domainId || item.id || item.name || item.domain,
    name: item.name || item.domain || item.hostname || '',
    providerSyncStatus: item.providerSyncStatus || item.syncStatus || null,
    dnsRecords: normalizeList(item.dnsRecords || item.records || [], []),
  };
}

function DomainSettings({ domain, busy, onVerify }) {
  return (
    <div className="hosting-domain-settings">
      <div className="hosting-section-head">
        <div>
          <h3 style={{ margin: 0 }}>Domain settings</h3>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            DNS records for <span className="mono">{domain.name}</span>. Copy them to your registrar, then verify propagation.
          </p>
        </div>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={onVerify}><ICN.Refresh size={13} /> Verify DNS</button>
      </div>
      <div className="kv" style={{ gridTemplateColumns: '110px 1fr', marginBottom: 12, fontSize: 12 }}>
        <dt>DNS</dt><dd>{domain.verificationStatus || domain.status || 'pending'}</dd>
        <dt>Certificate</dt><dd>{domain.sslStatus || 'pending_certificate'}</dd>
      </div>
      <DnsRecords records={domain.dnsRecords?.length ? domain.dnsRecords : defaultDnsRecords(domain)} />
    </div>
  );
}

function defaultDnsRecords(domain = {}) {
  const target = domain.value || domain.target || domain.targetValue || domain.ipAddress || domain.serverAddress || '45.77.236.52';
  return [
    { id: 'default-www', host: 'www', name: 'www', type: 'CNAME', value: target, status: 'pending' },
    { id: 'default-root', host: '@', name: '@', type: 'A', value: target, status: 'optional' },
  ];
}

function DomainRemovePopup({ domain, busy, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <div className="card" style={{ width: 'min(420px, 100%)', padding: 18 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Remove domain?</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            This removes <span className="mono">{domain.name || domain.domain}</span> from this hosting service. DNS records at your registrar are not deleted automatically.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button className="btn btn-outline" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Removing...' : 'Remove domain'}</button>
        </div>
      </div>
    </div>
  );
}

function DnsRecords({ records = [] }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="muted" style={{ fontSize: 11 }}>Copy these DNS records into your registrar, then click Verify.</div>
      {records.map((record, index) => (
        <div className="hosting-edit-card" style={{ gridTemplateColumns: '90px 82px minmax(160px, 1fr) 34px', gap: 6, padding: 8, alignItems: 'end' }} key={record.id || `${record.type}:${record.name}:${index}`}>
          <Field label="Host" value={record.host || record.name || '@'} />
          <Field label="Type" value={record.type || 'A'} />
          <Field label="Value" value={record.value || ''} copyable />
          <DnsStatusIcon status={record.status || 'pending'} />
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, copyable = false }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!copyable) return;
    navigator.clipboard?.writeText(String(value || '')).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <label>
      <span style={{ fontSize: 10 }}>{label}</span>
      <span className="input mono" style={{ minHeight: 32, padding: '6px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '-'}</span>
        {copyable && (
          <button
            type="button"
            onClick={copy}
            title={copied ? 'Copied' : `Copy ${label}`}
            aria-label={copied ? `${label} copied` : `Copy ${label}`}
            style={{ border: 0, background: 'transparent', color: copied ? 'var(--accent)' : 'var(--text-muted)', padding: 0, display: 'inline-flex', cursor: 'pointer' }}
          >
            {copied ? <ICN.Check size={11} stroke={3} /> : <ICN.Copy size={11} />}
          </button>
        )}
      </span>
    </label>
  );
}

function DnsStatusIcon({ status }) {
  const state = dnsState(status);
  const BadgeIcon = state === 'connected' ? ICN.Check : state === 'dead' ? ICN.X : ICN.RefreshCw;
  const color = state === 'connected' ? 'var(--accent)' : state === 'dead' ? 'var(--danger)' : 'var(--warning)';
  const label = state === 'connected' ? 'Connected' : state === 'dead' ? 'Not connected' : 'Propagating';
  return (
    <span title={label} style={{ position: 'relative', display: 'inline-flex', width: 30, height: 30, alignItems: 'center', justifyContent: 'center', color, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg)' }}>
      <ICN.BarChart2 size={16} />
      <sup style={{ position: 'absolute', right: 2, top: 0, width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: 'var(--bg-deep)', color }}>
        <BadgeIcon size={9} stroke={3} />
      </sup>
    </span>
  );
}

function dnsState(status = '') {
  const value = String(status).toLowerCase();
  if (['found', 'verified', 'connected', 'active', 'required_connected'].some((key) => value.includes(key))) return 'connected';
  if (['missing', 'failed', 'dead', 'error', 'not_connected', 'not connected'].some((key) => value.includes(key))) return 'dead';
  return 'propagating';
}
