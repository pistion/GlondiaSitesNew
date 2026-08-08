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
import { ProjectWorkspace } from './project-workspace';
import { HostingList, HostingDetail } from './hosting-control';
import { DomainsMine, DomainsBuy, DnsEditor, DomainSettings } from './domains';
import {
  BuilderGallery, BuilderTemplates, BuilderRoxanne, BuilderImport,
  BuilderEditor, BuilderAiIntake, BuilderDeploymentSettings, BuilderSitePlan,
  BuilderProjectShell,
} from './features/builder';
import { ActivityPage } from './activity';
import BillingPage from './features/billing/BillingPage.jsx';
import ProfilePage from './features/profile/ProfilePage.jsx';
import EmailManagementPage from './features/email/EmailManagementPage.jsx';
import { MailboxesPage, MailboxSettingsPage } from './features/email/MailboxesPage.jsx';
import GlondiaMailApp from './features/glondia-mail/GlondiaMailApp.jsx';
import { VpsHostingList, VpsCreateWizard, VpsDetail } from './vps-hosting';
import { CloudStorageList, CloudStorageCreate, CloudStorageDetail, CloudDriveDashboard } from './cloud-storage';
import SupportPage from './features/tickets/TicketsPage.jsx';
import ServiceSandboxPage from './features/sandbox/ServiceSandboxPage.jsx';
import { isFeatureEnabled } from './app/features.js';
import { notifyDataChanged } from './api';
import { isAuthenticated, clearAuthSession, getStoredAuth, storeAuthSession, restoreSession, watchAccessTokenExpiry, AUTH_CHANGED_EVENT, login as authLogin } from './api/auth.js';
import { isLiveMode } from './app/config.js';
import { isViewComingSoon } from './app/features.js';
import LoginPage from './features/auth/LoginPage.jsx';
import SignupPage from './features/auth/SignupPage.jsx';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": (() => { try { return localStorage.getItem('glondia-theme') || 'dark'; } catch { return 'dark'; } })(),
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

const CLIENT_ROUTE_PREFIX = 'client';
const VIEW_TO_PATH = {
  overview: '',
  'hosting-list': 'hosting',
  'domains-mine': 'domains',
  'domains-buy': 'domains/buy',
  'builder-gallery': 'site-builder',
  activity: 'activity',
  billing: 'billing',
  sandbox: 'sandbox',
  email: 'email',
  'email-mailboxes': 'email/mailboxes',
  profile: 'profile',
  settings: 'settings',
  'vps-hosting': 'vps-services',
  'vps-create': 'vps-services/new',
  'cloud-storage': 'cloud-storage',
  'cloud-storage-create': 'cloud-storage/new',
  support: 'support',
};

const PATH_TO_VIEW = {
  '': 'overview',
  hosting: 'hosting-list',
  domains: 'domains-mine',
  'domains/buy': 'domains-buy',
  'site-builder': 'builder-gallery',
  activity: 'activity',
  billing: 'billing',
  sandbox: 'sandbox',
  email: 'email',
  'email/mailboxes': 'email-mailboxes',
  profile: 'profile',
  settings: 'settings',
  'vps-services': 'vps-hosting',
  'vps-services/new': 'vps-create',
  'cloud-storage': 'cloud-storage',
  'cloud-storage/new': 'cloud-storage-create',
  'cloud-servers': 'vps-hosting',
  'cloud-servers/new': 'vps-create',
  support: 'support',
};

function accountClientId(user = getStoredAuth().user) {
  const raw = user?.clientId || user?.id || '';
  return String(raw).trim().replace(/[^a-zA-Z0-9_-]/g, '');
}

