import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ICN } from './icons';
import { Badge, Empty, StatusBadge, Tabs } from './components';
import { uploadManualReceipt, createPaypalOrder, capturePaypalOrder } from './api/payments.js';
import SandboxBanner from './features/sandbox/SandboxBanner.jsx';
import {
  HOSTING_TABS,
  BillingSection,
  BuildLogsSection,
  DeployHistorySection,
  DisksSection,
  DomainsSection,
  EnvVarsSection,
  HeadersSection,
  HostingSettingsSection,
  MetricsSection,
  OverviewSection,
  SecretFilesSection,
  WebhooksSection,
} from './features/hosting-management';

// Glondia Hosting Hub owns live-site controls: logs, settings, env vars,
// secret files, headers, routes, disks, domains, billing, and lifecycle actions.
import {
  getDeploymentLogStreamUrl,
  getHostingPaymentStatus,
  getHostingService,
  getRenderDeploymentStatus,
  getRenderSettings,
  listHostingDeployments,
  redeployRenderDeployment,
  syncHostingDeployment,
  suspendHostingDeployment,
  resumeHostingDeployment,
  restartHostingDeployment,
  cancelHostingDeploy,
  rollbackHostingDeploy,
  listHostingDeployHistory,
  purgeHostingCache,
  listHostingEvents,
  listHostingSecretFiles,
  upsertHostingSecretFiles,
  listHostingHeaders,
  updateHostingHeaders,
  listHostingRoutes,
  updateHostingRoutes,
  getHostingMetrics,
  deleteHostingDeployment,
  verifyRenderDeploymentUrl,
  listHostingEnvVars,
  upsertHostingEnvVar,
  syncHostingEnvVars,
  listHostingDisks,
  attachHostingDisk,
  updateHostingDisk,
  deleteHostingDisk,
  listHostingDomains,
  addHostingDomain,
  verifyHostingDomain,
  updateHostingSettings,
  updateHostingDeploySettings,
  updateHostingBuildSettings,
  updateHostingSourceSettings,
  redeployHostingWithSettings,
} from './api';

function getHostingSourceType(app) {
  if (app?.source === 'zip-upload' || app?.generatedSite?.sourceType === 'uploaded-zip-source-artifact') return 'zip-upload';
  if (app?.source === 'template') return 'template';
  if (app?.source === 'ai-tailored-template' || app?.sourceReference === 'roxanne-ai-tailored-template') return 'roxanne-ai';
  if (app?.githubRepo || app?.source === 'github') return 'github';
  return 'builder';
}
function isZipUpload(app) { return getHostingSourceType(app) === 'zip-upload'; }
function isTemplateGenerated(app) { return getHostingSourceType(app) === 'template'; }
function isRoxanneGenerated(app) { return getHostingSourceType(app) === 'roxanne-ai'; }
function sourceLabel(app) { const t = getHostingSourceType(app); return t === 'zip-upload' ? 'ZIP Upload' : t === 'template' ? 'Template' : t === 'roxanne-ai' ? 'RoxanneAI generated' : t === 'github' ? 'GitHub import' : 'Builder'; }
function sourceBadgeTone(app) { const t = getHostingSourceType(app); return t === 'zip-upload' || t === 'template' || t === 'roxanne-ai' ? 'info' : 'muted'; }
function hostingPlanLabel(app) { return app?.hostingPlan === 'dedicated' || app?.provider === 'vultr' ? 'Dedicated Hosting' : 'Shared Hosting'; }
function getRenderSourceRoot(app) { return app?.generatedSite?.sourceArtifact?.targetRoot || app?.generatedSite?.githubTargetRoot || app?.render?.githubPublish?.targetRoot || app?.environmentConfiguration?.rootDirectory || ''; }
function hasRealRenderId(id) { return Boolean(id && !String(id).includes('_pending')); }

