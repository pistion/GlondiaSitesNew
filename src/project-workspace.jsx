import React from 'react';
import { createPortal } from 'react-dom';
import { ICN } from './icons';
import { Empty, Stat, StatusBadge } from './components';
import { archiveProject, getProjectSummary, manageProjectService, updateProject } from './api';

const TABS = ['overview', 'services', 'analytics', 'logs', 'billing', 'settings'];

export function ProjectWorkspace({ projectId, initialTab = 'overview', navigate }) {
  const [tab, setTab] = React.useState(TABS.includes(initialTab) ? initialTab : 'overview');
  const [summary, setSummary] = React.useState(null);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [managingService, setManagingService] = React.useState('');
  const [managingProject, setManagingProject] = React.useState('');
  const [actionDialog, setActionDialog] = React.useState(null);

  const load = React.useCallback(() => {
    setError('');
    return getProjectSummary(projectId).then(setSummary).catch((err) => setError(err.message || 'Could not load project.'));
  }, [projectId]);

  React.useEffect(() => { load(); }, [load]);
  const project = summary?.project;

  function openTab(next) {
    setTab(next);
    navigate({ view: 'project-workspace', params: { projectId, tab: next } });
  }

  async function save(patch) {
    setSaving(true);
    setError('');
    try {
      await updateProject(projectId, patch);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save project.');
    } finally {
      setSaving(false);
    }
  }

  async function manage(service, action, input = {}) {
    const key = `${service.type}:${service.id}:${action}`;
    setManagingService(key);
    setError('');
    try {
      await manageProjectService(projectId, service.type, service.id, action, input);
      await load();
    } catch (err) {
      setError(err.message || 'Could not manage service.');
    } finally {
      setManagingService('');
    }
  }

  async function manageProject(action, input = {}) {
    if (action === 'edit') { openTab('settings'); return; }
    let patch = null;
    if (action === 'mark') patch = { status: 'active', metadata: { flagged: false } };
    if (action === 'stop') patch = { status: 'paused' };
    if (action === 'flag') {
      patch = { metadata: { flagged: true, flagReason: input.reason || '', flaggedAt: new Date().toISOString() } };
    }
    if (action === 'report') {
      patch = { metadata: { reported: true, reportReason: input.reason || '', reportedAt: new Date().toISOString() } };
    }
    setManagingProject(action);
    setError('');
    try {
      if (action === 'delete') {
        await archiveProject(projectId);
        navigate({ view: 'overview' });
        return;
      }
      await updateProject(projectId, patch);
      await load();
    } catch (err) {
      setError(err.message || 'Could not manage project.');
    } finally {
      setManagingProject('');
    }
  }

  function requestAction(scope, target, action) {
    if (scope === 'project' && action === 'edit') { manageProject('edit'); return; }
    setActionDialog({ scope, target, action, value: action === 'edit' ? target.name || '' : '' });
  }

  async function confirmActionDialog() {
    const dialog = actionDialog;
    if (!dialog) return;
    const input = dialog.action === 'edit' ? { name: dialog.value.trim() } : { reason: dialog.value.trim() };
    if (dialog.action === 'edit' && !input.name) return;
    setActionDialog(null);
    if (dialog.scope === 'project') await manageProject(dialog.action, input);
    else await manage(dialog.target, dialog.action, input);
  }

  if (!project && !error) return <div className="card project-loading">Loading project workspace…</div>;
  if (!project) return <Empty icon="AlertCircle" title="Project unavailable" body={error} />;

  const services = summary.services || [];
  return (
    <div className="project-workspace">
      <div className="page-head project-workspace__head">
        <div>
          <div className="page-eyebrow">Project workspace · {project.projectCode || project.id}</div>
          <h1>{project.name}</h1>
          <p className="sub">Everything created here stays grouped under this project and client.</p>
        </div>
        <div className="actions"><StatusBadge value={project.status || 'Draft'} /><button className="btn btn-outline" onClick={() => navigate({ view: 'overview' })}><ICN.ArrowLeft size={14}/> Back to projects</button></div>
      </div>

      <div className="project-workspace__identity card">
        <span><b>Project ID</b><code>{project.id}</code></span>
        <span><b>Client ID</b><code>{project.clientId || 'Unassigned'}</code></span>
        <span><b>Storage path</b><code>{project.storageNamespace || 'Not provisioned'}</code></span>
      </div>

      <div className="project-workspace__body">
        <ProjectServiceSidebar projectId={projectId} navigate={navigate} />
        <main className="project-workspace__content">
          <nav className="project-workspace__tabs" aria-label="Project sections">
            {TABS.map((item) => <button key={item} className={tab === item ? 'is-active' : ''} onClick={() => openTab(item)}>{item}</button>)}
          </nav>
          {error && <div className="project-error">{error}</div>}

          {tab === 'overview' && <OverviewPanel project={project} summary={summary} navigate={navigate} onRequestAction={requestAction} managingService={managingService} managingProject={managingProject} />}
          {tab === 'services' && <ServicesPanel projectId={projectId} services={services} navigate={navigate} />}
          {tab === 'analytics' && <AnalyticsPanel metrics={summary.metrics || {}} />}
          {tab === 'logs' && <LogsPanel activity={summary.recentActivity || []} deployments={summary.recentDeployments || []} />}
          {tab === 'billing' && <BillingPanel project={project} saving={saving} onSave={save} />}
          {tab === 'settings' && <SettingsPanel project={project} saving={saving} onSave={save} />}
        </main>
      </div>
      <ActionDialog dialog={actionDialog} onChange={(value) => setActionDialog((current) => ({ ...current, value }))} onClose={() => setActionDialog(null)} onConfirm={confirmActionDialog} />
    </div>
  );
}

