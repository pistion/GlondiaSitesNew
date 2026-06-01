// App.jsx — main shell, router state, theme/tweaks integration
import React, { useState as useStateApp, useEffect as useEffectApp } from 'react';
import { ICN } from './icons';
import { 
  DashSidebar, 
  DashTopbar, 
  Badge, 
  StatusBadge, 
  Empty 
} from './components';
import { 
  useTweaks, 
  TweaksPanel, 
  TweakSection, 
  TweakRadio, 
  TweakColor, 
  TweakSelect, 
  TweakButton 
} from './tweaks-panel';
import { Overview } from './overview';
import { HostingList, HostingDetail } from './hosting-control';
import { DomainsMine, DomainsBuy, DnsEditor } from './domains';
import {
  BuilderGallery, BuilderTemplates, BuilderRoxanne, BuilderImport,
  BuilderEditor, BuilderAiIntake, BuilderDeploymentSettings,
} from './features/builder';
import { ActivityPage } from './activity';
import { AdminPage } from './features/admin/AdminPage.jsx';
import { useBilling } from './use-billing';
import { VpsHostingList, VpsCreateWizard, VpsDetail } from './vps-hosting';
import { notifyDataChanged } from './api';
import { isAuthenticated, clearAuthSession, AUTH_CHANGED_EVENT } from './api/auth.js';
import { isViewComingSoon } from './app/features.js';
import LoginPage from './features/auth/LoginPage.jsx';
import SignupPage from './features/auth/SignupPage.jsx';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "#198754",
  "density": "regular",
  "fontPair": "serif-sans"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  "#198754": { hover: "#136943", soft: "#dcf2e6",   ink: "#0c4a2a", glow: "rgba(25,135,84,.22)"  }, // green (default)
  "#1d4e6e": { hover: "#163d57", soft: "#e0eaf2",   ink: "#0b2436", glow: "rgba(29,78,110,.24)"  }, // harbor blue
  "#7c2d12": { hover: "#5f220e", soft: "#fbe3d4",   ink: "#3a1607", glow: "rgba(124,45,18,.24)"  }, // terracotta
  "#2a4d9a": { hover: "#21407f", soft: "#e4ebf7",   ink: "#142555", glow: "rgba(42,77,154,.24)"  }, // royal
  "#1a1f1d": { hover: "#0a0e0c", soft: "#e6e8e6",   ink: "#070a09", glow: "rgba(26,31,29,.24)"   }, // mono
};

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ padding: "32px 24px", maxWidth: 720, margin: "40px auto" }}>
        <Empty
          icon="AlertCircle"
          title="This screen could not load"
          body={this.state.error?.message || "Something went wrong while rendering this workspace screen."}
          action={
            <button className="btn btn-primary" onClick={() => this.props.navigate({ view: "builder-gallery" })}>
              Back to site builder
            </button>
          }
        />
      </div>
    );
  }
}

function applyAccent(color) {
  const p = ACCENT_PRESETS[color] || ACCENT_PRESETS["#198754"];
  const r = document.documentElement.style;
  r.setProperty("--accent", color);
  r.setProperty("--accent-hover", p.hover);
  r.setProperty("--accent-soft", p.soft);
  r.setProperty("--accent-ink", p.ink);
  r.setProperty("--accent-glow", p.glow);
}

function applyFontPair(pair) {
  const r = document.documentElement.style;
  if (pair === "all-sans") {
    r.setProperty("--serif", '"Inter", system-ui, sans-serif');
  } else if (pair === "mono-display") {
    r.setProperty("--serif", '"JetBrains Mono", ui-monospace, monospace');
  } else {
    // serif-sans default
    r.setProperty("--serif", '"Instrument Serif", "Cormorant Garamond", Georgia, serif');
  }
}

