// dashboard-search.jsx — topbar command-palette search for the client dashboard.
//
// Self-contained: owns its open/query state, loads the same account records the
// dashboard pages render (projects, registrar domains, VPS services), and
// navigates with the router's route objects. Mounted by DashTopbar.
import React from 'react';
import { createPortal } from 'react-dom';
import { ICN } from './icons';
import {
  apiRequest,
  getRegistrarSettings,
  getStoredAuth,
  listRegisteredDomains,
  mapApiDomain,
  mapApiProject,
} from './api';
import { listVpsServices } from './api/vultr.js';
import { GD } from './data';
import { isFeatureEnabled } from './app/features.js';
import { isLiveMode } from './app/config.js';
import { DASH_NAV } from './components';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const MAX_PER_GROUP = 6;

// ── Data sources ──────────────────────────────────────────────────────────────
// Each fetch mirrors the page that renders the same records (use-projects.js,
// use-domains.js, VpsHostingList) so search never shows anything the dashboard
// itself would not show. Feature-disabled sources resolve to empty lists.

async function fetchSearchProjects() {
  const { accessToken } = getStoredAuth();
  // Same source the hosting pages use: API when signed in, demo store otherwise.
  if (!accessToken) return GD.projects;
  const projects = await apiRequest('/projects');
  return (Array.isArray(projects) ? projects : []).map(mapApiProject);
}

async function fetchSearchDomains() {
  if (!isFeatureEnabled('domains')) return [];
  if (isLiveMode()) {
    // Registrar inventory only — never demo domains in live mode (see use-domains.js).
    try {
      const settings = await getRegistrarSettings();
      if (!settings?.configured) return [];
    } catch {
      return [];
    }
    const result = await listRegisteredDomains(0, 100);
    const items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
    return items.map(mapApiDomain);
  }
  const { accessToken } = getStoredAuth();
  if (!accessToken) return [];
  const domains = await apiRequest('/domains');
  return (Array.isArray(domains) ? domains : []).map(mapApiDomain);
}

async function fetchSearchServers() {
  if (!isFeatureEnabled('vps')) return [];
  if (!getStoredAuth().accessToken) return [];
  const list = await listVpsServices();
  return Array.isArray(list) ? list : [];
}

