import React from 'react';
import { ICN } from '../../icons.jsx';
import { activateServiceSandbox, clearServiceSandbox, useServiceSandbox } from './sandboxState.js';

const { useCallback, useEffect, useMemo, useState } = React;

const LOCAL_SERVICES = [
  { id: 'hosting', label: 'Hosting', icon: 'Server', status: 'local-sandbox', records: 'simulated', note: 'Test hosting list, deployment, billing lock, and management UI states.' },
  { id: 'vps', label: 'VPS Services', icon: 'Cpu', status: 'local-sandbox', records: 'simulated', note: 'Test server provisioning, provider sync, status, and settings UI states.' },
  { id: 'cloud-storage', label: 'Cloud Storage', icon: 'Database', status: 'local-sandbox', records: 'simulated', note: 'Test storage selection, provisioning, files, backups, repositories, usage, logs, billing, and settings.' },
  { id: 'domains-buy', label: 'Buy a domain', icon: 'Cart', status: 'local-sandbox', records: 'simulated', note: 'Test domain search, checkout handoff, and registration-state UI.' },
  { id: 'domains-mine', label: 'My domains', icon: 'Globe', status: 'local-sandbox', records: 'simulated', note: 'Test owned-domain lists, DNS editor, and verification UI states.' },
  { id: 'email', label: 'Email setup', icon: 'Mail', status: 'local-sandbox', records: 'simulated', note: 'Test plan cards, setup steps, DNS records, mailbox quota, history, and checkout UI.' },
  { id: 'email-mailboxes', label: 'My emails', icon: 'Inbox', status: 'local-sandbox', records: 'simulated', note: 'Test active and expired mailbox management screens; pending setup stays hidden here.' },
  { id: 'billing', label: 'Billing', icon: 'CreditCard', status: 'local-sandbox', records: 'simulated', note: 'Review account-wide hosting, email, VPS, cloud-storage usage, invoices, payments, and totals.' },
  { id: 'support', label: 'Contact support', icon: 'MessageSquare', status: 'local-sandbox', records: 'simulated', note: 'Test ticket creation, replies, unread state, and attachment UI.' },
];

