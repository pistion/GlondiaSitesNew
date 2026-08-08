import React from 'react';
import { ICN } from '../../icons.jsx';
import {
  changeEmailMailboxPassword,
  getEmailDnsRecords,
  getEmailMailbox,
  getEmailMailboxUsage,
  listEmailMailboxes,
} from '../../api/email.js';
import SandboxBanner from '../sandbox/SandboxBanner.jsx';
import BillingSection from '../hosting-management/BillingSection.jsx';

const { useCallback, useEffect, useMemo, useState } = React;

const PAYMENT_EXPIRED_STATUSES = ['suspended', 'expired', 'past_due', 'payment_past_due', 'non_payment'];
const MY_EMAIL_STATUSES = ['active', 'pending', 'pending_setup', 'setup_required', ...PAYMENT_EXPIRED_STATUSES];

function normalizeMailboxStatus(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '_');
}

function isVisibleMailbox(mailbox) {
  return MY_EMAIL_STATUSES.includes(normalizeMailboxStatus(mailbox?.status));
}

function toneForStatus(status) {
  const value = normalizeMailboxStatus(status);
  if (value === 'active') return 'green';
  if (PAYMENT_EXPIRED_STATUSES.includes(value)) return 'red';
  return 'amber';
}

function displayMailboxStatus(status) {
  const value = normalizeMailboxStatus(status);
  if (value === 'active') return 'Active';
  if (['pending', 'pending_setup', 'setup_required'].includes(value)) return 'Setup required';
  if (PAYMENT_EXPIRED_STATUSES.includes(value)) return 'Expired - payment due';
  return 'Unavailable';
}

function Label({ children, tone = 'muted' }) {
  return <span className={`mailbox-label ${tone}`}>{children}</span>;
}

function formatBytes(value) {
  if (value == null || value === '') return 'Unavailable';
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return 'Unavailable';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(bytes % (1024 ** 3) ? 1 : 0)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function generatePassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*+-_'];
  const all = groups.join('');
  const bytes = new Uint32Array(18);
  window.crypto.getRandomValues(bytes);
  const chars = groups.map((group, index) => group[bytes[index] % group.length]);
  for (let index = groups.length; index < bytes.length; index += 1) chars.push(all[bytes[index] % all.length]);
  return chars.map((char, index) => ({ char, rank: bytes[index] }))
    .sort((a, b) => a.rank - b.rank).map((item) => item.char).join('');
}