export default function App() {
  const [route, setRoute] = useStateApp({ view: "login" });
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [githubBanner, setGithubBanner] = useStateApp(null);
  const [authed, setAuthed] = useStateApp(isAuthenticated());

  useEffectApp(() => {
    const sync = () => setAuthed(isAuthenticated());
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, sync);
  }, []);

  // Apply theme/accent/density to root
  useEffectApp(() => { document.documentElement.dataset.theme = t.theme; }, [t.theme]);
  useEffectApp(() => { document.documentElement.dataset.density = t.density; }, [t.density]);
  useEffectApp(() => { applyAccent(t.accent); }, [t.accent]);
  useEffectApp(() => { applyFontPair(t.fontPair); }, [t.fontPair]);

  // GitHub OAuth callback — clear query params and show banner.
  useEffectApp(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('github_connected') === '1') {
      const login = params.get('login') || '';
      setGithubBanner(login ? `GitHub connected as @${login}.` : 'GitHub connected successfully.');
      // Clear query params without reload
      const clean = new URL(window.location.href);
      clean.search = '';
      window.history.replaceState({}, '', clean.toString());
      // Land on hosting so the user can start importing
      setRoute({ view: 'hosting-list' });
      notifyDataChanged();
      const t = setTimeout(() => setGithubBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffectApp(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [route.view, route.params?.id]);

  const navigate = (r) => setRoute(r);
  const toggleTheme = () => setTweak("theme", t.theme === "dark" ? "light" : "dark");

  const DASHBOARD_VIEWS = new Set([
    "overview","hosting-list","hosting-detail","domains-mine","domains-buy","dns",
    "builder-gallery","builder-templates","builder-roxanne","builder-import","builder-editor","builder-ai-intake","builder-deployment-settings",
    "analytics","activity","billing","settings","vps-hosting","vps-create","vps-detail","admin",
  ]);

  // Render
  const isAuthBlocked = DASHBOARD_VIEWS.has(route.view) && !authed;

  const renderView = () => {
    if (isAuthBlocked) return <LoginPage navigate={navigate} />;

    // Non-MVP surfaces are gated behind Coming Soon instead of broken pages.
    if (isViewComingSoon(route.view)) return <ComingSoon navigate={navigate} />;

    switch (route.view) {
      case "login":             return authed ? (() => { navigate({ view: 'overview' }); return null; })() : <LoginPage navigate={navigate} />;
      case "signup":            return authed ? (() => { navigate({ view: 'overview' }); return null; })() : <SignupPage navigate={navigate} />;
      case "overview":          return <Overview navigate={navigate} />;
      case "hosting-list":      return <HostingList navigate={navigate} />;
      case "hosting-detail":    return <HostingDetail id={route.params?.id} navigate={navigate} />;
      case "domains-mine":      return <DomainsMine navigate={navigate} />;
      case "domains-buy":       return <DomainsBuy navigate={navigate} />;
      case "dns":               return <DnsEditor domain={route.params?.domain || ""} navigate={navigate} />;
      case "builder-gallery":   return <BuilderGallery navigate={navigate} />;
      case "builder-templates": return <BuilderTemplates navigate={navigate} />;
      case "builder-roxanne":   return <BuilderRoxanne navigate={navigate} />;
      case "builder-import":    return <BuilderImport mode={route.params?.mode || "github"} navigate={navigate} />;
      case "builder-ai-intake":              return <BuilderAiIntake templateId={route.params?.templateId || ""} templateType={route.params?.templateType || "html"} navigate={navigate} />;
      case "builder-deployment-settings":    return <BuilderDeploymentSettings siteId={route.params?.siteId || null} templateId={route.params?.templateId || ""} templateType={route.params?.templateType || "html"} navigate={navigate} />;
      case "builder-editor":                 return <BuilderEditor id={route.params?.id} siteId={route.params?.siteId} navigate={navigate} />;
      case "analytics":         return <SimplePage title="Analytics" body="Cross-project analytics — coming up next." />;
      case "activity":          return <ActivityPage />;
      case "admin":             return <AdminPage navigate={navigate} />;
      case "billing":           return <BillingPageIntegrated />;
      case "settings":          return <SimplePage title="Settings" body="Workspace settings — coming up next." />;
      case "vps-hosting":       return <VpsHostingList navigate={navigate} />;
      case "vps-create":        return <VpsCreateWizard navigate={navigate} initialPlan={route.params?.plan || ''} initialPlanType={route.params?.planType || ''} />;
      case "vps-detail":        return <VpsDetail id={route.params?.id} navigate={navigate} />;
      default:
        window.location.href = "/";
        return null;
    }
  };

  // Sidebar key
  const activeKey = (() => {
    if (route.view.startsWith("hosting")) return "hosting";
    if (route.view.startsWith("vps")) return "vps-hosting";
    if (route.view === "domains-mine") return "domains";
    if (route.view === "domains-buy") return "buy";
    if (route.view === "dns") return "dns";
    if (route.view.startsWith("builder")) return "builder";
    return route.view;
  })();

  const crumbs = (() => {
    switch (route.view) {
      case "overview":        return [{ label: "Workspace" }, { label: "Overview" }];
      case "hosting-list":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Hosting" }];
      case "hosting-detail":  return [{ label: "Hosting", onClick: () => navigate({ view: "hosting-list" }) }, { label: route.params?.id || "project" }];
      case "domains-mine":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Domains" }];
      case "domains-buy":     return [{ label: "Domains", onClick: () => navigate({ view: "domains-mine" }) }, { label: "Buy a domain" }];
      case "dns":             return [{ label: "Domains", onClick: () => navigate({ view: "domains-mine" }) }, { label: route.params?.domain || "DNS" }, { label: "DNS records" }];
      case "builder-gallery":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Site builder" }];
      case "builder-ai-intake":           return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Template setup" }];
      case "builder-deployment-settings": return [{ label: "Template setup", onClick: () => navigate({ view: "builder-ai-intake" }) }, { label: "Deploy" }];
      case "builder-templates": return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Templates" }];
      case "builder-roxanne": return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "RoxanneAI" }];
      case "builder-import":  return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Import" }];
      case "builder-editor":  return [{ label: "Templates", onClick: () => navigate({ view: "builder-templates" }) }, { label: "Editor" }];
      case "billing":         return [{ label: "Workspace" }, { label: "Billing" }];
      case "admin":           return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Admin" }];
      case "vps-hosting":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Cloud Servers" }];
      case "vps-create":     return [{ label: "Cloud Servers", onClick: () => navigate({ view: "vps-hosting" }) }, { label: "New server" }];
      case "vps-detail":     return [{ label: "Cloud Servers", onClick: () => navigate({ view: "vps-hosting" }) }, { label: route.params?.id || "Server" }];
      default:                return [{ label: "Workspace" }];
    }
  })();

  const isFullPageView = route.view === "login" || route.view === "signup" || isAuthBlocked;

  return (
    <>
      {isFullPageView
        ? renderView()
        : (
          <div className="dash">
            {githubBanner && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
                background: "var(--accent-soft)", color: "var(--accent)",
                borderBottom: "1px solid var(--accent)", padding: "10px 20px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 13, fontWeight: 500,
              }}>
                <span><ICN.Git size={14} style={{ marginRight: 6 }} />{githubBanner}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setGithubBanner(null)} style={{ color: "var(--accent)" }}>✕</button>
              </div>
            )}
            <DashSidebar active={activeKey} navigate={navigate} />
            <main className="dash-main">
              <DashTopbar crumbs={crumbs} navigate={navigate} theme={t.theme} toggleTheme={toggleTheme} />
              <div className="dash-body">
                <RouteErrorBoundary routeKey={`${route.view}:${route.params?.id || ""}:${route.params?.siteId || ""}`} navigate={navigate}>
                  {renderView()}
                </RouteErrorBoundary>
              </div>
            </main>
          </div>
        )}

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={t.theme} options={["light", "dark"]}
                    onChange={(v) => setTweak("theme", v)} />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular", "comfy"]}
                    onChange={(v) => setTweak("density", v)} />
        <TweakSection label="Brand" />
        <TweakColor label="Accent" value={t.accent}
                    options={Object.keys(ACCENT_PRESETS)}
                    onChange={(v) => setTweak("accent", v)} />
        <TweakSelect label="Font pairing" value={t.fontPair}
                     options={[
                       { value: "serif-sans", label: "Instrument Serif + Inter" },
                       { value: "all-sans",   label: "Inter only" },
                       { value: "mono-display", label: "JetBrains Mono display" },
                     ]}
                     onChange={(v) => setTweak("fontPair", v)} />
        <TweakSection label="Navigate" />
        <TweakButton onClick={() => { window.location.href = "/"; }}>Front page</TweakButton>
        <TweakButton onClick={() => navigate({ view: "overview" })}>Dashboard overview</TweakButton>
        <TweakButton onClick={() => navigate({ view: "hosting-list" })}>Hosting projects</TweakButton>
        <TweakButton onClick={() => navigate({ view: "hosting-detail", params: { id: "" } })}>Project detail</TweakButton>
        <TweakButton onClick={() => navigate({ view: "domains-buy" })}>Buy a domain</TweakButton>
        <TweakButton onClick={() => navigate({ view: "dns" })}>DNS editor</TweakButton>
        <TweakButton onClick={() => navigate({ view: "builder-gallery" })}>Site builder start</TweakButton>
        <TweakButton onClick={() => navigate({ view: "builder-templates" })}>Template gallery</TweakButton>
        <TweakButton onClick={() => navigate({ view: "builder-templates" })}>Builder editor</TweakButton>
      </TweaksPanel>
    </>
  );
}