export function HostingList({ navigate }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('apps');
  const [prefillConfig, setPrefillConfig] = useState(null);
  const [showDeployOptions, setShowDeployOptions] = useState(false);

  // Read ?prefill= query param set by template-configurator after AI generation
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('prefill');
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(raw));
        setPrefillConfig(parsed);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch { /* ignore malformed prefill */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listHostingDeployments().then((items) => { if (!cancelled) setApps(items || []); }).catch((err) => { if (!cancelled) setError(err.message || 'Hosting apps could not be loaded.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Hosting</div>
          <h1>Glondia Hosting</h1>
          <p className="sub">Deploy and manage apps created from GitHub, ZIP imports, or RoxanneAI Site Builder templates.</p>
        </div>
        <div className="actions">
          {tab === 'apps' && (
            <>
              <button className="btn btn-outline" onClick={() => navigate({ view: 'builder-templates' })}><ICN.Layers size={14} /> Site builder</button>
              <button className="btn btn-primary" onClick={() => setShowDeployOptions((open) => !open)}><ICN.Plus size={14} /> New deploy</button>
            </>
          )}
        </div>
      </div>

      <SandboxBanner service="hosting" />

      {prefillConfig && (
        <div className="card prefill-banner" style={{ padding: '18px 20px', marginBottom: 20, borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <ICN.Sparkles size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent-ink)' }}>✓ Site generated — ready to deploy</div>
              <div style={{ fontSize: 13, marginTop: 2, color: 'var(--accent-ink)', opacity: 0.8 }}>
                <strong>{prefillConfig.name}</strong> was pushed to GitHub. Review the config below and click Deploy.
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--accent-ink)' }} onClick={() => setPrefillConfig(null)}>✕</button>
          </div>

          <div className="kv" style={{ marginTop: 14, gridTemplateColumns: '130px 1fr', gap: '6px 14px', fontSize: 13 }}>
            <dt>Site name</dt><dd className="mono">{prefillConfig.name}</dd>
            <dt>GitHub repo</dt><dd><a href={prefillConfig.repoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)' }}>{prefillConfig.repoUrl}</a></dd>
            <dt>Branch</dt><dd className="mono">{prefillConfig.branch}</dd>
            <dt>Root directory</dt><dd className="mono">{prefillConfig.rootDir}</dd>
            <dt>Build command</dt><dd className="mono">{prefillConfig.buildCommand}</dd>
            <dt>Publish dir</dt><dd className="mono">{prefillConfig.publishDir}</dd>
            <dt>Type</dt><dd className="mono">{prefillConfig.serviceType}</dd>
            <dt>Plan</dt><dd className="mono">{prefillConfig.plan}</dd>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button
              className="btn btn-primary"
              onClick={() => navigate({ view: 'builder-import', params: { mode: 'github', prefill: prefillConfig } })}
            >
              <ICN.Server size={14} /> Deploy site
            </button>
            <a href={prefillConfig.repoUrl} target="_blank" rel="noreferrer" className="btn btn-outline">
              <ICN.Git size={14} /> View on GitHub
            </a>
          </div>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} options={[{ value: 'apps', label: 'My apps' }, { value: 'billing', label: 'Billing' }, { value: 'settings', label: 'Settings' }]} />
      {tab === 'apps' ? (
        <>
          {showDeployOptions && <HostingDeploySetup navigate={navigate} onClose={() => setShowDeployOptions(false)} />}
          {error && <div className="card" style={{ padding: '10px 14px', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {loading
            ? <div className="card" style={{ padding: '42px 24px' }}><Empty icon="Server" title="Loading hosting apps..." /></div>
            : apps.length === 0
              ? <div className="card" style={{ padding: '48px 24px' }}><Empty icon="Server" title="No hosted apps yet" body="Start a deploy above from GitHub, ZIP upload, or choose a template in Site builder." /></div>
              : <div className="grid-2 hosting-app-grid">{apps.map((app) => <HostingAppCard key={app.deploymentId || app.id} app={app} navigate={navigate} />)}</div>
          }
        </>
      ) : tab === 'billing' ? (
        <BillingSection scope="hosting" app={{ billingPlanName: 'Professional' }} />
      ) : <HostingSettings />}
    </>
  );
}

function HostingDeploySetup({ navigate, onClose }) {
  const [hostingTarget, setHostingTarget] = useState('');
  const [dedicatedPlan, setDedicatedPlan] = useState(null);
  const go = (route) => {
    onClose?.();
    navigate(route);
  };
  const options = [
    {
      icon: ICN.Git,
      title: 'Deploy from GitHub',
      body: 'Connect an existing repository, confirm build settings, then hand it to Hosting.',
      action: 'Start GitHub deploy',
      onClick: () => go({ view: 'builder-import', params: { mode: 'github', hostingTarget, dedicatedPlan } }),
    },
    {
      icon: ICN.Box,
      title: 'Upload ZIP',
      body: 'Drop a deployable ZIP package, validate the source, then send it to Hosting.',
      action: 'Start ZIP upload',
      onClick: () => go({ view: 'builder-import', params: { mode: 'zip', hostingTarget, dedicatedPlan } }),
    },
    {
      icon: ICN.Layers,
      title: 'Choose template',
      body: 'Use Site builder templates first, then send the generated site into Hosting.',
      action: 'Open Site builder',
      onClick: () => go({ view: 'builder-templates' }),
      secondary: true,
    },
  ];
  const dedicatedPlans = [
    { id: 'managed-essential', tierKey: 'starter', tierLabel: 'Essential', monthly_cost: 10, vcpu_count: 1, ram: 1024, disk: 25 },
    { id: 'managed-performance', tierKey: 'balanced', tierLabel: 'Performance', monthly_cost: 30, vcpu_count: 2, ram: 4096, disk: 80 },
    { id: 'managed-high-performance', tierKey: 'power', tierLabel: 'High performance', monthly_cost: 100, vcpu_count: 4, ram: 16384, disk: 320 },
  ];
  const sourceReady = hostingTarget === 'shared' || (hostingTarget === 'vultr' && dedicatedPlan);

  return (
    <div className="card hosting-deploy-setup">
      <button className="btn btn-icon btn-ghost hosting-deploy-close" onClick={onClose} aria-label="Close deploy options"><ICN.X size={16} /></button>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Choose a deploy source</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Choose where the app will run, then select its source.
      </p>
      <div className="hosting-deploy-step-label"><span>1</span> Choose a hosting plan</div>
      <div className="hosting-deploy-options" style={{ marginBottom: 18 }}>
        {[
          { id: 'shared', icon: ICN.Server, title: 'Shared Hosting', body: 'Recommended for most websites. Glondia manages deployment, SSL, logs, and availability.' },
          { id: 'vultr', icon: ICN.Server, title: 'Dedicated Hosting', body: 'Private compute resources for demanding websites and web applications.' },
        ].map((target) => {
          const Icon = target.icon;
          const selected = hostingTarget === target.id;
          return (
            <button
              key={target.id}
              type="button"
              className={`hosting-deploy-option${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => { setHostingTarget(target.id); if (target.id !== 'vultr') setDedicatedPlan(null); }}
            >
              <span className="hosting-deploy-option-icon"><Icon size={18} /></span>
              <span style={{ flex: 1 }}><strong>{target.title}</strong><small>{target.body}</small></span>
              {selected && <ICN.CheckCircle size={17} style={{ color: 'var(--accent)' }} />}
            </button>
          );
        })}
      </div>
      {hostingTarget === 'vultr' && (
        <div className="hosting-dedicated-plans">
          <div className="hosting-deploy-step-label"><span>2</span> Choose server performance</div>
          <div className="hosting-dedicated-plan-grid">
            {dedicatedPlans.map((plan) => {
              const selected = dedicatedPlan?.id === plan.id;
              return <button key={plan.id} type="button" className={`hosting-dedicated-plan${selected ? ' is-selected' : ''}`} onClick={() => setDedicatedPlan(plan)}>
                <span className="eyebrow">{plan.tierLabel}</span>
                <strong>${plan.monthly_cost}<small>/month estimated</small></strong>
                <span>{plan.vcpu_count} vCPU · {plan.ram / 1024} GB RAM · {plan.disk} GB SSD</span>
                {selected && <ICN.CheckCircle size={17} />}
              </button>;
            })}
          </div>
        </div>
      )}
      {sourceReady ? (
        <div className="hosting-deploy-source-step">
          <div className="hosting-deploy-step-label"><span>{hostingTarget === 'vultr' ? '3' : '2'}</span> Choose how to add the website</div>
          <div className="hosting-deploy-options">
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.title} type="button" className="hosting-deploy-option" onClick={option.onClick}>
                  <span className="hosting-deploy-option-icon"><Icon size={18} /></span>
                  <span style={{ flex: 1 }}>
                    <strong>{option.title}</strong>
                    <small>{option.body}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="hosting-deploy-source-placeholder">
          {hostingTarget === 'vultr' ? 'Choose a server performance level to continue.' : 'Select a hosting plan to continue to GitHub, ZIP upload, or templates.'}
        </div>
      )}
    </div>
  );
}

function HostingAppCard({ app, navigate }) {
  const src = sourceLabel(app); const building = ['preparing', 'queued', 'building', 'deploying', 'verifying'].includes(app.status);
  return <button type="button" className="card" onClick={() => navigate({ view: 'hosting-detail', params: { id: app.deploymentId || app.id } })} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14, color: 'inherit' }}><div className="row between"><div className="row" style={{ gap: 12, minWidth: 0 }}><span className="proj-thumb" style={{ width: 40, height: 40, fontSize: 15 }}>{(app.serviceName || app.siteName || 'A')[0]}</span><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{app.serviceName || app.siteName}</div><div className="mono faint" style={{ fontSize: 12 }}>{src}</div></div></div><StatusBadge value={statusLabel(app.status)} /></div><div className="row" style={{ gap: 6 }}><Badge tone={sourceBadgeTone(app)} dot={false}>{src}</Badge><Badge tone="muted" dot={false}>{hostingPlanLabel(app)}</Badge></div>{building && <DeploymentPulse compact />}<div className="kv" style={{ gridTemplateColumns: '110px 1fr', gap: '6px 14px' }}><dt>Step</dt><dd>{app.currentStep || statusLabel(app.status)}</dd><dt>Build</dt><dd className="mono">{app.buildStatus || 'pending'}</dd><dt>Live URL</dt><dd className="mono">{app.liveUrl ? app.liveUrl.replace(/^https?:\/\//, '') : 'Pending'}</dd><dt>Plan</dt><dd>{hostingPlanLabel(app)}</dd><dt>Source</dt><dd className="mono">{src}</dd></div><div className="row" style={{ gap: 8 }}>{app.liveUrl && <a className="btn btn-sm btn-outline" href={app.liveUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><ICN.ExternalLink size={13} /> View Live Site</a>}<span className="btn btn-sm btn-primary">Manage</span></div></button>;
}

const TAB_OPTIONS = HOSTING_TABS;
const REDEPLOY_DELAY_MS = 20 * 60 * 1000;

function redeployNoticeStorageKey(deploymentId) {
  return `glondia:hosting:${deploymentId}:pending-redeploy`;
}

function readRedeployNotice(deploymentId) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(redeployNoticeStorageKey(deploymentId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRedeployNotice(deploymentId, notice) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(redeployNoticeStorageKey(deploymentId), JSON.stringify(notice));
}

function clearRedeployNotice(deploymentId) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(redeployNoticeStorageKey(deploymentId));
}

export function HostingDetail({ id, navigate }) {
  const deploymentId = id;
  const [app, setApp] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [tab, setTab] = useState('Overview');
  const [redeployNotice, setRedeployNotice] = useState(() => readRedeployNotice(deploymentId));
  const [showRedeployPopup, setShowRedeployPopup] = useState(false);
  const copyTimerRef = useRef(null);
  const redeployTimerRef = useRef(null);

  const load = useCallback(async () => {
    const [hosting, nextStatus] = await Promise.all([
      getHostingService(deploymentId),
      getRenderDeploymentStatus(deploymentId).catch(() => null),
    ]);
    setApp(hosting);
    setStatus(nextStatus);
  }, [deploymentId]);

  useEffect(() => {
    let cancelled = false;
    const run = () => load().catch((err) => { if (!cancelled) setError(err.message || 'Hosting app could not be loaded.'); }).finally(() => { if (!cancelled) setLoading(false); });
    run();
    const interval = setInterval(run, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [deploymentId, load]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    setRedeployNotice(readRedeployNotice(deploymentId));
    setShowRedeployPopup(false);
  }, [deploymentId]);

  useEffect(() => {
    if (redeployTimerRef.current) clearTimeout(redeployTimerRef.current);
    if (!redeployNotice?.scheduledFor || redeployNotice.status !== 'pending') return undefined;
    const waitMs = Math.max(0, new Date(redeployNotice.scheduledFor).getTime() - Date.now());
    redeployTimerRef.current = setTimeout(() => {
      runAction('redeploy', () => redeployRenderDeployment(deploymentId, { reason: 'scheduled_settings_change', changes: redeployNotice.changes || [] }))
        .then((ok) => {
          if (ok) {
            clearRedeployNotice(deploymentId);
            setRedeployNotice(null);
            setShowRedeployPopup(false);
          }
        });
    }, waitMs);
    return () => {
      if (redeployTimerRef.current) clearTimeout(redeployTimerRef.current);
    };
  }, [deploymentId, redeployNotice]);

  const merged = useMemo(() => ({ ...(app || {}), ...(status || {}) }), [app, status]);
  const isRemoved = merged.status === 'deleted';
  const isBuilding = ['preparing', 'queued', 'building'].includes(merged.status);
  const isSuspended = merged.status === 'suspended';
  const isWebService = merged.serviceType === 'web_service';
  const real = hasRealRenderId(merged.renderServiceId);

  const runAction = async (name, fn) => {
    setBusy(name); setError('');
    try { await fn(); await load(); return true; }
    catch (err) { setError(err.message || 'Action failed.'); return false; }
    finally { setBusy(''); }
  };

  const handleDelete = () => {
    if (!window.confirm('Permanently delete this site and all its data? This cannot be undone.')) return;
    runAction('delete', async () => {
      await deleteHostingDeployment(deploymentId);
      navigate({ view: 'hosting-list' });
    });
  };

  const handleCopyUrl = async () => {
    if (!merged.liveUrl) return;
    await navigator.clipboard?.writeText(merged.liveUrl);
    setCopiedUrl(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedUrl(false), 1600);
  };

  const flagRedeployNeeded = (changeLabel) => {
    const existing = readRedeployNotice(deploymentId);
    const createdAt = existing?.createdAt || new Date().toISOString();
    const scheduledFor = existing?.scheduledFor || new Date(Date.now() + REDEPLOY_DELAY_MS).toISOString();
    const changes = Array.from(new Set([...(existing?.changes || []), changeLabel].filter(Boolean)));
    const next = {
      status: 'pending',
      createdAt,
      scheduledFor,
      changes,
      updatedAt: new Date().toISOString(),
    };
    writeRedeployNotice(deploymentId, next);
    setRedeployNotice(next);
    setShowRedeployPopup(true);
  };

  const handleRedeployNow = async () => {
    const ok = await runAction('redeploy', () => redeployRenderDeployment(deploymentId, { reason: 'manual_pending_settings', changes: redeployNotice?.changes || [] }));
    if (ok) {
      clearRedeployNotice(deploymentId);
      setRedeployNotice(null);
      setShowRedeployPopup(false);
    }
  };

  if (loading) return <div className="card" style={{ padding: 42 }}><Empty icon="Server" title="Loading hosting app..." /></div>;
  if (!app) return <div className="card" style={{ padding: 42 }}><Empty icon="AlertCircle" title="Hosting app not found" action={<button className="btn btn-outline" onClick={() => navigate({ view: 'hosting-list' })}>Back to Hosting</button>} /></div>;
  const src = sourceLabel(merged);

  return <>
    <div className="page-head">
      <div>
        <button className="page-eyebrow" style={{ background: 'none', border: 0, padding: 0, color: 'var(--text-muted)' }} onClick={() => navigate({ view: 'hosting-list' })}>Back to Hosting</button>
        <div className="row" style={{ gap: 14, marginTop: 8 }}>
          <span className="proj-thumb" style={{ width: 44, height: 44, fontSize: 16 }}>{(merged.serviceName || 'A')[0]}</span>
          <div>
            <h1 style={{ margin: 0 }}>{merged.serviceName || merged.siteName}</h1>
            <div className="row" style={{ gap: 10, marginTop: 6, color: 'var(--text-muted)', fontSize: 13, flexWrap: 'wrap' }}>
              <span className="mono">{hasRealRenderId(merged.renderServiceId) ? merged.renderServiceId : merged.deploymentId}</span>
              <span>·</span>
              <StatusBadge value={statusLabel(merged.status)} />
              <Badge tone={sourceBadgeTone(merged)} dot={false}>{src}</Badge>
              {merged.lastRenderSyncedAt && <span className="mono">Synced {formatDate(merged.lastRenderSyncedAt)}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div className="hosting-tabs-wrap">
      <Tabs value={tab} onChange={setTab} options={TAB_OPTIONS} />
      <label className="hosting-tab-select">
        <span className="label">Section</span>
        <select className="select" value={tab} onChange={(event) => setTab(event.target.value)}>
          {TAB_OPTIONS.map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return <option key={value} value={value}>{label}</option>;
          })}
        </select>
      </label>
    </div>
    <SandboxBanner service="hosting" />
    {redeployNotice && !showRedeployPopup && (
      <PendingRedeployBanner notice={redeployNotice} onOpen={() => setShowRedeployPopup(true)} onRedeployNow={handleRedeployNow} busy={busy === 'redeploy'} />
    )}
    {showRedeployPopup && redeployNotice && (
      <PendingRedeployPopup notice={redeployNotice} onClose={() => setShowRedeployPopup(false)} onRedeployNow={handleRedeployNow} busy={busy === 'redeploy'} />
    )}
    {error && <div className="card" style={{ padding: '10px 14px', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
    <div key={tab} className="hosting-tab-panel-animate">
      {tab === 'Overview' && (
        <div className="hosting-overview-stack">
          <DeploymentStatusPanel
            app={merged}
            onVerify={() => runAction('verify', () => verifyRenderDeploymentUrl(deploymentId))}
            busy={busy}
            controls={<AdminPanel app={merged} real={real} />}
            actions={<HostingOverviewActions
              app={merged}
              busy={busy}
              copiedUrl={copiedUrl}
              isRemoved={isRemoved}
              isSuspended={isSuspended}
              real={real}
              onCopyUrl={handleCopyUrl}
              onRedeploy={() => runAction('redeploy', () => redeployRenderDeployment(deploymentId))}
              onSuspend={() => window.confirm('Suspend this site?') && runAction('suspend', () => suspendHostingDeployment(deploymentId))}
              onResume={() => runAction('resume', () => resumeHostingDeployment(deploymentId))}
              onDelete={handleDelete}
            />}
          />
          <OverviewSection app={merged} deploymentId={deploymentId} />
        </div>
      )}
      {tab === 'Deploy History' && <DeployHistorySection app={merged} deploymentId={deploymentId} busy={busy} onRollback={(deployId) => window.confirm(`Roll back to deploy ${deployId.slice(0, 8)}?`) && runAction('rollback', () => rollbackHostingDeploy(deploymentId, deployId))} />}
      {tab === 'Build Logs' && <BuildLogsSection deploymentId={deploymentId} />}
      {tab === 'Metrics' && <MetricsSection deploymentId={deploymentId} />}
      {tab === 'Hosting Settings' && <HostingSettingsSection app={merged} deploymentId={deploymentId} onReload={load} isStatic={merged.serviceType !== 'web_service'} onPurgeCache={() => runAction('purgeCache', () => purgeHostingCache(deploymentId))} busy={busy} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Env Vars' && <EnvVarsSection deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Secret Files' && <SecretFilesSection deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Headers' && <HeadersSection deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Webhooks' && <WebhooksSection deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Disks' && <DisksSection app={merged} deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Domains' && <DomainsSection app={merged} deploymentId={deploymentId} onNeedsRedeploy={flagRedeployNeeded} />}
      {tab === 'Billing' && <BillingSection deploymentId={deploymentId} app={merged} onReload={load} scope="website" />}
    </div>
  </>;
}

function DeploymentStatusPanel({ app, onVerify, busy, controls, actions }) {
  const hasService = hasRealRenderId(app.renderServiceId); const hasDeploy = hasRealRenderId(app.renderDeployId); const renderAttempted = Boolean(app.render?.attempted || hasService || hasDeploy); const renderPending = !renderAttempted && (String(app.renderServiceId || '').includes('_pending') || app.render?.skippedReason); const shouldAnimate = ['preparing', 'queued', 'building', 'deploying', 'verifying'].includes(app.status) && !renderPending;
  return <div className="card"><div className="row between hosting-deployment-status-head"><div><div className="page-eyebrow" style={{ marginBottom: 6 }}>{sourceLabel(app)} deployment status</div><h2 style={{ margin: 0 }}>{statusLabel(app.status)}</h2></div><div className="hosting-deployment-status-actions"><StatusBadge value={statusLabel(app.status)} />{actions}</div></div>{(isZipUpload(app) || isTemplateGenerated(app) || isRoxanneGenerated(app)) && <SourcePackageBlock app={app} />}{renderAttempted && <RenderStartedBlock app={app} />}{!renderAttempted && renderPending && <RenderNotStartedBlock app={app} />}{shouldAnimate && <DeploymentPulse />}{app.status === 'failed' && <FailureBlock app={app} />}{app.status === 'live' && <SuccessBlock app={app} />}{app.status === 'deployed_unverified' && <WarmingBlock app={app} />}<div className="kv" style={{ marginTop: 16, gridTemplateColumns: '150px 1fr' }}><dt>Current step</dt><dd>{app.currentStep || statusLabel(app.status)}</dd><dt>Build status</dt><dd className="mono">{app.buildStatus || 'pending'}</dd><dt>Deploy handoff</dt><dd>{renderAttempted ? 'Started' : renderPending ? 'Waiting for configuration' : 'Ready'}</dd><dt>URL verification</dt><dd>{app.urlReachable ? 'Reachable' : app.liveUrl ? 'Warming up' : 'Pending URL'}</dd></div>{app.liveUrl && !app.urlReachable && <button className="btn btn-sm btn-outline" style={{ marginTop: 14 }} onClick={onVerify} disabled={busy === 'verify'}><ICN.Refresh size={13} /> Retry URL verification</button>}{controls}</div>;
}

function HostingOverviewActions({ app, busy, copiedUrl, isRemoved, isSuspended, real, onCopyUrl, onRedeploy, onSuspend, onResume, onDelete }) {
  return (
      <div className="actions hosting-live-actions" aria-label="Hosting actions">
        {app.liveUrl && (
          <a className="btn btn-icon btn-outline hosting-action-icon" href={app.liveUrl} target="_blank" rel="noopener noreferrer" aria-label="View Live Site" data-tooltip="View Live Site">
            <ICN.ExternalLink size={15} />
          </a>
        )}
        {app.liveUrl && (
          <button className="btn btn-icon btn-outline hosting-action-icon" onClick={onCopyUrl} aria-label={copiedUrl ? 'Copied URL' : 'Copy URL'} data-tooltip={copiedUrl ? 'Copied' : 'Copy URL'}>
            {copiedUrl ? <ICN.Check size={15} /> : <ICN.Copy size={15} />}
          </button>
        )}
        <button className="btn btn-icon btn-outline hosting-action-icon" disabled={!!busy || isRemoved} onClick={onRedeploy} aria-label="Redeploy" data-tooltip={busy === 'redeploy' ? 'Redeploying' : 'Redeploy'}>
          <ICN.Refresh size={15} />
        </button>
        {!isSuspended && (
          <button className="btn btn-icon btn-outline hosting-action-icon" disabled={!real || !!busy || isRemoved} onClick={onSuspend} aria-label="Suspend Site" data-tooltip={busy === 'suspend' ? 'Suspending' : 'Suspend Site'}>
            <ICN.Power size={15} />
          </button>
        )}
        {isSuspended && (
          <button className="btn btn-icon btn-outline hosting-action-icon" disabled={!real || !!busy || isRemoved} onClick={onResume} aria-label="Resume Site" data-tooltip={busy === 'resume' ? 'Resuming' : 'Resume Site'}>
            <ICN.Play size={15} />
          </button>
        )}
        <button className="btn btn-icon btn-outline hosting-action-icon hosting-action-icon--danger" disabled={!!busy} onClick={onDelete} aria-label="Delete Site" data-tooltip={busy === 'delete' ? 'Deleting' : 'Delete Site'}>
          <ICN.Trash size={15} />
        </button>
      </div>
  );
}

function PendingRedeployBanner({ notice, onOpen, onRedeployNow, busy }) {
  return (
    <div className="hosting-redeploy-banner">
      <div>
        <strong>Redeploy pending</strong>
        <span>Saved changes will apply on redeploy. Auto redeploy is scheduled for {formatScheduleTime(notice.scheduledFor)}.</span>
      </div>
      <div className="hosting-redeploy-actions">
        <button className="btn btn-sm btn-outline" onClick={onOpen}>View changes</button>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={onRedeployNow}>{busy ? 'Redeploying...' : 'Redeploy now'}</button>
      </div>
    </div>
  );
}

function PendingRedeployPopup({ notice, onClose, onRedeployNow, busy }) {
  const changes = Array.isArray(notice.changes) && notice.changes.length ? notice.changes : ['Saved hosting settings'];
  return (
    <div className="hosting-redeploy-modal-backdrop" role="presentation">
      <div className="hosting-redeploy-modal" role="dialog" aria-modal="true" aria-labelledby="hosting-redeploy-title">
        <div className="hosting-redeploy-icon"><ICN.Refresh size={20} /></div>
        <div>
          <div className="page-eyebrow" style={{ marginBottom: 6 }}>Redeploy scheduled</div>
          <h2 id="hosting-redeploy-title">Your changes were saved</h2>
          <p>
            These settings are stored now. To make them active on the live site, Glondia will run one scheduled redeploy in the next 20 minutes unless you redeploy manually.
          </p>
          <div className="hosting-redeploy-summary">
            <span>Scheduled for</span>
            <strong>{formatScheduleTime(notice.scheduledFor)}</strong>
          </div>
          <div className="hosting-redeploy-changes">
            {changes.map((change) => <span key={change}>{change}</span>)}
          </div>
          <div className="hosting-redeploy-modal-actions">
            <button className="btn btn-outline" disabled={busy} onClick={onClose}>Keep scheduled</button>
            <button className="btn btn-outline" disabled={busy} onClick={onRedeployNow}>{busy ? 'Redeploying...' : 'Redeploy now'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatScheduleTime(value) {
  if (!value) return 'soon';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SourcePackageBlock({ app }) { const g = app.generatedSite || {}; const root = getRenderSourceRoot(app); const repo = app.environmentConfiguration?.sourceRepository || g.sourceRepository || ''; return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent-soft)' }}><div className="row" style={{ gap: 8, color: 'var(--accent)', fontWeight: 700 }}><ICN.CheckCircle size={16} /> {isZipUpload(app) ? 'ZIP source package prepared' : 'Generated Vite React site prepared'}</div><div className="kv" style={{ marginTop: 10, gridTemplateColumns: '155px 1fr', fontSize: 12.5 }}>{g.uploadedFileName && <><dt>Uploaded file</dt><dd className="mono">{g.uploadedFileName}</dd></>}<dt>Deployable files</dt><dd>{Array.isArray(g.files) ? g.files.length : 0}</dd>{Array.isArray(g.ignoredFiles) && <><dt>Ignored files</dt><dd>{g.ignoredFiles.length}</dd></>}<dt>Framework</dt><dd className="mono">{g.framework || g.projectType || 'vite-react'}</dd>{repo && <><dt>Source repository</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{repo}</dd></>}{root && <><dt>Source root directory</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{root}</dd></>}{g.siteDir && <><dt>Internal storage path</dt><dd className="mono" style={{ wordBreak: 'break-all', opacity: 0.7 }}>{g.siteDir}</dd></>}</div></div>; }
function RenderStartedBlock({ app }) { return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)' }}><div className="row" style={{ gap: 8, color: 'var(--accent)', fontWeight: 700 }}><ICN.CheckCircle size={16} /> Deployment started</div><div className="kv" style={{ marginTop: 10, gridTemplateColumns: '130px 1fr', fontSize: 12.5 }}><dt>Service ID</dt><dd className="mono">{hasRealRenderId(app.renderServiceId) ? app.renderServiceId : 'Pending'}</dd><dt>Deploy ID</dt><dd className="mono">{hasRealRenderId(app.renderDeployId) ? app.renderDeployId : 'Pending'}</dd><dt>Current step</dt><dd>{app.currentStep || statusLabel(app.status)}</dd>{app.liveUrl && <><dt>Live URL</dt><dd className="mono" style={{ wordBreak: 'break-all' }}><a href={app.liveUrl} target="_blank" rel="noopener noreferrer">{app.liveUrl}</a></dd></>}</div></div>; }
function RenderNotStartedBlock({ app }) { const reason = app.render?.skippedReason || app.errorMessage || 'Hosting has not received a deployable source repository/API configuration yet.'; return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--warning)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)' }}><div className="row" style={{ gap: 8, color: 'var(--warning)', fontWeight: 700 }}><ICN.AlertCircle size={16} /> Deploy handoff pending</div><div className="muted" style={{ marginTop: 8 }}>{reason}</div><div className="mono" style={{ marginTop: 8, fontSize: 12 }}>Contact Glondia support if your deployment is stuck in this state.</div></div>; }
function DeploymentPulse({ compact = false }) { return <div style={{ marginTop: compact ? 0 : 18, display: 'grid', gap: 8 }}><div style={{ height: compact ? 6 : 8, borderRadius: 999, background: 'var(--bg-deep)', overflow: 'hidden' }}><div style={{ height: '100%', width: '42%', background: 'var(--accent)', borderRadius: 999, animation: 'pulse 1.2s ease-in-out infinite' }} /></div>{!compact && <div className="muted" style={{ fontSize: 13 }}>Preparing, sending to hosting, building, deploying, then verifying the live URL.</div>}</div>; }
function SuccessBlock({ app }) { return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)' }}><div className="row" style={{ gap: 8, color: 'var(--accent)', fontWeight: 700 }}><ICN.CheckCircle size={16} /> Deployment is live</div><div className="mono" style={{ marginTop: 8, wordBreak: 'break-all' }}>{app.liveUrl}</div></div>; }
function WarmingBlock({ app }) { return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--warning)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)' }}><div className="row" style={{ gap: 8, color: 'var(--warning)', fontWeight: 700 }}><ICN.Refresh size={16} /> Deployed, still warming up</div><div className="mono" style={{ marginTop: 8, wordBreak: 'break-all' }}>{app.liveUrl || 'URL pending'}</div></div>; }
function FailureBlock({ app }) { return <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--danger)', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)' }}><div className="row" style={{ gap: 8, color: 'var(--danger)', fontWeight: 700 }}><ICN.AlertCircle size={16} /> Deployment failed</div><div className="muted" style={{ marginTop: 8 }}>{app.errorMessage || 'Review logs and settings, then redeploy.'}</div></div>; }

function AdminPanel({ app, real }) {
  return <div className="hosting-service-controls">
    <h2 style={{ marginTop: 0 }}>Service controls</h2>
    <div className="kv" style={{ gridTemplateColumns: '140px 1fr', marginBottom: 16 }}>
      <dt>Deployment ID</dt><dd className="mono">{app.deploymentId}</dd>
      <dt>Hosting service</dt><dd className="mono">{real ? app.renderServiceId : 'Pending configuration'}</dd>
      <dt>Deploy</dt><dd className="mono">{hasRealRenderId(app.renderDeployId) ? app.renderDeployId : 'Pending'}</dd>
      <dt>Last synced</dt><dd>{formatDate(app.lastRenderSyncedAt)}</dd>
      <dt>Created</dt><dd>{formatDate(app.createdAt)}</dd>
    </div>
  </div>;
}

function OverviewTab({ app, deploymentId }) {
  const g = app.generatedSite || {}; const s = app.environmentConfiguration || {}; const root = getRenderSourceRoot(app);
  return <div className="grid-side"><div style={{ display: 'grid', gap: 16 }}><div className="card"><h2 style={{ marginTop: 0 }}>Hosting app</h2><div className="kv"><dt>Source</dt><dd className="mono">{sourceLabel(app)}</dd><dt>Branch</dt><dd className="mono">{app.githubBranch || s.branch || 'main'}</dd><dt>Service type</dt><dd><Badge tone="info" dot={false}>{app.serviceType}</Badge></dd><dt>Live URL</dt><dd className="mono">{app.liveUrl || 'Pending'}</dd>{s.sourceRepository && <><dt>Source repository</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{s.sourceRepository}</dd></>}{root && <><dt>Source root</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{root}</dd></>}<dt>Build command</dt><dd className="mono">{s.buildCommand || g.buildCommand || 'Not set'}</dd><dt>Publish directory</dt><dd className="mono">{s.outputDirectory || g.publishDirectory || 'dist'}</dd></div></div>{(isZipUpload(app) || isTemplateGenerated(app) || isRoxanneGenerated(app)) && <SourcePackageBlock app={app} />}</div><LiveLogsPanel deploymentId={deploymentId} compact /></div>;
}

// ── Deploy History Tab ────────────────────────────────────────────────────────

function deployStatusTone(s) {
  if (!s) return 'muted';
  const lower = s.toLowerCase();
  if (['live', 'succeeded', 'deployed'].includes(lower)) return 'success';
  if (['failed', 'build_failed', 'canceled'].includes(lower)) return 'danger';
  if (['build_in_progress', 'update_in_progress', 'queued', 'created'].includes(lower)) return 'info';
  return 'muted';
}

function DeployHistoryTab({ app, deploymentId, busy, onRollback }) {
  const [deploys, setDeploys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    listHostingDeployHistory(deploymentId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.deploys || data?.data || []);
        setDeploys(list.map((item) => item?.deploy || item));
      })
      .catch((e) => setErr(e.message || 'Could not load deploy history.'))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="Refresh" title="Loading deploy history..." /></div>;

  return <div className="card">
    <h2 style={{ marginTop: 0 }}>Deploy history</h2>
    {err && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}
    {deploys.length === 0 && <Empty icon="Layers" title="No deploys found" body="Deploy history will appear here after your first deployment." />}
    {deploys.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Commit</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Triggered</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Finished</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Trigger</th>
              <th style={{ padding: '6px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {deploys.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <span className="mono" style={{ fontSize: 12 }}>{d.commit?.id?.slice(0, 8) || d.commitId?.slice(0, 8) || '—'}</span>
                  {d.commit?.message && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.commit.message}</div>}
                </td>
                <td style={{ padding: '8px 10px' }}><Badge tone={deployStatusTone(d.status)} dot={false}>{d.status || '—'}</Badge></td>
                <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>{d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>{d.finishedAt ? new Date(d.finishedAt).toLocaleString() : '—'}</td>
                <td style={{ padding: '8px 10px' }}><span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.trigger?.type || d.triggerType || 'manual'}</span></td>
                <td style={{ padding: '8px 10px' }}>
                  {d.id && (
                    <button
                      className="btn btn-sm btn-outline"
                      disabled={!!busy}
                      onClick={() => onRollback(d.id)}
                    >
                      {busy === 'rollback' ? 'Rolling back...' : 'Rollback'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>;
}

// ── Metrics Tab ──────────────────────────────────────────────────────────────

const METRIC_TYPES = [
  { type: 'cpu', label: 'CPU', unit: '%' },
  { type: 'memory', label: 'Memory', unit: 'MB' },
  { type: 'http-requests', label: 'HTTP Requests', unit: 'req/s' },
  { type: 'bandwidth', label: 'Bandwidth', unit: 'GB' },
];

function MetricCard({ deploymentId, metricType, label, unit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    getHostingMetrics(deploymentId, metricType)
      .then(setData)
      .catch((e) => setErr(e.message || 'Could not load metric.'))
      .finally(() => setLoading(false));
  }, [deploymentId, metricType]);

  const points = data?.data || data?.values || (Array.isArray(data) ? data : []);
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const latestValue = latest?.value != null ? Number(latest.value).toFixed(2) : null;

  const maxVal = points.length > 0 ? Math.max(...points.map((p) => Number(p.value || 0))) : 1;
  const sparkPoints = points.slice(-20);

  return <div className="card" style={{ padding: 16 }}>
    <div className="page-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
    {loading && <div className="muted" style={{ fontSize: 13 }}>Loading...</div>}
    {!loading && err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
    {!loading && !err && latestValue === null && (
      <div className="muted" style={{ fontSize: 13 }}>Metrics not available on this plan</div>
    )}
    {!loading && !err && latestValue !== null && <>
      <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>{latestValue}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{unit}</span></div>
      {sparkPoints.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, marginTop: 8 }}>
          {sparkPoints.map((p, i) => {
            const h = maxVal > 0 ? Math.max(2, (Number(p.value || 0) / maxVal) * 32) : 2;
            return <div key={i} style={{ flex: 1, height: h, background: 'var(--accent)', borderRadius: 2, opacity: 0.7 }} />;
          })}
        </div>
      )}
      {latest?.timestamp && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6 }}>Last: {new Date(latest.timestamp).toLocaleTimeString()}</div>}
    </>}
  </div>;
}

function MetricsTab({ deploymentId }) {
  return <div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
      {METRIC_TYPES.map((m) => (
        <MetricCard key={m.type} deploymentId={deploymentId} metricType={m.type} label={m.label} unit={m.unit} />
      ))}
    </div>
    <div className="card" style={{ padding: '10px 14px' }}>
      <span className="muted" style={{ fontSize: 12 }}>Metrics show the last 1 hour. Free tier services may not have metrics available.</span>
    </div>
  </div>;
}

// ── Events Tab ───────────────────────────────────────────────────────────────

function EventsTab({ deploymentId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    listHostingEvents(deploymentId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.events || data?.data || []);
        setEvents(list.map((item) => item?.event || item));
      })
      .catch((e) => setErr(e.message || 'Could not load events.'))
      .finally(() => setLoading(false));
  }, [deploymentId]);

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="Activity" title="Loading events..." /></div>;

  return <div className="card">
    <h2 style={{ marginTop: 0 }}>Service events</h2>
    {err && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}
    {events.length === 0 && <Empty icon="Activity" title="No events found" body="Service events will appear here as your app runs." />}
    <div style={{ display: 'grid', gap: 8 }}>
      {events.map((ev, i) => (
        <div key={ev.id || i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 13 }}>
          <span className="mono" style={{ color: 'var(--text-muted)', flexShrink: 0, fontSize: 11 }}>{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}</span>
          <span>{ev.type || ev.details || JSON.stringify(ev)}</span>
        </div>
      ))}
    </div>
  </div>;
}

// ── Secret Files Tab ─────────────────────────────────────────────────────────

function SecretFilesTab({ deploymentId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [revealed, setRevealed] = useState({});

  const load = () => {
    setLoading(true);
    listHostingSecretFiles(deploymentId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.secretFiles || data?.data || []);
        setFiles(list.map((f) => ({ name: f.name || '', value: f.content || f.value || '', id: f.id || f.name })));
      })
      .catch((e) => setErr(e.message || 'Could not load secret files.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [deploymentId]);

  const addRow = () => setFiles((prev) => [...prev, { name: '', value: '', id: `new_${Date.now()}` }]);
  const removeRow = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, [field]: val } : f));
  const toggleReveal = (idx) => setRevealed((prev) => ({ ...prev, [idx]: !prev[idx] }));

  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await upsertHostingSecretFiles(deploymentId, files.map((f) => ({ name: f.name, content: f.value })));
      setMsg('Secret files saved.');
      load();
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="ShieldCheck" title="Loading secret files..." /></div>;

  return <div className="card">
    <div className="row between" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>Secret files</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-outline" onClick={addRow}><ICN.Plus size={14} /> Add file</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
    {err && <div style={{ color: 'var(--danger)', marginBottom: 10, fontSize: 13 }}>{err}</div>}
    {msg && <div style={{ color: 'var(--accent)', marginBottom: 10, fontSize: 13 }}>{msg}</div>}
    <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Secret files are written to disk at runtime. Values are masked below — click Reveal to view.</p>
    {files.length === 0 && <Empty icon="ShieldCheck" title="No secret files" body="Add files that will be available on disk at runtime." />}
    {files.map((f, idx) => (
      <div key={f.id || idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input className="input mono" placeholder="/etc/secrets/config.json" value={f.name} onChange={(e) => updateRow(idx, 'name', e.target.value)} />
        <input className="input mono" type={revealed[idx] ? 'text' : 'password'} placeholder="file contents" value={f.value} onChange={(e) => updateRow(idx, 'value', e.target.value)} />
        <button className="btn btn-sm btn-outline" onClick={() => toggleReveal(idx)}>{revealed[idx] ? 'Hide' : 'Reveal'}</button>
        <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(idx)}><ICN.X size={13} /></button>
      </div>
    ))}
  </div>;
}

// ── Headers Tab ──────────────────────────────────────────────────────────────

function HeadersTab({ deploymentId }) {
  const [headers, setHeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    listHostingHeaders(deploymentId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.headers || data?.data || []);
        setHeaders(list.map((h, i) => ({ path: h.path || '', name: h.name || '', value: h.value || '', id: h.id || i })));
      })
      .catch((e) => setErr(e.message || 'Could not load headers.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [deploymentId]);

  const addRow = () => setHeaders((prev) => [...prev, { path: '/*', name: '', value: '', id: `new_${Date.now()}` }]);
  const removeRow = (idx) => setHeaders((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setHeaders((prev) => prev.map((h, i) => i === idx ? { ...h, [field]: val } : h));

  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await updateHostingHeaders(deploymentId, headers.map((h) => ({ path: h.path, name: h.name, value: h.value })));
      setMsg('Headers saved.');
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="Edit" title="Loading headers..." /></div>;

  return <div className="card">
    <div className="row between" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>Custom response headers</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-outline" onClick={addRow}><ICN.Plus size={14} /> Add header</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
    {err && <div style={{ color: 'var(--danger)', marginBottom: 10, fontSize: 13 }}>{err}</div>}
    {msg && <div style={{ color: 'var(--accent)', marginBottom: 10, fontSize: 13 }}>{msg}</div>}
    {headers.length === 0 && <Empty icon="Edit" title="No custom headers" body="Add response headers applied to matching paths." />}
    {headers.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Path</span>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Header name</span>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Value</span>
        <span />
      </div>
    )}
    {headers.map((h, idx) => (
      <div key={h.id || idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <input className="input mono" placeholder="/*" value={h.path} onChange={(e) => updateRow(idx, 'path', e.target.value)} />
        <input className="input mono" placeholder="X-Frame-Options" value={h.name} onChange={(e) => updateRow(idx, 'name', e.target.value)} />
        <input className="input mono" placeholder="DENY" value={h.value} onChange={(e) => updateRow(idx, 'value', e.target.value)} />
        <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(idx)}><ICN.X size={13} /></button>
      </div>
    ))}
  </div>;
}

// ── Rules (Redirect/Rewrite) Tab ─────────────────────────────────────────────

function RulesTab({ deploymentId }) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    setLoading(true);
    listHostingRoutes(deploymentId)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.routes || data?.data || []);
        setRoutes(list.map((r, i) => ({ type: r.type || 'redirect', source: r.source || '', destination: r.destination || '', id: r.id || i })));
      })
      .catch((e) => setErr(e.message || 'Could not load rules.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [deploymentId]);

  const addRow = () => setRoutes((prev) => [...prev, { type: 'redirect', source: '', destination: '', id: `new_${Date.now()}` }]);
  const removeRow = (idx) => setRoutes((prev) => prev.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setRoutes((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      await updateHostingRoutes(deploymentId, routes.map((r) => ({ type: r.type, source: r.source, destination: r.destination })));
      setMsg('Rules saved.');
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card" style={{ padding: 36 }}><Empty icon="ArrowRight" title="Loading rules..." /></div>;

  return <div className="card">
    <div className="row between" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>Redirect &amp; rewrite rules</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-outline" onClick={addRow}><ICN.Plus size={14} /> Add rule</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
    {err && <div style={{ color: 'var(--danger)', marginBottom: 10, fontSize: 13 }}>{err}</div>}
    {msg && <div style={{ color: 'var(--accent)', marginBottom: 10, fontSize: 13 }}>{msg}</div>}
    {routes.length === 0 && <Empty icon="ArrowRight" title="No rules configured" body="Add redirect or rewrite rules for your static site." />}
    {routes.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Type</span>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Source</span>
        <span className="muted" style={{ fontSize: 11, padding: '0 4px' }}>Destination</span>
        <span />
      </div>
    )}
    {routes.map((r, idx) => (
      <div key={r.id || idx} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <select className="input" value={r.type} onChange={(e) => updateRow(idx, 'type', e.target.value)}>
          <option value="redirect">Redirect</option>
          <option value="rewrite">Rewrite</option>
        </select>
        <input className="input mono" placeholder="/old-path" value={r.source} onChange={(e) => updateRow(idx, 'source', e.target.value)} />
        <input className="input mono" placeholder="/new-path" value={r.destination} onChange={(e) => updateRow(idx, 'destination', e.target.value)} />
        <button className="btn btn-sm btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeRow(idx)}><ICN.X size={13} /></button>
      </div>
    ))}
  </div>;
}

// ── Deploy Presets ────────────────────────────────────────────────────────────

const SETTINGS_PRESETS = [
  { id: 'static-html', label: 'Static HTML', serviceType: 'static_site', buildCommand: 'bash glondia-render-build.sh', outputDirectory: '.' },
  { id: 'vite-react', label: 'Vite React', serviceType: 'static_site', buildCommand: 'bash glondia-render-build.sh', outputDirectory: 'dist' },
  { id: 'create-react-app', label: 'CRA', serviceType: 'static_site', buildCommand: 'bash glondia-render-build.sh', outputDirectory: 'build' },
  { id: 'nextjs', label: 'Next.js', serviceType: 'web_service', runtime: 'node', buildCommand: 'npm install && npm run build', startCommand: 'npm start' },
  { id: 'express-api', label: 'Express', serviceType: 'web_service', runtime: 'node', buildCommand: 'npm install', startCommand: 'npm start' },
  { id: 'node-web-app', label: 'Node App', serviceType: 'web_service', runtime: 'node', buildCommand: 'npm install && npm run build', startCommand: 'npm start' },
];

// ── Deploy Doctor ─────────────────────────────────────────────────────────────

function getSettingsDoctorChecks(form = {}) {
  const checks = [];
  const serviceType = form.serviceType || 'static_site';
  checks.push({ status: form.sourceRepository ? 'ok' : 'warn', label: form.sourceRepository ? 'Source repository set' : 'Source repository not configured', fix: null });
  checks.push({ status: form.branch ? 'ok' : 'error', label: form.branch ? `Branch: ${form.branch}` : 'Branch is required', fix: null });
  if ((form.rootDirectory || '').includes('/opt/render/project')) {
    checks.push({ status: 'error', label: 'Root directory cannot be a local server path', fix: { label: 'Clear root', patch: { rootDirectory: '' } } });
  } else {
    checks.push({ status: form.rootDirectory ? 'ok' : 'warn', label: form.rootDirectory ? `Root: ${form.rootDirectory}` : 'Root directory not set; repo root used', fix: null });
  }
  if (serviceType === 'static_site') {
    checks.push({ status: form.buildCommand ? 'ok' : 'error', label: form.buildCommand ? 'Build command set' : 'Build command required', fix: !form.buildCommand ? { label: 'Use npm run build', patch: { buildCommand: 'npm run build' } } : null });
    checks.push({ status: form.outputDirectory ? 'ok' : 'error', label: form.outputDirectory ? `Publish: ${form.outputDirectory}` : 'Publish directory required', fix: !form.outputDirectory ? { label: 'Use dist', patch: { outputDirectory: 'dist' } } : null });
  }
  if (serviceType === 'web_service') {
    checks.push({ status: form.buildCommand ? 'ok' : 'error', label: form.buildCommand ? 'Build command set' : 'Build command required', fix: !form.buildCommand ? { label: 'Use npm install', patch: { buildCommand: 'npm install' } } : null });
    checks.push({ status: form.startCommand ? 'ok' : 'error', label: form.startCommand ? 'Start command set' : 'Start command required', fix: !form.startCommand ? { label: 'Use npm start', patch: { startCommand: 'npm start' } } : null });
    checks.push({ status: 'info', label: 'Must listen on process.env.PORT / 0.0.0.0', fix: null });
  }
  return checks;
}

function getReadinessScore(checks = []) {
  if (!checks.length) return 0;
  const max = checks.length * 2;
  const score = checks.reduce((t, c) => t + (c.status === 'ok' ? 2 : c.status === 'warn' || c.status === 'info' ? 1 : 0), 0);
  return Math.round((score / max) * 100);
}

function RenderSettingsTab({ app, deploymentId, onReload, isStatic: isStaticProp, onPurgeCache, busy: outerBusy }) {
  const s = app.environmentConfiguration || {};
  const [form, setForm] = useState({
    serviceName: app.serviceName || '',
    serviceType: app.serviceType || 'static_site',
    branch: app.githubBranch || s.branch || 'main',
    rootDirectory: s.rootDirectory || '',
    buildCommand: s.buildCommand || '',
    startCommand: s.startCommand || '',
    outputDirectory: s.outputDirectory || 'dist',
    runtime: s.runtime || 'node',
    healthCheckPath: s.healthCheckPath || '/',
    plan: app.plan || s.plan || 'starter',
    region: s.region || 'oregon',
    sourceRepository: s.sourceRepository || app.repoUrl || '',
  });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [presetNotice, setPresetNotice] = useState('');
  const [showDoctor, setShowDoctor] = useState(true);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isStatic = form.serviceType === 'static_site';
  const realService = hasRealRenderId(app.renderServiceId);

  const doctorChecks = useMemo(() => getSettingsDoctorChecks(form), [form]);
  const score = useMemo(() => getReadinessScore(doctorChecks), [doctorChecks]);
  const errors = doctorChecks.filter((c) => c.status === 'error').length;
  const warnings = doctorChecks.filter((c) => c.status === 'warn').length;

  const applyPreset = (p) => {
    setForm((f) => ({
      ...f,
      serviceType: p.serviceType || f.serviceType,
      buildCommand: p.buildCommand || f.buildCommand,
      ...(p.outputDirectory !== undefined ? { outputDirectory: p.outputDirectory } : {}),
      ...(p.startCommand !== undefined ? { startCommand: p.startCommand } : {}),
      ...(p.runtime !== undefined ? { runtime: p.runtime } : {}),
    }));
    setPresetNotice(`${p.label} preset applied`);
    setTimeout(() => setPresetNotice(''), 3000);
  };

  const applyFix = (patch = {}) => setForm((f) => ({ ...f, ...patch }));

  const runAction = async (name, fn) => {
    setBusy(name); setMsg('');
    try { await fn(); setMsg(name === 'sync' ? 'Synced.' : name === 'save' ? 'Settings saved.' : name === 'redeploy' ? 'Settings saved & redeploy triggered.' : name === 'clearRedeploy' ? 'Cache cleared & redeploy triggered.' : name === 'retry' ? 'Redeploy triggered.' : name === 'purgeCache' ? 'Cache purged.' : 'Done.'); onReload?.(); }
    catch (e) { setMsg(e.message || 'Action failed.'); }
    finally { setBusy(''); }
  };

  const handleSave = () => runAction('save', () => updateHostingSettings(deploymentId, form));
  const handleSaveRedeploy = () => runAction('redeploy', () => redeployHostingWithSettings(deploymentId, { ...form, clearCache: false }));
  const handleClearRedeploy = () => runAction('clearRedeploy', () => redeployHostingWithSettings(deploymentId, { ...form, clearCache: true }));
  const handleSync = () => runAction('sync', () => syncHostingDeployment(deploymentId));
  const handleRetry = () => runAction('retry', () => redeployRenderDeployment(deploymentId));
  const handlePurgeCache = () => runAction('purgeCache', onPurgeCache);

  const allBusy = busy || outerBusy;

  return <div className="grid-side"><div style={{ display: 'grid', gap: 16 }}>
    {/* Settings form */}
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Hosting service settings</h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {SETTINGS_PRESETS.map((p) => (
          <button key={p.id} className="btn btn-sm btn-outline" onClick={() => applyPreset(p)} style={{ fontSize: 11, padding: '3px 8px' }}>{p.label}</button>
        ))}
      </div>
      {presetNotice && <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{presetNotice}</div>}
      <div className="render-config-grid">
        <label><span>Service name</span><input className="input mono" value={form.serviceName} onChange={(e) => set('serviceName', e.target.value)} /></label>
        <label><span>Service type</span><select className="input" value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)}><option value="static_site">Static Site</option><option value="web_service">Web Service</option></select></label>
        <label><span>Branch</span><input className="input mono" value={form.branch} onChange={(e) => set('branch', e.target.value)} /></label>
        <label><span>Root directory</span><input className="input mono" value={form.rootDirectory} onChange={(e) => set('rootDirectory', e.target.value)} placeholder="./" />{form.rootDirectory.includes('/opt/render/project') && <span style={{ color: 'var(--danger)', fontSize: 11 }}>Must be a repo path, not a local server path.</span>}</label>
        <label><span>Source repository</span><input className="input mono" value={form.sourceRepository} onChange={(e) => set('sourceRepository', e.target.value)} /></label>
      </div>
      <h3 style={{ marginTop: 16 }}>{isStatic ? 'Static Site Build Settings' : 'Web Service Build & Runtime'}</h3>
      <div className="render-config-grid">
        {!isStatic && <label><span>Runtime</span><select className="input" value={form.runtime} onChange={(e) => set('runtime', e.target.value)}><option value="node">Node</option><option value="python">Python</option><option value="go">Go</option><option value="rust">Rust</option><option value="ruby">Ruby</option><option value="elixir">Elixir</option></select></label>}
        <label><span>Build command</span><input className="input mono" value={form.buildCommand} onChange={(e) => set('buildCommand', e.target.value)} placeholder={isStatic ? 'npm run build' : 'npm install && npm run build'} /></label>
        {isStatic
          ? <label><span>Publish directory</span><input className="input mono" value={form.outputDirectory} onChange={(e) => set('outputDirectory', e.target.value)} placeholder="dist" /></label>
          : <>
              <label><span>Start command</span><input className="input mono" value={form.startCommand} onChange={(e) => set('startCommand', e.target.value)} placeholder="npm start" /></label>
              <label><span>Health check path</span><input className="input mono" value={form.healthCheckPath} onChange={(e) => set('healthCheckPath', e.target.value)} placeholder="/" /></label>
            </>
        }
        <label><span>Plan</span><input className="input mono" value={form.plan} onChange={(e) => set('plan', e.target.value)} /></label>
        <label><span>Region</span><select className="input" value={form.region} onChange={(e) => set('region', e.target.value)}><option value="oregon">Oregon (US West)</option><option value="ohio">Ohio (US East)</option><option value="frankfurt">Frankfurt (EU)</option><option value="singapore">Singapore (Asia)</option></select></label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button className="btn btn-primary" disabled={!!allBusy || !realService} onClick={handleSave}><ICN.CheckCircle size={14} /> {busy === 'save' ? 'Saving...' : 'Save Settings'}</button>
        <button className="btn btn-primary" disabled={!!allBusy || !realService} onClick={handleSaveRedeploy}><ICN.Rocket size={14} /> {busy === 'redeploy' ? 'Deploying...' : 'Save & Redeploy'}</button>
        <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handleClearRedeploy}><ICN.Trash size={14} /> {busy === 'clearRedeploy' ? 'Deploying...' : 'Clear Cache & Redeploy'}</button>
        <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handleSync}><ICN.Refresh size={14} /> {busy === 'sync' ? 'Syncing...' : 'Sync'}</button>
      </div>
      {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
    </div>

    {/* Deployment Preview */}
    <div className="card" style={{ padding: 14, background: 'var(--bg-deep)' }}>
      <div className="eyebrow">Deployment preview</div>
      <h3 style={{ margin: '4px 0 10px' }}>Your site will use these settings</h3>
      <div className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
        <dt>Service name</dt><dd className="mono">{form.serviceName || app.serviceName || 'auto'}</dd>
        <dt>Type</dt><dd>{form.serviceType}</dd>
        <dt>Repo</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{form.sourceRepository || '(not set)'}</dd>
        <dt>Branch</dt><dd className="mono">{form.branch || 'main'}</dd>
        <dt>Root</dt><dd className="mono">{form.rootDirectory || 'repo root'}</dd>
        <dt>Build</dt><dd className="mono">{form.buildCommand || 'Not set'}</dd>
        {isStatic
          ? <><dt>Publish</dt><dd className="mono">{form.outputDirectory || 'Not set'}</dd></>
          : <><dt>Start</dt><dd className="mono">{form.startCommand || 'Not set'}</dd></>}
        <dt>Plan</dt><dd className="mono">{form.plan || 'starter'}</dd>
        <dt>Region</dt><dd className="mono">{form.region || 'oregon'}</dd>
      </div>
    </div>
  </div><div style={{ display: 'grid', gap: 16 }}>

    {/* Current hosting record */}
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Current hosting record</h2>
      <div className="kv">
        <dt>Service ID</dt><dd className="mono">{realService ? app.renderServiceId : 'Pending'}</dd>
        <dt>Deploy ID</dt><dd className="mono">{hasRealRenderId(app.renderDeployId) ? app.renderDeployId : 'Pending'}</dd>
        <dt>Source repository</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{s.sourceRepository || app.repoUrl || 'Not configured'}</dd>
        <dt>Source root</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{getRenderSourceRoot(app) || 'Not set'}</dd>
        <dt>Last synced</dt><dd>{formatDate(app.lastRenderSyncedAt)}</dd>
        <dt>Provider status</dt><dd className="mono">{app.providerStatus || app.renderDeployStatus || '—'}</dd>
      </div>
    </div>

    {/* Deploy Doctor */}
    <div className="card" style={{ padding: 14, background: 'var(--bg-deep)' }}>
      <div className="row between">
        <div><div className="eyebrow">Deploy Doctor</div><h3 style={{ margin: '4px 0 0' }}>Settings validation</h3></div>
        <div className="row" style={{ gap: 8 }}>
          <Badge tone={errors ? 'danger' : warnings ? 'warn' : 'success'} dot={false}>{errors ? `${errors} issue${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'Ready'}</Badge>
          <Badge tone={score >= 100 ? 'success' : score >= 70 ? 'warn' : 'danger'} dot={false}>{score}%</Badge>
        </div>
      </div>
      {showDoctor && <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        {doctorChecks.map((check, i) => (
          <div key={i} className="row between" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: check.status === 'ok' ? 'var(--accent)' : check.status === 'error' ? 'var(--danger)' : check.status === 'warn' ? 'var(--warning)' : 'var(--text-muted)' }}>
                {check.status === 'ok' ? '✓' : check.status === 'error' ? '✗' : check.status === 'warn' ? '⚠' : '•'}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>{check.label}</span>
            </div>
            {check.fix && <button className="btn btn-sm btn-outline" onClick={() => applyFix(check.fix.patch)}>{check.fix.label}</button>}
          </div>
        ))}
      </div>}
    </div>

    {/* Repair Tools */}
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Repair tools</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handleSync}><ICN.Refresh size={14} /> Sync</button>
        <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handleRetry}><ICN.Refresh size={14} /> {busy === 'retry' ? 'Deploying...' : 'Retry deploy'}</button>
        <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handleClearRedeploy}><ICN.Trash size={14} /> Clear cache & redeploy</button>
        {isStatic && <button className="btn btn-outline" disabled={!!allBusy || !realService} onClick={handlePurgeCache}><ICN.Trash size={14} /> {busy === 'purgeCache' ? 'Purging...' : 'Purge CDN cache'}</button>}
        <button className="btn btn-outline" onClick={() => { setShowDoctor(true); setMsg('Validation refreshed — see Deploy Doctor.'); }}><ICN.AlertCircle size={14} /> Validate settings</button>
      </div>
    </div>
  </div></div>;
}

function EnvVarsTab({ deploymentId }) {
  const [items, setItems] = useState([]); const [form, setForm] = useState({ key: '', value: '' }); const [msg, setMsg] = useState('');
  const load = () => listHostingEnvVars(deploymentId).then(setItems).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, [deploymentId]);
  const add = async () => { await upsertHostingEnvVar(deploymentId, form); setForm({ key: '', value: '' }); load(); };
  return <div className="card"><h2 style={{ marginTop: 0 }}>Environment variables</h2><div className="input-group"><input className="input mono" placeholder="KEY" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} /><input className="input mono" placeholder="value" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} /><button className="btn btn-primary" onClick={add}>Add</button><button className="btn btn-outline" onClick={() => syncHostingEnvVars(deploymentId).then(load)}>Sync</button></div>{msg && <p className="muted">{msg}</p>}<div className="kv" style={{ marginTop: 14 }}>{items.map((v) => <React.Fragment key={v.key}><dt className="mono">{v.key}</dt><dd><span className="mono">{v.valuePreview || 'hidden'}</span></dd></React.Fragment>)}</div></div>;
}

function DisksTab({ app, deploymentId }) {
  const [items, setItems] = useState([]); const [form, setForm] = useState({ name: '', mountPath: '/data', sizeGB: 1 });
  const load = () => listHostingDisks(deploymentId).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, [deploymentId]);
  const add = async () => { await attachHostingDisk(deploymentId, form); load(); };
  return <div className="card"><h2 style={{ marginTop: 0 }}>Persistent disks</h2>{app.serviceType !== 'web_service' && <p className="muted">Disks are only available for web services.</p>}<div className="input-group"><input className="input" placeholder="disk name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /><input className="input mono" placeholder="/data" value={form.mountPath} onChange={(e) => setForm((f) => ({ ...f, mountPath: e.target.value }))} /><input className="input mono" type="number" value={form.sizeGB} onChange={(e) => setForm((f) => ({ ...f, sizeGB: e.target.value }))} /><button className="btn btn-primary" disabled={app.serviceType !== 'web_service'} onClick={add}>Attach</button></div><div className="kv" style={{ marginTop: 14 }}>{items.map((d) => <React.Fragment key={d.diskId}><dt>{d.name}</dt><dd className="mono">{d.mountPath} · {d.sizeGB}GB <button className="btn btn-sm btn-outline" onClick={() => updateHostingDisk(deploymentId, d.diskId, d).then(load)}>Sync</button></dd></React.Fragment>)}</div></div>;
}

function DisksTabV2({ app, deploymentId }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', mountPath: '/var/glondia/data', sizeGB: 1 });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => listHostingDisks(deploymentId).then(setItems).catch((e) => { setMsg(e.message || 'Could not load disks.'); setItems([]); });
  useEffect(() => { load(); }, [deploymentId]);
  const add = async () => {
    setBusy('add'); setMsg('');
    try {
      const disk = await attachHostingDisk(deploymentId, form);
      setItems((rows) => [disk, ...rows.filter((row) => row.diskId !== disk.diskId)]);
      setForm({ name: '', mountPath: '/var/glondia/data', sizeGB: 1 });
      setMsg('Disk attached.');
      load();
    } catch (e) { setMsg(e.message || 'Could not attach disk.'); }
    finally { setBusy(''); }
  };
  const sync = async (disk) => {
    setBusy(disk.diskId); setMsg('');
    try {
      const updated = await updateHostingDisk(deploymentId, disk.diskId, disk);
      setItems((rows) => rows.map((row) => row.diskId === disk.diskId ? updated : row));
      setMsg('Disk synced.');
    } catch (e) { setMsg(e.message || 'Could not sync disk.'); }
    finally { setBusy(''); }
  };
  const remove = async (disk) => {
    if (!window.confirm(`Delete disk ${disk.name}? This removes the disk from Glondia Hosting.`)) return;
    setBusy(disk.diskId); setMsg('');
    try {
      await deleteHostingDisk(deploymentId, disk.diskId);
      setItems((rows) => rows.filter((row) => row.diskId !== disk.diskId));
      setMsg('Disk deleted.');
      load();
    } catch (e) { setMsg(e.message || 'Could not delete disk.'); }
    finally { setBusy(''); }
  };
  return <div className="card"><h2 style={{ marginTop: 0 }}>Persistent SSD disks</h2><p className="muted" style={{ fontSize: 13 }}>Glondia SSD storage is mounted on your service. The platform SSD uses <span className="mono">/var/glondia</span>; app disks should use the mount path your service expects.</p>{app.serviceType !== 'web_service' && <p className="muted">Disks are only available for web services.</p>}<div className="input-group"><input className="input" placeholder="disk name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /><input className="input mono" placeholder="/var/glondia/data" value={form.mountPath} onChange={(e) => setForm((f) => ({ ...f, mountPath: e.target.value }))} /><input className="input mono" type="number" min="1" value={form.sizeGB} onChange={(e) => setForm((f) => ({ ...f, sizeGB: e.target.value }))} /><button className="btn btn-primary" disabled={app.serviceType !== 'web_service' || busy === 'add'} onClick={add}>{busy === 'add' ? 'Attaching...' : 'Attach'}</button></div>{msg && <p className="muted">{msg}</p>}<div className="kv" style={{ marginTop: 14 }}>{items.map((d) => <React.Fragment key={d.diskId}><dt>{d.name}</dt><dd className="mono">{d.mountPath} - {d.sizeGB}GB <StatusBadge value={d.status || 'attached'} /> <button className="btn btn-sm btn-outline" disabled={busy === d.diskId} onClick={() => sync(d)}>Sync</button> <button className="btn btn-sm btn-outline" disabled={busy === d.diskId} onClick={() => remove(d)}>Delete</button></dd></React.Fragment>)}</div></div>;
}

function DomainsTab({ deploymentId }) {
  const [items, setItems] = useState([]); const [domain, setDomain] = useState('');
  const load = () => listHostingDomains(deploymentId).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, [deploymentId]);
  const add = async () => { await addHostingDomain(deploymentId, { domain }); setDomain(''); load(); };
  return <div className="card"><h2 style={{ marginTop: 0 }}>Custom domains</h2><div className="input-group"><input className="input mono" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /><button className="btn btn-primary" onClick={add}>Add domain</button></div><div className="kv" style={{ marginTop: 14 }}>{items.map((d) => <React.Fragment key={d.domainId}><dt className="mono">{d.name}</dt><dd>{d.status || d.verificationStatus || 'pending'} <button className="btn btn-sm btn-outline" onClick={() => verifyHostingDomain(deploymentId, d.domainId).then(load)}>Verify</button></dd></React.Fragment>)}</div></div>;
}

function LiveLogsPanel({ deploymentId, compact = false }) {
  const [lines, setLines] = useState([]); const [streamStatus, setStreamStatus] = useState(null); const [connState, setConnState] = useState('connecting'); const bottomRef = useRef(null); const seenIds = useRef(new Set());
  useEffect(() => { setLines([]); seenIds.current = new Set(); setConnState('connecting'); const es = new EventSource(getDeploymentLogStreamUrl(deploymentId)); es.addEventListener('open', () => setConnState('live')); es.addEventListener('log', (e) => { try { const log = JSON.parse(e.data); const key = log.id || `${log.source}:${log.timestamp}:${log.message}`; if (seenIds.current.has(key)) return; seenIds.current.add(key); setLines((prev) => [...prev, log]); } catch {} }); es.addEventListener('status', (e) => { try { setStreamStatus(JSON.parse(e.data)); } catch {} }); es.addEventListener('done', () => { setConnState('ended'); es.close(); }); es.addEventListener('error', () => { setConnState('error'); es.close(); }); return () => es.close(); }, [deploymentId]);
  useEffect(() => { if (!compact) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines.length, compact]);
  return <div className="card"><div className="row between" style={{ marginBottom: 10 }}><h2 style={{ margin: 0, fontSize: compact ? 14 : 18 }}>{compact ? 'Live logs' : 'Build Logs'}</h2><Badge tone={connState === 'live' ? 'success' : connState === 'error' ? 'danger' : 'muted'} dot={connState === 'live'}>{connState}</Badge></div>{streamStatus && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}><Badge tone={streamStatus.status === 'live' ? 'success' : streamStatus.status === 'failed' ? 'danger' : 'muted'} dot={false}>{streamStatus.currentStep || streamStatus.status || 'Preparing'}</Badge></div>}<div className="term" style={{ maxHeight: compact ? 220 : 520, overflowY: 'auto' }}>{lines.length === 0 && <div><span className="dim">No log lines yet.</span></div>}{lines.map((log, i) => <div key={log.id || i} style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}><span className="ts" style={{ flexShrink: 0 }}>{formatTime(log.timestamp || log.createdAt)}</span><span className="dim" style={{ flexShrink: 0 }}>[build]</span><span className={log.level === 'error' ? 'err' : log.level === 'warn' ? 'warn' : log.source === 'render' ? '' : 'dim'}>{log.message || log.msg}</span></div>)}<div ref={bottomRef} /></div></div>;
}

