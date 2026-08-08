function Sidebar({ view, setView, counts, settings, isOpen, onClose, layer, onLayerChange }) {
  const GLONDIA_ICON = "/dashboard-assets/assets/glondia-icon.jpg";

  const mainItems = [
    { id: "dashboard",   label: "Overview",      Icon: I.Home },
    { id: "customers",   label: "Clients",       Icon: I.Users,         count: counts.customers },
    { id: "hosting",     label: "Hosting",       Icon: I.Server },
    { id: "deployments", label: "Deployments",   Icon: I.Activity,      count: counts.deployments },
    { id: "vps",         label: "VPS",           Icon: I.Database },
    { id: "domains",     label: "Domain Names",  Icon: I.Globe },
    { id: "email-services", label: "Emails",     Icon: I.Mail },
    { id: "security-data", label: "Security Data", Icon: I.AlertTriangle },
    { id: "billing",     label: "Billing",       Icon: I.CreditCard,    count: counts.orders },
    { id: "receipts",    label: "Receipts",      Icon: I.File,          count: counts.receipts },
    { id: "service-access", label: "Service Access", Icon: I.Check },
    { id: "tickets",     label: "Tickets",       Icon: I.MessageSquare, count: counts.tickets },
    { id: "warnings",    label: "Warnings",      Icon: I.AlertCircle,   count: counts.warnings },
    { id: "watchdog",    label: "Watchdog",      Icon: I.AlertTriangle, count: counts.watchdog },
    { id: "activity",    label: "Activity",      Icon: I.Clock },
  ];

  const crmItems = [
    { id: "crm-overview",         label: "Overview",         Icon: I.Home },
    { id: "crm-inbox",            label: "Inbox",            Icon: I.Mail, count: counts.unreadMessages },
    { id: "crm-service-requests", label: "Service Requests", Icon: I.Check },
    { id: "crm-email-lists",      label: "Email Lists",      Icon: I.Users },
    { id: "crm-ai-chat",          label: "AI Chat",          Icon: I.Bot },
    { id: "crm-website-bots",     label: "Website Bots",     Icon: I.Bot },
    { id: "crm-automations",      label: "Automations",      Icon: I.Activity },
  ];

  const accountSettings = settings?.accountSettings || {};
  const profile = settings?.profile || {};
  const displayName = accountSettings.fullName || profile.displayName || profile.username || "Dashboard Admin";
  const username = profile.username || (accountSettings.email ? accountSettings.email.split("@")[0] : "dashboard-admin");
  const initials = displayName.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "DA";
  const [swapping, setSwapping] = React.useState(false);
  const [nextLayer, setNextLayer] = React.useState("");
  const currentLayer = layer || "main";

  function handleExchange() {
    if (swapping) return;
    const next = currentLayer === "main" ? "crm" : "main";
    setNextLayer(next);
    setSwapping(true);
  }

  React.useEffect(() => {
    if (!swapping) return;
    const timer = setTimeout(() => {
      if (onLayerChange) onLayerChange(nextLayer);
      setSwapping(false);
      setNextLayer("");
    }, 980);
    return () => clearTimeout(timer);
  }, [swapping, nextLayer, onLayerChange]);

  function handleCrmNav(id) {
    const tabMap = {
      "crm-overview": "overview",
      "crm-inbox": "inbox",
      "crm-service-requests": "service-requests",
      "crm-email-lists": "email-lists",
      "crm-ai-chat": "ai-chat",
      "crm-website-bots": "website-bots",
      "crm-automations": "automations",
    };
    setView("crm", tabMap[id] || "overview");
    if (onClose) onClose();
  }

  const activeCrmId = view === "crm"
    ? Object.entries({
        "crm-overview": "overview",
        "crm-inbox": "inbox",
        "crm-service-requests": "service-requests",
        "crm-email-lists": "email-lists",
        "crm-ai-chat": "ai-chat",
        "crm-website-bots": "website-bots",
        "crm-automations": "automations",
      }).find(([, tab]) => tab === (counts._crmTab || "overview"))?.[0] || "crm-overview"
    : "";

  return (
    <aside
      className={"sidebar" + (isOpen ? " is-open" : "")}
      data-layer={currentLayer}
      data-swapping={swapping ? "true" : "false"}
      data-next={nextLayer}
    >
      <button
        className="sidebar-layer-tag"
        onClick={handleExchange}
        title={currentLayer === "main" ? "Switch to CRM workspace" : "Switch to main workspace"}
        aria-label={currentLayer === "main" ? "Open CRM" : "Back to main nav"}
      >
        {currentLayer === "main" ? "CRM" : "Main"}
      </button>

      <div className="sidebar-clip">
        <div className="sidebar-panel sidebar-panel--main">
          <div className="brand">
            <div className="brand-mark" style={{ overflow: "hidden" }}>
              <img src={GLONDIA_ICON} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="brand-name">Glondia<em>/</em>sites</div>
              <div className="brand-sub">Admin Dashboard</div>
            </div>
          </div>

          <div className="nav-section">Workspace</div>
          {mainItems.map((it) => (
            <div
              key={it.id}
              className={"nav-item" + (view === it.id ? " active" : "")}
              onClick={() => { setView(it.id); if (onClose) onClose(); }}
            >
              <it.Icon className="nav-icon" />
              <span>{it.label}</span>
              {it.count != null && it.count > 0 && <span className="count">{it.count}</span>}
            </div>
          ))}

          <div className="sidebar-foot">
            <div
              className={"nav-item" + (view === "settings" ? " active" : "")}
              onClick={() => { setView("settings"); if (onClose) onClose(); }}
            >
              <I.Settings className="nav-icon" />
              <span>Settings</span>
            </div>
            <div className="sidebar-account">
              <div className="avatar tone-c sidebar-account__avatar">
                {(accountSettings.avatarUrl || profile.avatarUrl)
                  ? <img src={accountSettings.avatarUrl || profile.avatarUrl} alt={displayName} />
                  : initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="sidebar-account__name">{displayName}</div>
                <div className="mono sidebar-account__meta">@{username}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-panel sidebar-panel--crm">
          <div className="brand">
            <div className="brand-mark" style={{ overflow: "hidden" }}>
              <img src={GLONDIA_ICON} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="brand-name">Glondia<em>/</em>CRM</div>
              <div className="brand-sub">Admin Dashboard</div>
            </div>
          </div>

          <div className="crm-nav-section">CRM</div>
          {crmItems.map((it) => (
            <div
              key={it.id}
              className={"crm-nav-item" + (activeCrmId === it.id ? " active" : "")}
              onClick={() => handleCrmNav(it.id)}
            >
              <it.Icon />
              <span>{it.label}</span>
              {it.count != null && it.count > 0 && <span className="count">{it.count}</span>}
            </div>
          ))}

          <div className="crm-nav-foot">
            <div
              className={"crm-nav-item" + (view === "settings" ? " active" : "")}
              onClick={() => { setView("settings"); if (onClose) onClose(); }}
            >
              <I.Settings />
              <span>Settings</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
