import React from 'react';
import { Badge } from '../../../components';

export function getHandoffReadinessChecks(config = {}, context = {}) {
  const checks = [];
  const serviceType = config.serviceType || 'static_site';
  const sourceRepository = config.sourceRepository || config.repoUrl || '';
  const branch = config.branch || 'main';
  const rootDirectory = config.rootDirectory || '';
  const buildCommand = config.buildCommand || '';
  const publishDirectory = config.publishDirectory || config.outputDirectory || '';
  const startCommand = config.startCommand || '';

  checks.push({
    status: sourceRepository ? 'ok' : (context.sourceOptional ? 'ok' : 'error'),
    label: sourceRepository ? 'Source connected' : (context.sourceOptional ? 'Source package ready' : 'Connect a source first'),
    fix: null,
  });
  checks.push({ status: branch ? 'ok' : 'error', label: branch ? `Branch set to ${branch}` : 'Branch is required', fix: null });

  if (rootDirectory.includes('/opt/render/project')) {
    checks.push({ status: 'error', label: 'Root directory cannot be a local server filesystem path', fix: context.recommendedRoot ? { label: `Use ${context.recommendedRoot}`, patch: { rootDirectory: context.recommendedRoot } } : null });
  } else if (context.recommendedRoot && rootDirectory !== context.recommendedRoot) {
    checks.push({ status: 'warn', label: `Recommended root is ${context.recommendedRoot}`, fix: { label: `Use ${context.recommendedRoot}`, patch: { rootDirectory: context.recommendedRoot } } });
  } else {
    checks.push({ status: rootDirectory ? 'ok' : 'warn', label: rootDirectory ? `Project folder set to ${rootDirectory}` : 'Project folder not set; root will be used', fix: null });
  }

  if (serviceType === 'static_site') {
    checks.push({ status: buildCommand ? 'ok' : 'error', label: buildCommand ? 'Build command set' : 'Build command is required for static sites', fix: context.recommendedBuildCommand ? { label: `Use ${context.recommendedBuildCommand}`, patch: { buildCommand: context.recommendedBuildCommand } } : null });
    checks.push({ status: publishDirectory ? 'ok' : 'error', label: publishDirectory ? `Publish folder set to ${publishDirectory}` : 'Publish folder is required for static sites', fix: context.recommendedPublishDirectory ? { label: `Use ${context.recommendedPublishDirectory}`, patch: { publishDirectory: context.recommendedPublishDirectory } } : null });
  }

  if (serviceType === 'web_service') {
    checks.push({ status: buildCommand ? 'ok' : 'error', label: buildCommand ? 'Build command set' : 'Build command is required for web services', fix: context.recommendedBuildCommand ? { label: `Use ${context.recommendedBuildCommand}`, patch: { buildCommand: context.recommendedBuildCommand } } : null });
    checks.push({ status: startCommand ? 'ok' : 'error', label: startCommand ? 'Start command set' : 'Start command is required for web services', fix: context.recommendedStartCommand ? { label: `Use ${context.recommendedStartCommand}`, patch: { startCommand: context.recommendedStartCommand } } : null });
    checks.push({ status: 'info', label: 'Server apps must listen on process.env.PORT and bind to 0.0.0.0', fix: null });
  }

  return checks;
}

function getReadinessScore(checks = []) {
  if (!checks.length) return 0;
  const max = checks.length * 2;
  const score = checks.reduce((total, check) => {
    if (check.status === 'ok') return total + 2;
    if (check.status === 'warn' || check.status === 'info') return total + 1;
    return total;
  }, 0);
  return Math.round((score / max) * 100);
}

const ICON = {
  ok:   { symbol: '✓', color: 'var(--accent)' },
  error:{ symbol: '✕', color: 'var(--danger)' },
  warn: { symbol: '⚠', color: 'var(--warning)' },
  info: { symbol: 'i', color: 'var(--text-muted)' },
};

export function HandoffReadinessCard({ config, context, onApplyFix }) {
  const checks = getHandoffReadinessChecks(config, context);
  const errors   = checks.filter((c) => c.status === 'error').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  const score    = getReadinessScore(checks);

  const statusTone  = errors ? 'danger' : warnings ? 'warn' : 'success';
  const statusLabel = errors
    ? `${errors} issue${errors > 1 ? 's' : ''}`
    : warnings
    ? `${warnings} warning${warnings > 1 ? 's' : ''}`
    : 'Ready';

  return (
    <div className="card" style={{ padding: '10px 12px', background: 'var(--bg-deep)' }}>

      {/* Header row — compact */}
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="eyebrow" style={{ margin: 0 }}>Launch Check</span>
          <Badge tone={statusTone} dot={false}>{statusLabel}</Badge>
        </div>
        <Badge tone={score >= 100 ? 'success' : score >= 70 ? 'warn' : 'danger'} dot={false}>{score}%</Badge>
      </div>

      {/* Check rows */}
      <div style={{ display: 'grid', gap: 4 }}>
        {checks.map((check, i) => {
          const ic = ICON[check.status] || ICON.info;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{
                  color: ic.color,
                  fontSize: 11,
                  fontWeight: 700,
                  width: 14,
                  textAlign: 'center',
                  flexShrink: 0,
                }}>
                  {ic.symbol}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 }}>{check.label}</span>
              </div>
              {check.fix && (
                <button
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                  onClick={() => onApplyFix?.(check.fix.patch)}
                >
                  {check.fix.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
