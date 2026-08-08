/**
 * Business Email setup wizard.
 * This page configures domain DNS and mailbox requests. Reading/sending mail
 * stays in GlondiaMail.
 */
import React from 'react';
import { ICN } from '../../icons';
import {
  getEmailStatus,
  getEmailMailboxCapacity,
  getEmailPlans,
  selectEmailPlan,
  listEmailMailboxes,
  requestEmailMailbox,
  getEmailDnsRecords,
  checkEmailDns,
} from '../../api/email.js';
import { getStoredAuth, listRegisteredDomains } from '../../api.js';
import { isLiveMode } from '../../app/config.js';
import SandboxBanner from '../sandbox/SandboxBanner.jsx';

const { useState, useEffect, useCallback, useMemo } = React;

const STEPS = [
  { id: 'plan', label: 'Choose Plan', note: 'Select mailbox capacity' },
  { id: 'domain', label: 'Select Domain', note: 'Choose the address family' },
  { id: 'dns', label: 'Configure DNS', note: 'Add mail records' },
  { id: 'propagation', label: 'DNS Propagation', note: 'Check public records' },
  { id: 'mailbox', label: 'Create Mailbox', note: 'Request the first inbox' },
  { id: 'ready', label: 'Mailbox request', note: 'Confirm setup details' },
];

const PRESETS = ['info', 'admin', 'sales', 'support', 'careers', 'billing'];

const DEFAULT_EMAIL_PLANS = Object.freeze([
  Object.freeze({ id: 'email-5', name: 'Starter Mail', mailboxLimit: 5, unitPriceCents: 100, monthlyPriceCents: 500, currency: 'USD', billingCycle: 'monthly' }),
  Object.freeze({ id: 'email-15', name: 'Business Mail', mailboxLimit: 15, unitPriceCents: 100, monthlyPriceCents: 1500, currency: 'USD', billingCycle: 'monthly' }),
  Object.freeze({ id: 'email-25', name: 'Team Mail', mailboxLimit: 25, unitPriceCents: 100, monthlyPriceCents: 2500, currency: 'USD', billingCycle: 'monthly' }),
]);

const DNS_STATUS = {
  not_checked: { label: 'Not checked', tone: 'muted' },
  checking: { label: 'Checking', tone: 'blue' },
  found: { label: 'Found', tone: 'green' },
  waiting: { label: 'Waiting for propagation', tone: 'amber' },
  incorrect: { label: 'Incorrect value', tone: 'red' },
  missing: { label: 'Missing', tone: 'red' },
};

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function isValidDomain(value) {
  const domain = normalizeDomain(value);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain);
}

function cleanMailboxName(value) {
  return String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9._-]/g, '');
}

function generateMailboxPassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*+-_'];
  const all = groups.join('');
  const bytes = new Uint32Array(18);
  window.crypto.getRandomValues(bytes);
  const chars = groups.map((group, index) => group[bytes[index] % group.length]);
  for (let index = groups.length; index < bytes.length; index += 1) chars.push(all[bytes[index] % all.length]);
  return chars
    .map((char, index) => ({ char, rank: bytes[index] }))
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.char)
    .join('');
}

function mailboxAddress(mailbox) {
  if (!mailbox) return '';
  if (mailbox.email) return mailbox.email;
  if (mailbox.mailboxName && mailbox.domain) return `${mailbox.mailboxName}@${mailbox.domain}`;
  return '';
}

const EMAIL_SETUP_HISTORY_KEY = 'glondia.email.setupHistory.v1';
const EMAIL_SETUP_DRAFTS_KEY = 'glondia.email.setupDrafts.v1';

function setupHistoryStorageKey() {
  if (typeof window === 'undefined') return EMAIL_SETUP_HISTORY_KEY;
  const auth = getStoredAuth();
  const accountId = auth?.user?.id || auth?.user?.email || auth?.organizationId || 'anonymous';
  return `${EMAIL_SETUP_HISTORY_KEY}.${accountId}`;
}

function setupDraftsStorageKey() {
  if (typeof window === 'undefined') return EMAIL_SETUP_DRAFTS_KEY;
  const auth = getStoredAuth();
  const accountId = auth?.user?.id || auth?.user?.email || auth?.organizationId || 'anonymous';
  return `${EMAIL_SETUP_DRAFTS_KEY}.${accountId}`;
}

function loadSetupDrafts() {
  if (typeof window === 'undefined') return [];

  try {
    const stored = JSON.parse(window.localStorage.getItem(setupDraftsStorageKey()) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((draft) => draft && typeof draft.id === 'string' && typeof draft.planId === 'string')
      .map((draft) => ({
        id: draft.id,
        planId: draft.planId,
        planName: String(draft.planName || 'Business Email'),
        mailboxLimit: Number(draft.mailboxLimit || 0),
        currentStep: ['domain', 'dns', 'propagation', 'mailbox', 'ready'].includes(draft.currentStep)
          ? draft.currentStep
          : 'domain',
        selectedDomain: normalizeDomain(draft.selectedDomain),
        mailboxName: cleanMailboxName(draft.mailboxName),
        pendingEmail: typeof draft.pendingEmail === 'string' ? draft.pendingEmail : '',
        lastAction: String(draft.lastAction || 'Setup started'),
        createdAt: String(draft.createdAt || new Date().toISOString()),
        updatedAt: String(draft.updatedAt || draft.createdAt || new Date().toISOString()),
        status: 'incomplete',
      }))
      .slice(-20);
  } catch {
    return [];
  }
}

function persistSetupDrafts(drafts) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(setupDraftsStorageKey(), JSON.stringify(drafts));
}

function makeEvent(title, detail) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    detail,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date().toISOString(),
    status: 'incomplete',
  };
}

function loadSetupHistory() {
  if (typeof window === 'undefined') return [];

  try {
    const stored = JSON.parse(window.localStorage.getItem(setupHistoryStorageKey()) || '[]');
    if (!Array.isArray(stored)) return [];

    return stored
      .filter((event) => event && typeof event.id === 'string' && typeof event.title === 'string')
      .map((event) => ({
        id: event.id,
        title: event.title,
        detail: typeof event.detail === 'string' ? event.detail : '',
        time: typeof event.time === 'string' ? event.time : '',
        createdAt: typeof event.createdAt === 'string' ? event.createdAt : '',
        status: 'incomplete',
      }))
      .slice(-40);
  } catch {
    return [];
  }
}

function initialSetupHistory() {
  const stored = loadSetupHistory();
  return stored.length
    ? stored
    : [makeEvent('Setup started', 'Choose a mailbox plan to begin Business Email setup.')];
}

function recordPurpose(record) {
  const type = String(record?.type || '').toUpperCase();
  const id = String(record?.id || '').toLowerCase();
  if (record?.purpose) return record.purpose;
  if (type === 'MX') return 'Routes inbound email to GlondiaMail.';
  if (type === 'TXT' && (id.includes('spf') || String(record?.value || '').includes('spf1'))) {
    return 'Authorizes GlondiaMail to send for this domain.';
  }
  if (type === 'TXT' && (id.includes('dkim') || String(record?.host || '').includes('_domainkey'))) {
    return 'Adds a signature that protects outgoing mail.';
  }
  if (type === 'TXT' && (id.includes('dmarc') || String(record?.host || '').includes('_dmarc'))) {
    return 'Tells receivers how to handle suspicious mail.';
  }
  return 'Required email DNS record.';
}

function normalizeRecords(dns) {
  const records = Array.isArray(dns?.records) ? dns.records : [];
  return records.map((record, index) => ({
    id: record.id || `${record.type || 'record'}-${record.host || index}-${index}`,
    type: String(record.type || '').toUpperCase(),
    host: record.host || record.name || '@',
    name: record.name || record.host || '@',
    priority: record.priority,
    value: record.value || record.data || '',
    purpose: recordPurpose(record),
    raw: record,
  }));
}

function normalizeRecordStatus(value) {
  const status = String(value || '').toLowerCase().replace(/\s+/g, '_');
  if (['found', 'verified', 'valid', 'pass', 'passed', 'ok', 'active'].includes(status)) return 'found';
  if (['missing', 'not_found'].includes(status)) return 'missing';
  if (['incorrect', 'wrong', 'mismatch', 'invalid'].includes(status)) return 'incorrect';
  if (['checking', 'in_progress'].includes(status)) return 'checking';
  if (['waiting', 'pending', 'pending_propagation', 'manual', 'setup_required'].includes(status)) return 'waiting';
  return 'not_checked';
}

function matchRecordCheck(record, dnsCheck) {
  const checks = Array.isArray(dnsCheck?.records) ? dnsCheck.records : [];
  return checks.find((item) => {
    const itemId = String(item.id || '').toLowerCase();
    const itemType = String(item.type || '').toUpperCase();
    const itemHost = String(item.host || item.name || '').toLowerCase();
    return (
      itemId === String(record.id || '').toLowerCase() ||
      (itemType === record.type && itemHost === String(record.host || record.name || '').toLowerCase())
    );
  });
}