const SERVICE_GROUPS = [
  { label: 'Services', items: [
    { label: 'Hosting', icon: 'Server', route: { view: 'builder-import', params: { mode: 'zip' } } },
    { label: 'Site Builder', icon: 'Layers', route: { view: 'builder-gallery' } },
    { label: 'Domain', icon: 'Globe', route: { view: 'domains-buy' } },
    { label: 'Business Email', icon: 'Mail', route: { view: 'email' } },
    { label: 'VPS', icon: 'Cpu', route: { view: 'vps-create' } },
    { label: 'Cloud Storage', icon: 'Database', route: { view: 'cloud-storage-create' } },
    { label: 'Support', icon: 'HelpCircle', route: { view: 'support' } },
  ] },
  { label: 'Custom Build', items: [
    { label: 'Request a build', icon: 'Wand2', route: { view: 'support' } },
  ] },
  { label: 'Consultations', items: [
    { label: 'Book consultation', icon: 'MessageCircle', route: { view: 'support' } },
  ] },
];

function ProjectServiceSidebar({ projectId, navigate }) {
  return <aside className="project-service-sidebar">
    <div className="project-service-sidebar__title"><span>Add to project</span><small>Services inherit this project ID</small></div>
    {SERVICE_GROUPS.map((group) => <section key={group.label}>
      <h3>{group.label}</h3>
      <div>{group.items.map((item) => {
        const Icon = ICN[item.icon] || ICN.Folder;
        return <button key={item.label} onClick={() => navigate({ ...item.route, params: { ...(item.route.params || {}), projectId } })}><Icon size={14}/><span>{item.label}</span><ICN.ArrowRight size={12}/></button>;
      })}</div>
    </section>)}
  </aside>;
}

function OverviewPanel({ project, summary, navigate, onRequestAction, managingService, managingProject }) {
  const [openMenu, setOpenMenu] = React.useState('');
  const services = summary.services || [];
  return <>
    <div className="grid-4">
      <Stat k="Services" v={String(summary.services?.length || 0)} d="Attached to this project" />
      <Stat k="Deployments" v={String(summary.recentDeployments?.length || 0)} d="Recent project deployments" />
      <Stat k="Visitors (30d)" v={String(summary.metrics?.visitors30d || 0)} d="Across project services" />
      <Stat k="Auto billing" v={project.autoBillingEnabled ? 'On' : 'Off'} d={`${project.billingCurrency || 'PGK'} ${Number(project.billingAmount || 0).toFixed(2)} ${project.billingInterval || 'monthly'}`} />
    </div>
    <div className="card"><div className="card-head"><h2>Project details</h2><ActionMenu id="project" openMenu={openMenu} setOpenMenu={setOpenMenu} busy={managingProject} onAction={(action) => onRequestAction('project', project, action)} /></div><div className="project-details-grid">
      <Detail label="Type" value={project.serviceTypeLabel || project.serviceType} />
      <Detail label="Status" value={project.status} />
      <Detail label="Created" value={dateTime(project.createdAt)} />
      <Detail label="Updated" value={dateTime(project.updatedAt)} />
    </div>
    <div className="project-details-services">
      <div className="project-details-services__head"><div><h3>Running services</h3><span>Services attached to this project ID</span></div><b>{services.length}</b></div>
      {services.length ? <div className="project-details-services__list">{services.map((service) => {
        const target = serviceRoute(service, project.id);
        return <div className="project-details-service" key={`${service.type}-${service.id}`}>
          <button className="project-details-service__open" disabled={!target} onClick={() => target && navigate(target)}>
            <span className="project-details-services__icon">{serviceIcon(service.type)}</span>
            <span className="project-details-services__name"><strong>{service.name || service.label || service.id}</strong><small>{service.type || 'service'} · ID: {service.id}</small></span>
            <StatusBadge value={service.status || 'active'} />
          </button>
          <ActionMenu id={`${service.type}:${service.id}`} openMenu={openMenu} setOpenMenu={setOpenMenu} busy={managingService} deleteLabel="Remove" onAction={(action) => onRequestAction('service', service, action)} />
        </div>;
      })}</div> : <div className="project-details-services__empty">No running services are attached to this project yet. Add one from the project side menu.</div>}
    </div></div>
  </>;
}

