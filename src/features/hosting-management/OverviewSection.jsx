import React from 'react';
import { Badge } from '../../components';
import BuildLogsSection from './BuildLogsSection';
import { formatDate, getRenderSourceRoot, sourceBadgeTone, sourceLabel } from './shared';

export default function OverviewSection({ app, deploymentId }) {
  const settings = app.environmentConfiguration || {};
  const generated = app.generatedSite || {};
  const root = getRenderSourceRoot(app);

  return (
    <div className="hosting-stack">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Hosting app</h2>
        <div className="kv hosting-kv">
          <dt>Source</dt><dd><Badge tone={sourceBadgeTone(app)} dot={false}>{sourceLabel(app)}</Badge></dd>
          <dt>Branch</dt><dd className="mono">{app.githubBranch || settings.branch || 'main'}</dd>
          <dt>Service type</dt><dd><Badge tone="info" dot={false}>{app.serviceType || 'static_site'}</Badge></dd>
          <dt>Live URL</dt><dd className="mono">{app.liveUrl || 'Pending'}</dd>
          <dt>Build command</dt><dd className="mono">{settings.buildCommand || generated.buildCommand || 'Not set'}</dd>
          <dt>Publish directory</dt><dd className="mono">{settings.outputDirectory || generated.publishDirectory || 'dist'}</dd>
          <dt>Last synced</dt><dd>{formatDate(app.lastRenderSyncedAt)}</dd>
          {settings.sourceRepository && <><dt>Source repository</dt><dd className="mono">{settings.sourceRepository}</dd></>}
          {root && <><dt>Source root</dt><dd className="mono">{root}</dd></>}
        </div>
        <div className="hosting-overview-logs">
          <BuildLogsSection deploymentId={deploymentId} compact />
        </div>
      </div>
    </div>
  );
}
