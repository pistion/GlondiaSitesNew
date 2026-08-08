import React from 'react';
import { ICN } from '../../../icons';

export function ZipPreparePanel({
  zipFile,
  zipBusy,
  zipError,
  zipNotice,
  zipConfig,
  dragging,
  fileInputRef,
  onDragState,
  onDrop,
  onSelectZip,
  onClearZip,
  formatFileSize,
}) {
  return (
    <div className="builder-import-pane">
      <div
        onDragOver={(e) => { e.preventDefault(); onDragState(true); }}
        onDragEnter={(e) => { e.preventDefault(); onDragState(true); }}
        onDragLeave={() => onDragState(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `2px dashed ${zipFile ? 'var(--accent)' : dragging ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: 28, textAlign: 'center', background: zipFile ? 'var(--accent-soft)' : dragging ? 'var(--accent-soft)' : 'var(--bg-deep)', cursor: 'pointer' }}
      >
        <input ref={fileInputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" style={{ display: 'none' }} onClick={(e) => { e.currentTarget.value = ''; }} onChange={(e) => onSelectZip(e.target.files?.[0])} />
        <div style={{ width: 52, height: 52, borderRadius: 999, background: zipFile ? 'var(--accent)' : 'var(--accent-soft)', color: zipFile ? '#fff' : 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          {zipFile ? <ICN.CheckCircle size={24} /> : <ICN.Box size={24} />}
        </div>
        <h3 style={{ margin: '0 0 6px' }}>{zipFile ? 'Package selected' : 'Drop your website ZIP here'}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{zipFile ? `${zipFile.name} - ${formatFileSize(zipFile.size)}` : 'Include package.json or index.html. Glondia ignores build caches, node_modules, and source-control folders.'}</p>
      </div>
      {zipFile && <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--bg-deep)', border: '1px solid var(--accent)' }}><div className="row between" style={{ gap: 10 }}><div><div style={{ fontWeight: 700 }}>Selected file</div><div className="mono muted" style={{ fontSize: 12 }}>{zipFile.name} - {formatFileSize(zipFile.size)}</div></div><button className="btn btn-sm btn-outline" onClick={onClearZip} disabled={zipBusy}>Remove</button></div></div>}
      {zipConfig && (
        <div className="card" style={{ marginTop: 12, padding: 12, background: 'var(--bg-deep)', fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Glondia platform readiness</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><span style={{ color: 'var(--accent)' }}>Ready</span> Publishing lane</div>
          </div>
        </div>
      )}
      {zipNotice && <div style={{ marginTop: 10, color: 'var(--accent)', fontSize: 13 }}>{zipNotice}</div>}
      {zipError && <div style={{ marginTop: 10, color: 'var(--danger)', fontSize: 13 }}>{zipError}</div>}
    </div>
  );
}
