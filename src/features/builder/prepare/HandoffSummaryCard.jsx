import React, { useState } from 'react';

export function HandoffSummaryCard({ config }) {
  const [open, setOpen] = useState(false);
  const isStatic = (config.serviceType || 'static_site') === 'static_site';

  const rows = [
    { label: 'Name',    value: config.serviceName || 'auto' },
    { label: 'Type',    value: config.serviceType || 'static_site' },
    { label: 'Source',  value: config.sourceRepository || config.repoUrl || 'Uploaded package', mono: true, wrap: true },
    { label: 'Branch',  value: config.branch || 'main', mono: true },
    { label: 'Folder',  value: config.rootDirectory || 'project root', mono: true },
    { label: 'Build',   value: config.buildCommand || 'Not set', mono: true },
    isStatic
      ? { label: 'Publish', value: config.publishDirectory || config.outputDirectory || 'Not set', mono: true }
      : { label: 'Start',   value: config.startCommand || 'Not set', mono: true },
  ];

  return (
    <div className="card" style={{ padding: '8px 12px', background: 'var(--bg-deep)' }}>

      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        <span className="eyebrow" style={{ margin: 0 }}>Glondia launch settings</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? 'Hide' : 'View'} <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* Collapsible detail */}
      {open && (
        <div
          className="kv"
          style={{ gridTemplateColumns: '80px 1fr', gap: '4px 12px', marginTop: 8, fontSize: 12 }}
        >
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.label}</dt>
              <dd
                className={r.mono ? 'mono' : undefined}
                style={{ wordBreak: r.wrap ? 'break-all' : undefined, fontSize: 12 }}
              >
                {r.value}
              </dd>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
