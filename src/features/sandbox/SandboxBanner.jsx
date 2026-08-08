import React from 'react';
import { ICN } from '../../icons.jsx';
import { clearServiceSandbox, useServiceSandbox } from './sandboxState.js';

export default function SandboxBanner({ service }) {
  const sandbox = useServiceSandbox(React);
  if (!sandbox) return null;
  if (service && sandbox.service !== service && sandbox.targetView !== service) return null;
  return (
    <div className="card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderColor: 'var(--accent)' }}>
      <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <ICN.Zap size={14} /> Sandbox active: <strong style={{ color: 'var(--text)' }}>{sandbox.label}</strong>
      </span>
      <button className="btn btn-sm btn-outline" type="button" onClick={clearServiceSandbox}>
        <ICN.X size={13} /> Turn off
      </button>
    </div>
  );
}
