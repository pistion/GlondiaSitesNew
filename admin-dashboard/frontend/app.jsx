const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "green",
  "density": "balanced",
  "fontDisplay": "Instrument Serif",
  "showAI": false
}/*EDITMODE-END*/;

const GLONDIA_ICON = "/dashboard-assets/assets/glondia-icon.jpg";
const DEFAULT_REFRESH_INTERVAL_MS = 60000;
const DEFAULT_NOTIFICATION_SUMMARY = { total: 0, unread: 0, read: 0 };
const DEFAULT_MESSAGE_SUMMARY = { total: 0, unread: 0 };

function DashboardLogin({ message, onLogin }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(message || "");

  React.useEffect(() => { setError(message || ""); }, [message]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await window.HEYA_API.loginAdmin(email.trim(), password);
      await onLogin();
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-login">
      <section className="dashboard-login__panel" aria-label="GlondiaSites admin sign in">
        <div className="dashboard-login__intro">
          <div className="dashboard-login__eyebrow">GlondiaSites Admin</div>
          <h1>Control room for customer services.</h1>
          <p>Review accounts, hosting, billing, service access, tickets, and CRM activity from one protected workspace.</p>
        </div>

        <form onSubmit={handleSubmit} className="dashboard-login__card">
          <div className="dashboard-login__brand">
            <div className="dashboard-login__mark">
              <img src={GLONDIA_ICON} alt="" />
            </div>
            <div>
              <div className="dashboard-login__title">Dashboard sign in</div>
              <div className="dashboard-login__subtitle">Administrator access only</div>
            </div>
          </div>

        {error && (
          <div className="dashboard-login__alert" role="alert">
            {error}
          </div>
        )}

          <label className="dashboard-login__field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@glondia.local"
            />
          </label>

          <label className="dashboard-login__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter password"
            />
          </label>

        <button className="dashboard-login__submit" type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in to dashboard"}
        </button>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [authState, setAuthState] = React.useState("checking");
  const [authMessage, setAuthMessage] = React.useState("");
  const [view, setView] = React.useState(() => sessionStorage.getItem("glondia_view") || "dashboard");
  const [settings, setSettings] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarLayer, setSidebarLayer] = React.useState(() => sessionStorage.getItem("glondia_sidebar_layer") || (sessionStorage.getItem("glondia_view") === "crm" ? "crm" : "main"));
  const [dashboardNotifications, setDashboardNotifications] = React.useState([]);
  const [notificationSummary, setNotificationSummary] = React.useState(DEFAULT_NOTIFICATION_SUMMARY);
  const [messages, setMessages] = React.useState([]);
  const [messageSummary, setMessageSummary] = React.useState(DEFAULT_MESSAGE_SUMMARY);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const [messagesOpen, setMessagesOpen] = React.useState(false);
  const [messageModalOpen, setMessageModalOpen] = React.useState(false);
  const [overview, setOverview] = React.useState(null);
  const [crmTab, setCrmTab] = React.useState(() => sessionStorage.getItem("glondia_crm_tab") || "overview");

  React.useEffect(() => { sessionStorage.setItem("glondia_view", view); }, [view]);
  React.useEffect(() => { sessionStorage.setItem("glondia_sidebar_layer", sidebarLayer); }, [sidebarLayer]);
  React.useEffect(() => { sessionStorage.setItem("glondia_crm_tab", crmTab); }, [crmTab]);

  React.useEffect(() => {
    document.documentElement.dataset.accent = tweaks.accent || "green";
    document.documentElement.dataset.density = tweaks.density || "balanced";
  }, [tweaks]);

  const loadInitialData = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setAuthMessage("");
    try {
      await window.HEYA_API.requireAdminSession();
      setAuthState("authenticated");
    } catch (err) {
      setAuthState("login");
      setAuthMessage(err.message || "Admin sign-in required.");
      setLoading(false);
      return;
    }
    const results = await Promise.allSettled([
      window.HEYA_API.getAdminOverview(),
      window.HEYA_API.getSettings(),
      window.HEYA_API.getRecentNotifications(10),
      window.HEYA_API.getRecentMessages(8),
    ]);
    const [overviewResult, settingsResult, notifResult, messagesResult] = results;
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      console.warn("Admin overview unavailable:", overviewResult.reason);
    }
    if (settingsResult.status === "fulfilled") {
      setSettings(settingsResult.value.settings || null);
    }
    if (notifResult.status === "fulfilled") {
      setDashboardNotifications(notifResult.value.notifications || []);
      setNotificationSummary(notifResult.value.summary || DEFAULT_NOTIFICATION_SUMMARY);
    }
    if (messagesResult.status === "fulfilled") {
      setMessages(messagesResult.value.messages || []);
      setMessageSummary(messagesResult.value.summary || DEFAULT_MESSAGE_SUMMARY);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadInitialData(); }, [loadInitialData]);

  React.useEffect(() => {
    if (!settings) return;
    const prefs = settings.accountSettings?.displayPreferences || settings.preferences || {};
    if (prefs.accent) setTweak("accent", prefs.accent);
    if (prefs.density) setTweak("density", prefs.density);
  }, [settings, setTweak]);

  // Background notification/message refresh
  React.useEffect(() => {
    if (loading || authState !== "authenticated") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const [notifData, msgData] = await Promise.allSettled([
          notificationsOpen
            ? window.HEYA_API.getRecentNotifications(10)
            : window.HEYA_API.getNotificationUnreadCount(),
          messagesOpen && !messageModalOpen
            ? window.HEYA_API.getRecentMessages(8)
            : window.HEYA_API.getMessageUnreadCount(),
        ]);
        if (!cancelled) {
          if (notifData.status === "fulfilled") {
            if (notifData.value.notifications) setDashboardNotifications(notifData.value.notifications);
            if (notifData.value.summary) setNotificationSummary(notifData.value.summary);
          }
          if (msgData.status === "fulfilled") {
            if (msgData.value.messages) setMessages(msgData.value.messages);
            if (msgData.value.summary) setMessageSummary(msgData.value.summary);
          }
        }
      } catch { /* silent */ }
      if (!cancelled) timer = window.setTimeout(tick, DEFAULT_REFRESH_INTERVAL_MS);
    };
    let timer = window.setTimeout(tick, DEFAULT_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loading, authState, notificationsOpen, messagesOpen, messageModalOpen]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await window.HEYA_API.logout();
      window.location.href = response.redirectTo || "/dashboard?logged-out=1";
    } catch (err) {
      setError(err.message || "Unable to log out.");
      setLoggingOut(false);
    }
  }

  async function markNotificationRead(id) {
    await window.HEYA_API.markNotificationRead(id);
    setDashboardNotifications((current) =>
      current.map((n) => n.id === id ? { ...n, status: "read" } : n)
    );
    setNotificationSummary((s) => ({ ...s, unread: Math.max(0, (s.unread || 0) - 1) }));
  }

  async function deleteNotification(id) {
    await window.HEYA_API.deleteNotification(id);
    setDashboardNotifications((current) => current.filter((n) => n.id !== id));
  }

  async function refreshAfterMessageAction() {
    try {
      const data = await window.HEYA_API.getRecentMessages(8);
      setMessages(data.messages || []);
      setMessageSummary(data.summary || DEFAULT_MESSAGE_SUMMARY);
    } catch { /* silent */ }
  }

  async function saveSettings(nextSettings) {
    const response = await window.HEYA_API.updateSettings(nextSettings);
    setSettings(response.settings || nextSettings);
    return response.settings;
  }

  async function saveAccountSettings(accountPayload) {
    const response = await window.HEYA_API.updateAccountSettings(accountPayload);
    if (response.settings) {
      setSettings(response.settings);
      return response.settings.accountSettings || response.accountSettings;
    }
    setSettings((current) => current ? { ...current, accountSettings: response.accountSettings || accountPayload } : current);
    return response.accountSettings || accountPayload;
  }

  const [warningCount, setWarningCount] = React.useState(0);
  const [watchdogCount, setWatchdogCount] = React.useState(0);
  const [ticketCount, setTicketCount] = React.useState(0);

  React.useEffect(() => {
    if (loading || authState !== "authenticated") return;
    Promise.allSettled([
      window.HEYA_API.listWarnings({ limit: 1 }),
      window.HEYA_API.listWatchdog({ limit: 1 }),
      window.HEYA_API.listAdminTickets({ limit: 1, status: "open" }),
      window.HEYA_API.listAdminTickets({ limit: 1, status: "pending_admin" }),
    ]).then(([w, wd, tOpen, tPending]) => {
      if (w.status === "fulfilled")  setWarningCount(w.value.total || 0);
      if (wd.status === "fulfilled") setWatchdogCount(wd.value.total || 0);
      const open    = tOpen.status === "fulfilled"    ? (tOpen.value.total || 0)    : 0;
      const pending = tPending.status === "fulfilled" ? (tPending.value.total || 0) : 0;
      setTicketCount(open + pending);
    });
  }, [loading, authState]);

  const counts = React.useMemo(() => ({
    customers:   overview?.users                 || 0,
    deployments: overview?.deployments?.total    || 0,
    orders:      overview?.orders?.pending       || 0,
    receipts:    overview?.receipts?.pending     || 0,
    tickets:     ticketCount,
    warnings:    warningCount,
    watchdog:    watchdogCount,
    unreadMessages: messageSummary.unread || 0,
    _crmTab: crmTab,
  }), [overview, messageSummary, crmTab, warningCount, watchdogCount, ticketCount]);

  if (authState === "login") {
    return <DashboardLogin message={authMessage} onLogin={loadInitialData} />;
  }

  let body;
  if (loading) {
    body = (
      <div className="page">
        <div className="glondia-loading-card">
          <img src={GLONDIA_ICON} alt="" />
          <div>
            <div className="glondia-loading-title">Loading GlondiaSites admin dashboard…</div>
            <div className="glondia-loading-subtitle">Preparing your workspace</div>
          </div>
        </div>
      </div>
    );
  } else if (error) {
    body = <div className="page"><div className="card" style={{ padding: 28, color: "var(--danger)" }}>{error}</div></div>;
  } else {
    switch (view) {
      case "dashboard":
        body = <GlondiaDashboard overview={overview} settings={settings} setView={setView} />;
        break;
      case "customers":
        body = <CustomersView />;
        break;
      case "hosting":
        body = <HostingView />;
        break;
      case "deployments":
        body = <DeploymentsView />;
        break;
      case "domains":
        body = <DomainsView />;
        break;
      case "vps":
        body = <VpsView />;
        break;
      case "email-services":
        body = <EmailServicesView />;
        break;
      case "security-data":
        body = <SecurityDataView />;
        break;
      case "billing":
        body = <BillingView />;
        break;
      case "receipts":
        body = <ReceiptsView />;
        break;
      case "service-access":
        body = window.ServiceAccessView
          ? <window.ServiceAccessView />
          : <div className="page"><div className="card" style={{ padding: 28 }}>Service Access view is not loaded.</div></div>;
        break;
      case "tickets":
        body = <TicketsView />;
        break;
      case "warnings":
        body = <WarningsView />;
        break;
      case "watchdog":
        body = <WatchdogView />;
        break;
      case "crm":
        body = window.CRMWorkspace
          ? (
            <window.CRMWorkspace
              initialTab={crmTab}
              messages={messages}
              messageSummary={messageSummary}
              positions={[]}
              applicants={[]}
              talentPool={[]}
              employerSubmissions={[]}
              onMessagesChanged={refreshAfterMessageAction}
              onTabChange={setCrmTab}
            />
          )
          : <div className="page"><div className="card" style={{ padding: 28 }}>CRM workspace is not loaded.</div></div>;
        break;
      case "activity":
        body = <ActivityView />;
        break;
      case "settings":
        body = <AdminSettingsView settings={settings} onSaveSettings={saveSettings} onSaveAccountSettings={saveAccountSettings} />;
        break;
      default:
        body = <GlondiaDashboard overview={overview} settings={settings} setView={setView} />;
    }
  }

  return (
    <div className="app" data-screen-label={"App / " + view}>
      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        view={view}
        setView={(v, tab) => {
          if (v === "crm" && tab) setCrmTab(tab);
          setView(v);
          setSidebarOpen(false);
        }}
        counts={counts}
        settings={settings}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        layer={sidebarLayer}
        onLayerChange={(layer) => {
          setSidebarLayer(layer);
          if (layer === "crm") {
            setView("crm");
          } else {
            setView((current) => current === "crm" ? "dashboard" : current);
          }
        }}
      />
      <div className="main">
        <Topbar
          view={view}
          onLogout={logout}
          loggingOut={loggingOut}
          notifications={dashboardNotifications}
          notificationSummary={notificationSummary}
          onMarkNotificationRead={markNotificationRead}
          onDeleteNotification={deleteNotification}
          settings={settings}
          messages={messages}
          messageSummary={messageSummary}
          positions={[]}
          onMessagesChanged={refreshAfterMessageAction}
          onNotificationsOpenChange={setNotificationsOpen}
          onMessagesOpenChange={setMessagesOpen}
          onMessageModalOpenChange={setMessageModalOpen}
          onMenuToggle={() => setSidebarOpen((v) => !v)}
          setView={(v, tab) => {
            if (v === "crm" && tab) {
              setCrmTab(tab);
              setSidebarLayer("crm");
            }
            setView(v);
          }}
          setActivePositionId={() => {}}
          setCrmTab={setCrmTab}
        />
        {body}
      </div>

      {window.TweaksPanel && settings?.plugins?.tweaksPanel !== false && (
        <window.TweaksPanel title="Tweaks">
          <window.TweakSection title="Brand accent">
            <window.TweakRadio label="Primary accent" value={tweaks.accent} onChange={(v) => setTweak("accent", v)}
              options={[{ value: "green", label: "Green" }, { value: "black", label: "Black" }]} />
          </window.TweakSection>
          <window.TweakSection title="Density">
            <window.TweakRadio value={tweaks.density} onChange={(v) => setTweak("density", v)}
              options={[{ value: "balanced", label: "Balanced" }, { value: "dense", label: "Dense" }]} />
          </window.TweakSection>
        </window.TweaksPanel>
      )}

      {window.CrmEmailActionHost && (
        <window.CrmEmailActionHost
          onOpenCrmMail={() => {
            setCrmTab("inbox");
            setView("crm");
            setSidebarLayer("crm");
          }}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
