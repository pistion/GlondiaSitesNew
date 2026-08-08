// BuilderProjectShell.jsx — the canonical, durable Site Builder customer flow.
//
// One shell for the whole lifecycle: it loads a BuilderProject by id from the
// server (so refresh/deep-link resume), and drives the canonical API for every
// step — plan → content → generate → preview → approve → deploy. There is no
// client-owned source of truth; the server state machine and version are
// authoritative and every mutation reflects the server's response.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { builderProjectsApi, newIdempotencyKey } from '../../../api/builder-projects.js';
import { useBuilderProject, useBuilderJob } from './useBuilderProject.js';
import { ICN } from '../../../icons.jsx';

const STEPS = [
  { key: 'plan', label: 'Plan' },
  { key: 'content', label: 'Content' },
  { key: 'preview', label: 'Preview' },
  { key: 'deploy', label: 'Deploy' },
];

function prettyJson(value) {
  try { return JSON.stringify(value?.data ?? value ?? {}, null, 2); } catch { return '{}'; }
}

function StatusPill({ status }) {
  const tone = {
    PREVIEW_READY: 'ok', APPROVED: 'ok', LIVE: 'ok',
    GENERATION_FAILED: 'err', DEPLOYMENT_FAILED: 'err', BILLING_SETUP_FAILED: 'err',
  }[status] || 'info';
  return <span className={`badge ${tone === 'err' ? 'warn' : tone === 'ok' ? 'ok' : 'info'}`}><span className="dot" />{status || '—'}</span>;
}

function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="card" style={{ borderColor: 'var(--danger, #b42318)', padding: 12, margin: '10px 0' }}>
      <strong>{error.code || 'Error'}</strong>
      <div className="muted" style={{ fontSize: 13 }}>{error.message}</div>
      {error.requestId && <div className="muted" style={{ fontSize: 11 }}>requestId: {error.requestId}</div>}
    </div>
  );
}

// ── Saved projects list ───────────────────────────────────────────────────────

