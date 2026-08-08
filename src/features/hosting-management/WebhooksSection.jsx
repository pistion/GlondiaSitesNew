import React, { useEffect, useMemo, useState } from 'react';
import { ICN } from '../../icons';
import { createHostingWebhook, deleteHostingWebhook, listHostingWebhooks, updateHostingWebhook } from '../../api';
import { EmptyRows, Notice } from './SectionShell';
import { normalizeList } from './shared';

const EVENT_OPTIONS = [
  ['site.activity', 'Website activity'],
  ['site.form_submitted', 'Form submitted'],
  ['site.error', 'Site error'],
  ['deploy.started', 'Deploy started'],
  ['deploy.succeeded', 'Deploy succeeded'],
  ['deploy.failed', 'Deploy failed'],
  ['domain.verified', 'Domain verified'],
  ['billing.payment_due', 'Payment due'],
];

const BLANK = { name: '', url: '', action: 'webhook', emailTo: '', events: ['site.activity'] };

export default function WebhooksSection({ deploymentId, onNeedsRedeploy }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const data = await listHostingWebhooks(deploymentId);
      setItems(normalizeList(data, ['items', 'webhooks']));
    } catch (error) {
      setErr(error.message || 'Could not load webhooks.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [deploymentId]);

  const eventLabel = useMemo(() => Object.fromEntries(EVENT_OPTIONS), []);

  const startAdd = () => {
    setAdding(true);
    setEditingId('');
    setForm(BLANK);
    setMsg('');
    setErr('');
  };

  const startEdit = (item) => {
    setAdding(false);
    setEditingId(item.webhookId);
    setForm({
      name: item.name || '',
      url: item.url || '',
      action: item.action || 'webhook',
      emailTo: item.emailTo || '',
      events: Array.isArray(item.events) && item.events.length ? item.events : ['site.activity'],
    });
    setMsg('');
    setErr('');
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId('');
    setForm(BLANK);
  };

  const toggleEvent = (event) => {
    setForm((current) => {
      const has = current.events.includes(event);
      const next = has ? current.events.filter((item) => item !== event) : [...current.events, event];
      return { ...current, events: next.length ? next : [event] };
    });
  };

  const save = async () => {
    setBusy('save'); setMsg(''); setErr('');
    try {
      if (editingId) await updateHostingWebhook(deploymentId, editingId, form);
      else await createHostingWebhook(deploymentId, form);
      setMsg(editingId ? 'Webhook updated.' : 'Webhook added.');
      onNeedsRedeploy?.('Webhooks');
      cancelForm();
      await load();
    } catch (error) {
      setErr(error.message || 'Could not save webhook.');
    } finally {
      setBusy('');
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove webhook ${item.name}?`)) return;
    setBusy(item.webhookId); setMsg(''); setErr('');
    try {
      await deleteHostingWebhook(deploymentId, item.webhookId);
      setMsg('Webhook removed.');
      onNeedsRedeploy?.('Webhooks');
      await load();
    } catch (error) {
      setErr(error.message || 'Could not remove webhook.');
    } finally {
      setBusy('');
    }
  };

  const showForm = adding || editingId;

  return (
    <div className="card">
      <style>{`
        .hosting-webhook-form { display: grid; gap: 12px; margin-bottom: 14px; padding: 14px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-deep); }
        .hosting-webhook-grid { display: grid; grid-template-columns: minmax(160px,.75fr) minmax(240px,1.25fr); gap: 10px; }
        .hosting-webhook-events { display: flex; gap: 8px; flex-wrap: wrap; }
        .hosting-webhook-event { border: 1px solid var(--border); border-radius: 999px; padding: 6px 10px; color: var(--text-muted); font-size: 12px; font-weight: 700; }
        .hosting-webhook-event.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
        .hosting-webhook-row-meta { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 6px; }
        .hosting-webhook-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
        @media(max-width:820px){ .hosting-webhook-grid { grid-template-columns: 1fr; } }
      `}</style>
      <div className="hosting-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Webhooks</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Attach callbacks or email notifications for website activity, deploys, forms, domain checks, and billing events.
          </p>
        </div>
        <button className="btn btn-outline" disabled={loading || !!busy} onClick={startAdd}>
          <ICN.Plus size={14} /> Add item
        </button>
      </div>

      <Notice type="error">{err}</Notice>
      <Notice type="success">{msg}</Notice>

      {showForm && (
        <div className="hosting-webhook-form">
          <div className="hosting-webhook-grid">
            <input className="input" placeholder="Name e.g. Lead email alert" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus />
            <input className="input mono" placeholder="https://example.com/webhook" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} />
            <select className="select" value={form.action} onChange={(event) => setForm((current) => ({ ...current, action: event.target.value }))}>
              <option value="webhook">Send webhook</option>
              <option value="email">Send email notification</option>
              <option value="webhook_and_email">Webhook + email</option>
            </select>
            <input className="input" placeholder="Email recipient optional" value={form.emailTo} onChange={(event) => setForm((current) => ({ ...current, emailTo: event.target.value }))} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 7 }}>Events</div>
            <div className="hosting-webhook-events">
              {EVENT_OPTIONS.map(([value, label]) => (
                <button className={`hosting-webhook-event${form.events.includes(value) ? ' active' : ''}`} type="button" key={value} onClick={() => toggleEvent(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="hosting-webhook-actions">
            <button className="btn btn-primary" disabled={busy === 'save' || !form.name.trim() || (form.action !== 'email' && !form.url.trim()) || (form.action.includes('email') && !form.emailTo.trim())} onClick={save}>
              {busy === 'save' ? 'Saving...' : editingId ? 'Save webhook' : 'Create webhook'}
            </button>
            <button className="btn btn-outline" disabled={busy === 'save'} onClick={cancelForm}>Cancel</button>
          </div>
        </div>
      )}

      <div className="hosting-card-list">
        {loading ? (
          <EmptyRows message="Loading webhooks..." />
        ) : items.length === 0 ? (
          <EmptyRows message="No webhooks attached yet. Add one to automate website activity or customer notifications." />
        ) : items.map((item) => (
          <div className="hosting-row-card" key={item.webhookId}>
            <div>
              <strong>{item.name}</strong>
              <div className="mono muted" style={{ fontSize: 12 }}>{item.action === 'email' ? item.emailTo || 'Email notification' : item.url}</div>
              <div className="hosting-webhook-row-meta">
                {(item.events || []).map((event) => <span className="badge muted" key={event}>{eventLabel[event] || event}</span>)}
              </div>
            </div>
            <span className="muted">{item.status || 'active'}</span>
            <div className="hosting-webhook-actions">
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => startEdit(item)}><ICN.Edit size={13} /> Edit</button>
              <button className="btn btn-sm btn-outline" disabled={busy === item.webhookId} onClick={() => remove(item)}>{busy === item.webhookId ? 'Removing...' : 'Remove'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