function SharedStyles() {
  return <style>{`
    .mailbox-label { display:inline-flex; align-items:center; width:max-content; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:800; background:var(--bg-sunken); color:var(--muted); }
    .mailbox-label.green { background:var(--accent-soft); color:var(--accent); }.mailbox-label.amber { background:color-mix(in srgb,var(--warning) 15%,transparent); color:var(--warning); }.mailbox-label.red { background:color-mix(in srgb,var(--danger) 14%,transparent); color:var(--danger); }
    .mailbox-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:18px; }
    .mailbox-stat { padding:16px; border:1px solid var(--border); border-radius:9px; background:var(--bg-elev); }.mailbox-stat span { display:block; color:var(--muted); font-size:12px; }.mailbox-stat strong { display:block; margin-top:5px; font-size:22px; }
    .mailbox-domain-list { display:grid; gap:16px; }.mailbox-domain-card { overflow:hidden; border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); }
    .mailbox-domain-head { display:flex; justify-content:space-between; gap:14px; align-items:center; padding:16px 18px; border-bottom:1px solid var(--border); background:var(--bg-deep); }.mailbox-domain-title { display:flex; gap:10px; align-items:center; }.mailbox-domain-title h2 { margin:0; font-size:17px; }.mailbox-domain-title small { display:block; margin-top:3px; color:var(--muted); }
    .mailbox-table-wrap { overflow-x:auto; }.mailbox-table { width:100%; border-collapse:collapse; table-layout:fixed; }.mailbox-table th { padding:10px 16px; color:var(--muted); font-size:10px; font-weight:800; text-align:left; text-transform:uppercase; letter-spacing:.04em; background:var(--bg-deep); }.mailbox-table td { padding:13px 16px; border-top:1px solid var(--border); vertical-align:middle; }.mailbox-table th:nth-child(1){width:29%}.mailbox-table th:nth-child(2){width:15%}.mailbox-table th:nth-child(3){width:24%}.mailbox-table th:nth-child(4){width:19%}.mailbox-table th:nth-child(5){width:13%;text-align:right}.mailbox-address { min-width:0; display:flex; gap:9px; align-items:center; }.mailbox-address strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }.mailbox-storage { display:grid; gap:3px; }.mailbox-storage strong { font-size:12px; }.mailbox-storage small,.mailbox-updated { color:var(--muted); font-size:11px; }.mailbox-row-actions { display:flex; justify-content:flex-end; gap:6px; white-space:nowrap; }
    .mailbox-empty { padding:34px; border:1px dashed var(--border); border-radius:10px; background:var(--bg-elev); text-align:center; }.mailbox-empty h2 { margin:10px 0 6px; }.mailbox-empty p { margin:0 0 16px; color:var(--muted); }
    .mailbox-detail-back { display:flex; align-items:center; min-height:34px; margin-bottom:12px; }.mailbox-detail-back .btn { margin-left:-8px; }.mailbox-detail-head { display:flex; justify-content:space-between; gap:20px; align-items:center; margin-bottom:18px; padding:18px 20px; border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); }.mailbox-detail-title { min-width:0; display:flex; gap:12px; align-items:center; }.mailbox-detail-icon { width:44px; height:44px; display:grid; flex:0 0 44px; place-items:center; border-radius:10px; background:var(--accent-soft); color:var(--accent); }.mailbox-detail-title h1 { margin:0; overflow:hidden; font-size:25px; text-overflow:ellipsis; white-space:nowrap; }.mailbox-detail-title p { margin:4px 0 0; color:var(--muted); font-size:13px; }.mailbox-detail-actions { display:flex; flex:0 0 auto; align-items:center; gap:10px; }
    .mailbox-settings-tabs { display:flex; gap:18px; overflow:auto; margin-bottom:18px; border-bottom:1px solid var(--border); }.mailbox-settings-tabs button { padding:10px 1px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--muted); font:inherit; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; }.mailbox-settings-tabs button.active { color:var(--text); border-bottom-color:var(--accent); }
    .mailbox-settings-card { padding:20px; border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); }.mailbox-settings-card h2 { margin:0 0 5px; font-size:18px; }.mailbox-settings-card > p { margin:0 0 18px; color:var(--muted); font-size:13px; }
    .mailbox-overview-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }.mailbox-overview-grid article { min-width:0; padding:13px; border:1px solid var(--border); border-radius:8px; background:var(--bg-deep); }.mailbox-overview-grid span { display:block; color:var(--muted); font-size:11px; }.mailbox-overview-grid strong { display:block; margin-top:6px; overflow-wrap:anywhere; font-size:13px; }
    .mailbox-password-form { display:grid; gap:14px; max-width:620px; }.mailbox-password-row { display:flex; gap:8px; }.mailbox-password-row .input { min-width:0; flex:1; }.mailbox-form-actions { display:flex; justify-content:flex-end; gap:8px; }.mailbox-success { display:flex; align-items:center; gap:7px; padding:10px 12px; border:1px solid var(--accent); border-radius:7px; background:var(--accent-soft); color:var(--accent); font-size:12px; font-weight:700; }
    .mailbox-quota { display:grid; gap:12px; }.mailbox-quota-head { display:flex; justify-content:space-between; gap:14px; align-items:flex-end; }.mailbox-quota-head span { display:block; color:var(--muted); font-size:12px; }.mailbox-quota-head strong { display:block; margin-top:4px; font-size:22px; }.mailbox-quota-track { height:10px; overflow:hidden; border:1px solid var(--border); border-radius:999px; background:var(--bg-deep); }.mailbox-quota-track span { display:block; height:100%; background:var(--accent); }.mailbox-quota-note { display:flex; gap:8px; padding:11px; border-radius:7px; background:var(--bg-deep); color:var(--muted); font-size:12px; }
    .mailbox-dns-card .card-head { align-items:flex-start; }.mailbox-dns-card .card-head h2 { margin:0; font-size:18px; }.mailbox-dns-card .card-head p { margin:5px 0 0; color:var(--muted); font-size:12px; }.mailbox-dns-table-wrap { overflow-x:auto; }.mailbox-dns-table { min-width:760px; }.mailbox-dns-table th:last-child,.mailbox-dns-table td:last-child { text-align:right; }.mailbox-dns-host,.mailbox-dns-value { display:block; overflow:hidden; color:var(--text); font-family:var(--mono); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }.mailbox-dns-value { max-width:420px; }.mailbox-dns-meta { display:block; margin-top:4px; color:var(--muted); font-size:10px; }.mailbox-dns-empty { padding:32px 20px; text-align:center; color:var(--muted); }.mailbox-dns-empty strong { display:block; margin:8px 0 4px; color:var(--text); }.mailbox-dns-sync { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:11px; }
    @media(max-width:900px){.mailbox-table{min-width:760px}.mailbox-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:640px){.mailbox-stats,.mailbox-overview-grid{grid-template-columns:1fr}.mailbox-domain-head,.mailbox-detail-head{align-items:stretch;flex-direction:column}.mailbox-detail-head{padding:16px}.mailbox-detail-title h1{font-size:20px}.mailbox-detail-actions{justify-content:space-between}.mailbox-detail-actions .btn{flex:1;justify-content:center}.mailbox-row{padding:14px}.mailbox-row-actions{grid-column:1/-1;grid-row:auto;justify-content:stretch}.mailbox-row-actions .btn{flex:1;justify-content:center}.mailbox-form-actions{display:grid}.mailbox-password-row{display:grid}}
  `}</style>;
}

