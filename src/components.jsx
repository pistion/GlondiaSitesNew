// components.jsx — shared UI primitives: Logo, Badge, Topbar, Sidebar
import React from 'react';
import { ICN } from './icons';
import { clearAuthSession, getStoredAuth, login, register, AUTH_CHANGED_EVENT } from './api';
import { isFeatureEnabled } from './app/features.js';

const { useState } = React;

export function Logo({ compact = false, onClick }) {
  return (
    <a className="logo" href="#" onClick={(e) => { e.preventDefault(); onClick && onClick(); }}
       style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "inherit" }}>
      <span style={{
        width: compact ? 28 : 32, height: compact ? 28 : 32,
        borderRadius: 8,
        background: "var(--accent)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "#fff",
        fontFamily: "var(--serif)", fontWeight: 500, fontSize: compact ? 17 : 20, lineHeight: 1,
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)",
      }}>g</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontWeight: 700, fontSize: compact ? 14 : 15, letterSpacing: "-0.005em" }}>Glondia</span>
        {!compact && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Hosting · Domains · Sites</span>}
      </span>
    </a>
  );
}

export function Badge({ tone = "muted", children, dot = true }) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function StatusBadge({ value }) {
  const v = String(value || "").toLowerCase();
  if (["ready", "active", "success", "connected", "live"].includes(v)) return <Badge tone="success">{value}</Badge>;
  if (["building", "queued", "pending dns", "pending setup", "transferring", "in progress", "needs review", "waiting reply", "preparing"].includes(v)) return <Badge tone="warn">{value}</Badge>;
  if (["preview", "draft", "paused", "queued"].includes(v)) return <Badge tone="info">{value}</Badge>;
  if (["failed", "error", "denied"].includes(v)) return <Badge tone="danger">{value}</Badge>;
  return <Badge tone="muted">{value}</Badge>;
}

export function Avatar({ name, size = 28 }) {
  const initials = name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  // simple stable hue
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%",
      background: `hsl(${h} 35% 88%)`,
      color: `hsl(${h} 35% 28%)`,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, fontWeight: 600, letterSpacing: 0.02 + "em",
      border: "1px solid var(--border)",
    }}>{initials}</span>
  );
}

export const DASH_NAV = [
  {
    title: "Workspace",
    items: [
      { key: "overview",     label: "Overview",       icon: "LayoutDashboard", route: { view: "overview" } },
      { key: "hosting",      label: "Render hosting", icon: "Server",          route: { view: "hosting-list" } },
      { key: "vps-hosting",  label: "Cloud Servers",  icon: "Cpu",             route: { view: "vps-hosting" }, feature: "vps" },
      { key: "domains",      label: "Domains",        icon: "Globe",           route: { view: "domains-mine" }, feature: "domains" },
      { key: "buy",          label: "Buy a domain",   icon: "Cart",            route: { view: "domains-buy" },  indent: true, feature: "domains" },
      { key: "dns",          label: "DNS records",    icon: "Network",         route: { view: "dns" },          indent: true, feature: "domains" },
      { key: "builder",      label: "Site builder",   icon: "Layers",          route: { view: "builder-gallery" } },
    ],
  },
  {
    title: "Manage",
    items: [
      { key: "analytics",  label: "Analytics",      icon: "ChartBar",        route: { view: "analytics" }, feature: "analytics" },
      { key: "activity",   label: "Activity",       icon: "Activity",        route: { view: "activity" }, feature: "activity" },
    ],
  },
  {
    title: "Account",
    items: [
      { key: "billing",    label: "Billing",        icon: "CreditCard",      route: { view: "billing" } },
      { key: "settings",   label: "Settings",       icon: "Settings",        route: { view: "settings" }, feature: "settings" },
    ],
  },
  {
    title: "Administration",
    items: [
      { key: "admin",      label: "Admin",          icon: "ShieldCheck",     route: { view: "admin" }, admin: true },
    ],
  },
];