function accountPathFor(route, user = getStoredAuth().user) {
  const clientId = accountClientId(user);
  if (!clientId || !route || route.view === 'login' || route.view === 'signup') return null;

  if (route.view === 'project-workspace' && route.params?.projectId) {
    const tab = route.params.tab || 'overview';
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/projects/${encodeURIComponent(route.params.projectId)}/${encodeURIComponent(tab)}`;
  }

  if (route.view === 'hosting-detail' && route.params?.id) {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/hosting/${encodeURIComponent(route.params.id)}`;
  }
  if (route.view === 'dns' && route.params?.domain) {
    const section = route.params?.section === 'settings' ? 'settings' : 'records';
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/domains/${encodeURIComponent(route.params.domain)}/${section}`;
  }
  if (route.view === 'builder-editor' && (route.params?.siteId || route.params?.id)) {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/editor/${encodeURIComponent(route.params.siteId || route.params.id)}`;
  }
  if (route.view === 'builder-ai-intake') {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/setup`;
  }
  if (route.view === 'builder-site-plan') {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/plan`;
  }
  if (route.view === 'builder-deployment-settings') {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/deploy`;
  }
  if (route.view === 'builder-project') {
    const base = `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/projects`;
    if (!route.params?.projectId) return base;
    const step = route.params.step || 'plan';
    return `${base}/${encodeURIComponent(route.params.projectId)}/${encodeURIComponent(step)}`;
  }
  if (route.view === 'builder-templates') {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/templates`;
  }
  if (route.view === 'builder-roxanne') {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/site-builder/roxanne`;
  }
  if (route.view === 'builder-import') {
    const mode = route.params?.mode === 'zip' ? 'zip-upload' : 'github-upload';
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/hosting/${mode}`;
  }
  if (route.view === 'vps-detail' && route.params?.id) {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/vps-services/${encodeURIComponent(route.params.id)}`;
  }
  if (route.view === 'cloud-storage-detail' && route.params?.id) {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/cloud-storage/${encodeURIComponent(route.params.id)}`;
  }
  if (route.view === 'cloud-drive' && route.params?.id) {
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/cloud-storage/${encodeURIComponent(route.params.id)}/drive`;
  }
  if (route.view === 'email-mailbox-detail' && route.params?.id) {
    const tab = route.params.tab || 'overview';
    return `/${CLIENT_ROUTE_PREFIX}/${clientId}/email/mailboxes/${encodeURIComponent(route.params.id)}/${encodeURIComponent(tab)}`;
  }

  const suffix = VIEW_TO_PATH[route.view];
  if (suffix === undefined) return `/${CLIENT_ROUTE_PREFIX}/${clientId}`;
  return suffix ? `/${CLIENT_ROUTE_PREFIX}/${clientId}/${suffix}` : `/${CLIENT_ROUTE_PREFIX}/${clientId}`;
}

function routeFromAccountPath(pathname = window.location.pathname) {
  const parts = String(pathname || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts[0] !== CLIENT_ROUTE_PREFIX || !parts[1]) return null;
  const rest = parts.slice(2).map((p) => decodeURIComponent(p));
  const key = rest.join('/');

  if (rest[0] === 'projects' && rest[1]) return { view: 'project-workspace', params: { projectId: rest[1], tab: rest[2] || 'overview' } };

  if (key === 'hosting/github-upload') return { view: 'builder-import', params: { mode: 'github' } };
  if (key === 'hosting/zip-upload') return { view: 'builder-import', params: { mode: 'zip' } };
  if (rest[0] === 'hosting' && rest[1]) return { view: 'hosting-detail', params: { id: rest[1] } };
  if (rest[0] === 'domains' && rest[1] && ['dns', 'records', 'settings'].includes(rest[2])) {
    return { view: 'dns', params: { domain: rest[1], section: rest[2] === 'settings' ? 'settings' : 'records' } };
  }
  if (rest[0] === 'email' && rest[1] === 'mailboxes' && rest[2]) {
    return { view: 'email-mailbox-detail', params: { id: rest[2], tab: rest[3] || 'overview' } };
  }
  if (rest[0] === 'site-builder' && rest[1] === 'projects') {
    if (rest[2]) return { view: 'builder-project', params: { projectId: rest[2], step: rest[3] || 'plan' } };
    return { view: 'builder-project', params: {} };
  }
  if (key === 'site-builder/templates') return { view: 'builder-templates' };
  if (key === 'site-builder/roxanne') return { view: 'builder-roxanne' };
  if (key === 'site-builder/import') return { view: 'builder-import', params: { mode: 'github' } };
  if (key === 'site-builder/setup') return { view: 'builder-ai-intake' };
  if (key === 'site-builder/plan') return { view: 'builder-site-plan' };
  if (key === 'site-builder/deploy') return { view: 'builder-deployment-settings' };
  if (rest[0] === 'site-builder' && rest[1] === 'editor' && rest[2]) return { view: 'builder-editor', params: { id: rest[2], siteId: rest[2] } };
  if ((rest[0] === 'vps-services' || rest[0] === 'cloud-servers') && rest[1] && rest[1] !== 'new') return { view: 'vps-detail', params: { id: rest[1] } };
  if (rest[0] === 'cloud-storage' && rest[1] && rest[2] === 'drive') return { view: 'cloud-drive', params: { id: rest[1] } };
  if (rest[0] === 'cloud-storage' && rest[1] && rest[1] !== 'new') return { view: 'cloud-storage-detail', params: { id: rest[1] } };

  return { view: PATH_TO_VIEW[key] || 'overview' };
}

function clientIdFromPath(pathname = window.location.pathname) {
  const parts = String(pathname || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return parts[0] === CLIENT_ROUTE_PREFIX ? parts[1] || '' : '';
}

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

/** Root entry: GlondiaMail is a separate full-page app; everything else is the client dashboard. */
export default function App() {
  const path = String(window.location.pathname || '/').replace(/\/+$/, '') || '/';
  // Separate Mailboxes webmail (same site, not dashboard shell).
  if (path === '/mailboxes' || path === '/glondiamail' || path === '/mail') {
    if (!isFeatureEnabled('glondiaMail')) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="card" style={{ padding: 28, maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ marginTop: 0 }}>GlondiaMail</h1>
            <p className="muted">This feature is not enabled.</p>
            <a className="btn btn-primary" href="/">Back to Glondia</a>
          </div>
        </div>
      );
    }
    return <GlondiaMailApp />;
  }
  return <ClientDashboardApp />;
}

function ClientDashboardApp() {
  const [route, setRoute] = useStateApp(() => routeFromAccountPath() || { view: "login" });
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [githubBanner, setGithubBanner] = useStateApp(null);
  const [authed, setAuthed] = useStateApp(false);
  const [authReady, setAuthReady] = useStateApp(!isLiveMode());
  // Mobile sidebar drawer open/closed (desktop ignores this).
  const [mobileNavOpen, setMobileNavOpen] = useStateApp(false);

  useEffectApp(() => {
    const sync = () => {
      setAuthed(isAuthenticated());
      setAuthReady(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, sync);
  }, []);

  useEffectApp(() => {
    if (!isLiveMode()) return undefined;
    return watchAccessTokenExpiry();
  }, []);

  useEffectApp(() => {
    if (!isLiveMode()) return;
    let alive = true;
    let retryTimer = null;
    const verify = () => restoreSession({ attempts: 5 })
      .then((user) => {
        if (!alive) return;
        setAuthed(Boolean(user));
        setAuthReady(true);
      })
      .catch((error) => {
        if (!alive) return;
        console.error('[auth] session restore delayed:', error.message);
        setAuthReady(false);
        retryTimer = window.setTimeout(verify, 2500);
      });
    verify();
    return () => { alive = false; if (retryTimer) window.clearTimeout(retryTimer); };
  }, []);

  useEffectApp(() => {
    const onPop = () => setRoute(routeFromAccountPath() || (isAuthenticated() ? { view: 'overview' } : { view: 'login' }));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffectApp(() => {
    if (!authed) return;
    const user = getStoredAuth().user;
    const expectedClientId = accountClientId(user);
    if (!expectedClientId) return;
    const pathClientId = clientIdFromPath();
    if (!pathClientId || pathClientId !== expectedClientId) {
      navigate(route.view === 'login' || route.view === 'signup' ? { view: 'overview' } : route, { user, replace: true });
    }
  }, [authed, route.view, route.params?.id, route.params?.domain]);

  // ── Demo-mode auto-login ────────────────────────────────────────────────────
  // In local dev (non-live mode) skip the login screen entirely.
  // Any credentials work in demo mode — this just saves the click.
  useEffectApp(() => {
    if (!isLiveMode() && !isAuthenticated()) {
      authLogin('dev@glondia.local', 'devpass').then(() => {
        setAuthed(true);
        // Preserve a deep-linked route (e.g. a builder project URL) so refresh
        // resumes where the customer was instead of bouncing to the gallery.
        navigate(routeFromAccountPath() || { view: 'builder-gallery' }, { replace: true });
      }).catch(() => {});
    } else if (!isLiveMode() && isAuthenticated()) {
      navigate(routeFromAccountPath() || { view: 'builder-gallery' }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme/accent/density to root
  useEffectApp(() => { document.documentElement.dataset.theme = t.theme; }, [t.theme]);
  useEffectApp(() => { document.documentElement.dataset.density = t.density; }, [t.density]);
  useEffectApp(() => { applyAccent(t.accent); }, [t.accent]);
  useEffectApp(() => { applyFontPair(t.fontPair); }, [t.fontPair]);

  // GitHub OAuth callback — handle both repo-connect and sign-in flows.
  useEffectApp(() => {
    const params = new URLSearchParams(window.location.search);
    const clean = new URL(window.location.href);
    clean.search = '';

    // Sign-in via GitHub OAuth
    if (params.get('github_auth') === '1') {
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const ghLogin      = params.get('github_login') || '';
      let   user         = null;
      try { user = JSON.parse(params.get('user') || 'null'); } catch {}
      window.history.replaceState({}, '', clean.toString());
      if (accessToken) {
        storeAuthSession({ tokens: { accessToken, refreshToken }, user });
        setGithubBanner(ghLogin ? `Signed in with GitHub as @${ghLogin}` : 'Signed in with GitHub');
        navigate({ view: 'overview' }, { user, replace: true });
        const t = setTimeout(() => setGithubBanner(null), 5000);
        return () => clearTimeout(t);
      }
    }

    // Sign-in via Google OAuth
    if (params.get('google_auth') === '1') {
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      let   user         = null;
      try { user = JSON.parse(params.get('user') || 'null'); } catch {}
      window.history.replaceState({}, '', clean.toString());
      if (accessToken) {
        storeAuthSession({ tokens: { accessToken, refreshToken }, user });
        setGithubBanner(`Signed in with Google${user?.name ? ` as ${user.name}` : ''}`);
        navigate({ view: 'overview' }, { user, replace: true });
        const t = setTimeout(() => setGithubBanner(null), 5000);
        return () => clearTimeout(t);
      }
    }

    // Auth error from GitHub
    if (params.get('auth_error')) {
      const msg = params.get('auth_error') || 'GitHub sign-in failed.';
      window.history.replaceState({}, '', clean.toString());
      setGithubBanner(`Sign-in failed: ${msg}`);
      const t = setTimeout(() => setGithubBanner(null), 7000);
      return () => clearTimeout(t);
    }

    // Repo-connect callback (existing behaviour)
    if (params.get('github_connected') === '1') {
      const login = params.get('login') || '';
      setGithubBanner(login ? `GitHub connected as @${login}.` : 'GitHub connected successfully.');
      window.history.replaceState({}, '', clean.toString());
      setRoute({ view: 'hosting-list' });
      notifyDataChanged();
      const t = setTimeout(() => setGithubBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffectApp(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [route.view, route.params?.id]);

  const commitNavigation = (r, options = {}) => {
    const fromPath = window.location.pathname;
    setRoute(r);
    const nextPath = accountPathFor(r, options.user);
    if (nextPath && nextPath !== window.location.pathname) {
      const nextUrl = `${nextPath}${window.location.search || ''}`;
      if (options.replace) window.history.replaceState({}, '', nextUrl);
      else window.history.pushState({}, '', nextUrl);
    }
    window.dispatchEvent(new CustomEvent('glondia:ux-navigation', { detail: { fromPath, toPath: window.location.pathname, service: r.view } }));
  };
  const navigate = (r, options = {}) => {
    const navigationEvent = new CustomEvent('glondia:before-navigation', {
      cancelable: true,
      detail: {
        target: r,
        continueNavigation: () => commitNavigation(r, options),
      },
    });
    if (!window.dispatchEvent(navigationEvent)) return;
    commitNavigation(r, options);
  };
  const toggleTheme = () => setTweak("theme", t.theme === "dark" ? "light" : "dark");

  const DASHBOARD_VIEWS = new Set([
    "overview","project-workspace","hosting-list","hosting-detail","domains-mine","domains-buy","dns",
    "builder-gallery","builder-templates","builder-roxanne","builder-import","builder-editor","builder-ai-intake","builder-deployment-settings","builder-site-plan","builder-project",
    "analytics","activity","billing","sandbox","email","email-mailboxes","email-mailbox-detail","settings","profile","vps-hosting","vps-create","vps-detail",
    "cloud-storage","cloud-storage-create","cloud-storage-detail","cloud-drive",
    "support",
  ]);

  // Render — in demo/dev mode skip auth gate entirely; real JWT check only in live mode
  const isAuthBlocked = isLiveMode() && DASHBOARD_VIEWS.has(route.view) && (!authReady || !authed);

  const renderView = () => {
    if (isAuthBlocked) {
      if (!authReady) return <div className="auth-page"><div className="auth-shell"><main className="auth-card"><div className="auth-card-body">Restoring your secure session…</div></main></div></div>;
      return <LoginPage navigate={navigate} />;
    }

    // Non-MVP surfaces are gated behind Coming Soon instead of broken pages.
    if (isViewComingSoon(route.view)) return <ComingSoon navigate={navigate} />;

    switch (route.view) {
      case "login":             return authed ? (() => { navigate({ view: 'overview' }, { replace: true }); return null; })() : <LoginPage navigate={navigate} />;
      case "signup":            return authed ? (() => { navigate({ view: 'overview' }, { replace: true }); return null; })() : <SignupPage navigate={navigate} />;
      case "overview":          return <Overview navigate={navigate} />;
      case "project-workspace": return <ProjectWorkspace projectId={route.params?.projectId} initialTab={route.params?.tab || 'overview'} navigate={navigate} />;
      case "hosting-list":      return <HostingList navigate={navigate} />;
      case "hosting-detail":    return <HostingDetail id={route.params?.id} navigate={navigate} />;
      case "domains-mine":      return <DomainsMine navigate={navigate} />;
      case "domains-buy":       return <DomainsBuy navigate={navigate} />;
      case "dns":               return route.params?.section === 'settings'
        ? <DomainSettings domain={route.params?.domain || ""} navigate={navigate} />
        : <DnsEditor domain={route.params?.domain || ""} navigate={navigate} />;
      case "builder-gallery":   return <BuilderGallery navigate={navigate} />;
      case "builder-project":   return <BuilderProjectShell projectId={route.params?.projectId || null} step={route.params?.step || "plan"} navigate={navigate} />;
      case "builder-templates": return <BuilderTemplates navigate={navigate} />;
      case "builder-roxanne":   return <BuilderRoxanne navigate={navigate} />;
      case "builder-import":    return <BuilderImport mode={route.params?.mode || "github"} hostingTarget={route.params?.hostingTarget || "shared"} dedicatedPlan={route.params?.dedicatedPlan || null} initialProjectId={route.params?.projectId || ''} navigate={navigate} />;
      case "builder-ai-intake":              return <BuilderAiIntake templateId={route.params?.templateId || ""} templateType={route.params?.templateType || "html"} navigate={navigate} />;
      case "builder-site-plan":              return <BuilderSitePlan templateId={route.params?.templateId || ""} templateType={route.params?.templateType || "repo-template"} navigate={navigate} />;
      case "builder-deployment-settings":    return <BuilderDeploymentSettings siteId={route.params?.siteId || null} templateId={route.params?.templateId || ""} templateType={route.params?.templateType || "html"} navigate={navigate} />;
      case "builder-editor":                 return <BuilderEditor id={route.params?.id} siteId={route.params?.siteId} navigate={navigate} />;
      case "analytics":         return <SimplePage title="Analytics" body="Cross-project analytics — coming up next." />;
      case "activity":          return <ActivityPage />;
      case "billing":           return <BillingPage navigate={navigate} />;
      case "sandbox":           return <ServiceSandboxPage navigate={navigate} />;
      case "email":             return <EmailManagementPage navigate={navigate} />;
      case "email-mailboxes":    return <MailboxesPage navigate={navigate} />;
      case "email-mailbox-detail": return <MailboxSettingsPage mailboxId={route.params?.id} initialTab={route.params?.tab || 'overview'} navigate={navigate} />;
      case "profile":           return <ProfilePage navigate={navigate} theme={t.theme} onThemeChange={(v) => { setTweak('theme', v); try { localStorage.setItem('glondia-theme', v); } catch {} }} />;
      case "settings":          return <SimplePage title="Settings" body="Workspace settings — coming up next." />;
      case "vps-hosting":       return <VpsHostingList navigate={navigate} />;
      case "vps-create":        return <VpsCreateWizard navigate={navigate} initialPlan={route.params?.plan || ''} initialPlanType={route.params?.planType || ''} initialProjectId={route.params?.projectId || ''} />;
      case "vps-detail":        return <VpsDetail id={route.params?.id} navigate={navigate} />;
      case "cloud-storage":     return <CloudStorageList navigate={navigate} />;
      case "cloud-storage-create": return <CloudStorageCreate navigate={navigate} initialKind={route.params?.kind || 'postgres'} initialProjectId={route.params?.projectId || ''} />;
      case "cloud-storage-detail": return <CloudStorageDetail id={route.params?.id} navigate={navigate} />;
      case "cloud-drive":         return <CloudDriveDashboard id={route.params?.id} navigate={navigate} />;
      case "support":           return <SupportPage initialTicketId={route.params?.ticketId || null} />;
      default:
        window.location.href = "/";
        return null;
    }
  };

  // Sidebar key
  const activeKey = (() => {
    if (route.view === 'project-workspace') return 'overview';
    if (route.view.startsWith("hosting")) return "hosting";
    if (route.view === "builder-import") return "hosting";
    if (route.view.startsWith("vps")) return "vps-hosting";
    if (route.view.startsWith("cloud-storage")) return "cloud-storage";
    if (route.view === "support") return "support";
    if (route.view === "domains-mine") return "domains";
    if (route.view === "domains-buy") return "buy";
    if (route.view === "dns") return "domains";
    if (route.view === "email-mailboxes" || route.view === "email-mailbox-detail") return "email-mailboxes";
    if (route.view === "email") return "email";
    if (route.view.startsWith("builder")) return "builder";
    return route.view;
  })();

  const crumbs = (() => {
    switch (route.view) {
      case "overview":        return [{ label: "Workspace" }, { label: "Overview" }];
      case "project-workspace": return [{ label: "Projects", onClick: () => navigate({ view: "overview" }) }, { label: route.params?.projectId || "Project" }, { label: route.params?.tab || "Overview" }];
      case "hosting-list":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Hosting" }];
      case "hosting-detail":  return [{ label: "Hosting", onClick: () => navigate({ view: "hosting-list" }) }, { label: route.params?.id || "project" }];
      case "domains-mine":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "My domains" }];
      case "domains-buy":     return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Buy a domain" }];
      case "dns":             return [{ label: "My domains", onClick: () => navigate({ view: "domains-mine" }) }, { label: route.params?.domain || "Domain" }, { label: route.params?.section === 'settings' ? "Settings" : "Records" }];
      case "builder-gallery":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Site builder" }];
      case "builder-ai-intake":           return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Template setup" }];
      case "builder-site-plan":           return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Plan" }];
      case "builder-deployment-settings": return [{ label: "Template setup", onClick: () => navigate({ view: "builder-ai-intake" }) }, { label: "Deploy" }];
      case "builder-templates": return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "Choose templates" }];
      case "builder-roxanne": return [{ label: "Site builder", onClick: () => navigate({ view: "builder-gallery" }) }, { label: "RoxanneAI" }];
      case "builder-import":  return [{ label: "Hosting", onClick: () => navigate({ view: "hosting-list" }) }, { label: route.params?.mode === "zip" ? "ZIP upload" : "GitHub upload" }];
      case "builder-editor":  return [{ label: "Templates", onClick: () => navigate({ view: "builder-templates" }) }, { label: "Editor" }];
      case "billing":         return [{ label: "Workspace" }, { label: "Billing" }];
      case "sandbox":         return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Service Sandbox" }];
      case "email":           return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Business Email" }];
      case "email-mailboxes":  return [{ label: "Business Email", onClick: () => navigate({ view: "email" }) }, { label: "My emails" }];
      case "email-mailbox-detail": return [{ label: "Business Email", onClick: () => navigate({ view: "email" }) }, { label: "My emails", onClick: () => navigate({ view: "email-mailboxes" }) }, { label: "Mailbox settings" }];
      case "profile":         return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Profile" }];
      case "vps-hosting":    return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "VPS Services" }];
      case "vps-create":     return [{ label: "VPS Services", onClick: () => navigate({ view: "vps-hosting" }) }, { label: "New server" }];
      case "vps-detail":     return [{ label: "VPS Services", onClick: () => navigate({ view: "vps-hosting" }) }, { label: route.params?.id || "Server" }];
      case "cloud-storage":  return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Cloud Storage" }];
      case "cloud-storage-create": return [{ label: "Cloud Storage", onClick: () => navigate({ view: "cloud-storage" }) }, { label: "New service" }];
      case "cloud-storage-detail": return [{ label: "Cloud Storage", onClick: () => navigate({ view: "cloud-storage" }) }, { label: route.params?.id || "Service" }];
      case "support":        return [{ label: "Workspace", onClick: () => navigate({ view: "overview" }) }, { label: "Contact support" }];
      default:                return [{ label: "Workspace" }];
    }
  })();

  const isFullPageView = route.view === "login" || route.view === "signup" || route.view === "cloud-drive" || isAuthBlocked;

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
            <DashSidebar
              active={activeKey}
              navigate={(r) => { navigate(r); setMobileNavOpen(false); }}
              mobileOpen={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
            />
            {mobileNavOpen && <button className="dash-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
            <main className="dash-main">
              <DashTopbar crumbs={crumbs} navigate={navigate} theme={t.theme} toggleTheme={toggleTheme} onOpenNav={() => setMobileNavOpen(true)} />
              <div key={route.view} className="dash-body dashboard-view-enter">
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