function ProjectsList({ navigate }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setProjects(await builderProjectsApi.listProjects()); }
    catch (err) { setError(err); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createProject = async (templateId, name) => {
    setCreating(true);
    setError(null);
    try {
      const project = await builderProjectsApi.createProject({ sourceType: 'template', templateId, name });
      navigate({ view: 'builder-project', params: { projectId: project.id, step: 'plan' } });
    } catch (err) { setError(err); setCreating(false); }
  };

  return (
    <div className="builder-projects-page">
      <div className="builder-projects-head">
        <button
          className="builder-projects-back"
          type="button"
          onClick={() => navigate({ view: 'builder-gallery' })}
          title="Back to Site Builder"
        >
          <ICN.ArrowLeft size={18} />
        </button>
        <div>
          <div className="page-eyebrow">Site Builder</div>
          <h1>Your projects</h1>
          <p className="muted">Saved work and new site starts live here.</p>
        </div>
        <div className="builder-projects-new-actions">
          <button className="btn btn-primary" disabled={creating} onClick={() => createProject('pulse-works', 'New Pulse site')}>
            {creating ? 'Creating...' : 'Build from Pulse Works'}
          </button>
          <button className="btn btn-outline" disabled={creating} onClick={() => createProject('forge', 'New Forge site')}>
            Build from Forge
          </button>
        </div>
      </div>

      <ErrorNote error={error} />

      <div className="builder-projects-intro">
        <div>
          <h2>Start a new site</h2>
          <p>Build from a template. Your progress saves to the server and survives refresh.</p>
        </div>
        <div className="builder-projects-inline-actions">
          <button className="btn btn-primary" disabled={creating} onClick={() => createProject('pulse-works', 'New Pulse site')}>
            {creating ? 'Creating…' : 'Build from Pulse Works'}
          </button>
          <button className="btn btn-outline" disabled={creating} onClick={() => createProject('forge', 'New Forge site')}>
            Build from Forge
          </button>
        </div>
      </div>

      <div className="builder-projects-section-head">
        <h3>Saved projects</h3>
      </div>
      {projects === null && <p className="muted">Loading…</p>}
      {projects && projects.length === 0 && <p className="muted">No projects yet — start one above.</p>}
      <div className="builder-project-list">
        {(projects || []).map((p) => (
          <button
            key={p.id}
            className="builder-project-row"
            onClick={() => navigate({ view: 'builder-project', params: { projectId: p.id, step: 'plan' } })}
          >
            <div className="builder-project-row-main">
              <strong>{p.name}</strong>
              <small>Updated {new Date(p.updatedAt).toLocaleString()}</small>
              <ICN.ArrowRight size={16} />
              <span>{p.templateId} · v{p.version}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{p.templateId} · v{p.version} · updated {new Date(p.updatedAt).toLocaleString()}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Plan step (debounced autosave with expectedVersion) ───────────────────────

function PlanStep({ project, reload }) {
  const [text, setText] = useState(() => prettyJson(project.plan));
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|conflict|error
  const [error, setError] = useState(null);
  const versionRef = useRef(project.version);
  const timer = useRef(null);

  useEffect(() => { versionRef.current = project.version; }, [project.version]);

  const save = useCallback(async (value) => {
    let parsed;
    try { parsed = JSON.parse(value); } catch { setSaveState('error'); setError({ message: 'Plan is not valid JSON.' }); return; }
    setSaveState('saving');
    setError(null);
    try {
      const result = await builderProjectsApi.updatePlan(project.id, { expectedVersion: versionRef.current, plan: parsed });
      versionRef.current = result.version;
      setSaveState('saved');
      reload();
    } catch (err) {
      if (err.code === 'BUILDER_VERSION_CONFLICT') { setSaveState('conflict'); reload(); }
      else { setSaveState('error'); setError(err); }
    }
  }, [project.id, reload]);

  const onChange = (value) => {
    setText(value);
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(value), 900);
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Plan</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && '✓ Saved'}
          {saveState === 'conflict' && '⚠ Reloaded — this project changed elsewhere'}
          {saveState === 'idle' && 'Edited'}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Describe the site. Autosaves with optimistic concurrency (expectedVersion v{project.version}).</p>
      <ErrorNote error={error} />
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{ width: '100%', minHeight: 320, fontFamily: 'monospace', fontSize: 13, padding: 12 }}
      />
    </div>
  );
}

// ── Content step (answer sheet, expectedVersion) ──────────────────────────────

function ContentStep({ project, reload }) {
  const [text, setText] = useState(() => prettyJson(project.answerSheet));
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');

  const build = async () => {
    setStatus('building'); setError(null);
    try { await builderProjectsApi.buildAnswerSheet(project.id); const p = await reload(); setText(prettyJson(p.answerSheet)); setStatus('saved'); }
    catch (err) { setError(err); setStatus('error'); }
  };
  const save = async () => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { setError({ message: 'Answer sheet is not valid JSON.' }); return; }
    setStatus('saving'); setError(null);
    try { await builderProjectsApi.updateAnswerSheet(project.id, { schemaVersion: 1, data: parsed.data ?? parsed }, project.version); await reload(); setStatus('saved'); }
    catch (err) { if (err.code === 'BUILDER_VERSION_CONFLICT') { reload(); } setError(err); setStatus('error'); }
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Content — answer sheet</h3>
        <span className="muted" style={{ fontSize: 12 }}>{status === 'saved' ? '✓ Saved' : status === 'saving' ? 'Saving…' : ''}</span>
      </div>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <button className="btn btn-outline" onClick={build} disabled={status === 'building'}>Generate from plan</button>
        <button className="btn btn-primary" onClick={save} disabled={status === 'saving'}>Save answer sheet</button>
      </div>
      <ErrorNote error={error} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        style={{ width: '100%', minHeight: 300, fontFamily: 'monospace', fontSize: 13, padding: 12 }} />
    </div>
  );
}

// ── Generation + preview step ─────────────────────────────────────────────────

function PreviewStep({ project, reload }) {
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const loadRevisions = useCallback(async () => {
    try { setRevisions(await builderProjectsApi.listRevisions(project.id)); }
    catch (err) { setError(err); }
  }, [project.id]);
  useEffect(() => { loadRevisions(); }, [loadRevisions]);

  const { job, events } = useBuilderJob(activeJobId, {
    onSettled: () => { setActiveJobId(null); loadRevisions(); reload(); },
  });

  const generate = async () => {
    setError(null); setPreviewUrl(null);
    try {
      const result = await builderProjectsApi.startGeneration(project.id, { mode: 'full' }, newIdempotencyKey('gen'));
      setActiveJobId(result.jobId);
    } catch (err) { setError(err); }
  };

  const openPreview = async (revisionId) => {
    setError(null);
    try {
      const grant = await builderProjectsApi.createPreviewGrant(project.id, revisionId);
      setPreviewUrl(grant.url);
    } catch (err) { setError(err); }
  };

  const approve = async (revisionId) => {
    setError(null);
    try { await builderProjectsApi.approveRevision(project.id, revisionId); await loadRevisions(); await reload(); }
    catch (err) { setError(err); }
  };

  const requestChange = async (revisionId) => {
    setError(null);
    const message = window.prompt('Describe the change you want:');
    if (!message) return;
    try {
      const result = await builderProjectsApi.requestChange(project.id, revisionId, { changeRequest: { message } }, newIdempotencyKey('cr'));
      setActiveJobId(result.jobId);
    } catch (err) { setError(err); }
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Preview</h3>
        <button className="btn btn-primary" onClick={generate} disabled={Boolean(activeJobId)}>
          {activeJobId ? 'Generating…' : 'Generate revision'}
        </button>
      </div>
      <ErrorNote error={error} />

      {activeJobId && job && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="row between"><strong>Job {job.status}</strong><span className="muted">{job.stage}</span></div>
          <div style={{ display: 'grid', gap: 3, marginTop: 8, maxHeight: 140, overflow: 'auto' }}>
            {events.map((e) => <div key={e.sequence} className="muted" style={{ fontSize: 12 }}>· {e.stage || e.level}: {e.message}</div>)}
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="card" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
          <iframe title="Site preview" src={previewUrl} style={{ width: '100%', height: 460, border: 0 }} sandbox="allow-scripts allow-same-origin" />
        </div>
      )}

      <h4>Revisions</h4>
      {revisions.length === 0 && <p className="muted">No revisions yet — generate one above.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {revisions.map((r) => (
          <div key={r.id} className="card" style={{ padding: 12 }}>
            <div className="row between">
              <strong>Revision {r.revisionNumber}</strong>
              <StatusPill status={r.status} />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{r.artifactChecksum ? `checksum ${r.artifactChecksum.slice(0, 12)}…` : 'no artifact'}</div>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {['READY', 'APPROVED'].includes(r.status) && <button className="btn btn-outline" onClick={() => openPreview(r.id)}>Preview</button>}
              {r.status === 'READY' && <button className="btn btn-primary" onClick={() => approve(r.id)}>Approve</button>}
              {['READY', 'APPROVED'].includes(r.status) && <button className="btn btn-ghost" onClick={() => requestChange(r.id)}>Request change</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Deploy step ───────────────────────────────────────────────────────────────

function DeployStep({ project, reload, navigate }) {
  const [deployments, setDeployments] = useState([]);
  const [error, setError] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);

  const load = useCallback(async () => {
    try { setDeployments(await builderProjectsApi.listDeployments(project.id)); }
    catch (err) { setError(err); }
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const { job } = useBuilderJob(activeJobId, { onSettled: () => { setActiveJobId(null); load(); reload(); } });

  const deploy = async () => {
    setError(null);
    try {
      const result = await builderProjectsApi.createDeployment(project.id, {}, newIdempotencyKey('deploy'));
      if (result.jobId) setActiveJobId(result.jobId);
      await load();
    } catch (err) { setError(err); }
  };

  const canDeploy = Boolean(project.approvedRevisionId);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Deploy</h3>
        <button className="btn btn-primary" onClick={deploy} disabled={!canDeploy || Boolean(activeJobId)}>
          {activeJobId ? 'Deploying…' : 'Deploy approved revision'}
        </button>
      </div>
      {!canDeploy && <p className="muted">Approve a revision on the Preview step before deploying.</p>}
      <ErrorNote error={error} />
      {activeJobId && job && <div className="card" style={{ padding: 12, marginBottom: 12 }}><strong>Deploy job {job.status}</strong> <span className="muted">{job.stage}</span></div>}

      <h4>Deployments</h4>
      {deployments.length === 0 && <p className="muted">No deployments yet.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {deployments.map((d) => (
          <div key={d.id} className="card" style={{ padding: 12 }}>
            <div className="row between"><strong>{d.deploymentId}</strong><StatusPill status={d.status} /></div>
            {d.liveUrl && <a href={d.liveUrl} target="_blank" rel="noreferrer">{d.liveUrl}</a>}
            {d.errorMessage && <div className="muted" style={{ fontSize: 12 }}>{d.errorMessage}</div>}
            {d.hostingDeploymentId && (
              <button className="btn btn-ghost" style={{ marginTop: 8 }}
                onClick={() => navigate({ view: 'hosting-detail', params: { id: d.hostingDeploymentId } })}>
                Open in Hosting
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function BuilderProjectShell({ projectId, step = 'plan', navigate }) {
  const { project, loading, error, reload } = useBuilderProject(projectId);

  const goStep = (key) => navigate({ view: 'builder-project', params: { projectId, step: key } });

  if (!projectId) return <ProjectsList navigate={navigate} />;
  if (loading && !project) return <p className="muted">Loading project…</p>;
  if (error && !project) {
    return (
      <div>
        <ErrorNote error={error} />
        <button className="btn btn-outline" onClick={() => navigate({ view: 'builder-project', params: {} })}>Back to projects</button>
      </div>
    );
  }
  if (!project) return null;

  const currentStep = STEPS.find((s) => s.key === step) ? step : 'plan';

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <button className="btn btn-ghost" style={{ padding: 0, marginBottom: 4 }} onClick={() => navigate({ view: 'builder-project', params: {} })}>← Projects</button>
          <h1 style={{ margin: 0 }}>{project.name}</h1>
          <div className="muted" style={{ fontSize: 12 }}>{project.templateId} · v{project.version}</div>
        </div>
        <StatusPill status={project.status} />
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {STEPS.map((s) => (
          <button key={s.key}
            className={`btn ${s.key === currentStep ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => goStep(s.key)}>{s.label}</button>
        ))}
      </div>

      {currentStep === 'plan' && <PlanStep project={project} reload={reload} />}
      {currentStep === 'content' && <ContentStep project={project} reload={reload} />}
      {currentStep === 'preview' && <PreviewStep project={project} reload={reload} />}
      {currentStep === 'deploy' && <DeployStep project={project} reload={reload} navigate={navigate} />}
    </div>
  );
}

export default BuilderProjectShell;
