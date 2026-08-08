import React, { useState } from 'react';
import { ICN } from '../../icons';
import {
  purgeHostingCache,
  redeployHostingWithSettings,
  syncHostingDeployment,
  updateHostingBuildSettings,
  updateHostingDeploySettings,
  updateHostingSettings,
  updateHostingSourceSettings,
} from '../../api';
import { getRenderSourceRoot } from './shared';
import { Notice } from './SectionShell';

export default function HostingSettingsSection({ app, deploymentId, onReload, isStatic, onPurgeCache, busy: outerBusy, onNeedsRedeploy }) {
  const config = app.environmentConfiguration || {};
  const [serviceForm, setServiceForm] = useState({
    serviceName: app.serviceName || app.siteName || '',
    serviceType: app.serviceType || 'static_site',
    plan: app.plan || '',
    region: app.region || '',
  });
  const [sourceForm, setSourceForm] = useState({
    sourceRepository: config.sourceRepository || app.repoUrl || '',
    branch: config.branch || app.githubBranch || 'main',
    rootDirectory: getRenderSourceRoot(app),
  });
  const [buildForm, setBuildForm] = useState({
    buildCommand: config.buildCommand || app.generatedSite?.buildCommand || '',
    outputDirectory: config.outputDirectory || app.generatedSite?.publishDirectory || 'dist',
  });
  const [deployForm, setDeployForm] = useState({
    autoDeploy: config.autoDeploy ?? true,
    healthCheckPath: config.healthCheckPath || '/',
  });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [openSection, setOpenSection] = useState('');

  const run = async (name, action, success, redeployLabel = '') => {
    setBusy(name); setMsg(''); setErr('');
    try {
      await action();
      setMsg(success);
      if (redeployLabel) onNeedsRedeploy?.(redeployLabel);
      onReload?.();
    } catch (error) { setErr(error.message || 'Action failed.'); }
    finally { setBusy(''); }
  };

  const allBusy = busy || outerBusy;
  const fullSettingsPayload = () => ({
    ...serviceForm,
    ...sourceForm,
    ...buildForm,
    ...deployForm,
  });

  return (
    <div className="grid-side hosting-section-grid">
      <div className="hosting-stack">
        <SettingsCard
          title="Service settings"
          summary={serviceForm.serviceName || app.serviceName || 'Name, type, plan, and region'}
          open={openSection === 'service'}
          onToggle={() => setOpenSection((current) => current === 'service' ? '' : 'service')}
        >
          <div className="hosting-form-grid">
            <label><span className="label">Service name</span><input className="input" value={serviceForm.serviceName} onChange={(event) => setServiceForm((current) => ({ ...current, serviceName: event.target.value }))} /></label>
            <label><span className="label">Service type</span><select className="select" value={serviceForm.serviceType} onChange={(event) => setServiceForm((current) => ({ ...current, serviceType: event.target.value }))}><option value="static_site">Static site</option><option value="web_service">Web service</option></select></label>
            <label><span className="label">Plan</span><input className="input" value={serviceForm.plan} onChange={(event) => setServiceForm((current) => ({ ...current, plan: event.target.value }))} /></label>
            <label><span className="label">Region</span><input className="input" value={serviceForm.region} onChange={(event) => setServiceForm((current) => ({ ...current, region: event.target.value }))} /></label>
          </div>
          <div className="hosting-settings-actions">
            <button className="btn btn-primary" disabled={!!allBusy} onClick={() => run('service', () => updateHostingSettings(deploymentId, serviceForm), 'Service settings saved.', 'Service settings')}>Save service</button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Source settings"
          summary={sourceForm.sourceRepository || 'Repository, branch, and root directory'}
          open={openSection === 'source'}
          onToggle={() => setOpenSection((current) => current === 'source' ? '' : 'source')}
        >
          <div className="hosting-form-grid">
            <label><span className="label">Repository</span><input className="input mono" value={sourceForm.sourceRepository} onChange={(event) => setSourceForm((current) => ({ ...current, sourceRepository: event.target.value }))} /></label>
            <label><span className="label">Branch</span><input className="input mono" value={sourceForm.branch} onChange={(event) => setSourceForm((current) => ({ ...current, branch: event.target.value }))} /></label>
            <label><span className="label">Root directory</span><input className="input mono" value={sourceForm.rootDirectory} onChange={(event) => setSourceForm((current) => ({ ...current, rootDirectory: event.target.value }))} /></label>
          </div>
          <div className="hosting-settings-actions">
            <button className="btn btn-primary" disabled={!!allBusy} onClick={() => run('source', () => updateHostingSourceSettings(deploymentId, sourceForm), 'Source settings saved.', 'Source settings')}>Save source</button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Build settings"
          summary={`${buildForm.buildCommand || 'No build command'} → ${buildForm.outputDirectory || 'dist'}`}
          open={openSection === 'build'}
          onToggle={() => setOpenSection((current) => current === 'build' ? '' : 'build')}
        >
          <div className="hosting-form-grid">
            <label><span className="label">Build command</span><input className="input mono" value={buildForm.buildCommand} onChange={(event) => setBuildForm((current) => ({ ...current, buildCommand: event.target.value }))} /></label>
            <label><span className="label">Publish directory</span><input className="input mono" value={buildForm.outputDirectory} onChange={(event) => setBuildForm((current) => ({ ...current, outputDirectory: event.target.value }))} /></label>
          </div>
          <div className="hosting-settings-actions">
            <button className="btn btn-primary" disabled={!!allBusy} onClick={() => run('build', () => updateHostingBuildSettings(deploymentId, buildForm), 'Build settings saved.', 'Build settings')}>Save build</button>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Deploy settings"
          summary={`${deployForm.autoDeploy ? 'Auto deploy on' : 'Auto deploy off'} · health ${deployForm.healthCheckPath || '/'}`}
          open={openSection === 'deploy'}
          onToggle={() => setOpenSection((current) => current === 'deploy' ? '' : 'deploy')}
        >
          <div className="hosting-form-grid">
            <label><span className="label">Health check path</span><input className="input mono" value={deployForm.healthCheckPath} onChange={(event) => setDeployForm((current) => ({ ...current, healthCheckPath: event.target.value }))} /></label>
            <label className="hosting-toggle-row"><input type="checkbox" checked={!!deployForm.autoDeploy} onChange={(event) => setDeployForm((current) => ({ ...current, autoDeploy: event.target.checked }))} /> Auto deploy</label>
          </div>
          <div className="hosting-settings-actions">
            <button className="btn btn-primary" disabled={!!allBusy} onClick={() => run('deploy', () => updateHostingDeploySettings(deploymentId, deployForm), 'Deploy settings saved.', 'Deploy settings')}>Save deploy</button>
          </div>
        </SettingsCard>
      </div>

      <div className="hosting-stack">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Repair tools</h2>
          <div className="hosting-button-stack">
            <button className="btn btn-outline" disabled={!!allBusy} onClick={() => run('sync', () => syncHostingDeployment(deploymentId), 'Synced with hosting provider.')}><ICN.Refresh size={14} /> Sync</button>
            <button className="btn btn-outline" disabled={!!allBusy} onClick={() => run('redeploy', () => redeployHostingWithSettings(deploymentId, fullSettingsPayload()), 'Redeploy started.')}><ICN.Refresh size={14} /> Redeploy with settings</button>
            <button className="btn btn-outline" disabled={!!allBusy} onClick={() => run('clear', async () => { await purgeHostingCache(deploymentId); await redeployHostingWithSettings(deploymentId, {}); }, 'Cache cleared and redeploy started.')}><ICN.Trash size={14} /> Clear cache and redeploy</button>
            {isStatic && <button className="btn btn-outline" disabled={!!allBusy} onClick={() => run('purge', onPurgeCache || (() => purgeHostingCache(deploymentId)), 'CDN cache purged.')}><ICN.Trash size={14} /> Purge CDN cache</button>}
          </div>
        </div>
        <Notice type="success">{msg}</Notice>
        <Notice type="error">{err}</Notice>
      </div>
    </div>
  );
}

function SettingsCard({ title, summary, open, onToggle, children }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        className="hosting-settings-toggle"
        aria-expanded={open}
        style={{ width: '100%', border: 0, background: 'transparent', color: 'inherit', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 16 }}>{title}</span>
          <span className="muted mono" style={{ display: 'block', marginTop: 4, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary || 'Configure settings'}</span>
        </span>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .5s ease', color: 'var(--text-muted)' }}>
          <ICN.Chevron size={18} />
        </span>
      </button>
      <div
        style={{
          maxHeight: open ? 520 : 0,
          opacity: open ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height .5s ease, opacity .5s ease',
        }}
      >
        <div style={{ padding: '0 16px 16px', display: 'grid', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