export function MailboxesPage({ navigate }) {
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const list = await listEmailMailboxes();
      setMailboxes(Array.isArray(list?.mailboxes) ? list.mailboxes : []);
      if (silent) setError('');
    } catch (err) {
      if (!silent) setError(err.message || 'Could not load mailboxes.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refreshFromServer = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    const timer = window.setInterval(refreshFromServer, 15000);
    document.addEventListener('visibilitychange', refreshFromServer);
    window.addEventListener('focus', refreshFromServer);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshFromServer);
      window.removeEventListener('focus', refreshFromServer);
    };
  }, [load]);

  const visibleMailboxes = useMemo(
    () => mailboxes.filter(isVisibleMailbox),
    [mailboxes],
  );

  const groups = useMemo(() => {
    const byDomain = new Map();
    for (const mailbox of visibleMailboxes) {
      const domain = mailbox.domain || String(mailbox.email || '').split('@')[1] || 'Unassigned domain';
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(mailbox);
    }
    return [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleMailboxes]);

  const repaymentDueCount = visibleMailboxes.filter((mailbox) => toneForStatus(mailbox.status) === 'red').length;
  return <>
    <SharedStyles />
    <div className="page-head">
      <div>
        <div className="page-eyebrow">Email / My emails</div>
        <h1>My emails</h1>
        <p className="sub">Manage active mailboxes and emails expired because repayment is due. Pending setup stays in Email setup history.</p>
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={() => { window.location.href = '/mailboxes'; }}>
          <ICN.Mail size={14}/> Open GlondiaMail
        </button>
        <button className="btn btn-outline" onClick={() => navigate({ view:'email' })}><ICN.Plus size={14}/> Email setup</button>
      </div>
    </div>
    <SandboxBanner service="email-mailboxes" />
    {error && <div className="mailbox-empty" style={{color:'var(--danger)'}}>{error}</div>}
    <div className="mailbox-stats">
      <div className="mailbox-stat"><span>Active / expired mailboxes</span><strong>{loading ? '—' : visibleMailboxes.length}</strong></div>
      <div className="mailbox-stat"><span>Domains with email</span><strong>{loading ? '—' : groups.length}</strong></div>
      <div className="mailbox-stat"><span>Payment due</span><strong>{loading ? '—' : repaymentDueCount}</strong></div>
    </div>
    {!loading && visibleMailboxes.length === 0 ? (
      <div className="mailbox-empty">
        <ICN.Inbox size={28}/>
        <h2>No active emails yet</h2>
        <p>Pending mailbox setup requests stay in the Email setup history until they become active or need repayment attention.</p>
        <button className="btn btn-primary" onClick={() => navigate({view:'email'})}><ICN.Plus size={14}/> Open setup history</button>
      </div>
    ) : (
      <div className="mailbox-domain-list">{groups.map(([domain, items]) => <section className="mailbox-domain-card" key={domain}>
        <div className="mailbox-domain-head"><div className="mailbox-domain-title"><ICN.Globe size={19}/><div><h2>{domain}</h2><small>{items.length} mailbox{items.length===1?'':'es'}</small></div></div><button className="btn btn-sm btn-outline" onClick={() => navigate({view:'email-mailbox-detail',params:{id:items[0].id,tab:'dns'}})}><ICN.Network size={14}/> Domain DNS</button></div>
        <div className="mailbox-table-wrap"><table className="mailbox-table"><thead><tr><th>Mailbox</th><th>Status</th><th>Storage</th><th>Last synchronized</th><th aria-label="Actions"></th></tr></thead><tbody>
        {items.map((mailbox) => <tr key={mailbox.id}>
          <td><div className="mailbox-address"><ICN.Mail size={15}/><strong>{mailbox.email}</strong></div></td>
          <td><Label tone={toneForStatus(mailbox.status)}>{displayMailboxStatus(mailbox.status)}</Label></td>
          <td><div className="mailbox-storage"><strong>{mailbox.usageAvailable ? `${formatBytes(mailbox.storageUsedBytes)} / ${formatBytes(mailbox.storageLimitBytes)}` : `${formatBytes(mailbox.storageLimitBytes)} limit`}</strong><small>{mailbox.usageAvailable ? 'Database synchronized' : 'Usage sync pending'}</small></div></td>
          <td><span className="mailbox-updated">{formatDate(mailbox.lastUsageSyncAt || mailbox.updatedAt)}</span></td>
          <td><div className="mailbox-row-actions"><button className="btn btn-sm btn-outline" onClick={() => navigate({view:'email-mailbox-detail',params:{id:mailbox.id}})}><ICN.Settings size={14}/> Settings</button><button className="btn btn-sm btn-ghost" aria-label={`Open ${mailbox.email}`} onClick={() => window.location.href=mailbox.webmailUrl||'/mailboxes'}><ICN.ArrowRight size={14}/></button></div></td>
        </tr>)}
        </tbody></table></div>
      </section>)}</div>
    )}
  </>;
}