function getRecordStatus(record, dnsCheck, checkingDns) {
  if (checkingDns) return 'checking';
  const match = matchRecordCheck(record, dnsCheck);
  if (match) return normalizeRecordStatus(match.status || match.check || match.result);
  if (dnsCheck?.status) return normalizeRecordStatus(dnsCheck.status);
  return 'not_checked';
}

function domainStatus(selectedDomain, domains) {
  if (!isValidDomain(selectedDomain)) return { label: 'Needs domain', tone: 'muted' };
  return domains.includes(selectedDomain)
    ? { label: 'Connected', tone: 'green' }
    : { label: 'Manual', tone: 'amber' };
}

function isActiveMailbox(box) {
  return String(box?.status || '').toLowerCase().replace(/\s+/g, '_') === 'active';
}

function StatusPill({ label, tone = 'muted' }) {
  return <span className={`email-setup-pill ${tone}`}>{label}</span>;
}

function CopyRecordButton({ value, onCopied }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-sm btn-outline email-copy-btn ${copied ? 'copied' : ''}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        onCopied?.();
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <ICN.Copy size={13} /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function SetupStepper({ currentStep, completed, onStep }) {
  const setupSteps = STEPS.filter((step) => step.id !== 'plan');
  const currentIndex = setupSteps.findIndex((step) => step.id === currentStep);
  const doneCount = setupSteps.filter((step) => completed[step.id]).length;
  const progress = Math.round((doneCount / setupSteps.length) * 100);
  return (
    <div className="email-stepper-wrap">
      <div className="email-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <span className="email-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="email-setup-stepper">
        {setupSteps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isDone = completed[step.id];
          const isReachable = completed.plan && (isDone || index <= currentIndex + 1);
          return (
            <button
              key={step.id}
              type="button"
              className={`email-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
              disabled={!isReachable}
              onClick={() => isReachable && onStep(step.id)}
              style={{ '--email-step-delay': `${index * 60}ms` }}
            >
              <span className="email-step-index">
                {isDone ? <ICN.Check size={15} /> : index + 1}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.note}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanSelectionStep({ plans, selectedPlan, busyPlanId, error, onSelect }) {
  const visiblePlans = Array.isArray(plans) && plans.length ? plans : DEFAULT_EMAIL_PLANS;
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 1</div>
          <h2>Choose your Business Email plan</h2>
          <p className="muted">Each mailbox is USD $1 per month. Choose the capacity that fits your team.</p>
        </div>
        {selectedPlan && <StatusPill label="Plan selected" tone="green" />}
      </div>

      <div className="email-plan-grid">
        {visiblePlans.map((plan) => {
          const selected = selectedPlan?.id === plan.id;
          const busy = busyPlanId === plan.id;
          return (
            <article className={`email-plan-card ${selected ? 'selected' : ''}`} key={plan.id}>
              <div>
                <span className="email-plan-capacity">{plan.mailboxLimit} mailboxes</span>
                <h3>{plan.name}</h3>
                <p><strong>${(plan.monthlyPriceCents / 100).toFixed(0)}</strong><span> USD / month</span></p>
                <small>${(plan.unitPriceCents / 100).toFixed(0)} per mailbox, billed monthly</small>
              </div>
              <button
                className={selected ? 'btn btn-outline email-full-width' : 'btn btn-primary email-full-width'}
                type="button"
                disabled={Boolean(busyPlanId)}
                onClick={() => onSelect(plan)}
              >
                {busy ? 'Starting setup...' : `Start new setup — ${plan.mailboxLimit} mailboxes`}
              </button>
            </article>
          );
        })}
      </div>
      {error && <p className="email-field-note danger">{error}</p>}
    </section>
  );
}

function DomainSetupStep({
  domains,
  selectedDomain,
  manualDomain,
  setManualDomain,
  onSelectDomain,
  onBack,
  onContinue,
  navigate,
}) {
  const selectedStatus = domainStatus(selectedDomain, domains);
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 2</div>
          <h2>Select Domain</h2>
          <p className="muted">Pick the domain that will receive professional email addresses.</p>
        </div>
        <StatusPill label={selectedStatus.label} tone={selectedStatus.tone} />
      </div>

      {domains.length > 0 ? (
        <div className="email-domain-grid">
          {domains.map((domain) => (
            <button
              key={domain}
              type="button"
              className={`email-domain-option ${selectedDomain === domain ? 'selected' : ''}`}
              onClick={() => onSelectDomain(domain, 'Domain selected')}
            >
              <span className="email-domain-radio" />
              <span>
                <strong>{domain}</strong>
                <small>Use this domain for GlondiaMail setup</small>
              </span>
              <StatusPill label={selectedDomain === domain ? 'Selected' : 'Available'} tone={selectedDomain === domain ? 'green' : 'muted'} />
            </button>
          ))}
        </div>
      ) : (
        <div className="email-empty-panel">
          <strong>No connected domains found.</strong>
          <p className="muted">You can buy a new domain or use one you already own.</p>
          <div className="email-inline-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => navigate?.({ view: 'domains-buy' })}
            >
              Buy a domain
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => document.getElementById('manual-domain')?.focus()}>
              Use a domain I already own
            </button>
          </div>
        </div>
      )}

      <div className="email-manual-domain">
        <label className="label" htmlFor="manual-domain">Use a domain I already own</label>
        <div className="email-input-row">
          <input
            id="manual-domain"
            className="input"
            placeholder="example.com"
            value={manualDomain}
            onChange={(event) => setManualDomain(normalizeDomain(event.target.value))}
          />
          <button
            type="button"
            className="btn btn-outline"
            disabled={!isValidDomain(manualDomain)}
            onClick={() => onSelectDomain(manualDomain, 'Manual domain added')}
          >
            Use domain
          </button>
        </div>
        {manualDomain && !isValidDomain(manualDomain) && (
          <p className="email-field-note danger">Enter a domain like example.com.</p>
        )}
      </div>

      <div className="email-card-actions">
        <button className="btn btn-outline" type="button" onClick={onBack}>
          Back to plans
        </button>
        <button className="btn btn-primary" type="button" disabled={!isValidDomain(selectedDomain)} onClick={onContinue}>
          Continue to DNS setup
        </button>
      </div>
    </section>
  );
}

function DnsRecordsStep({ selectedDomain, records, dnsLoading, onBack, onContinue, onCopy }) {
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 3</div>
          <h2>Configure DNS</h2>
          <p className="muted">Add these MX, SPF, DKIM, and DMARC records at your DNS provider.</p>
        </div>
        <StatusPill label={selectedDomain || 'No domain'} tone={isValidDomain(selectedDomain) ? 'green' : 'muted'} />
      </div>

      <button className="btn btn-outline email-coming-soon" type="button" disabled>
        Auto-configure DNS - coming soon
      </button>

      {dnsLoading && records.length === 0 ? (
        <div className="email-loading-panel">Loading DNS records...</div>
      ) : records.length === 0 ? (
        <div className="email-empty-panel">
          <strong>No DNS records returned yet.</strong>
          <p className="muted">Choose a valid domain first, then refresh this setup step.</p>
        </div>
      ) : (
        <div className="email-record-grid">
          {records.map((record) => (
            <article className="email-record-card" key={record.id}>
              <div className="email-record-head">
                <div className="email-record-identity">
                  <span className="email-record-type">{record.type}</span>
                  <h3>{record.purpose}</h3>
                </div>
                <CopyRecordButton
                  value={`${record.type} ${record.host} ${record.priority != null ? `${record.priority} ` : ''}${record.value}`}
                  onCopied={() => onCopy(record)}
                />
              </div>
              <div className="email-record-fields">
                <div className="email-record-field email-record-field-short">
                  <span>Host</span>
                  <code>{record.host}</code>
                </div>
                {record.priority != null && (
                  <div className="email-record-field email-record-field-short">
                    <span>Priority</span>
                    <code>{record.priority}</code>
                  </div>
                )}
                <div className="email-record-field email-record-value">
                  <span>Value</span>
                  <code>{record.value}</code>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="email-card-actions">
        <button className="btn btn-outline" type="button" onClick={onBack}>Back</button>
        <button className="btn btn-primary" type="button" disabled={records.length === 0} onClick={onContinue}>
          I have added these records
        </button>
      </div>
    </section>
  );
}

function DnsPropagationStep({ records, dnsCheck, checkingDns, lastCheckedAt, onCheck, onBack, onContinue }) {
  const total = records.length;
  const foundCount = records.filter((record) => getRecordStatus(record, dnsCheck, false) === 'found').length;
  const verified = total > 0 && foundCount === total;
  const hasChecked = Boolean(dnsCheck) && !checkingDns;
  const pct = total ? Math.round((foundCount / total) * 100) : 0;
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 4</div>
          <h2>DNS Propagation</h2>
          <p className="muted">We query public DNS live and report exactly what resolves right now.</p>
        </div>
        <button
          className={`btn ${verified ? 'btn-outline' : 'btn-primary'}`}
          type="button"
          onClick={onCheck}
          disabled={checkingDns || records.length === 0}
        >
          <span className={checkingDns ? 'email-spin' : ''} style={{ display: 'inline-flex' }}>
            {checkingDns ? <ICN.RefreshCw size={14} /> : <ICN.ShieldCheck size={14} />}
          </span>
          {checkingDns ? 'Checking…' : hasChecked ? 'Re-check DNS' : 'Check DNS records'}
        </button>
      </div>

      <div className={`email-propagation-meter ${verified ? 'verified' : ''}`}>
        <div className="email-propagation-meter-head">
          <strong>{checkingDns ? 'Resolving records…' : hasChecked ? `${foundCount} of ${total} records found` : 'Not checked yet'}</strong>
          {lastCheckedAt && !checkingDns && <span className="muted">Last checked {lastCheckedAt}</span>}
        </div>
        <div className="email-meter-track">
          <span className={`email-meter-fill ${checkingDns ? 'indeterminate' : ''}`} style={{ width: checkingDns ? undefined : `${pct}%` }} />
        </div>
      </div>

      {dnsCheck?.message && !checkingDns && (
        <div className={`email-check-message ${verified ? 'ok' : ''}`}>{dnsCheck.message}</div>
      )}

      <div className="email-checklist">
        {records.map((record, index) => {
          const state = getRecordStatus(record, dnsCheck, checkingDns);
          const meta = DNS_STATUS[state] || DNS_STATUS.not_checked;
          const match = matchRecordCheck(record, dnsCheck);
          return (
            <div className={`email-check-row state-${state}`} key={record.id} style={{ '--email-row-delay': `${index * 70}ms` }}>
              <span className={`email-status-dot ${meta.tone} ${checkingDns ? 'pulsing' : ''} ${state === 'found' ? 'pop' : ''}`}>
                {state === 'found' && !checkingDns && <ICN.Check size={10} />}
              </span>
              <div>
                <strong>{record.type} {record.host}</strong>
                <small>{record.purpose}</small>
                {match?.observed && !checkingDns && (
                  <code className="email-observed" title={match.observed}>{match.observed}</code>
                )}
              </div>
              <StatusPill label={meta.label} tone={meta.tone} />
            </div>
          );
        })}
      </div>

      <div className="email-card-actions">
        <button className="btn btn-outline" type="button" onClick={onBack}>Back</button>
        <button className={`btn ${verified ? 'btn-primary' : 'btn-outline'}`} type="button" onClick={onContinue}>
          {verified ? 'Continue to mailbox' : 'Skip for now — records still propagating'}
        </button>
      </div>
    </section>
  );
}

function MailboxCreateStep({
  selectedDomain,
  capacity,
  capacityLoading,
  mailboxDraft,
  setMailboxDraft,
  createdMailbox,
  busy,
  error,
  onSubmit,
  onBack,
  onFinish,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const mailboxName = cleanMailboxName(mailboxDraft.mailboxName);
  const address = mailboxName && selectedDomain ? `${mailboxName}@${selectedDomain}` : '';
  const used = Number(capacity?.used || 0);
  const allowed = Number(capacity?.allowed || 0);
  const remaining = Math.max(0, Number(capacity?.remaining ?? (allowed - used)));
  const atLimit = Boolean(capacity?.atLimit);
  const percentUsed = Number(capacity?.percentUsed || 0);
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 5</div>
          <h2>Create Mailbox</h2>
          <p className="muted">Create the email address and secure its GlondiaMail sign-in.</p>
        </div>
        {address && <StatusPill label={address} tone="blue" />}
      </div>

      <div className={`email-mailbox-usage ${atLimit ? 'at-limit' : ''}`}>
        <div className="email-mailbox-usage-head">
          <div>
            <span>Mailbox plan usage</span>
            <strong>{capacityLoading ? 'Checking allowance…' : `${used} of ${allowed} used`}</strong>
          </div>
          <StatusPill
            label={atLimit ? 'Limit reached' : `${remaining} remaining`}
            tone={atLimit ? 'red' : 'green'}
          />
        </div>
        <div className="email-mailbox-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={allowed || 1} aria-valuenow={used}>
          <span style={{ width: `${percentUsed}%` }} />
        </div>
        {atLimit && <p>Your plan is full. Choose a larger plan before creating another mailbox.</p>}
      </div>

      {createdMailbox && (
        <div className="email-check-message ok">
          {mailboxAddress(createdMailbox)} was created. The plan allowance has been checked and updated.
        </div>
      )}

      <form className="email-mailbox-form" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="mailbox-name">Mailbox</label>
          <div className="email-mailbox-builder">
            <input
              id="mailbox-name"
              className="input"
              value={mailboxDraft.mailboxName}
              disabled={atLimit || capacityLoading}
              onChange={(event) => setMailboxDraft((draft) => ({ ...draft, mailboxName: cleanMailboxName(event.target.value) }))}
              placeholder="info"
              required
            />
            <span>@ {selectedDomain || 'domain.com'}</span>
          </div>
        </div>

        <div className="email-preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={atLimit || capacityLoading}
              className={`email-preset ${mailboxName === preset ? 'selected' : ''}`}
              onClick={() => setMailboxDraft((draft) => ({ ...draft, mailboxName: preset }))}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="email-password-field">
          <label className="label" htmlFor="mailbox-password">Password</label>
          <div className="email-password-input">
            <input
              id="mailbox-password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={mailboxDraft.password}
              disabled={atLimit || capacityLoading}
              onChange={(event) => setMailboxDraft((draft) => ({ ...draft, password: event.target.value }))}
              placeholder="Create a secure password"
              required
            />
            <div className="email-password-tools">
              {mailboxDraft.password && (
                <button className="btn btn-icon btn-ghost" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                  <ICN.Eye size={15} />
                </button>
              )}
              <button
                className="btn btn-icon btn-outline"
                type="button"
                disabled={atLimit || capacityLoading}
                onClick={() => {
                  setMailboxDraft((draft) => ({ ...draft, password: generateMailboxPassword() }));
                  setShowPassword(true);
                }}
                aria-label="Generate secure password"
                title="Generate secure password"
              >
                <ICN.Wand2 size={15} />
              </button>
            </div>
          </div>
          <p className="email-field-note">At least 10 characters with uppercase, lowercase, and a number.</p>
        </div>

        {error && <div className="email-field-note danger">{error}</div>}

        <div className="email-card-actions">
          <button className="btn btn-outline" type="button" onClick={onBack}>Back</button>
          {createdMailbox && (
            <button className="btn btn-outline" type="button" onClick={onFinish}>Finish setup</button>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || capacityLoading || atLimit || !mailboxName || mailboxDraft.password.length < 10 || !isValidDomain(selectedDomain)}>
            {busy ? 'Creating mailbox...' : atLimit ? 'Mailbox limit reached' : 'Create mailbox'}
          </button>
        </div>
      </form>
    </section>
  );
}

function MailboxReadyStep({ selectedDomain, activeMailbox, createdMailbox, onDns, onPropagation }) {
  const pendingAddress = mailboxAddress(createdMailbox);
  return (
    <section className="email-main-card">
      <div className="email-card-head">
        <div>
          <div className="page-eyebrow">Step 6</div>
          <h2>Ready for GlondiaMail</h2>
          <p className="muted">Review the mailbox request, then complete checkout in the summary below.</p>
        </div>
        <StatusPill label={activeMailbox ? 'Active' : 'Pending'} tone={activeMailbox ? 'green' : 'amber'} />
      </div>

      {activeMailbox ? (
        <div className="email-ready-panel active">
          <ICN.Mail size={24} />
          <div>
            <strong>{mailboxAddress(activeMailbox)}</strong>
            <p className="muted">Domain: {activeMailbox.domain || selectedDomain}</p>
            <StatusPill label="Active" tone="green" />
          </div>
        </div>
      ) : (
        <div className="email-ready-panel">
          <ICN.Mail size={24} />
          <div>
            <strong>{pendingAddress || `Mailbox for ${selectedDomain || 'your domain'}`}</strong>
            <p className="muted">
              This is waiting on setup or activation. DNS may still be propagating, and the mailbox request stays safe here.
            </p>
          </div>
        </div>
      )}

      <div className="email-card-actions">
        <button className="btn btn-outline" type="button" onClick={onPropagation}>
          Check DNS
        </button>
        <button className="btn btn-outline" type="button" onClick={onDns}>
          View DNS
        </button>
        <button className="btn btn-ghost" type="button" disabled title="Coming soon">
          Send setup link
        </button>
      </div>
    </section>
  );
}

function SetupSummary({ status, selectedDomain, domains, dnsCheck, mailboxes, activeMailbox, onRefresh, onCheckout }) {
  const selectedStatus = domainStatus(selectedDomain, domains);
  const domainMailboxes = mailboxes.filter((box) => box.domain === selectedDomain);
  const dnsState = dnsCheck ? normalizeRecordStatus(dnsCheck.status || dnsCheck.result || 'waiting') : 'not_checked';
  const dnsMeta = DNS_STATUS[dnsState] || DNS_STATUS.not_checked;
  const selectedPlan = status?.selectedPlan || null;
  const allowed = Number(status?.capacity?.allowed ?? selectedPlan?.mailboxLimit ?? 0);
  const used = Number(status?.capacity?.used ?? status?.mailboxCount ?? mailboxes.length ?? 0);
  const remaining = Math.max(0, Number(status?.capacity?.remaining ?? (allowed - used)));
  const percentUsed = allowed ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
  const monthlyPrice = selectedPlan?.monthlyPriceCents != null
    ? `$${(selectedPlan.monthlyPriceCents / 100).toFixed(0)} / month`
    : 'Pending';
  return (
    <aside className="email-summary-card">
      <div className="email-summary-head">
        <div>
          <div className="page-eyebrow">Summary</div>
          <h3>Setup summary</h3>
          <p>Review your Business Email setup and mailbox allowance.</p>
        </div>
        <StatusPill label={activeMailbox ? 'Mail ready' : 'Provisioning'} tone={activeMailbox ? 'green' : 'amber'} />
      </div>

      <div className="email-summary-hero">
        <span className="email-summary-hero-icon"><ICN.Mail size={20} /></span>
        <div>
          <span>Business Email domain</span>
          <strong>{selectedDomain || 'No domain selected'}</strong>
          <small>{domainMailboxes.length} mailbox{domainMailboxes.length === 1 ? '' : 'es'} created for this domain</small>
        </div>
      </div>

      <div className="email-summary-usage">
        <div className="email-summary-usage-head">
          <div>
            <span>Mailbox allowance</span>
            <strong>{selectedPlan ? selectedPlan.name : 'No plan selected'}</strong>
          </div>
          <b>{allowed ? `${used} / ${allowed} used` : 'Not available'}</b>
        </div>
        <div className="email-summary-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={allowed || 1} aria-valuenow={used}>
          <span style={{ width: `${percentUsed}%` }} />
        </div>
        <small>{remaining} mailbox{remaining === 1 ? '' : 'es'} remaining on this plan</small>
      </div>

      <div className="email-summary-grid">
        <article><span>Domain</span><StatusPill label={selectedStatus.label} tone={selectedStatus.tone} /></article>
        <article><span>DNS records</span><StatusPill label={dnsMeta.label} tone={dnsMeta.tone} /></article>
        <article><span>Email provider</span><StatusPill label={status?.configured ? 'Configured' : 'Needs configuration'} tone={status?.configured ? 'green' : 'amber'} /></article>
        <article><span>GlondiaMail</span><StatusPill label={activeMailbox ? 'Ready' : 'Pending'} tone={activeMailbox ? 'green' : 'amber'} /></article>
      </div>

      {status?.message && <div className="email-summary-note"><ICN.Info size={15} /><p>{status.message}</p></div>}

      <div className="email-checkout-card">
        <div>
          <span>Checkout</span>
          <strong>{monthlyPrice}</strong>
          <small>{selectedPlan ? `${selectedPlan.mailboxLimit} mailboxes at $${((selectedPlan.unitPriceCents || 100) / 100).toFixed(0)} each` : 'Choose a plan to calculate checkout.'}</small>
        </div>
        <StatusPill label={status?.selectedPlan?.billingStatus === 'paid' ? 'Paid' : 'Payment pending'} tone={status?.selectedPlan?.billingStatus === 'paid' ? 'green' : 'amber'} />
      </div>

      <div className="email-summary-actions">
        <button className="btn btn-outline" type="button" onClick={onRefresh}>
          <ICN.RefreshCw size={14} /> Refresh status
        </button>
        <button className="btn btn-primary" type="button" onClick={onCheckout}>
          <ICN.CreditCard size={14} /> Continue to checkout
        </button>
      </div>
    </aside>
  );
}

function ActivityTimeline({ drafts, onResume, onClose }) {
  const [expandedId, setExpandedId] = useState('');

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="email-activity-backdrop" onMouseDown={onClose}>
      <section
        className="email-activity-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-activity-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="email-activity-head">
          <div>
            <div className="page-eyebrow">Setup history</div>
            <h2 id="email-activity-title">Activity timeline</h2>
          </div>
          <button className="btn btn-sm btn-outline" type="button" onClick={onClose} autoFocus>
            <ICN.X size={14} /> Close
          </button>
        </div>
        <div className="email-timeline">
          {drafts.length === 0 && (
            <div className="email-empty-panel">
              <strong>No unfinished setups.</strong>
              <p className="muted">Choose a plan to start a new Business Email setup.</p>
            </div>
          )}
          {[...drafts].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((draft) => {
            const isExpanded = expandedId === draft.id;
            const updatedAt = new Date(draft.updatedAt);
            const timestamp = Number.isNaN(updatedAt.getTime())
              ? 'Saved setup'
              : updatedAt.toLocaleString([], {
                  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                });
            return (
              <article className={`email-timeline-event${isExpanded ? ' expanded' : ''}`} key={draft.id}>
                <span className="email-timeline-dot" aria-hidden="true" />
                <button
                  className="email-timeline-trigger"
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? '' : draft.id)}
                >
                  <span className="email-timeline-copy">
                    <strong>{draft.planName} setup</strong>
                    <small>{draft.currentStep === 'ready' ? 'Pending activation' : 'Incomplete setup'}</small>
                  </span>
                  <time dateTime={draft.updatedAt}>{timestamp}</time>
                  <ICN.ChevronDown className="email-timeline-chevron" size={15} aria-hidden="true" />
                </button>
                <div className="email-timeline-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => onResume(draft)}>
                    Continue setup <ICN.ArrowRight size={14} />
                  </button>
                </div>
                {isExpanded && (
                  <div className="email-timeline-detail">
                    <dl className="email-history-details">
                      <div><dt>Plan</dt><dd>{draft.mailboxLimit} mailboxes</dd></div>
                      <div><dt>Last step</dt><dd>{draft.lastAction}</dd></div>
                      {draft.selectedDomain && <div><dt>Domain</dt><dd>{draft.selectedDomain}</dd></div>}
                      {draft.pendingEmail && <div><dt>Pending</dt><dd>{draft.pendingEmail}</dd></div>}
                      {draft.mailboxName && <div><dt>Mailbox</dt><dd>{draft.mailboxName}{draft.selectedDomain ? `@${draft.selectedDomain}` : ''}</dd></div>}
                    </dl>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SetupLeaveDialog({ onSave, onDiscard, onCancel }) {
  return (
    <div className="email-activity-backdrop email-leave-backdrop">
      <section className="email-leave-modal" role="alertdialog" aria-modal="true" aria-labelledby="email-leave-title">
        <div className="email-leave-icon"><ICN.AlertCircle size={20} /></div>
        <div>
          <div className="page-eyebrow">Unfinished email setup</div>
          <h2 id="email-leave-title">Leave this setup?</h2>
          <p>Your progress can be saved to Setup history so you can continue from this exact step later.</p>
        </div>
        <div className="email-leave-actions">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Keep editing</button>
          <button className="btn btn-outline" type="button" onClick={onDiscard}>Discard progress</button>
          <button className="btn btn-primary" type="button" onClick={onSave}>Save and leave</button>
        </div>
      </section>
    </div>
  );
}

export default function EmailManagementPage({ navigate }) {
  const [status, setStatus] = useState(null);
  const [plans, setPlans] = useState(DEFAULT_EMAIL_PLANS);
  const [mailboxes, setMailboxes] = useState([]);
  const [domains, setDomains] = useState([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [manualDomain, setManualDomain] = useState('');
  const [dns, setDns] = useState(null);
  const [dnsCheck, setDnsCheck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [checkingDns, setCheckingDns] = useState(false);
  const [mailboxCapacity, setMailboxCapacity] = useState(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [error, setError] = useState('');
  const [mailboxError, setMailboxError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState('');
  const [planError, setPlanError] = useState('');
  const [currentStep, setCurrentStep] = useState('plan');
  const [createdMailbox, setCreatedMailbox] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [mailboxDraft, setMailboxDraft] = useState({
    mailboxName: '',
    password: '',
  });
  const [setupDrafts, setSetupDrafts] = useState(loadSetupDrafts);
  const [activeSetupId, setActiveSetupId] = useState('');
  const [setupEvents, setSetupEvents] = useState(initialSetupHistory);
  const hasUnfinishedSetup = Boolean(activeSetupId && currentStep !== 'plan' && currentStep !== 'ready');

  const addEvent = useCallback((title, detail) => {
    setSetupEvents((events) => [...events, makeEvent(title, detail)].slice(-40));
    if (activeSetupId) {
      setSetupDrafts((drafts) => drafts.map((draft) => (
        draft.id === activeSetupId
          ? { ...draft, lastAction: title, updatedAt: new Date().toISOString() }
          : draft
      )));
    }
  }, [activeSetupId]);

  useEffect(() => {
    try {
      const safeHistory = setupEvents.map(({ id, title, detail, time, createdAt, status }) => ({
        id,
        title,
        detail,
        time,
        createdAt,
        status,
      }));
      window.localStorage.setItem(setupHistoryStorageKey(), JSON.stringify(safeHistory));
    } catch {
      // Setup remains usable when browser storage is unavailable.
    }
  }, [setupEvents]);

  useEffect(() => {
    try {
      persistSetupDrafts(setupDrafts);
    } catch {
      // Setup remains usable when browser storage is unavailable.
    }
  }, [setupDrafts]);

  useEffect(() => {
    if (!hasUnfinishedSetup) return undefined;

    const saveImmediately = () => {
      try { persistSetupDrafts(setupDrafts); } catch { /* browser storage may be unavailable */ }
    };
    const onBeforeNavigation = (event) => {
      if (event.detail?.target?.view === 'email') return;
      event.preventDefault();
      saveImmediately();
      setPendingNavigation(() => event.detail?.continueNavigation || null);
    };
    const onBeforeUnload = (event) => {
      saveImmediately();
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('glondia:before-navigation', onBeforeNavigation);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', saveImmediately);
    return () => {
      window.removeEventListener('glondia:before-navigation', onBeforeNavigation);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', saveImmediately);
    };
  }, [hasUnfinishedSetup, setupDrafts]);

  useEffect(() => {
    if (!activeSetupId || currentStep === 'plan' || currentStep === 'ready') return;
    setSetupDrafts((drafts) => drafts.map((draft) => (
      draft.id === activeSetupId && draft.currentStep !== 'ready'
        ? {
            ...draft,
            currentStep,
            selectedDomain,
            mailboxName: cleanMailboxName(mailboxDraft.mailboxName),
            updatedAt: new Date().toISOString(),
          }
        : draft
    )));
  }, [activeSetupId, currentStep, mailboxDraft.mailboxName, selectedDomain]);

  const records = useMemo(() => normalizeRecords(dns), [dns]);

  const selectedDomainMailboxes = useMemo(
    () => mailboxes.filter((box) => box.domain === selectedDomain),
    [mailboxes, selectedDomain],
  );

  const activeMailbox = useMemo(
    () => selectedDomainMailboxes.find(isActiveMailbox),
    [selectedDomainMailboxes],
  );

  const completed = useMemo(() => ({
    plan: Boolean(status?.selectedPlan),
    domain: isValidDomain(selectedDomain),
    dns: records.length > 0,
    propagation: Boolean(dnsCheck),
    mailbox: Boolean(createdMailbox) || selectedDomainMailboxes.length > 0,
    ready: Boolean(activeMailbox),
  }), [activeMailbox, createdMailbox, dnsCheck, records.length, selectedDomain, selectedDomainMailboxes.length, status?.selectedPlan]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const [st, boxes, planData] = await Promise.all([
        getEmailStatus(),
        listEmailMailboxes(),
        getEmailPlans(),
      ]);
      const mailboxList = Array.isArray(boxes?.mailboxes) ? boxes.mailboxes : [];
      const selectedPlan = planData?.selectedPlan || st?.selectedPlan || null;
      setPlans(Array.isArray(planData?.plans) && planData.plans.length ? planData.plans : DEFAULT_EMAIL_PLANS);
      setStatus({ ...st, selectedPlan });
      setMailboxCapacity(st?.capacity || null);
      setMailboxes(mailboxList);

      let domainList = [];
      if (isLiveMode()) {
        try {
          const registered = await listRegisteredDomains(0, 100);
          const items = Array.isArray(registered?.items)
            ? registered.items
            : (Array.isArray(registered) ? registered : []);
          domainList = items.map((domain) => domain.name || domain.hostname || domain.domain).filter(Boolean);
        } catch {
          domainList = [];
        }
      }
      for (const mailbox of mailboxList) {
        if (mailbox.domain && !domainList.includes(mailbox.domain)) domainList.push(mailbox.domain);
      }
      domainList = [...new Set(domainList.map(normalizeDomain).filter(Boolean))];
      setDomains(domainList);
      if (silent) setError('');
    } catch (err) {
      setPlans((current) => (Array.isArray(current) && current.length ? current : DEFAULT_EMAIL_PLANS));
      if (!silent) setError(err.message || 'Could not load Business Email setup.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadDns = useCallback(async (domain) => {
    if (!isValidDomain(domain)) {
      setDns(null);
      setDnsCheck(null);
      return;
    }
    setDnsLoading(true);
    try {
      const data = await getEmailDnsRecords(domain);
      setDns(data);
      setDnsCheck(null);
    } catch (err) {
      setDns(null);
      setError(err.message || 'Could not load DNS records.');
    } finally {
      setDnsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshFromServer = () => {
      if (document.visibilityState === 'visible') refresh({ silent: true });
    };
    const timer = window.setInterval(refreshFromServer, 15000);
    document.addEventListener('visibilitychange', refreshFromServer);
    window.addEventListener('focus', refreshFromServer);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshFromServer);
      window.removeEventListener('focus', refreshFromServer);
    };
  }, [refresh]);

  useEffect(() => {
    loadDns(selectedDomain);
  }, [loadDns, selectedDomain]);

  const checkMailboxCapacity = useCallback(async () => {
    setCapacityLoading(true);
    try {
      const capacity = await getEmailMailboxCapacity();
      setMailboxCapacity(capacity);
      setStatus((current) => ({
        ...(current || {}),
        mailboxCount: capacity.used,
        capacity,
      }));
      return capacity;
    } finally {
      setCapacityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentStep !== 'mailbox') return;
    checkMailboxCapacity().catch((err) => {
      setMailboxError(err.message || 'Could not verify the mailbox plan allowance.');
    });
  }, [checkMailboxCapacity, currentStep]);

  const selectDomain = (domain, eventTitle) => {
    const clean = normalizeDomain(domain);
    setSelectedDomain(clean);
    setManualDomain(clean);
    setCurrentStep('domain');
    addEvent(eventTitle, `${clean} is selected for Business Email.`);
  };

  const checkDns = async () => {
    if (!isValidDomain(selectedDomain)) return;
    setCheckingDns(true);
    setError('');
    try {
      const result = await checkEmailDns(selectedDomain);
      setDnsCheck(result);
      if (result?.verified) {
        addEvent('DNS verified', `All email records for ${selectedDomain} resolve correctly.`);
      } else {
        const found = result?.foundCount;
        const total = result?.total;
        addEvent(
          'DNS records checked',
          found != null && total != null
            ? `${found} of ${total} records found for ${selectedDomain}. Still propagating.`
            : (result?.message || `${selectedDomain} DNS was checked.`),
        );
      }
    } catch (err) {
      setError(err.message || 'DNS check failed.');
      addEvent('DNS check needs attention', err.message || 'The DNS check could not complete.');
    } finally {
      setCheckingDns(false);
    }
  };

  const markDnsAdded = () => {
    setDnsCheck((current) => current || {
      status: 'waiting',
      message: 'Records marked as added. DNS propagation can take a few minutes or longer.',
      records: records.map((record) => ({ id: record.id, type: record.type, host: record.host, status: 'waiting' })),
    });
    addEvent('DNS records marked as added', 'Waiting for public DNS propagation.');
    setCurrentStep('mailbox');
  };

  const choosePlan = async (plan) => {
    if (!plan?.id || busyPlanId) return;
    setBusyPlanId(plan.id);
    setPlanError('');
    try {
      let selectedPlan = plan;
      if (status?.selectedPlan?.id !== plan.id) {
        const result = await selectEmailPlan(plan.id);
        selectedPlan = result?.selectedPlan || plan;
      }
      const now = new Date().toISOString();
      const setupId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setStatus((current) => ({ ...(current || {}), selectedPlan }));
      setSetupDrafts((drafts) => [...drafts, {
        id: setupId,
        planId: plan.id,
        planName: plan.name,
        mailboxLimit: plan.mailboxLimit,
        currentStep: 'domain',
        selectedDomain: '',
        mailboxName: '',
        pendingEmail: '',
        lastAction: 'Plan selected',
        createdAt: now,
        updatedAt: now,
        status: 'incomplete',
      }].slice(-20));
      setActiveSetupId(setupId);
      setSelectedDomain('');
      setManualDomain('');
      setDns(null);
      setDnsCheck(null);
      setCreatedMailbox(null);
      setMailboxDraft({ mailboxName: '', password: '' });
      setCurrentStep('domain');
    } catch (err) {
      setPlanError(err.message || 'Could not save the selected email plan.');
    } finally {
      setBusyPlanId('');
    }
  };

  const resumeSetup = async (draft) => {
    const plan = plans.find((item) => item.id === draft.planId);
    if (!plan) {
      setPlanError('This setup plan is no longer available. Start a new setup from the plan cards.');
      setShowActivity(false);
      return;
    }

    setBusyPlanId(plan.id);
    setPlanError('');
    try {
      let selectedPlan = plan;
      if (status?.selectedPlan?.id !== plan.id) {
        const result = await selectEmailPlan(plan.id);
        selectedPlan = result?.selectedPlan || plan;
      }
      setStatus((current) => ({ ...(current || {}), selectedPlan }));
      setActiveSetupId(draft.id);
      setSelectedDomain(draft.selectedDomain || '');
      setManualDomain(draft.selectedDomain || '');
      setMailboxDraft({ mailboxName: draft.mailboxName || '', password: '' });
      setDnsCheck(null);
      setSetupDrafts((drafts) => drafts.map((item) => (
        item.id === draft.id
          ? { ...item, lastAction: 'Setup resumed', updatedAt: new Date().toISOString() }
          : item
      )));
      setCurrentStep(draft.currentStep || 'domain');
      setShowActivity(false);
    } catch (err) {
      setPlanError(err.message || 'Could not resume this email setup.');
      setShowActivity(false);
    } finally {
      setBusyPlanId('');
    }
  };

  const submitMailbox = async (event) => {
    event.preventDefault();
    setMailboxError('');
    const mailboxName = cleanMailboxName(mailboxDraft.mailboxName);
    if (!isValidDomain(selectedDomain) || !mailboxName) {
      setMailboxError('Choose a valid domain and mailbox name.');
      return;
    }
    setBusy(true);
    try {
      const beforeCreate = await checkMailboxCapacity();
      if (!beforeCreate.hasPlan || beforeCreate.atLimit) {
        setMailboxError(beforeCreate.atLimit
          ? `Your ${beforeCreate.planName} plan has used all ${beforeCreate.allowed} mailboxes.`
          : 'Choose a Business Email plan before creating a mailbox.');
        return;
      }
      addEvent('Preparing mailbox', `${mailboxName}@${selectedDomain} request is being submitted.`);
      const result = await requestEmailMailbox({
        domain: selectedDomain,
        mailboxName,
        password: mailboxDraft.password,
      });
      const mailbox = result?.mailbox || result || {
        email: `${mailboxName}@${selectedDomain}`,
        domain: selectedDomain,
        mailboxName,
        status: 'pending_setup',
      };
      setCreatedMailbox(mailbox);
      if (result?.capacity) setMailboxCapacity(result.capacity);
      addEvent('Mailbox request submitted', `${mailboxName}@${selectedDomain} is pending activation.`);
      setSetupDrafts((drafts) => drafts.map((draft) => (
        draft.id === activeSetupId
          ? {
              ...draft,
              currentStep: 'ready',
              selectedDomain,
              mailboxName,
              pendingEmail: mailbox.email || `${mailboxName}@${selectedDomain}`,
              lastAction: 'Mailbox pending activation',
              updatedAt: new Date().toISOString(),
            }
          : draft
      )));
      setMailboxDraft({ mailboxName: '', password: '' });
      await refresh();
      await checkMailboxCapacity();
    } catch (err) {
      setMailboxError(err.message || 'Could not submit mailbox request.');
      addEvent('Mailbox request failed', err.message || 'The request could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  const finishMailboxSetup = () => {
    if (activeMailbox) {
      setSetupDrafts((drafts) => drafts.filter((draft) => draft.id !== activeSetupId));
      setActiveSetupId('');
    } else if (activeSetupId) {
      const pendingEmail = mailboxAddress(createdMailbox) || mailboxAddress(selectedDomainMailboxes[0]);
      setSetupDrafts((drafts) => drafts.map((draft) => (
        draft.id === activeSetupId
          ? {
              ...draft,
              currentStep: 'ready',
              selectedDomain,
              pendingEmail: pendingEmail || draft.pendingEmail || '',
              lastAction: 'Mailbox pending activation',
              updatedAt: new Date().toISOString(),
            }
          : draft
      )));
    }
    setCurrentStep('ready');
  };

  const saveAndLeaveSetup = () => {
    const continueNavigation = pendingNavigation;
    try { persistSetupDrafts(setupDrafts); } catch { /* browser storage may be unavailable */ }
    setPendingNavigation(null);
    continueNavigation?.();
  };

  const discardAndLeaveSetup = () => {
    const continueNavigation = pendingNavigation;
    const remainingDrafts = setupDrafts.filter((draft) => draft.id !== activeSetupId);
    try { persistSetupDrafts(remainingDrafts); } catch { /* browser storage may be unavailable */ }
    setSetupDrafts(remainingDrafts);
    setActiveSetupId('');
    setPendingNavigation(null);
    continueNavigation?.();
  };

  const renderCurrentStep = () => {
    if (currentStep === 'plan') {
      return (
        <PlanSelectionStep
          plans={plans}
          selectedPlan={status?.selectedPlan}
          busyPlanId={busyPlanId}
          error={planError}
          onSelect={choosePlan}
        />
      );
    }
    if (currentStep === 'domain') {
      return (
        <DomainSetupStep
          domains={domains}
          selectedDomain={selectedDomain}
          manualDomain={manualDomain}
          setManualDomain={setManualDomain}
          onSelectDomain={selectDomain}
          onBack={() => setCurrentStep('plan')}
          navigate={navigate}
          onContinue={() => {
            addEvent('Domain confirmed', `${selectedDomain} is ready for DNS setup.`);
            setCurrentStep('dns');
          }}
        />
      );
    }
    if (currentStep === 'dns') {
      return (
        <DnsRecordsStep
          selectedDomain={selectedDomain}
          records={records}
          dnsLoading={dnsLoading}
          onBack={() => setCurrentStep('domain')}
          onContinue={() => {
            addEvent('DNS instructions reviewed', `Records for ${selectedDomain} are ready to add.`);
            setCurrentStep('propagation');
          }}
          onCopy={(record) => addEvent(`${record.type} record copied`, `${record.host} value copied for DNS setup.`)}
        />
      );
    }
    if (currentStep === 'propagation') {
      return (
        <DnsPropagationStep
          records={records}
          dnsCheck={dnsCheck}
          checkingDns={checkingDns}
          lastCheckedAt={dnsCheck?.checkedAt ? new Date(dnsCheck.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          onCheck={checkDns}
          onBack={() => setCurrentStep('dns')}
          onContinue={markDnsAdded}
        />
      );
    }
    if (currentStep === 'mailbox') {
      return (
        <MailboxCreateStep
          selectedDomain={selectedDomain}
          capacity={mailboxCapacity || status?.capacity}
          capacityLoading={capacityLoading}
          mailboxDraft={mailboxDraft}
          setMailboxDraft={setMailboxDraft}
          createdMailbox={createdMailbox}
          busy={busy}
          error={mailboxError}
          onSubmit={submitMailbox}
          onBack={() => setCurrentStep('propagation')}
          onFinish={finishMailboxSetup}
        />
      );
    }
    return (
      <MailboxReadyStep
        selectedDomain={selectedDomain}
        activeMailbox={activeMailbox}
        createdMailbox={createdMailbox || selectedDomainMailboxes[0]}
        onDns={() => setCurrentStep('dns')}
        onPropagation={() => setCurrentStep('propagation')}
      />
    );
  };

  return (
    <>
      <style>{`
        .email-setup-shell { display: grid; gap: 18px; }
        .email-setup-stepper { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
        .email-step { border: 1px solid var(--border); background: var(--card); color: var(--text); border-radius: 8px; padding: 12px; display: flex; gap: 10px; text-align: left; align-items: center; min-height: 74px; transition: border-color .18s ease, transform .18s ease, background .18s ease; }
        .email-step:not(:disabled) { cursor: pointer; }
        .email-step:disabled { opacity: .55; cursor: not-allowed; }
        .email-step.current { border-color: var(--border-strong); background: var(--bg-deep); color: var(--text); transform: translateY(-1px); box-shadow: inset 0 0 0 1px var(--border); }
        .email-step.done .email-step-index { background: var(--accent); color: white; }
        .email-step-index { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 999px; background: var(--bg-deep); border: 1px solid var(--border); display: grid; place-items: center; font-size: 11px; font-weight: 800; }
        .email-step strong { display: block; font-size: 13px; }
        .email-step small { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; line-height: 1.3; }
        .email-setup-stage { display: grid; gap: 28px; }
        .email-step-panel { width: 100%; max-width: 1040px; margin: 0 auto; }
        .email-summary-section { margin-top: 32px; padding-top: 32px; border-top: 1px solid var(--border-strong); }
        .email-main-card, .email-summary-card { border: 1px solid var(--border); background: var(--card); border-radius: 10px; padding: 24px; box-shadow: var(--shadow-sm, none); }
        .email-summary-card { width: 100%; max-width: 1040px; margin: 0 auto; background: var(--bg-elev); }
        .email-card-head, .email-summary-head, .email-record-head, .email-check-row { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
        .email-card-head { margin-bottom: 18px; }
        .email-card-head h2, .email-summary-head h3 { margin: 4px 0 4px; font-size: 22px; letter-spacing: 0; }
        .email-card-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
        .email-plan-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .email-plan-card { min-width: 0; border: 1px solid var(--border); background: var(--bg-deep); border-radius: 8px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; gap: 20px; }
        .email-plan-card.selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
        .email-plan-card h3 { margin: 8px 0 12px; font-size: 18px; }
        .email-plan-card p { margin: 0 0 4px; }
        .email-plan-card p strong { font-size: 28px; }
        .email-plan-card p span, .email-plan-card small { color: var(--muted); }
        .email-plan-capacity { display: inline-flex; border-radius: 999px; background: var(--accent-soft); color: var(--accent); padding: 5px 9px; font-size: 12px; font-weight: 800; }
        .email-domain-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .email-domain-option { border: 1px solid var(--border); background: var(--bg-deep); color: var(--text); border-radius: 8px; padding: 14px; display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer; transition: border-color .18s ease, transform .18s ease; }
        .email-domain-option.selected { border-color: var(--accent); transform: translateY(-1px); }
        .email-domain-option strong { display: block; word-break: break-word; }
        .email-domain-option small { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
        .email-domain-radio { width: 14px; height: 14px; border-radius: 999px; border: 2px solid var(--accent); box-shadow: inset 0 0 0 3px var(--bg-deep); background: transparent; flex: 0 0 14px; }
        .email-domain-option.selected .email-domain-radio { background: var(--accent); }
        .email-empty-panel, .email-loading-panel, .email-check-message, .email-ready-panel { border: 1px dashed var(--border); border-radius: 8px; background: var(--bg-deep); padding: 16px; }
        .email-inline-actions, .email-input-row, .email-preset-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .email-manual-domain { margin-top: 18px; }
        .email-input-row .input { min-width: 240px; flex: 1; }
        .email-field-note { font-size: 12px; margin: 6px 0 0; color: var(--muted); }
        .email-field-note.danger { color: var(--danger); }
        .email-coming-soon { margin-bottom: 14px; }
        .email-record-grid { display: grid; gap: 9px; }
        .email-record-card { border: 1px solid var(--border); background: var(--bg-deep); border-radius: 8px; padding: 12px 14px; }
        .email-record-head { align-items: center; }
        .email-record-identity { min-width: 0; display: flex; align-items: center; gap: 10px; }
        .email-record-type { display: inline-grid; place-items: center; min-width: 50px; height: 24px; padding: 0 8px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 800; white-space: nowrap; }
        .email-record-card h3 { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; line-height: 1.35; letter-spacing: 0; }
        .email-record-fields { display: grid; grid-template-columns: auto auto minmax(220px, 1fr); gap: 8px; margin-top: 10px; }
        .email-record-field { min-width: 0; display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--card); border-radius: 6px; padding: 7px 9px; }
        .email-record-field > span { color: var(--muted); font-size: 10px; line-height: 1; text-transform: uppercase; font-weight: 800; white-space: nowrap; }
        .email-record-field code { min-width: 0; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.35; word-break: break-all; }
        .email-record-field-short code { font-weight: 700; }
        .email-record-value { overflow: hidden; }
        .email-copy-btn.copied { animation: emailPulse .9s ease; border-color: var(--accent); }
        .email-checklist { display: grid; gap: 10px; }
        .email-check-row { border: 1px solid var(--border); background: var(--bg-deep); border-radius: 8px; padding: 13px; align-items: center; }
        .email-check-row div { flex: 1; min-width: 0; }
        .email-check-row strong { display: block; font-size: 14px; }
        .email-check-row small { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
        .email-status-dot { width: 18px; height: 18px; border-radius: 999px; background: var(--muted); flex: 0 0 18px; display: grid; place-items: center; color: #fff; transition: background .25s ease, transform .25s ease; margin-top: 1px; }
        .email-status-dot svg { display: block; }
        .email-status-dot.green { background: var(--accent); }
        .email-status-dot.amber { background: #b8860b; }
        .email-status-dot.red { background: var(--danger); }
        .email-status-dot.blue { background: #2563eb; }
        .email-status-dot.pulsing { background: var(--muted); animation: emailDotPulse 1s ease-in-out infinite; }
        .email-status-dot.pop { animation: emailDotPop .4s cubic-bezier(.34, 1.56, .64, 1); }
        .email-mailbox-form { display: grid; gap: 14px; }
        .email-mailbox-usage { display: grid; gap: 10px; margin-bottom: 18px; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-deep); }
        .email-mailbox-usage.at-limit { border-color: var(--danger); }
        .email-mailbox-usage-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .email-mailbox-usage-head span { display: block; color: var(--muted); font-size: 12px; }
        .email-mailbox-usage-head strong { display: block; margin-top: 3px; font-size: 16px; }
        .email-mailbox-usage-track { height: 8px; overflow: hidden; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-elev); }
        .email-mailbox-usage-track > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .3s ease; }
        .email-mailbox-usage.at-limit .email-mailbox-usage-track > span { background: var(--danger); }
        .email-mailbox-usage > p { margin: 0; color: var(--danger); font-size: 12px; font-weight: 700; }
        .email-mailbox-builder { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: var(--bg-deep); }
        .email-mailbox-builder .input { border: 0; background: transparent; padding-left: 6px; }
        .email-mailbox-builder span { color: var(--muted); font-weight: 700; padding-right: 8px; word-break: break-word; }
        .email-preset { border: 1px solid var(--border); background: var(--bg-deep); color: var(--text); border-radius: 999px; padding: 7px 12px; cursor: pointer; font-size: 13px; }
        .email-preset.selected { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
        .email-password-field { max-width: 620px; }
        .email-password-input { display: flex; align-items: center; gap: 8px; }
        .email-password-input > .input { min-width: 0; flex: 1; }
        .email-password-tools { display: flex; align-items: center; gap: 6px; }
        .email-ready-panel { display: flex; gap: 14px; align-items: flex-start; }
        .email-ready-panel.active { border-style: solid; border-color: var(--accent); }
        .email-summary-card { position: static; display: grid; gap: 16px; }
        .email-summary-head { align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
        .email-summary-head p { margin: 3px 0 0; color: var(--muted); font-size: 13px; }
        .email-summary-hero { display: flex; gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-deep); }
        .email-summary-hero-icon { width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-items: center; border-radius: 9px; background: var(--accent-soft); color: var(--accent); }
        .email-summary-hero > div { min-width: 0; display: grid; gap: 2px; }
        .email-summary-hero span, .email-summary-hero small { color: var(--muted); font-size: 12px; }
        .email-summary-hero strong { overflow: hidden; text-overflow: ellipsis; font-size: 17px; }
        .email-summary-usage { display: grid; gap: 9px; padding: 14px; border: 1px solid var(--border); border-radius: 9px; }
        .email-summary-usage-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
        .email-summary-usage-head span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; font-weight: 800; }
        .email-summary-usage-head strong { display: block; margin-top: 3px; font-size: 15px; }
        .email-summary-usage-head b { font-size: 13px; }
        .email-summary-usage-track { height: 8px; overflow: hidden; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-deep); }
        .email-summary-usage-track > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
        .email-summary-usage > small { color: var(--muted); font-size: 12px; }
        .email-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .email-summary-grid article { min-width: 0; display: grid; gap: 8px; align-content: space-between; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-deep); }
        .email-summary-grid article > span { color: var(--muted); font-size: 11px; font-weight: 700; }
        .email-summary-grid .email-setup-pill { justify-content: flex-start; white-space: normal; text-align: left; }
        .email-summary-note { display: flex; gap: 9px; align-items: flex-start; margin: 0; padding: 12px; border-radius: 8px; background: var(--bg-deep); color: var(--muted); }
        .email-summary-note svg { flex: 0 0 auto; margin-top: 2px; color: var(--info); }
        .email-summary-note p { margin: 0; font-size: 12px; line-height: 1.45; }
        .email-checkout-card { display: flex; justify-content: space-between; gap: 14px; align-items: center; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg-deep); }
        .email-checkout-card > div { min-width: 0; display: grid; gap: 3px; }
        .email-checkout-card span { color: var(--muted); font-size: 11px; text-transform: uppercase; font-weight: 800; }
        .email-checkout-card strong { font-size: 18px; }
        .email-checkout-card small { color: var(--muted); font-size: 12px; }
        .email-summary-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 2px; }
        .email-full-width { width: 100%; justify-content: center; }
        .email-setup-pill { display: inline-flex; align-items: center; justify-content: center; padding: 0; font-size: 12px; font-weight: 800; white-space: nowrap; background: transparent; color: var(--muted); border: 0; }
        .email-setup-pill.green { color: var(--accent); }
        .email-setup-pill.amber { color: #9a6700; }
        .email-setup-pill.red { color: #c0392b; }
        .email-setup-pill.blue { color: #2563eb; }
        .email-activity-backdrop { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 20px; background: rgba(5, 10, 18, .72); }
        .email-activity-modal { width: min(680px, calc(100vw - 32px)); max-height: min(82dvh, 760px); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--border-strong); background: var(--bg-elev); opacity: 1; border-radius: 12px; padding: 22px; box-shadow: 0 28px 80px rgba(0, 0, 0, .38); }
        .email-activity-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
        .email-activity-head h2 { margin: 4px 0 0; font-size: 20px; }
        .email-leave-backdrop { z-index: 520; }
        .email-leave-modal { width: min(520px, calc(100vw - 32px)); display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 14px; padding: 22px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--bg-elev); box-shadow: 0 28px 80px rgba(0, 0, 0, .4); }
        .email-leave-modal h2 { margin: 4px 0 7px; font-size: 21px; }
        .email-leave-modal p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
        .email-leave-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--warning) 14%, transparent); color: var(--warning); }
        .email-leave-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
        .email-timeline { display: grid; gap: 10px; margin-top: 16px; overflow-y: auto; padding: 2px 4px 2px 2px; }
        .email-timeline-event { display: grid; grid-template-columns: 10px minmax(0, 1fr); column-gap: 12px; align-items: start; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-elev); box-shadow: var(--shadow-sm); }
        .email-timeline-trigger { min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 10px; align-items: center; text-align: left; cursor: pointer; font: inherit; }
        .email-timeline-copy { min-width: 0; display: grid; gap: 3px; }
        .email-timeline-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
        .email-timeline-copy small { color: #9a6700; font-size: 11px; font-weight: 700; }
        .email-timeline-event time { color: var(--muted); font-size: 11px; font-weight: 600; white-space: nowrap; }
        .email-timeline-chevron { color: var(--muted); transition: transform .18s ease; }
        .email-timeline-event.expanded .email-timeline-chevron { transform: rotate(180deg); }
        .email-timeline-actions { grid-column: 2; display: flex; justify-content: flex-end; margin-top: 12px; }
        .email-timeline-detail { grid-column: 2; min-width: 0; margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-deep); }
        .email-timeline-detail p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
        .email-history-details { display: grid; gap: 7px; margin: 0 0 12px; }
        .email-history-details > div { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; font-size: 12px; }
        .email-history-details dt { color: var(--muted); }
        .email-history-details dd { min-width: 0; margin: 0; color: var(--text); font-weight: 700; overflow-wrap: anywhere; }
        .email-timeline-dot { width: 10px; height: 10px; border-radius: 999px; background: #d69e2e; margin-top: 5px; }
        .email-timeline-event { animation: emailRowIn .32s ease both; }

        /* Progress bar above the stepper */
        .email-stepper-wrap { display: grid; gap: 12px; }
        .email-progress-track { height: 4px; border-radius: 999px; background: var(--bg-deep); border: 1px solid var(--border); overflow: hidden; }
        .email-progress-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent)); border-radius: 999px; transition: width .5s cubic-bezier(.4, 0, .2, 1); }
        .email-step { animation: emailRowIn .34s ease both; animation-delay: var(--email-step-delay, 0ms); }
        .email-step-index svg { display: block; }
        .email-step.done .email-step-index { animation: emailDotPop .4s cubic-bezier(.34, 1.56, .64, 1); }

        /* Step panel transition */
        .email-step-panel { animation: emailStepFade .34s ease both; }

        /* Propagation meter */
        .email-propagation-meter { border: 1px solid var(--border); background: var(--bg-deep); border-radius: 8px; padding: 14px; margin-bottom: 14px; transition: border-color .3s ease; }
        .email-propagation-meter.verified { border-color: var(--accent); }
        .email-propagation-meter-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
        .email-propagation-meter-head strong { font-size: 14px; }
        .email-propagation-meter-head span { font-size: 12px; }
        .email-meter-track { height: 8px; border-radius: 999px; background: var(--card); border: 1px solid var(--border); overflow: hidden; position: relative; }
        .email-meter-fill { display: block; height: 100%; background: var(--accent); border-radius: 999px; transition: width .6s cubic-bezier(.4, 0, .2, 1); }
        .email-meter-fill.indeterminate { position: absolute; width: 35%; animation: emailMeterSlide 1.1s ease-in-out infinite; }
        .email-check-message.ok { border-style: solid; border-color: var(--accent); color: var(--text); }
        .email-spin { animation: emailSpin .9s linear infinite; }

        /* Live checklist rows */
        .email-check-row { animation: emailRowIn .34s ease both; animation-delay: var(--email-row-delay, 0ms); transition: border-color .25s ease; }
        .email-check-row.state-found { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
        .email-observed { display: block; margin-top: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--muted); background: var(--card); border: 1px solid var(--border); border-radius: 5px; padding: 3px 7px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        @keyframes emailStepFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes emailRowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes emailDotPulse { 0%, 100% { transform: scale(.8); opacity: .55; } 50% { transform: scale(1.05); opacity: 1; } }
        @keyframes emailDotPop { 0% { transform: scale(.4); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
        @keyframes emailSpin { to { transform: rotate(360deg); } }
        @keyframes emailMeterSlide { 0% { left: -35%; } 100% { left: 100%; } }
        @media (prefers-reduced-motion: reduce) {
          .email-step, .email-step-panel, .email-check-row, .email-timeline-event,
          .email-status-dot.pop, .email-step.done .email-step-index { animation: none !important; }
          .email-spin, .email-meter-fill.indeterminate, .email-status-dot.pulsing { animation-duration: 2s; }
        }
        @keyframes emailPulse { 0% { box-shadow: 0 0 0 0 rgba(42, 122, 226, .35); } 100% { box-shadow: 0 0 0 10px rgba(42, 122, 226, 0); } }
        @media (max-width: 980px) {
          .email-setup-stepper { grid-template-columns: 1fr; }
          .email-plan-grid { grid-template-columns: 1fr; }
          .email-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .email-card-head, .email-summary-head, .email-record-head, .email-check-row { flex-direction: column; align-items: stretch; }
          .email-record-head { flex-direction: row; align-items: center; }
          .email-record-identity { align-items: flex-start; }
          .email-record-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .email-record-value { grid-column: 1 / -1; align-items: flex-start; flex-direction: column; }
          .email-mailbox-builder { grid-template-columns: 1fr; }
          .email-input-row { display: grid; grid-template-columns: 1fr; }
          .email-input-row .input { min-width: 0; }
          .email-activity-backdrop { padding: 10px; align-items: end; }
          .email-activity-modal { width: 100%; max-height: 85dvh; border-radius: 10px 10px 0 0; }
          .email-leave-backdrop { align-items: center; }
          .email-leave-modal { grid-template-columns: 1fr; }
          .email-leave-icon { width: 36px; height: 36px; }
          .email-leave-actions { display: grid; grid-template-columns: 1fr; }
          .email-summary-grid { grid-template-columns: 1fr; }
          .email-summary-usage-head { align-items: flex-start; flex-direction: column; }
          .email-summary-actions { display: grid; grid-template-columns: 1fr; }
          .email-summary-actions .btn { width: 100%; justify-content: center; }
          .email-timeline-trigger { grid-template-columns: minmax(0, 1fr) 16px; }
          .email-timeline-event time { grid-column: 1 / -1; grid-row: 2; white-space: normal; }
          .email-timeline-chevron { grid-column: 2; grid-row: 1; }
          .email-timeline-actions { justify-content: stretch; }
          .email-timeline-actions .btn { width: 100%; justify-content: center; }
        }
      `}</style>

      <div className="page-head">
        <div>
          <div className="page-eyebrow">Email</div>
          <h1>Business Email Setup</h1>
          <p className="sub">Choose a plan, configure the domain, create the first mailbox, review the summary, then continue to checkout.</p>
        </div>
        <div className="actions">
          {currentStep !== 'plan' && (
            <button className="btn btn-outline" type="button" onClick={() => setCurrentStep('plan')}>
              <ICN.Layers size={14} /> View plans
            </button>
          )}
          <button
            className="btn btn-outline"
            type="button"
            onClick={() => setShowActivity(true)}
            aria-haspopup="dialog"
            aria-expanded={showActivity}
          >
            <ICN.Clock size={14} /> Setup history ({setupDrafts.length})
          </button>
        </div>
      </div>

      <SandboxBanner service="email" />

      {error && <div className="email-check-message" style={{ color: 'var(--danger)', marginBottom: 14 }}>{error}</div>}

      <div className="email-setup-shell">
        {currentStep !== 'plan' && (
          <SetupStepper currentStep={currentStep} completed={completed} onStep={setCurrentStep} />
        )}
        <div className="email-setup-stage">
          <div className="email-step-panel" key={currentStep}>
            {renderCurrentStep()}
          </div>
        </div>
        {currentStep === 'ready' && (
          <section className="email-summary-section" aria-label="Setup summary">
            <SetupSummary
              status={status}
              selectedDomain={selectedDomain}
              domains={domains}
              dnsCheck={dnsCheck}
              mailboxes={mailboxes}
              activeMailbox={activeMailbox}
              onRefresh={refresh}
              onCheckout={() => navigate?.({ view: 'billing' })}
            />
          </section>
        )}
      </div>
      {showActivity && (
        <ActivityTimeline
          drafts={setupDrafts}
          onResume={resumeSetup}
          onClose={() => setShowActivity(false)}
        />
      )}
      {pendingNavigation && (
        <SetupLeaveDialog
          onSave={saveAndLeaveSetup}
          onDiscard={discardAndLeaveSetup}
          onCancel={() => setPendingNavigation(null)}
        />
      )}
    </>
  );
}
