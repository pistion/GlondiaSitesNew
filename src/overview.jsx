// overview.jsx — dashboard landing
import React from 'react';
import { createPortal } from 'react-dom';
import { ICN } from './icons';
import { GD } from './data';
import { StatusBadge, Tabs, Stat, Empty } from './components';
import { useProjects } from './use-projects';
import { useActivity } from './use-activity';
import { createProject, getStoredAuth, listProjectServiceTypes } from './api';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Overview({ navigate }) {
  const { projects, source } = useProjects();
  const { items: activity, source: activitySource } = useActivity(8);
  const [projectMenuOpen, setProjectMenuOpen] = React.useState(false);
  const [projectTypes, setProjectTypes] = React.useState(DEFAULT_PROJECT_TYPES);
  const [creatingType, setCreatingType] = React.useState('');
  const [createError, setCreateError] = React.useState('');
  const [sort, setSort] = React.useState({ key: 'createdAt', direction: 'desc' });
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const totalVisitors = projects.reduce((a, p) => a + (p.visitors30d || 0), 0);
  const auth = getStoredAuth();
  const userName = auth.user?.name || auth.user?.email || null;

  React.useEffect(() => {
    let cancelled = false;
    listProjectServiceTypes()
      .then((types) => { if (!cancelled && Array.isArray(types) && types.length) setProjectTypes(types); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleCreateProject(details) {
    setCreatingType('project');
    setCreateError('');
    try {
      const project = await createProject({
        serviceType: 'other',
        name: details.name,
        description: details.description,
        autoBillingEnabled: details.autoBillingEnabled,
        billingAmount: details.billingAmount,
        billingCurrency: details.billingCurrency,
        billingInterval: details.billingInterval,
        source: 'overview_dropdown',
      });
      setProjectMenuOpen(false);
      navigate({ view: 'project-workspace', params: { projectId: project.id, tab: 'overview' } });
    } catch (error) {
      setCreateError(error.message || 'Could not create project.');
    } finally {
      setCreatingType('');
    }
  }

  const sortedProjects = React.useMemo(() => [...projects].sort((a, b) => {
    const av = sort.key.endsWith('At') ? new Date(a[sort.key] || 0).getTime() : String(a[sort.key] || '').toLowerCase();
    const bv = sort.key.endsWith('At') ? new Date(b[sort.key] || 0).getTime() : String(b[sort.key] || '').toLowerCase();
    return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.direction === 'asc' ? 1 : -1);
  }), [projects, sort]);
  const sortBy = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Workspace{userName ? ` · ${userName}` : ''}</div>
          <h1>{greeting()}. {projects.length} project{projects.length === 1 ? '' : 's'} in your workspace.</h1>
          <p className="sub">A summary of your sites, hosting, and recent activity. Jump back into anything in progress.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setProjectMenuOpen((open) => !open)}>
            <ICN.Plus size={14} /> New project
          </button>
        </div>
      </div>

      <ProjectCreateDrawer
        open={projectMenuOpen}
        projectTypes={projectTypes}
        creatingType={creatingType}
        error={createError}
        onClose={() => setProjectMenuOpen(false)}
        onCreate={handleCreateProject}
      />

      {/* Stat row */}
      <div className="grid-4">
        <Stat k="Projects"      v={String(projects.length)}   d={source === "api" ? "Loaded from backend" : "Connect to backend to load"} />
        <Stat k="Hosting"       v={projects.length ? String(projects.length) : "—"}   d="Active hosted sites" />
        <Stat k="Visitors (30d)" v={projects.length ? totalVisitors.toLocaleString() : "—"} d={projects.length ? "across all projects" : "No projects yet"} />
        <Stat k="Build minutes" v="—"   d="Loaded from billing API" />
      </div>

      {/* Projects + activity */}
      <div className="grid-side">
        <div className="card card-flush">
          <div className="card-head">
            <h2>Projects</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="meta">Sortable project sheet</span>
              <button className="btn btn-sm btn-outline" onClick={() => setShowAllProjects((value) => !value)}>
                {showAllProjects ? 'Collapse' : 'View all projects'} <ICN.ArrowRight size={12} />
              </button>
            </div>
          </div>
          <div className={`table-wrap project-sheet-scroll${showAllProjects ? ' is-expanded' : ''}`}>
          <table className="tbl">
            <thead>
              <tr><SortTh label="Project" column="name" sort={sort} onSort={sortBy}/><SortTh label="Project ID" column="projectCode" sort={sort} onSort={sortBy}/><th>Services</th><SortTh label="Created" column="createdAt" sort={sort} onSort={sortBy}/><SortTh label="Updated" column="updatedAt" sort={sort} onSort={sortBy}/><th>Billing</th><SortTh label="Status" column="status" sort={sort} onSort={sortBy}/><th></th></tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <Empty icon="Server" title="No projects yet"
                      body="Create your first project or connect the backend to load existing ones."
                      action={<button className="btn btn-sm btn-primary" onClick={() => setProjectMenuOpen(true)}><ICN.Plus size={13} /> New project</button>} />
                  </td>
                </tr>
              ) : sortedProjects.map(p => (
                <tr key={p.id}>
                  <td>
                    <a href="#" className="proj-link"
                       onClick={(e) => { e.preventDefault(); navigate({ view: "project-workspace", params: { projectId: p.id, tab: 'overview' } }); }}>
                      <span className="proj-thumb">{p.framework[0]}</span>
                      <span>
                        <div>{p.name}</div>
                        <div className="faint" style={{ fontSize: 12 }}>{p.framework} · {p.repo}</div>
                      </span>
                    </a>
                  </td>
                  <td className="mono">{p.projectCode || p.id}</td>
                  <td>{p.serviceCount || 0}</td>
                  <td>{formatStamp(p.createdAt)}</td>
                  <td>{formatStamp(p.updatedAt)}</td>
                  <td>{p.autoBillingEnabled ? `${p.billingCurrency} ${Number(p.billingAmount || 0).toFixed(2)}` : 'Manual'}</td>
                  <td><StatusBadge value={p.status} /></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm btn-ghost" aria-label={`Open ${p.name}`} onClick={() => navigate({ view: 'project-workspace', params: { projectId: p.id, tab: 'overview' } })}><ICN.ArrowRight size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="card card-flush">
          <div className="card-head"><h2>Activity</h2><span className="meta">{activitySource === "api" ? "Backend" : "No data yet"}</span></div>
          <div style={{ padding: "8px 4px" }}>
            {activity.length === 0 ? (
              <Empty icon="Activity" title="No activity yet" body="Actions in your workspace will appear here." />
            ) : activity.map(a => (
              <div key={a.id} className="row" style={{ padding: "10px 16px", gap: 12, borderBottom: "1px solid var(--border)" }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 999,
                  background: a.kind === "deploy" ? "var(--accent-soft)" : a.kind === "domain" ? "color-mix(in srgb, var(--info) 14%, transparent)" : a.kind === "ssl" ? "color-mix(in srgb, var(--warning) 14%, transparent)" : "var(--bg-deep)",
                  color: a.kind === "deploy" ? "var(--accent)" : a.kind === "domain" ? "var(--info)" : a.kind === "ssl" ? "var(--warning)" : "var(--text-muted)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {a.kind === "deploy" && <ICN.Rocket size={14} />}
                  {a.kind === "domain" && <ICN.Globe size={14} />}
                  {a.kind === "ssl" && <ICN.ShieldCheck size={14} />}
                  {a.kind === "builder" && <ICN.Layers size={14} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 }}>{a.what}</div>
                  <div className="faint" style={{ fontSize: 12 }}>{a.who} · {a.when}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Three product CTAs */}
      <div className="grid-3">
        <ProductCta icon="Server" title="Hosting" body="Deploy from ZIP or GitHub and manage live sites." cta="Open hosting" onClick={() => navigate({ view: "hosting-list" })} />
        <ProductCta icon="Layers" title="Site builder" body="Prepare, organize, and publish sites." cta="Browse templates" onClick={() => navigate({ view: "builder-gallery" })} />
        <ProductCta icon="CreditCard" title="Billing" body="View hosting invoices and upload bank receipts." cta="Open billing" onClick={() => navigate({ view: "billing" })} />
      </div>
    </>
  );
}

const DEFAULT_PROJECT_TYPES = [
  { id: 'website', label: 'Website / Site Builder', nextView: 'builder-gallery' },
  { id: 'hosting', label: 'Hosting', nextView: 'hosting-list' },
  { id: 'domain', label: 'Domain', nextView: 'domains-mine' },
  { id: 'email', label: 'Business Email', nextView: 'email' },
  { id: 'vps', label: 'VPS Services', nextView: 'vps-hosting' },
  { id: 'consultation', label: 'Consultation', nextView: 'overview' },
  { id: 'build', label: 'Custom Build', nextView: 'overview' },
  { id: 'support', label: 'Support', nextView: 'overview' },
];

function routeForProjectType(type, fallback) {
  return {
    website: 'builder-gallery',
    hosting: 'hosting-list',
    domain: 'domains-mine',
    email: 'email',
    vps: 'vps-hosting',
  }[type] || fallback || 'overview';
}

function iconForProjectType(type) {
  const Icon = {
    website: ICN.Layers,
    hosting: ICN.Server,
    domain: ICN.Globe,
    email: ICN.Mail,
    vps: ICN.Cpu,
    consultation: ICN.HelpCircle,
    build: ICN.Wand2,
    support: ICN.HelpCircle,
    other: ICN.Folder,
  }[type] || ICN.Folder;
  return <Icon size={14} />;
}

function ProjectCreateDrawer({ open, creatingType, error, onClose, onCreate }) {
  const emptyDetails = { name: '', description: '', autoBillingEnabled: false, billingAmount: '', billingCurrency: 'PGK', billingInterval: 'monthly' };
  const [details, setDetails] = React.useState(emptyDetails);
  React.useEffect(() => { if (!open) setDetails(emptyDetails); }, [open]);
  React.useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return createPortal((
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        pointerEvents: open ? 'auto' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(12px, 3vw, 32px)',
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: open ? 'rgba(5, 7, 6, .42)' : 'rgba(5, 7, 6, 0)',
          opacity: open ? 1 : 0,
          transition: 'opacity .22s ease, background .22s ease',
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        className="card project-create-dialog"
        style={{
          position: 'relative',
          zIndex: 1,
          width: 'min(460px, calc(100vw - 32px))',
          maxHeight: 'min(680px, calc(100dvh - 24px))',
          borderRadius: 'var(--r-lg)',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(12px) scale(.97)',
          transition: 'opacity .18s ease, transform .22s cubic-bezier(.2,.8,.2,1)',
          boxShadow: '0 28px 80px rgba(0,0,0,.34)',
        }}
      >
        <div style={{ padding: '22px 22px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div className="page-eyebrow" style={{ marginBottom: 6 }}>New project</div>
            <h2 style={{ margin: 0, fontSize: 24 }}>Project settings</h2>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5 }}>Create the project first, then add and manage its services from the project workspace.</p>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close project drawer">
            <ICN.X size={15} />
          </button>
        </div>

        <div className="project-create-options">
          <div className="project-create-form">
            <label className="project-field"><span>Project name</span><input autoFocus value={details.name} onChange={(e)=>setDetails({...details,name:e.target.value})}/></label>
            <label className="project-field"><span>Description</span><textarea rows="3" placeholder="What is this project for?" value={details.description} onChange={(e)=>setDetails({...details,description:e.target.value})}/></label>
            <label className="project-check"><input type="checkbox" checked={details.autoBillingEnabled} onChange={(e)=>setDetails({...details,autoBillingEnabled:e.target.checked})}/><span>Enable automatic billing</span></label>
            {details.autoBillingEnabled && <div className="project-create-billing"><label className="project-field"><span>Amount</span><input type="number" min="0" step="0.01" value={details.billingAmount} onChange={(e)=>setDetails({...details,billingAmount:e.target.value})}/></label><label className="project-field"><span>Currency</span><select value={details.billingCurrency} onChange={(e)=>setDetails({...details,billingCurrency:e.target.value})}><option>PGK</option><option>USD</option><option>AUD</option></select></label><label className="project-field"><span>Interval</span><select value={details.billingInterval} onChange={(e)=>setDetails({...details,billingInterval:e.target.value})}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label></div>}
            <button className="btn btn-primary" disabled={!details.name.trim() || !!creatingType} onClick={()=>onCreate(details)}>{creatingType ? 'Creating project…' : 'Create project workspace'}</button>
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 12, padding: '8px 2px' }}>{error}</div>}
        </div>
      </aside>
    </div>
  ), document.body);
}


function SortTh({ label, column, sort, onSort }) { return <th><button className="project-sort" onClick={() => onSort(column)}>{label}<span>{sort.key === column ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>; }
function formatStamp(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }

function projectTypeHint(type) {
  return {
    website: 'Build or customize a site',
    hosting: 'Deploy ZIP, GitHub, or generated source',
    domain: 'Register, transfer, or connect DNS',
    email: 'Set up mailbox and mail records',
    vps: 'VPS service',
    consultation: 'Planning and advisory request',
    build: 'Custom implementation work',
    support: 'Help, fixes, or service issue',
    other: 'General project container',
  }[type] || 'Project workspace';
}

function ProductCta({ icon, title, body, cta, onClick }) {
  const Icon = ICN[icon];
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{
        width: 40, height: 40, borderRadius: 10,
        background: "var(--accent-soft)", color: "var(--accent-ink)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}><Icon size={18} /></span>
      <div>
        <h3 style={{ margin: 0, fontFamily: "var(--serif)", fontWeight: 500, fontSize: 22, letterSpacing: "-0.005em" }}>{title}</h3>
        <p className="muted" style={{ margin: "6px 0 0" }}>{body}</p>
      </div>
      <button className="btn btn-outline" style={{ alignSelf: "flex-start" }} onClick={onClick}>
        {cta} <ICN.ArrowRight size={14} />
      </button>
    </div>
  );
}