function ComingSoon({ navigate }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Coming soon</div>
          <h1>Not available yet</h1>
          <p className="sub">This feature is being prepared and will unlock soon.</p>
        </div>
      </div>
      <Empty
        icon="Sparkles"
        title="Coming soon"
        body="We're focused on shipping core hosting first. This area will be available in an upcoming release."
        action={
          <button className="btn btn-primary" onClick={() => navigate({ view: "hosting-list" })}>
            Go to hosting
          </button>
        }
      />
    </>
  );
}

function SimplePage({ title, body }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Workspace</div>
          <h1>{title}</h1>
          <p className="sub">{body}</p>
        </div>
      </div>
      <Empty icon="Sparkles" title="Surface in progress" body="This panel is on the roadmap for the next sprint." />
    </>
  );
}

function BillingPageIntegrated() {
  const { billing, loading, source, error } = useBilling();
  const plan = billing.subscription.plan;
  const renewalDate = billing.subscription.currentPeriodEnd
    ? new Date(billing.subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Not scheduled';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Billing</div>
          <h1>Plan &amp; invoices</h1>
          <p className="sub">Manage your subscription, payment method, and download past invoices.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline">Download invoices</button>
          <button className="btn btn-primary">Manage plan</button>
        </div>
      </div>

      {source === "api" && (
        <div className="card" style={{ padding: "10px 14px", fontSize: 13 }}>
          <span className="row" style={{ gap: 8 }}><ICN.Server size={14} /> Local workspace</span>
        </div>
      )}
      {error && (
        <div className="card" style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-muted)" }}>
          Showing local workspace billing.
        </div>
      )}

      <div className="grid-side">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="row between">
              <div>
                <div className="page-eyebrow" style={{ marginBottom: 6 }}>Current plan</div>
                <div className="row" style={{ gap: 12 }}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 36, lineHeight: 1 }}>{plan.name}</span>
                  <Badge tone={billing.subscription.status === "active" ? "success" : "warn"}>{billing.subscription.status}</Badge>
                </div>
                <div className="muted" style={{ marginTop: 8 }}>
                  {formatMoney(plan.priceMonthlyCents, plan.currency)} / month - {billing.subscription.seats} seats - renews {renewalDate}
                </div>
              </div>
              <button className="btn btn-outline">Change plan</button>
            </div>
          </div>

          <div className="card card-flush">
            <div className="card-head"><h2>Invoices</h2></div>
            <table className="tbl">
              <thead><tr><th>ID</th><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>Loading invoices...</td></tr>
                ) : billing.invoices.map((invoice) => (
                  <tr key={invoice.id || invoice.number}>
                    <td className="mono">{invoice.number}</td>
                    <td>{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString() : '-'}</td>
                    <td>{invoice.description || 'Subscription invoice'}</td>
                    <td>{formatMoney(invoice.amountPaidCents || invoice.amountDueCents, invoice.currency)}</td>
                    <td><StatusBadge value={invoice.status} /></td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-sm btn-ghost"><ICN.ExternalLink size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Payment method</h2>
            <div className="row" style={{ gap: 14, padding: 14, background: "var(--bg-deep)", borderRadius: "var(--r-sm)" }}>
              <ICN.CreditCard size={20} />
              <div style={{ flex: 1 }}>
                <div className="mono">No payment method stored</div>
                <div className="faint" style={{ fontSize: 12 }}>Payment provider integration is next.</div>
              </div>
              <button className="btn btn-sm btn-outline">Update</button>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Usage this period</h2>
            {billing.usage.map((item) => (
              <UsageBar key={item.metric} label={usageLabel(item.metric)} value={item.value} max={item.limit || 1} unit={usageUnit(item.metric)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}


function formatMoney(cents = 0, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
}

function usageLabel(metric) {
  return {
    build_minutes: 'Build minutes',
    bandwidth_gb: 'Bandwidth',
    projects: 'Projects',
    team_members: 'Team members',
  }[metric] || metric;
}

function usageUnit(metric) {
  return {
    build_minutes: 'min',
    bandwidth_gb: 'GB',
  }[metric] || '';
}

function UsageBar({ label, value, max, unit }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row between" style={{ fontSize: 13, marginBottom: 6 }}>
        <span className="muted">{label}</span>
        <span className="mono">{value} / {max} {unit}</span>
      </div>
      <div style={{ height: 6, background: "var(--bg-deep)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: pct > 80 ? "var(--warning)" : "var(--accent)", borderRadius: 999 }} />
      </div>
    </div>
  );
}