export function MailboxSettingsPage({ mailboxId, initialTab = 'overview', navigate }) {
  const [mailbox, setMailbox] = useState(null);
  const [usage, setUsage] = useState(null);
  const [dns, setDns] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const detail = await getEmailMailbox(mailboxId);
      setMailbox(detail);
      const [usageData, dnsData] = await Promise.all([getEmailMailboxUsage(mailboxId), getEmailDnsRecords(detail.domain)]);
      setUsage(usageData); setDns(dnsData);
    } catch (err) { setError(err.message || 'Could not load mailbox settings.'); }
    finally { setLoading(false); }
  }, [mailboxId]);
  useEffect(() => { load(); }, [load]);

  const changePassword = async (event) => {
    event.preventDefault(); setPasswordMessage(''); setError('');
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setSavingPassword(true);
    try { await changeEmailMailboxPassword(mailboxId, password); setPassword(''); setConfirmPassword(''); setPasswordMessage('Mailbox password changed successfully.'); }
    catch (err) { setError(err.message || 'Could not change mailbox password.'); }
    finally { setSavingPassword(false); }
  };

  const records = Array.isArray(dns?.records) ? dns.records : [];
  const percent = usage?.percentUsed || 0;
  return <>
    <SharedStyles />
    <div className="mailbox-detail-back"><button className="btn btn-sm btn-ghost" onClick={() => navigate({view:'email-mailboxes'})}><ICN.ArrowLeft size={14}/> My emails</button></div>
    {loading ? <div className="mailbox-settings-card">Loading mailbox settings...</div> : error && !mailbox ? <div className="mailbox-settings-card" style={{color:'var(--danger)'}}>{error}</div> : mailbox && <>
      <div className="mailbox-detail-head"><div className="mailbox-detail-title"><span className="mailbox-detail-icon"><ICN.Mail size={20}/></span><div><h1>{mailbox.email}</h1><p>{mailbox.domain} · Created {formatDate(mailbox.createdAt)}</p></div></div><div className="mailbox-detail-actions"><Label tone={toneForStatus(mailbox.status)}>{displayMailboxStatus(mailbox.status)}</Label><button className="btn btn-primary" onClick={() => window.location.href=mailbox.webmailUrl||'/mailboxes'}>Open GlondiaMail</button></div></div>
      <div className="mailbox-settings-tabs" role="tablist">{[['overview','Overview'],['security','Password & security'],['storage','Storage'],['dns','DNS records'],['transport','IMAP & SMTP'],['billing','Billing']].map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
      {error && <div className="mailbox-settings-card" style={{color:'var(--danger)',marginBottom:12}}>{error}</div>}
      {tab==='overview' && <section className="mailbox-settings-card"><h2>Mailbox overview</h2><p>Identity, service status, and provider configuration for this mailbox.</p><div className="mailbox-overview-grid"><article><span>Email address</span><strong>{mailbox.email}</strong></article><article><span>Status</span><strong>{displayMailboxStatus(mailbox.status)}</strong></article><article><span>Domain</span><strong>{mailbox.domain}</strong></article><article><span>Storage limit</span><strong>{formatBytes(mailbox.storageLimitBytes)}</strong></article><article><span>Usage synchronization</span><strong>{mailbox.usageAvailable?'Available':'Pending provider'}</strong></article><article><span>Last updated</span><strong>{formatDate(mailbox.updatedAt)}</strong></article></div></section>}
      {tab==='security' && <section className="mailbox-settings-card"><h2>GlondiaMail password</h2><p>This password belongs only to GlondiaMail. It is stored as a one-way hash and no password request is sent to the mailbox provider.</p><form className="mailbox-password-form" onSubmit={changePassword}>{passwordMessage&&<div className="mailbox-success"><ICN.CheckCircle size={14}/> {passwordMessage}</div>}<div><label className="label" htmlFor="mailbox-new-password">New password</label><div className="mailbox-password-row"><input id="mailbox-new-password" className="input" type={showPassword?'text':'password'} value={password} onChange={(e)=>setPassword(e.target.value)} minLength={10} maxLength={128} autoComplete="new-password" required/><button className="btn btn-icon btn-outline" type="button" onClick={()=>setShowPassword(v=>!v)}><ICN.Eye size={15}/></button><button className="btn btn-icon btn-outline" type="button" title="Generate password" onClick={()=>{const value=generatePassword();setPassword(value);setConfirmPassword(value);setShowPassword(true);}}><ICN.Wand2 size={15}/></button></div></div><div><label className="label" htmlFor="mailbox-confirm-password">Confirm new password</label><input id="mailbox-confirm-password" className="input" type={showPassword?'text':'password'} value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} minLength={10} maxLength={128} autoComplete="new-password" required/></div><div className="mailbox-form-actions"><button className="btn btn-primary" disabled={savingPassword||password.length<10||password!==confirmPassword}>{savingPassword?'Changing password...':'Change GlondiaMail password'}</button></div></form></section>}
      {tab==='storage' && <section className="mailbox-settings-card"><h2>Mailbox storage</h2><p>Each mailbox includes a 5 GB storage allowance.</p><div className="mailbox-quota"><div className="mailbox-quota-head"><div><span>Used storage</span><strong>{usage?.usageAvailable?formatBytes(usage.usedBytes):'Waiting for sync'}</strong></div><b>{formatBytes(usage?.limitBytes||mailbox.storageLimitBytes)} limit</b></div><div className="mailbox-quota-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${percent}%`}}/></div><div className="mailbox-quota-note"><ICN.Info size={14}/><span>{usage?.message||'Storage usage is not available yet.'}</span></div><small className="muted">Last synchronized: {formatDate(usage?.lastUsageSyncAt)}</small></div></section>}
      {tab==='dns' && <section className="card card-flush dns-records-card mailbox-dns-card">
        <div className="card-head">
          <div>
            <h2>DNS records for {mailbox.domain}</h2>
            <p>Provider records stored in the database and shared by every mailbox on this domain.</p>
          </div>
          <div className="actions">
            {dns?.lastSyncedAt && <span className="mailbox-dns-sync"><ICN.CheckCircle size={13}/> Synced {formatDate(dns.lastSyncedAt)}</span>}
            <button className="btn btn-sm btn-outline" onClick={load} disabled={loading}><ICN.RefreshCw size={13}/> Refresh</button>
          </div>
        </div>
        <div className="mailbox-dns-table-wrap">
          <table className="tbl mailbox-dns-table">
            <thead><tr><th>Type</th><th>Name / host</th><th>Value / target</th><th>TTL</th><th>Provider</th><th></th></tr></thead>
            <tbody>
              {records.map((record) => <tr key={record.id}>
                <td><Label tone={record.type === 'MX' ? 'green' : 'muted'}>{record.type}</Label></td>
                <td><code className="mailbox-dns-host">{record.host || record.name || '@'}</code></td>
                <td><code className="mailbox-dns-value" title={record.value}>{record.value || '—'}</code>{record.priority != null && <small className="mailbox-dns-meta">Priority {record.priority}</small>}</td>
                <td><span className="mailbox-updated">{record.ttl || 3600}s</span></td>
                <td><Label>{record.providerLabel || 'GlondiaMail'}</Label></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(record.value || '').catch(() => {})}><ICN.Copy size={13}/> Copy</button></td>
              </tr>)}
            </tbody>
          </table>
          {records.length===0 && <div className="mailbox-dns-empty"><ICN.Network size={24}/><strong>No DNS records available</strong><span>The backend has not synchronized records for this domain yet.</span></div>}
        </div>
      </section>}
      {tab==='transport' && <section className="mailbox-settings-card"><h2>IMAP & SMTP settings</h2><p>Mail-client connection details stored for this mailbox. Passwords are never stored with these settings.</p>{mailbox.transportSettings?<><div className="mailbox-dns-table-wrap"><table className="tbl mailbox-dns-table"><thead><tr><th>Protocol</th><th>Server</th><th>Port</th><th>Security</th><th>Username</th><th>Authentication</th></tr></thead><tbody><tr><td><strong>IMAP</strong></td><td><code>{mailbox.transportSettings.imap.host}</code></td><td>{mailbox.transportSettings.imap.port}</td><td>{mailbox.transportSettings.imap.security}</td><td><code>{mailbox.transportSettings.username}</code></td><td>{mailbox.transportSettings.authenticationRequired?'Required':'Not required'}</td></tr><tr><td><strong>SMTP</strong></td><td><code>{mailbox.transportSettings.smtp.host}</code></td><td>{mailbox.transportSettings.smtp.port}</td><td>{mailbox.transportSettings.smtp.security}</td><td><code>{mailbox.transportSettings.username}</code></td><td>{mailbox.transportSettings.authenticationRequired?'Required':'Not required'}</td></tr></tbody></table></div><small className="muted">Configuration synchronized {formatDate(mailbox.transportSettings.lastSyncedAt)}.</small></>:<div className="mailbox-quota-note"><ICN.Info size={14}/><span>Mail-client settings are not available for this mailbox yet.</span></div>}</section>}
      {tab==='billing' && <BillingSection scope="email-mailbox" app={{id:mailbox.businessServiceId || mailbox.id,serviceName:mailbox.email,billingPlanName:'Business Email',billingEmail:mailbox.email}}/>}
    </>}
  </>;
}