function serviceRoute(service, projectId) {
  const params = { id: service.id, projectId };
  if (service.type === 'hosting') return { view: 'hosting-detail', params };
  if (service.type === 'vps') return { view: 'vps-detail', params };
  if (service.type === 'storage' || service.type === 'cloud_storage') return { view: 'cloud-storage-detail', params };
  if (service.type === 'email') return { view: 'email', params: { projectId } };
  if (service.type === 'domain') return { view: 'domains-mine', params: { projectId } };
  if (service.type === 'website' || service.type === 'builder') return { view: 'builder-project', params: { projectId: service.id, step: 'plan', clientProjectId: projectId } };
  return null;
}

function serviceIcon(type) {
  const Icon = { hosting: ICN.Server, vps: ICN.Cpu, storage: ICN.Database, cloud_storage: ICN.Database, email: ICN.Mail, domain: ICN.Globe, website: ICN.Layers, builder: ICN.Layers }[type] || ICN.Folder;
  return <Icon size={14}/>;
}

const MANAGEMENT_ACTIONS = ['mark', 'edit', 'stop', 'flag', 'report', 'delete'];

function ActionMenu({ id, openMenu, setOpenMenu, busy, onAction, deleteLabel = 'Delete' }) {
  const open = openMenu === id;
  return <div className="project-action-menu">
    <button className="project-action-menu__trigger" aria-label="Open management menu" aria-expanded={open} onClick={() => setOpenMenu(open ? '' : id)}>⋮</button>
    {open && <div className="project-action-menu__popover" role="menu">
      <span>Manage</span>
      {MANAGEMENT_ACTIONS.map((action) => <button role="menuitem" key={action} className={action === 'delete' ? 'is-danger' : ''} disabled={!!busy} onClick={() => { setOpenMenu(''); onAction(action); }}>{action === 'delete' ? deleteLabel : action}</button>)}
    </div>}
  </div>;
}

function ActionDialog({ dialog, onChange, onClose, onConfirm }) {
  if (!dialog) return null;
  const subject = dialog.scope === 'project' ? dialog.target.name : dialog.target.name || dialog.target.id;
  const needsInput = ['edit', 'stop', 'flag', 'report'].includes(dialog.action);
  const labels = {
    mark: 'Mark as active', edit: 'Edit name', stop: 'Stop access', flag: 'Flag for review', report: 'Report issue', delete: dialog.scope === 'project' ? 'Delete project' : 'Remove service',
  };
  return createPortal(<div className="project-action-dialog" role="presentation">
    <button className="project-action-dialog__backdrop" aria-label="Close dialog" onClick={onClose}/>
    <section className="card project-action-dialog__card" role="dialog" aria-modal="true" aria-labelledby="project-action-title">
      <div className="project-action-dialog__head"><div><div className="page-eyebrow">{dialog.scope} management</div><h2 id="project-action-title">{labels[dialog.action]}</h2></div><button className="btn btn-sm btn-ghost" onClick={onClose}><ICN.X size={15}/></button></div>
      <div className="project-action-dialog__body">
        <p><strong>{subject}</strong></p>
        {dialog.action === 'delete' && <p className="muted">{dialog.scope === 'project' ? 'The project will be archived and retained for audit and recovery.' : 'The service will be removed from this project without silently destroying the provider resource.'}</p>}
        {dialog.action === 'mark' && <p className="muted">This will restore the record to active and allowed status.</p>}
        {needsInput && <label className="project-field"><span>{dialog.action === 'edit' ? 'Display name' : dialog.action === 'report' ? 'Report details' : 'Reason'}</span>{dialog.action === 'edit' ? <input autoFocus value={dialog.value} onChange={(e) => onChange(e.target.value)}/> : <textarea autoFocus rows="4" value={dialog.value} onChange={(e) => onChange(e.target.value)}/>}</label>}
      </div>
      <div className="project-action-dialog__footer"><button className="btn btn-outline" onClick={onClose}>Cancel</button><button className={`btn ${dialog.action === 'delete' ? 'btn-danger' : 'btn-primary'}`} disabled={dialog.action === 'edit' && !dialog.value.trim()} onClick={onConfirm}>Confirm {labels[dialog.action].toLowerCase()}</button></div>
    </section>
  </div>, document.body);
}