// Sidebar groups with disabled-feature items removed (and empty groups dropped).
// Admin-only items are hidden unless the current user has the admin role.
function visibleNavGroups({ isAdmin = false } = {}) {
  return DASH_NAV
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.feature && !isFeatureEnabled(item.feature)) return false;
        if (item.admin && !isAdmin) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function DashSidebar({ active, navigate }) {
  const isAdmin = getStoredAuth()?.user?.role === 'admin';
  return (
    <aside className="dash-side">
      <div className="dash-side-head">
        <Logo compact onClick={() => { window.location.href = "/"; }} />
      </div>
      <nav className="dash-side-nav">
        {visibleNavGroups({ isAdmin }).map((group) => (
          <div key={group.title}>
            <div className="dash-side-group-title">{group.title}</div>
            {group.items.map((item) => {
              const Icon = ICN[item.icon];
              const isActive = item.key === active;
              return (
                <a key={item.key}
                   className={`dash-side-link ${isActive ? "active" : ""}`}
                   href="#"
                   style={item.indent ? { paddingLeft: 32 } : undefined}
                   onClick={(e) => { e.preventDefault(); navigate(item.route); }}>
                  <Icon size={item.indent ? 13 : 16} />
                  <span style={item.indent ? { fontSize: 13 } : undefined}>{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="dash-side-foot">
        <div className="help">
          <b>Need a hand?</b>
          <div style={{ color: "var(--text-muted)" }}>Docs, status page, and live support are one click away.</div>
          <button className="btn btn-outline btn-sm" style={{ width: "100%", marginTop: 10 }}>
            <ICN.HelpCircle size={14} /> Help center
          </button>
          {/* LinkedIn */}
          <a href="https://www.linkedin.com/company/glondia" target="_blank" rel="noopener noreferrer"
             className="btn btn-outline btn-sm"
             style={{ width: "100%", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--text-muted)", textDecoration: "none" }}>
            <ICN.LinkedIn size={13} /> Follow on LinkedIn
          </a>
        </div>
      </div>
    </aside>
  );
}

export function DashTopbar({ crumbs = [], onSearch, navigate, theme, toggleTheme }) {
  return (
    <div className="dash-top">
      <div className="crumb" style={{ flex: 1 }}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {c.onClick
              ? <a href="#" onClick={(e) => { e.preventDefault(); c.onClick(); }} style={{ color: "inherit" }}>{c.label}</a>
              : <b>{c.label}</b>}
          </React.Fragment>
        ))}
      </div>
      <div className="row" style={{ position: "relative" }}>
        <ICN.Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-faint)" }} />
        <input className="input" placeholder="Search projects, domains…" style={{ paddingLeft: 34, width: 280, height: 36 }} />
      </div>
      <button className="btn btn-icon btn-ghost" onClick={toggleTheme} title="Toggle theme">
        {theme === "dark" ? <ICN.Sun size={16} /> : <ICN.Moon size={16} />}
      </button>
      <button className="btn btn-icon btn-ghost" title="Notifications"><ICN.Bell size={16} /></button>
      <AuthMenu navigate={navigate} />
    </div>
  );
}

function AuthMenu({ navigate }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState("login");
  const [auth, setAuth] = React.useState(() => getStoredAuth());
  const [form, setForm] = React.useState({ name: "", organizationName: "", email: "", password: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const sync = () => setAuth(getStoredAuth());
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, sync);
  }, []);

  const signedIn = !!auth.accessToken;
  const displayName = auth.user?.name || auth.user?.email || "Account";

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register({ name: form.name, email: form.email, password: form.password, organizationName: form.organizationName });
      setOpen(false);
      setAuth(getStoredAuth());
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-ghost" onClick={() => signedIn ? setOpen(!open) : navigate && navigate({ view: 'login' })} style={{ height: 36, padding: "0 8px" }}>
        <Avatar name={displayName} size={28} />
        <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{signedIn ? displayName : "Sign in"}</span>
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 44, width: 320, zIndex: 80, boxShadow: "var(--shadow)" }}>
          {signedIn ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><div className="label">Signed in</div><div style={{ fontWeight: 600 }}>{displayName}</div><div className="faint" style={{ fontSize: 12 }}>{auth.user?.email}</div></div>
              <button className="btn btn-outline" onClick={() => { clearAuthSession(); setAuth(getStoredAuth()); setOpen(false); window.location.href = "/"; }}>Sign out</button>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row between"><h2 style={{ margin: 0 }}>{mode === "login" ? "Sign in" : "Create account"}</h2><button type="button" className="btn btn-sm btn-ghost" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>{mode === "login" ? "Register" : "Login"}</button></div>
              {mode === "register" && <><div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div><div><label className="label">Organization</label><input className="input" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} required /></div></>}
              <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div><label className="label">Password</label><input className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Working..." : mode === "login" ? "Sign in" : "Create account"}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function PubNavbar({ navigate }) {
  return (
    <nav className="pub-nav">
      <Logo onClick={() => { window.location.href = "/"; }} />
      <div className="grow" />
      <a className="navlink" href="/#hosting">Hosting</a>
      <a className="navlink" href="/#domains">Domains</a>
      <a className="navlink" href="/#builder">Site builder</a>
      <a className="navlink" href="/#pricing">Pricing</a>
      <a className="navlink" href="#">Docs</a>
      <div style={{ width: 10 }} />
      <button className="btn btn-ghost" onClick={() => navigate({ view: "login" })}>Sign in</button>
      <button className="btn btn-primary" onClick={() => navigate({ view: "signup" })}>Start free <ICN.ArrowRight size={14} /></button>
    </nav>
  );
}

export function Empty({ icon = "Box", title, body, action }) {
  const Icon = ICN[icon];
  return (
    <div className="empty">
      <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--bg-deep)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}><Icon size={20} /></div>
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {body && <div style={{ maxWidth: 40 + "ch" }}>{body}</div>}
      {action}
    </div>
  );
}

export function Tabs({ value, onChange, options }) {
  return <div className="tabs">{options.map((opt) => { const v = typeof opt === "string" ? opt : opt.value; const label = typeof opt === "string" ? opt : opt.label; return <button key={v} className={v === value ? "active" : ""} onClick={() => onChange(v)}>{label}</button>; })}</div>;
}

export function Stat({ k, v, d }) { return <div className="card stat-card"><div className="k">{k}</div><div className="v">{v}</div><div className="d">{d}</div></div>; }

export function ToggleRow({ label, sub, defaultOn }) {
  const [on, setOn] = React.useState(!!defaultOn);
  return (
    <div className="row between" style={{ padding: "12px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{label}</div><div className="muted" style={{ fontSize: 13 }}>{sub}</div></div>
      <button onClick={() => setOn(!on)} style={{ width: 38, height: 22, borderRadius: 999, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: 999, background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.18)" }} />
      </button>
    </div>
  );
}