const LOCAL_SCENARIOS = [
  {
    id: 'hosting.deploy',
    service: 'hosting',
    targetView: 'hosting-list',
    label: 'Create hosting deployment',
    method: 'SIMULATE',
    path: 'Hosting tab / deployment flow',
    description: 'Simulates deployment validation, billing lock, provider handoff, and a running hosting service card.',
    payload: { projectName: 'glondia-sandbox-site', source: 'zip', plan: 'starter', desiredState: 'running' },
  },
  {
    id: 'hosting.expired',
    service: 'hosting',
    targetView: 'hosting-list',
    label: 'Hosting expired for non-payment',
    method: 'SIMULATE',
    path: 'Hosting tab / lifecycle state',
    description: 'Simulates an expired hosting service so the UI can test repayment and recovery states.',
    payload: { projectName: 'past-due-site', billingStatus: 'past_due', serviceStatus: 'suspended' },
  },
  {
    id: 'vps.provision',
    service: 'vps',
    targetView: 'vps-hosting',
    label: 'Provision VPS service',
    method: 'SIMULATE',
    path: 'VPS Services tab / create wizard',
    description: 'Simulates VPS plan validation, region selection, billing, and provider sync states.',
    payload: { label: 'sandbox-vps', region: 'syd', plan: 'vc2-1c-1gb', operatingSystem: 'ubuntu-24.04' },
  },
  {
    id: 'cloud-storage.create',
    service: 'cloud-storage',
    targetView: 'cloud-storage-create',
    label: 'Create Cloud Storage service',
    method: 'SIMULATE',
    path: 'Cloud Storage / guided creation',
    description: 'Walk through service, tenancy, plan and confirmation without checkout or provider calls.',
    payload: { serviceKind: 'private_vault', tenancy: 'shared', planSize: 'smallest', region: 'syd', name: 'Sandbox File Storage' },
  },
  {
    id: 'cloud-storage.active',
    service: 'cloud-storage',
    targetView: 'cloud-storage-detail',
    targetParams: { id: 'sandbox-cloud-storage-1' },
    label: 'Active file storage',
    method: 'SIMULATE',
    path: 'Cloud Storage / active service',
    description: 'Shows a provisioned private cloud hard drive with files, usage, billing, credentials, settings and logs.',
    payload: { serviceKind: 'private_vault', tenancy: 'dedicated', planSize: 'largest', region: 'syd', name: 'Company File Storage', storageUsedGb: 286 },
  },
  {
    id: 'cloud-storage.postgres',
    service: 'cloud-storage',
    targetView: 'cloud-storage-detail',
    targetParams: { id: 'sandbox-cloud-storage-1' },
    label: 'Running PostgreSQL database',
    method: 'SIMULATE',
    path: 'Cloud Storage / PostgreSQL detail',
    description: 'Shows a running PostgreSQL 16 service with pooling, trusted networks, backups, usage, billing and connection instructions.',
    payload: { serviceKind: 'postgres', tenancy: 'dedicated', planSize: 'smallest', region: 'syd', name: 'Production Database', storageUsedGb: 18, postgresVersion: '16' },
  },
  {
    id: 'cloud-storage.backup',
    service: 'cloud-storage',
    targetView: 'cloud-storage-detail',
    targetParams: { id: 'sandbox-cloud-storage-1' },
    label: 'SSH backup and restore points',
    method: 'SIMULATE',
    path: 'Cloud Storage / backup detail',
    description: 'Shows SFTP/rsync access, retention settings, restore points and provisioning logs.',
    payload: { serviceKind: 'ssh_backup', tenancy: 'dedicated', planSize: 'smallest', region: 'sgp', name: 'Production Backups', storageUsedGb: 74 },
  },
  {
    id: 'cloud-storage.repository',
    service: 'cloud-storage',
    targetView: 'cloud-storage-detail',
    targetParams: { id: 'sandbox-cloud-storage-1' },
    label: 'Private repository deployment',
    method: 'SIMULATE',
    path: 'Cloud Storage / repository detail',
    description: 'Shows private Git access, webhook settings and a branch-triggered hosting deployment log.',
    payload: { serviceKind: 'private_repository', tenancy: 'shared', planSize: 'smallest', region: 'syd', name: 'Website Repository', deploymentBranch: 'main' },
  },
  {
    id: 'domains.search',
    service: 'domains-buy',
    targetView: 'domains-buy',
    label: 'Domain search and checkout',
    method: 'SIMULATE',
    path: 'Buy a domain tab / search',
    description: 'Simulates a domain availability result and checkout-ready registration card.',
    payload: { query: 'glondia-sandbox.com', availability: 'available', priceCents: 1299 },
  },
  {
    id: 'domains.dns',
    service: 'domains-mine',
    targetView: 'domains-mine',
    label: 'DNS record update',
    method: 'SIMULATE',
    path: 'My domains tab / DNS editor',
    description: 'Simulates DNS record validation and propagation UI without changing registrar records.',
    payload: { domain: 'glondia-sandbox.com', type: 'A', host: '@', value: '203.0.113.10', propagation: 'pending' },
  },
  {
    id: 'email.setup',
    service: 'email',
    targetView: 'email',
    label: 'Email setup flow',
    method: 'SIMULATE',
    path: 'Email tab / setup wizard',
    description: 'Simulates selecting a mailbox plan, connecting a domain, DNS checks, mailbox creation, summary, and checkout.',
    payload: { plan: 'email-5', domain: 'glondia-sandbox.com', mailbox: 'info', mailboxStatus: 'pending_setup' },
  },
  {
    id: 'email.mailboxes',
    service: 'email-mailboxes',
    targetView: 'email-mailboxes',
    label: 'My emails management',
    method: 'SIMULATE',
    path: 'My emails tab / mailbox settings',
    description: 'Simulates active and expired mailbox cards while excluding pending setup records.',
    payload: { domain: 'glondia-sandbox.com', active: ['info@glondia-sandbox.com'], expired: ['billing@glondia-sandbox.com'], pendingHidden: true },
  },
  {
    id: 'billing.checkout',
    service: 'billing',
    targetView: 'billing',
    label: 'Account usage and invoice',
    method: 'SIMULATE',
    path: 'Billing tab / account usage',
    description: 'Simulates markup-inclusive customer usage across website hosting, email, VPS, object storage, and block storage with an invoice and payment history.',
    payload: { account: 'Northstar Trading', currency: 'USD', services: ['hosting', 'email', 'vps', 'cloud_storage'] },
  },
  {
    id: 'billing.settlement',
    service: 'billing',
    targetView: 'billing',
    label: 'Glondia to Vultr settlement',
    method: 'SIMULATE',
    path: 'Billing tab / complete payment lifecycle',
    description: 'Shows a $130 client invoice, $130 PayPal capture, $100 Vultr liability, and the verified provider settlement that leaves Glondia with a $30 gross platform margin.',
    payload: { account: 'Northstar Trading', provider: 'vultr', providerCostCents: 10000, markupPercent: 30, customerTotalCents: 13000, currency: 'USD' },
  },
  {
    id: 'billing.failed',
    service: 'billing',
    targetView: 'billing',
    label: 'Failed payment notification',
    method: 'SIMULATE',
    path: 'Billing tab / failed payment',
    description: 'Simulates a bounced provider payment, customer-safe billing alert, failed transaction row, and unread notification bell item.',
    payload: { account: 'Northstar Trading', paymentStatus: 'failed', serviceType: 'vps', currency: 'USD' },
  },
  {
    id: 'support.ticket',
    service: 'support',
    targetView: 'support',
    label: 'Support ticket conversation',
    method: 'SIMULATE',
    path: 'Contact support tab / ticket thread',
    description: 'Simulates creating a support ticket, adding a message, and rendering unread/replied states.',
    payload: { subject: 'Sandbox support test', priority: 'normal', message: 'Testing customer support UI.' },
  },
];