function ServicesPanel({ projectId, services, navigate }) {
  return <div className="card card-flush"><div className="card-head"><h2>Project services</h2><span className="meta">{services.length} attached</span></div>{services.length ? <div className="project-service-grid">{services.map((service) => <button key={`${service.type}-${service.id}`} className="project-service-card" onClick={() => service.type === 'hosting' && navigate({ view: 'hosting-detail', params: { id: service.id, projectId } })}><b>{service.name || service.label || service.id}</b><span>{service.type}</span><StatusBadge value={service.status || 'active'} /></button>)}</div> : <Empty icon="Folder" title="No services attached" body="Create hosting, storage, domains, email, or VPS from this workspace so it inherits the project ID." />}</div>;
}

function AnalyticsPanel({ metrics }) { return <div className="grid-3"><Stat k="Visitors (30d)" v={String(metrics.visitors30d || 0)} d="All project services"/><Stat k="Requests (30d)" v={String(metrics.requests30d || 0)} d="All project services"/><Stat k="Bandwidth (30d)" v={String(metrics.bandwidth30d || 0)} d="All project services"/></div>; }
function LogsPanel({ activity, deployments }) { const rows = [...activity, ...deployments].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)); return <div className="card card-flush"><div className="card-head"><h2>Project logs</h2></div>{rows.length ? rows.map((row, index) => <div className="project-log" key={row.id || index}><code>{dateTime(row.createdAt)}</code><span>{row.message || row.what || `Deployment ${row.status || ''}`}</span></div>) : <Empty icon="Activity" title="No project logs yet" body="Deployments, service changes, billing events, and project activity will appear here."/>}</div>; }

function BillingPanel({ project, saving, onSave }) {
  const [form, setForm] = React.useState({ autoBillingEnabled: !!project.autoBillingEnabled, billingAmount: project.billingAmount || 0, billingCurrency: project.billingCurrency || 'PGK', billingInterval: project.billingInterval || 'monthly' });
  return <div className="card project-form"><div className="card-head"><h2>Automatic billing</h2></div><label className="project-check"><input type="checkbox" checked={form.autoBillingEnabled} onChange={(e) => setForm({...form, autoBillingEnabled:e.target.checked})}/><span>Enable automatic billing for this project</span></label><div className="project-form-grid"><Field label="Amount"><input type="number" min="0" step="0.01" value={form.billingAmount} onChange={(e)=>setForm({...form,billingAmount:e.target.value})}/></Field><Field label="Currency"><select value={form.billingCurrency} onChange={(e)=>setForm({...form,billingCurrency:e.target.value})}><option>PGK</option><option>USD</option><option>AUD</option></select></Field><Field label="Interval"><select value={form.billingInterval} onChange={(e)=>setForm({...form,billingInterval:e.target.value})}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></Field></div><button className="btn btn-primary" disabled={saving} onClick={()=>onSave(form)}>{saving?'Saving…':'Save billing'}</button></div>;
}

function SettingsPanel({ project, saving, onSave }) { const [form,setForm]=React.useState({name:project.name,description:project.description||'',status:String(project.status||'draft').toLowerCase(),priority:project.priority||'normal'}); return <div className="card project-form"><div className="card-head"><h2>Project settings</h2></div><div className="project-form-grid"><Field label="Project name"><input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></Field><Field label="Status"><select value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></Field><Field label="Priority"><select value={form.priority} onChange={(e)=>setForm({...form,priority:e.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></Field></div><Field label="Description"><textarea rows="4" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></Field><button className="btn btn-primary" disabled={saving||!form.name.trim()} onClick={()=>onSave(form)}>{saving?'Saving…':'Save project'}</button></div>; }
function Field({label,children}) { return <label className="project-field"><span>{label}</span>{children}</label>; }
function Detail({label,value}) { return <div><span className="muted">{label}</span><strong>{value || '—'}</strong></div>; }
function dateTime(value) { return value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—'; }
