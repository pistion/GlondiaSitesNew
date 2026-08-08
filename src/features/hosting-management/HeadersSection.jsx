import React, { useCallback, useEffect, useState } from 'react';
import { ICN } from '../../icons';
import { Empty } from '../../components';
import { listHostingHeaders, updateHostingHeaders } from '../../api';
import { normalizeList } from './shared';
import { Notice } from './SectionShell';

export default function HeadersSection({ deploymentId, onNeedsRedeploy }) {
  const [headers, setHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    return listHostingHeaders(deploymentId)
      .then((data) => setHeaders(normalizeList(data, ['headers']).map(toHeaderRow)))
      .catch((error) => setErr(error.message || 'Could not load headers.'))
      .finally(() => setLoading(false));
  }, [deploymentId]);
  useEffect(() => { load(); }, [load]);

  const addRow = () => setHeaders((current) => [...current, { id: `new_${Date.now()}`, path: '/*', name: '', value: '' }]);
  const updateRow = (index, field, value) => setHeaders((current) => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const removeRow = (index) => setHeaders((current) => current.filter((_, i) => i !== index));
  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await updateHostingHeaders(deploymentId, headers.filter((row) => row.name.trim() || row.value.trim()));
      setMsg('Headers saved.');
      onNeedsRedeploy?.('HTTP headers');
      await load();
    } catch (error) { setErr(error.message || 'Could not save headers.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="card">
      <div className="hosting-section-head">
        <div>
          <h2>Headers</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Add HTTP response headers for security, caching, CORS, and browser behavior.</p>
        </div>
        <div className="hosting-section-actions">
          <button className="btn btn-outline" onClick={addRow} disabled={saving || loading}><ICN.Plus size={14} /> Add item</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <Notice type="error">{err}</Notice>
      <Notice type="success">{msg}</Notice>
      {loading && <Empty icon="Code" title="Loading headers..." body="Checking saved hosting header rules." />}
      {!loading && headers.length === 0 && <Empty icon="Code" title="No custom headers" body="Add response headers for paths on this site." />}
      <div className="hosting-card-list">
        {!loading && headers.map((row, index) => (
          <div className="hosting-edit-card hosting-edit-card--four" key={row.id || index} title={row.providerError || undefined}>
            <label>
              <span>Path</span>
              <input className="input mono" placeholder="/*" value={row.path} onChange={(event) => updateRow(index, 'path', event.target.value)} />
            </label>
            <label>
              <span>Name</span>
              <input className="input mono" placeholder="X-Frame-Options" value={row.name} onChange={(event) => updateRow(index, 'name', event.target.value)} />
            </label>
            <label>
              <span>Value</span>
              <input className="input mono" placeholder="SAMEORIGIN" value={row.value} onChange={(event) => updateRow(index, 'value', event.target.value)} />
            </label>
            <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(index)} aria-label="Remove header"><ICN.X size={13} /></button>
            {row.name && (
              <small className="muted" style={{ gridColumn: '1 / -1' }}>
                {row.providerSynced ? 'Saved in Glondia and synced to provider.' : 'Saved in Glondia. Provider sync will retry automatically when available.'}
              </small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function toHeaderRow(item = {}) {
  return {
    id: item.id || `${item.path || '/*'}:${item.name || item.key || Date.now()}`,
    path: item.path || '/*',
    name: item.name || item.key || '',
    value: item.value || '',
    providerSynced: Boolean(item.providerSynced),
    providerError: item.providerError || null,
  };
}