function Icon({ name, size = 16 }) {
  const Component = ICN[name] || ICN.Code;
  return <Component size={size} />;
}

function StatusPill({ value }) {
  const text = String(value || 'sandbox-only');
  const tone = text.includes('configured') || text.includes('ready') ? 'green' : 'amber';
  return <span className={`sandbox-pill ${tone}`}>{text.replace(/-/g, ' ')}</span>;
}

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return { parsed, error: '' };
  } catch (err) {
    return { parsed: null, error: err.message || 'Invalid JSON.' };
  }
}

export default function ServiceSandboxPage({ navigate }) {
  const [catalog, setCatalog] = useState({ services: LOCAL_SERVICES, scenarios: LOCAL_SCENARIOS });
  const [selectedId, setSelectedId] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeSandbox = useServiceSandbox(React);

  const selectedScenario = useMemo(
    () => catalog.scenarios.find((scenario) => scenario.id === selectedId) || catalog.scenarios[0] || null,
    [catalog.scenarios, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true); setError('');
    setCatalog({ services: LOCAL_SERVICES, scenarios: LOCAL_SCENARIOS });
    const first = LOCAL_SCENARIOS[0] || null;
    setSelectedId((current) => current || first?.id || '');
    if (first) setPayloadText(prettyJson(first.payload));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const chooseScenario = (scenario) => {
    setSelectedId(scenario.id);
    setPayloadText(prettyJson(scenario.payload));
    setError('');
  };

  const activateScenario = (scenario = selectedScenario) => {
    if (!scenario) return;
    const parsed = parsePayload(payloadText);
    if (parsed.error) {
      setError(`Payload JSON error: ${parsed.error}`);
      return;
    }
    activateServiceSandbox({ ...scenario, payload: parsed.parsed });
    navigate?.({ view: scenario.targetView || scenario.service, params: scenario.targetParams || {} });
  };

  return (
    <>
      <style>{`
        .sandbox-shell { display:grid; gap:18px; }
        .sandbox-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
        .sandbox-service-card { min-width:0; border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); padding:14px; display:grid; gap:10px; }
        .sandbox-service-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
        .sandbox-service-icon { width:34px; height:34px; display:grid; place-items:center; border-radius:9px; background:var(--accent-soft); color:var(--accent); }
        .sandbox-service-card h3 { margin:0; font-size:15px; }
        .sandbox-service-card p { margin:0; color:var(--muted); font-size:12px; line-height:1.4; }
        .sandbox-service-card small { color:var(--muted); }
        .sandbox-pill { display:inline-flex; width:max-content; border-radius:999px; padding:4px 8px; font-size:11px; font-weight:800; text-transform:capitalize; }
        .sandbox-pill.green { background:var(--accent-soft); color:var(--accent); }
        .sandbox-pill.amber { background:color-mix(in srgb,var(--warning) 14%,transparent); color:var(--warning); }
        .sandbox-runner { display:grid; grid-template-columns:minmax(260px,.85fr) minmax(0,1.15fr); gap:16px; }
        .sandbox-panel { border:1px solid var(--border); border-radius:10px; background:var(--bg-elev); padding:18px; min-width:0; }
        .sandbox-panel h2 { margin:0 0 6px; font-size:19px; }
        .sandbox-panel p { margin:0 0 14px; color:var(--muted); font-size:13px; line-height:1.45; }
        .sandbox-scenarios { display:grid; gap:9px; }
        .sandbox-scenario { width:100%; border:1px solid var(--border); border-radius:9px; background:var(--bg-deep); color:var(--text); padding:12px; display:grid; gap:6px; text-align:left; cursor:pointer; }
        .sandbox-scenario.active { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
        .sandbox-scenario strong { font-size:13px; }
        .sandbox-scenario span { color:var(--muted); font-size:11px; font-weight:800; text-transform:uppercase; }
        .sandbox-payload { display:grid; gap:10px; }
        .sandbox-payload textarea { min-height:190px; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; }
        .sandbox-endpoint { display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-deep); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
        .sandbox-method { color:var(--accent); font-weight:900; }
        .sandbox-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
        .sandbox-code { max-height:380px; overflow:auto; white-space:pre-wrap; padding:12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-deep); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.45; }
        @media(max-width:1100px){.sandbox-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sandbox-runner{grid-template-columns:1fr}}
        @media(max-width:640px){.sandbox-grid{grid-template-columns:1fr}.sandbox-actions{display:grid}.sandbox-trace-row{grid-template-columns:1fr}}
      `}</style>

      <div className="page-head">
        <div>
          <div className="page-eyebrow">Local UI sandbox</div>
          <h1>Service Sandbox</h1>
          <p className="sub">Activate a sandbox scenario, then use the real dashboard tab like a client. No real app API, provider API, or database request is made while that scenario is active.</p>
          {activeSandbox && <p className="sub" style={{ marginTop: 6 }}>Active: {activeSandbox.label}. Open the matching dashboard tab to walk through it like a client.</p>}
        </div>
        <div className="actions">
          {activeSandbox && (
            <button className="btn btn-outline" onClick={clearServiceSandbox}>
              <ICN.X size={14} /> Turn off sandbox
            </button>
          )}
        </div>
      </div>

      {error && <div className="sandbox-panel" style={{ color: 'var(--danger)' }}>{error}</div>}

      <div className="sandbox-shell">
        <div className="sandbox-grid">
          {catalog.services.map((service) => (
            <article className="sandbox-service-card" key={service.id}>
              <div className="sandbox-service-head">
                <span className="sandbox-service-icon"><Icon name={service.icon} size={18} /></span>
                <StatusPill value={service.status} />
              </div>
              <div>
                <h3>{service.label}</h3>
                <p>{service.note}</p>
              </div>
              <small>{service.records == null ? 'Records unavailable' : `${service.records} scoped records`}</small>
            </article>
          ))}
        </div>

        <div className="sandbox-runner">
          <section className="sandbox-panel">
            <h2>Scenarios</h2>
            <p>Choose the customer situation you want to walk through. Site Builder is intentionally excluded.</p>
            <div className="sandbox-scenarios">
              {catalog.scenarios.map((scenario) => (
                <button
                  className={`sandbox-scenario${selectedScenario?.id === scenario.id ? ' active' : ''}`}
                  key={scenario.id}
                  type="button"
                  onClick={() => chooseScenario(scenario)}
                >
                  <span>{scenario.service} · {scenario.method}</span>
                  <strong>{scenario.label}</strong>
                  <small className="muted">{scenario.description}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="sandbox-panel">
            <h2>Activate client walkthrough</h2>
            {selectedScenario ? (
              <>
                <p>{selectedScenario.description} Edit the fixture payload if you want a different domain, amount, or service label before opening the tab.</p>
                <div className="sandbox-endpoint">
                  <span className="sandbox-method">{selectedScenario.method}</span>
                  <span>{selectedScenario.path}</span>
                </div>
                <div className="sandbox-payload" style={{ marginTop: 12 }}>
                  <label className="label" htmlFor="sandbox-payload">Payload JSON</label>
                  <textarea
                    id="sandbox-payload"
                    className="input"
                    value={payloadText}
                    onChange={(event) => setPayloadText(event.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="sandbox-actions">
                  <button className="btn btn-outline" type="button" onClick={() => setPayloadText(prettyJson(selectedScenario.payload))}>
                    Reset payload
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => activateScenario(selectedScenario)}>
                    <ICN.ArrowRight size={14} /> Activate and open tab
                  </button>
                </div>
              </>
            ) : (
              <p>No sandbox scenarios are available.</p>
            )}

          </section>
        </div>
      </div>
    </>
  );
}