function hoursRemaining(dueAt) {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  return Math.max(0, Math.round((ms / 3_600_000) * 10) / 10);
}

// Deploy-first tiered billing: shows status + grace deadline, and lets the owner
// pay by PayPal (card via PayPal) or upload a bank receipt for admin approval.
function BillingTab({ deploymentId, app = {}, onReload }) {
  const paymentStatus = app.paymentStatus || 'pending';
  const orderId = app.checkoutOrderId || null;
  const paid = paymentStatus === 'paid';
  const expired = paymentStatus === 'expired' || app.status === 'payment_expired';
  const remaining = hoursRemaining(app.billingDueAt);
  const priceLabel = `K${((app.priceCents ?? 20000) / 100).toFixed(0)}`;

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  const refresh = () => { onReload && onReload(); };

  const handlePaypal = async () => {
    if (!orderId) { setError('No billing order is attached to this deployment yet.'); return; }
    setBusy('paypal'); setError(''); setNotice('');
    try {
      const order = await createPaypalOrder(orderId);
      if (order?.alreadyPaid) { setNotice('This deployment is already paid.'); refresh(); return; }
      if (order?.approvalUrl) {
        // Open PayPal approval in a new tab; capture is completed on return.
        window.open(order.approvalUrl, '_blank', 'noopener,noreferrer');
        setNotice('Complete the PayPal approval in the new tab, then click "I have approved" to finish.');
        window.__glondiaPaypalOrderId = order.paypalOrderId;
      } else {
        setError('PayPal is not configured. Use a bank receipt instead.');
      }
    } catch (e) { setError(e.message || 'Could not start PayPal payment.'); }
    finally { setBusy(''); }
  };

  const handleCapture = async () => {
    const ppId = window.__glondiaPaypalOrderId;
    if (!ppId) { setError('Start a PayPal payment first.'); return; }
    setBusy('capture'); setError(''); setNotice('');
    try {
      await capturePaypalOrder(ppId);
      setNotice('Payment captured. This deployment is now paid.');
      refresh();
    } catch (e) { setError(e.message || 'Could not capture the PayPal payment.'); }
    finally { setBusy(''); }
  };

  const handleUpload = async () => {
    if (!orderId) { setError('No billing order is attached to this deployment yet.'); return; }
    if (!file) { setError('Choose a receipt file (PDF, PNG, JPG).'); return; }
    setBusy('upload'); setError(''); setNotice('');
    try {
      await uploadManualReceipt(file, { checkoutOrderId: orderId });
      setNotice('Receipt uploaded. An administrator will review and approve it.');
      setFile(null); if (fileRef.current) fileRef.current.value = '';
      refresh();
    } catch (e) { setError(e.message || 'Receipt upload failed.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Hosting fee — {priceLabel}</h2>
      <p className="muted" style={{ marginTop: 0 }}>Every deployment costs a fixed <b>{priceLabel}</b>. Your site is live now; pay within the grace window or it will be suspended automatically.</p>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ color: 'var(--accent)', marginBottom: 12 }}>{notice}</div>}

      <div className="kv" style={{ gridTemplateColumns: '140px 1fr' }}>
        <dt>Amount</dt><dd><b>{priceLabel}</b> {app.priceCurrency || 'PGK'}</dd>
        <dt>Status</dt><dd><Badge tone={paid ? 'success' : expired ? 'danger' : 'warn'}>{paymentStatus}</Badge></dd>
        <dt>Grace period</dt><dd>{remaining != null ? `${remaining} hours remaining` : 'Not calculated'}</dd>
        <dt>Deadline</dt><dd>{app.billingDueAt ? new Date(app.billingDueAt).toLocaleString() : 'Pending'}</dd>
        {app.paidAt && <><dt>Paid at</dt><dd>{new Date(app.paidAt).toLocaleString()}</dd></>}
        {orderId && <><dt>Order</dt><dd className="mono">{orderId}</dd></>}
      </div>

      {paid ? (
        <div style={{ marginTop: 16, color: 'var(--accent)', fontWeight: 700 }}><ICN.CheckCircle size={16} /> Payment received — thank you.</div>
      ) : (
        <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
          <div>
            <h3 style={{ margin: '0 0 8px' }}>Pay with PayPal or card</h3>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={busy === 'paypal' || !orderId} onClick={handlePaypal}><ICN.CreditCard size={14} /> {busy === 'paypal' ? 'Starting…' : `Pay ${priceLabel} with PayPal`}</button>
              <button className="btn btn-outline" disabled={busy === 'capture'} onClick={handleCapture}>{busy === 'capture' ? 'Confirming…' : 'I have approved'}</button>
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px' }}>Or upload a bank transfer receipt</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Accepted: PDF, PNG, JPG. An administrator will verify and approve it.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <button className="btn btn-primary" disabled={busy === 'upload' || !file || !orderId} onClick={handleUpload}><ICN.Cloud size={14} /> {busy === 'upload' ? 'Uploading…' : 'Upload receipt'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HostingSettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => { getRenderSettings().then(setSettings).catch(() => setSettings({ configured: false })); }, []);
  return <div className="card"><h2 style={{ marginTop: 0 }}>Hosting settings</h2><div className="kv"><dt>Provider</dt><dd>Glondia Hosting</dd><dt>Configured</dt><dd>{settings?.configured ? 'Yes' : 'No'}</dd><dt>Owner ID</dt><dd>{settings?.ownerIdPresent ? 'Present' : 'Missing'}</dd><dt>Missing</dt><dd>{settings?.required?.join(', ') || 'None'}</dd></div><p className="muted">Only apps deployed through Glondiasites are tracked here. Existing third-party hosting services are not imported automatically.</p></div>;
}

function statusLabel(status) { return { preparing: 'Preparing', configuration_required: 'Preparing', queued: 'Queued', building: 'Building', deploying: 'Deploying', deployed: 'Verifying URL', deployed_unverified: 'Deployed - Warming Up', live: 'Live', failed: 'Failed', suspended: 'Suspended', deleted: 'Deleted' }[status] || 'Preparing'; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function formatTime(value) { try { return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; } catch { return ''; } }
