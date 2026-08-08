import React, { useEffect, useState } from 'react';
import { ICN } from '../../icons';
import { Empty } from '../../components';
import { listHostingRoutes, updateHostingRoutes } from '../../api';
import { normalizeList } from './shared';
import { Notice } from './SectionShell';

export default function RulesSection({ deploymentId }) {
  const [routes, setRoutes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => listHostingRoutes(deploymentId)
    .then((data) => setRoutes(normalizeList(data, ['routes']).map((item) => ({ id: item.id || `${item.source}:${item.destination}`, source: item.source || item.from || '', destination: item.destination || item.to || '', type: item.type || 'rewrite' }))))
    .catch((error) => setErr(error.message || 'Could not load rules.'));
  useEffect(() => { load(); }, [deploymentId]);

  const addRow = () => setRoutes((current) => [...current, { id: `new_${Date.now()}`, source: '', destination: '', type: 'rewrite' }]);
  const updateRow = (index, field, value) => setRoutes((current) => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const removeRow = (index) => setRoutes((current) => current.filter((_, i) => i !== index));
  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await updateHostingRoutes(deploymentId, routes.filter((row) => row.source.trim() && row.destination.trim()));
      setMsg('Rules saved.');
      load();
    } catch (error) { setErr(error.message || 'Could not save rules.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="card">
      <div className="hosting-section-head">
        <h2>Rules</h2>
        <div className="hosting-section-actions">
          <button className="btn btn-outline" onClick={addRow}><ICN.Plus size={14} /> Add rule</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <Notice type="error">{err}</Notice>
      <Notice type="success">{msg}</Notice>
      {routes.length === 0 && <Empty icon="Route" title="No rules" body="Add rewrites or redirects for this deployed site." />}
      <div className="hosting-card-list">
        {routes.map((row, index) => (
          <div className="hosting-edit-card hosting-edit-card--four" key={row.id || index}>
            <select className="select" value={row.type} onChange={(event) => updateRow(index, 'type', event.target.value)}>
              <option value="rewrite">Rewrite</option>
              <option value="redirect">Redirect</option>
            </select>
            <input className="input mono" placeholder="/old" value={row.source} onChange={(event) => updateRow(index, 'source', event.target.value)} />
            <input className="input mono" placeholder="/new" value={row.destination} onChange={(event) => updateRow(index, 'destination', event.target.value)} />
            <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(index)}><ICN.X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
