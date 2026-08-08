import React, { useEffect, useState } from 'react';
import { StatusBadge } from '../../components';
import { attachHostingDisk, deleteHostingDisk, listHostingDisks, updateHostingDisk } from '../../api';
import { EmptyRows, Notice } from './SectionShell';
import { normalizeList } from './shared';

const DISK_SIZE_OPTIONS = [10, 50, 100];

export default function DisksSection({ app, deploymentId, onNeedsRedeploy }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', mountPath: '/var/glondia/data', sizeGB: 10 });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => listHostingDisks(deploymentId)
    .then((rows) => setItems(normalizeList(rows, ['items', 'disks']).map(normalizeDisk)))
    .catch((error) => { setMsg(error.message || 'Could not load disks.'); setItems([]); });
  useEffect(() => { load(); }, [deploymentId]);

  const add = async () => {
    setBusy('add'); setMsg('');
    try {
      await attachHostingDisk(deploymentId, form);
      setForm({ name: '', mountPath: '/var/glondia/data', sizeGB: 10 });
      setShowForm(false);
      setMsg('Disk attached.');
      onNeedsRedeploy?.('Persistent disks');
      load();
    } catch (error) { setMsg(error.message || 'Could not attach disk.'); }
    finally { setBusy(''); }
  };

  const sync = async (disk) => {
    setBusy(disk.diskId); setMsg('');
    try { await updateHostingDisk(deploymentId, disk.diskId, disk); setMsg('Disk synced.'); onNeedsRedeploy?.('Persistent disks'); load(); }
    catch (error) { setMsg(error.message || 'Could not sync disk.'); }
    finally { setBusy(''); }
  };

  const remove = async (disk) => {
    if (!window.confirm(`Delete disk ${disk.name}?`)) return;
    setBusy(disk.diskId); setMsg('');
    try { await deleteHostingDisk(deploymentId, disk.diskId); setMsg('Disk deleted.'); onNeedsRedeploy?.('Persistent disks'); load(); }
    catch (error) { setMsg(error.message || 'Could not delete disk.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="card">
      <div className="hosting-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Persistent SSD disks</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Attach fixed-size storage to web services.</p>
        </div>
        <button className="btn btn-outline" onClick={() => setShowForm((value) => !value)}>
          {showForm ? 'Cancel' : 'Add disk'}
        </button>
      </div>
      {app.serviceType !== 'web_service' && <p className="muted">Disks are only available for web services.</p>}
      {showForm && (
        <div style={{ marginTop: 14, marginBottom: 14, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)', display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Disk name</span>
              <input className="input" placeholder="data" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Mount path</span>
              <input className="input mono" placeholder="/var/glondia/data" value={form.mountPath} onChange={(event) => setForm((current) => ({ ...current, mountPath: event.target.value }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Disk size</span>
              <select className="input mono" value={form.sizeGB} onChange={(event) => setForm((current) => ({ ...current, sizeGB: Number(event.target.value) }))}>
                {DISK_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}GB</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {app.serviceType !== 'web_service' ? 'You can preview the disk form here, but attaching disks is only available for web services.' : 'Choose one fixed disk size and mount path for this service.'}
            </p>
            <button className="btn btn-primary" disabled={app.serviceType !== 'web_service' || busy === 'add'} onClick={add}>{busy === 'add' ? 'Attaching...' : 'Attach'}</button>
          </div>
        </div>
      )}
      <Notice>{msg}</Notice>
      <div className="hosting-card-list">
        {items.length === 0 ? <EmptyRows message="No disks attached yet." /> : items.map((disk) => (
          <div className="hosting-row-card" key={disk.diskId}>
            <div>
              <span>{disk.name}</span>
              {disk.providerError && <div className="muted" style={{ fontSize: 12 }}>{disk.providerError}</div>}
            </div>
            <span className="mono muted">{disk.mountPath} - {disk.sizeGB}GB</span>
            <StatusBadge value={disk.status || 'attached'} />
            <button className="btn btn-sm btn-outline" disabled={busy === disk.diskId} onClick={() => sync(disk)}>Sync</button>
            <button className="btn btn-sm btn-outline" disabled={busy === disk.diskId} onClick={() => remove(disk)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function normalizeDisk(disk = {}) {
  return {
    ...disk,
    diskId: disk.diskId || disk.id || disk.name,
    sizeGB: disk.sizeGB ?? disk.sizeGb ?? disk.size ?? 1,
    status: disk.providerSyncStatus === 'pending_provider' ? 'pending' : disk.status || 'attached',
  };
}
