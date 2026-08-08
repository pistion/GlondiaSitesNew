import React, { useEffect, useState } from 'react';
import { ICN } from '../../icons';
import { Empty } from '../../components';
import { listHostingSecretFiles, upsertHostingSecretFiles } from '../../api';
import { normalizeList } from './shared';
import { Notice } from './SectionShell';

export default function SecretFilesSection({ deploymentId, onNeedsRedeploy }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    listHostingSecretFiles(deploymentId)
      .then((data) => setFiles(normalizeList(data, ['secretFiles']).map((file) => ({ id: file.id || file.name, name: file.name || '', value: file.content || file.value || '' }))))
      .catch((error) => setErr(error.message || 'Could not load secret files.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [deploymentId]);

  const addRow = () => setFiles((current) => [...current, { id: `new_${Date.now()}`, name: '', value: '' }]);
  const removeRow = (index) => setFiles((current) => current.filter((_, i) => i !== index));
  const updateRow = (index, field, value) => setFiles((current) => current.map((file, i) => i === index ? { ...file, [field]: value } : file));
  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await upsertHostingSecretFiles(deploymentId, files.filter((file) => file.name.trim()).map((file) => ({ name: file.name, content: file.value })));
      setMsg('Secret files saved.');
      onNeedsRedeploy?.('Secret files');
      load();
    } catch (error) { setErr(error.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="ShieldCheck" title="Loading secret files..." /></div>;

  return (
    <div className="card">
      <div className="hosting-section-head">
        <h2>Secret files</h2>
        <div className="hosting-section-actions">
          <button className="btn btn-outline" onClick={addRow}><ICN.Plus size={14} /> Add file</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <Notice type="error">{err}</Notice>
      <Notice type="success">{msg}</Notice>
      {files.length === 0 && <Empty icon="ShieldCheck" title="No secret files" body="Add files that will be available on disk at runtime." />}
      <div className="hosting-card-list">
        {files.map((file, index) => (
          <div className="hosting-edit-card" key={file.id || index}>
            <input className="input mono" placeholder="/etc/secrets/config.json" value={file.name} onChange={(event) => updateRow(index, 'name', event.target.value)} />
            <input className="input mono" type={revealed[index] ? 'text' : 'password'} placeholder="file contents" value={file.value} onChange={(event) => updateRow(index, 'value', event.target.value)} />
            <button className="btn btn-sm btn-outline" onClick={() => setRevealed((current) => ({ ...current, [index]: !current[index] }))}>{revealed[index] ? 'Hide' : 'Reveal'}</button>
            <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(index)}><ICN.X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