/** Loads searchable records once per palette open (the palette unmounts on close). */
function useSearchRecords() {
  const [state, setState] = useState({
    projects: [],
    domains: [],
    servers: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchSearchProjects(), fetchSearchDomains(), fetchSearchServers()])
      .then(([projects, domains, servers]) => {
        if (cancelled) return;
        setState({
          projects: projects.status === 'fulfilled' ? projects.value : [],
          domains: domains.status === 'fulfilled' ? domains.value : [],
          servers: servers.status === 'fulfilled' ? servers.value : [],
          loading: false,
          error: [projects, domains, servers].some((r) => r.status === 'rejected'),
        });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}

// ── Result building ───────────────────────────────────────────────────────────

/** Sidebar destinations, filtered by the same feature flags as DashSidebar. */
function navSearchItems() {
  const items = [];
  DASH_NAV.forEach((group) => {
    group.items.forEach((item) => {
      if (item.feature && !isFeatureEnabled(item.feature)) return;
      items.push({
        key: `nav-${item.key}`,
        icon: item.icon,
        title: item.label,
        sub: 'Navigation',
        route: item.route,
      });
    });
  });
  return items;
}

function matches(query, ...fields) {
  return fields.some((f) => String(f || '').toLowerCase().includes(query));
}

function buildGroups(query, { projects, domains, servers }) {
  const q = query.trim().toLowerCase();
  const nav = navSearchItems();

  if (!q) {
    // Initial state: quick links to the dashboard's own destinations.
    return [{ label: 'Go to', items: nav }];
  }

  const groups = [];

  const projectItems = projects
    .filter((p) => matches(q, p.name, p.domain, p.customDomain, p.repo, p.projectCode))
    .slice(0, MAX_PER_GROUP)
    .map((p) => ({
      key: `project-${p.id}`,
      icon: 'Server',
      title: p.name,
      sub: `Hosting project · ${p.status}`,
      route: { view: 'hosting-detail', params: { id: p.id } },
    }));
  if (projectItems.length) groups.push({ label: 'Projects', items: projectItems });

  const domainItems = domains
    .filter((d) => matches(q, d.name, d.rootDomain))
    .slice(0, MAX_PER_GROUP)
    .map((d) => ({
      key: `domain-${d.id}`,
      icon: 'Globe',
      title: d.name,
      sub: `Domain · ${d.status}`,
      route: { view: 'dns', params: { domain: d.name } },
    }));
  if (domainItems.length) groups.push({ label: 'Domains', items: domainItems });

  const serverItems = servers
    .filter((s) => matches(q, s.label, s.hostname, s.mainIp))
    .slice(0, MAX_PER_GROUP)
    .map((s) => ({
      key: `vps-${s.id}`,
      icon: 'Cpu',
      title: s.label || s.hostname || s.id,
      sub: `VPS service · ${s.status || 'Unknown'}`,
      route: { view: 'vps-detail', params: { id: s.id } },
    }));
  if (serverItems.length) groups.push({ label: 'VPS services', items: serverItems });

  const navItems = nav.filter((n) => matches(q, n.title)).slice(0, MAX_PER_GROUP);
  if (navItems.length) groups.push({ label: 'Navigation', items: navItems });

  return groups;
}

// ── Palette (portal) ──────────────────────────────────────────────────────────

function SearchPalette({ navigate, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const { projects, domains, servers, loading, error } = useSearchRecords();

  const groups = useMemo(
    () => buildGroups(query, { projects, domains, servers }),
    [query, projects, domains, servers],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || loading) return undefined;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('glondia:ux-search', { detail: {
        query: q.slice(0, 120),
        resultCount: flat.length,
        resultTypes: groups.map((group) => group.label).slice(0, 10),
      } }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [query, loading, flat.length, groups]);

  // Keep the keyboard selection in view while arrowing through results.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = useCallback((item) => {
    onClose();
    navigate(item.route);
  }, [navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[selected]) pick(flat[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const q = query.trim();
  const searching = q.length > 0;
  const showSkeleton = searching && loading;
  const showNoResults = searching && !loading && flat.length === 0 && q.length >= 2;
  const showKeepTyping = searching && !loading && flat.length === 0 && q.length < 2;

  let index = -1;

  return createPortal(
    <div className="gs-root" onKeyDown={onKeyDown}>
      <button type="button" className="gs-overlay" aria-label="Close search" onClick={onClose} tabIndex={-1} />
      <div className="gs-panel anim-slideDown" role="dialog" aria-modal="true" aria-label="Search dashboard">
        <div className="gs-head">
          <ICN.Search size={16} style={{ color: 'var(--text-faint)' }} />
          <label className="sr-only" htmlFor="gs-input">Search dashboard</label>
          <input
            id="gs-input"
            ref={inputRef}
            className="gs-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="gs-results"
            aria-activedescendant={flat[selected] ? `gs-opt-${selected}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search projects, sites, domains…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="gs-headbtn" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear search">
              <ICN.X size={14} />
            </button>
          )}
          <button type="button" className="gs-headbtn" onClick={onClose} aria-label="Close search">
            <kbd className="gs-kbd">Esc</kbd>
          </button>
        </div>

        <div className="gs-body" ref={listRef} id="gs-results" role="listbox" aria-label="Search results">
          {showSkeleton ? (
            <div className="gs-skel-rows" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div className="gs-item" key={i}>
                  <span className="skel" style={{ width: 32, height: 32, borderRadius: 8 }} />
                  <span className="gs-item-main">
                    <span className="skel skel-line" style={{ width: '45%', display: 'block', marginBottom: 6 }} />
                    <span className="skel skel-sm" style={{ width: '65%', display: 'block' }} />
                  </span>
                </div>
              ))}
            </div>
          ) : showNoResults ? (
            <div className="gs-empty">No matching projects, domains or pages found.</div>
          ) : showKeepTyping ? (
            <div className="gs-empty">Keep typing to search your workspace…</div>
          ) : (
            groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div className="gs-group-title" aria-hidden="true">{group.label}</div>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  const Icon = ICN[item.icon] || ICN.Search;
                  return (
                    <button
                      key={item.key}
                      id={`gs-opt-${i}`}
                      type="button"
                      className="gs-item"
                      role="option"
                      aria-selected={i === selected}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => pick(item)}
                    >
                      <span className="gs-item-icon"><Icon size={15} /></span>
                      <span className="gs-item-main">
                        <span className="gs-item-title">{item.title}</span>
                        <span className="gs-item-sub">{item.sub}</span>
                      </span>
                      <ICN.ArrowRight size={13} className="gs-item-arrow" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {error && !loading && (
            <div className="gs-error">
              <ICN.AlertCircle size={14} />
              Some account data could not be loaded. Results may be incomplete.
            </div>
          )}
        </div>

        <div className="gs-foot" aria-hidden="true">
          <span><kbd className="gs-kbd">↑</kbd> <kbd className="gs-kbd">↓</kbd> Navigate</span>
          <span><kbd className="gs-kbd">Enter</kbd> Open</span>
          <span><kbd className="gs-kbd">Esc</kbd> Close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Topbar control ────────────────────────────────────────────────────────────

export function DashboardSearch({ navigate }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const iconBtnRef = useRef(null);
  // Whichever element opened the palette gets focus back when it closes.
  const restoreFocusRef = useRef(null);

  const openPalette = useCallback((source) => {
    restoreFocusRef.current = source || document.activeElement;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    restoreFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          if (!v) restoreFocusRef.current = document.activeElement;
          else restoreFocusRef.current?.focus?.();
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="gs-trigger"
        aria-label="Search dashboard"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'gs-results' : undefined}
        onClick={() => openPalette(triggerRef.current)}
      >
        <ICN.Search size={15} />
        <span className="gs-trigger-text">Search projects, sites, domains…</span>
        <kbd className="gs-kbd gs-trigger-kbd">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      <button
        ref={iconBtnRef}
        type="button"
        className="btn btn-icon btn-ghost gs-iconbtn"
        aria-label="Search dashboard"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'gs-results' : undefined}
        onClick={() => openPalette(iconBtnRef.current)}
      >
        <ICN.Search size={16} />
      </button>
      {open && <SearchPalette navigate={navigate} onClose={close} />}
    </>
  );
}
