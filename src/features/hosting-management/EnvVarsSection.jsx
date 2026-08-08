import React, { useEffect, useState } from 'react';
import { deleteHostingEnvVar, listHostingEnvVars, upsertHostingEnvVar } from '../../api';
import { EmptyRows, Notice } from './SectionShell';
import { ICN } from '../../icons';

export default function EnvVarsSection({ deploymentId, onNeedsRedeploy }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ key: '', value: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editVisible, setEditVisible] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const rows = await listHostingEnvVars(deploymentId);
      setItems(normalizeEnvRows(rows));
    } catch (error) {
      setErr(error.message || 'Environment variables could not be loaded.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [deploymentId]);

  const add = async () => {
    if (!form.key.trim()) return;
    setBusy('add'); setMsg(''); setErr('');
    try {
      await upsertHostingEnvVar(deploymentId, form);
      setForm({ key: '', value: '' });
      setAdding(false);
      setMsg('Environment variable saved.');
      onNeedsRedeploy?.('Environment variables');
      load();
    } catch (error) { setErr(error.message); }
    finally { setBusy(''); }
  };

  const remove = async (key) => {
    setBusy(key); setMsg(''); setErr('');
    try {
      await deleteHostingEnvVar(deploymentId, key);
      setMsg('Environment variable deleted.');
      onNeedsRedeploy?.('Environment variables');
      load();
    } catch (error) { setErr(error.message); }
    finally { setBusy(''); }
  };

  const startEdit = (item) => {
    setEditingKey(item.key);
    setEditValue('');
    setEditVisible(false);
    setMsg('');
    setErr('');
  };

  const cancelEdit = () => {
    setEditingKey('');
    setEditValue('');
    setEditVisible(false);
  };

  const saveEdit = async (item) => {
    if (!item?.key || busy) return;
    setBusy(item.key); setMsg(''); setErr('');
    try {
      await upsertHostingEnvVar(deploymentId, {
        key: item.key,
        value: editValue,
        environment: item.environment || 'production',
      });
      setMsg(`${item.key} updated.`);
      onNeedsRedeploy?.('Environment variables');
      cancelEdit();
      await load();
    } catch (error) { setErr(error.message || 'Environment variable could not be updated.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="card">
      <style>{`
        .hosting-env-secret-field { position: relative; min-width: 0; display: grid; gap: 5px; }
        .hosting-env-secret-field .input { width: 100%; padding-right: 42px; }
        .hosting-env-secret-field label { color: var(--text-muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; }
        .hosting-env-eye {
          position: absolute;
          right: 6px;
          bottom: 5px;
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          color: var(--text-muted);
        }
        .hosting-env-eye:not(:disabled):hover { color: var(--text); background: var(--bg-deep); }
        .hosting-env-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
        .hosting-env-row-edit { grid-template-columns: minmax(140px,.65fr) minmax(190px,1fr) minmax(220px,1.15fr) auto; }
        .hosting-env-hidden-pill { justify-self: start; display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 5px 9px; background: var(--bg-deep); color: var(--text-muted); font-size: 12px; font-weight: 700; }
        @media(max-width:980px){ .hosting-env-row-edit { grid-template-columns: 1fr 1fr; } .hosting-env-actions { grid-column: 1 / -1; } }
        @media(max-width:760px){ .hosting-env-row-edit { grid-template-columns: 1fr; } .hosting-env-actions { justify-content: stretch; } .hosting-env-actions .btn { flex: 1; } }
      `}</style>
      <div className="hosting-section-head" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Environment variables</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Store runtime keys for this hosting service. Values are hidden after save and synced automatically when saved.</p>
        </div>
        <button className="btn btn-outline" disabled={loading || !!busy} onClick={() => { setAdding(true); cancelEdit(); }}>
          <ICN.Plus size={14} /> Add item
        </button>
      </div>
      {adding && (
        <div className="hosting-form-row" style={{ marginBottom: 12 }}>
          <input className="input mono" placeholder="KEY e.g. API_TOKEN" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value.toUpperCase() }))} autoFocus />
          <input className="input mono" type="password" placeholder="value" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} />
          <button className="btn btn-primary" disabled={busy === 'add' || !form.key.trim()} onClick={add}>{busy === 'add' ? 'Saving...' : 'Save variable'}</button>
          <button className="btn btn-outline" disabled={busy === 'add'} onClick={() => { setAdding(false); setForm({ key: '', value: '' }); }}>Cancel</button>
        </div>
      )}
      <Notice type="success">{msg}</Notice>
      <Notice type="error">{err}</Notice>
      <div className="hosting-card-list">
        {loading ? (
          <EmptyRows message="Loading environment variables..." />
        ) : items.length === 0 ? (
          <EmptyRows message="No environment variables saved for this hosting service yet." />
        ) : items.map((item) => (
          editingKey === item.key ? (
            <div className="hosting-row-card hosting-env-row-edit" key={`${item.environment || 'production'}:${item.key}`}>
              <div>
                <strong className="mono">{item.key}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{item.environment || 'production'} · editing</div>
              </div>
              <div className="hosting-env-secret-field">
                <label>Current saved value</label>
                <input
                  className="input mono"
                  type={editVisible ? 'text' : 'password'}
                  value={item.valuePreview || '••••••••'}
                  readOnly
                  aria-label={`${item.key} current saved value`}
                />
                <button
                  className="btn btn-icon btn-ghost hosting-env-eye"
                  type="button"
                  onClick={() => setEditVisible((visible) => !visible)}
                  aria-label={editVisible ? 'Hide current value preview' : 'Show current value preview'}
                  title={editVisible ? 'Hide current value preview' : 'Show current value preview'}
                >
                  <ICN.Eye size={15} />
                </button>
              </div>
              <div className="hosting-env-secret-field">
                <label>New value</label>
                <input
                  className="input mono"
                  type="password"
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  placeholder="Enter new value"
                  autoFocus
                />
              </div>
              <div className="hosting-env-actions">
                <button className="btn btn-sm btn-primary" disabled={busy === item.key || !editValue} onClick={() => saveEdit(item)}>{busy === item.key ? 'Saving...' : 'Save'}</button>
                <button className="btn btn-sm btn-outline" disabled={busy === item.key} onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="hosting-row-card" key={`${item.environment || 'production'}:${item.key}`}>
              <div>
                <strong className="mono">{item.key}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{item.environment || 'production'} · {item.renderSynced ? 'Synced' : 'Local table'}</div>
              </div>
              <span className="hosting-env-hidden-pill">Hidden</span>
              <div className="hosting-env-actions">
                <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => startEdit(item)}><ICN.Edit size={13} /> Edit</button>
                <button className="btn btn-sm btn-outline" disabled={busy === item.key} onClick={() => remove(item.key)}>{busy === item.key ? 'Deleting...' : 'Delete'}</button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function normalizeEnvRows(rows) {
  const list = Array.isArray(rows)
    ? rows
    : Array.isArray(rows?.items)
      ? rows.items
      : Array.isArray(rows?.envVars)
        ? rows.envVars
        : [];
  return list
    .filter((item) => item?.key)
    .map((item) => ({
      ...item,
      key: String(item.key || '').toUpperCase(),
      valuePreview: item.valuePreview || item.value || '',
      renderSynced: Boolean(item.renderSynced),
      environment: item.environment || 'production',
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
