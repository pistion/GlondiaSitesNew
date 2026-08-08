// GlondiaSites Admin Dashboard — tab view components

// ── Shared helpers ────────────────────────────────────────────────────────────

function AdminPage({ title, subtitle, actions, children }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-sub">{subtitle}</div>}
        </div>
        {actions && <div className="cluster">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function DataTable({ columns, rows, keyField = "id", onRowClick }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ padding: "36px 24px", textAlign: "center", color: "var(--muted)" }}>
        No records found.
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--line-2)" }}>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", fontWeight: 500 }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row[keyField] || idx}
              className={onRowClick ? "list-row" : ""}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: idx < rows.length - 1 ? "1px solid var(--line-2)" : "none", cursor: onRowClick ? "pointer" : "default" }}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ padding: "10px 16px", fontSize: 13 }}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: "status-published", published: "status-published",
    suspended: "status-draft",  disabled: "status-draft",
    pending: "status-ready",    approved: "status-published",
    rejected: "status-draft",   paid: "status-published",
  };
  return <span className={"status-badge " + (map[status] || "status-draft")}>{status || "unknown"}</span>;
}

function FmtDate({ value }) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function LoadingCard() {
  return <div className="card" style={{ padding: "32px 24px", textAlign: "center", color: "var(--muted)" }}>Loading…</div>;
}

function ErrorCard({ message }) {
  return <div className="card" style={{ padding: "20px 24px", color: "var(--danger)" }}>{message || "An error occurred."}</div>;
}

function SearchIcon() {
  return (
    <svg className="talent-search__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2"></circle>
      <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"></line>
    </svg>
  );
}

function rowSearchHaystack(row) {
  const values = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === "object") return Object.values(value).forEach(visit);
    values.push(String(value));
  };
  visit(row);
  return values.filter(Boolean).join("  ").toLowerCase();
}

function textMatchesRow(row, query) {
  const q = String(query || "").trim().toLowerCase();
  return !q || rowSearchHaystack(row).includes(q);
}

function statusOf(row) {
  return String(row?.status || row?.accountStatus || row?.billingStatus || "unknown").toLowerCase();
}

function countByStatus(rows) {
  return rows.reduce((acc, row) => {
    const status = statusOf(row);
    acc.all += 1;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { all: 0 });
}

function AdminSearchToolbar({
  search,
  onSearch,
  placeholder = "Search records...",
  count = 0,
  busy = false,
  filters = [],
  right,
}) {
  return (
    <div className="card talent-toolbar talent-toolbar--search" style={{ marginBottom: 16 }}>
      <form className="talent-search" onSubmit={(e) => e.preventDefault()}>
        <div className="talent-search__field">
          <SearchIcon />
          <input
            className="talent-search__input"
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
        </div>
        <button type="submit" className="talent-search__submit">Search</button>
      </form>
      <div className="talent-toolbar-actions">
        {right}
      </div>
      <div className="talent-filter-row">
        <span className="talent-search__count mono">
          {busy ? "Searching..." : `${count} result${count === 1 ? "" : "s"}`}
        </span>
        {filters.map((filter) => (
          <label key={filter.key} className="talent-filter-control">
            <span className="mono" style={{ fontSize: 10, textTransform: "uppercase" }}>{filter.label}</span>
            <select value={filter.value} onChange={(e) => filter.onChange(e.target.value)}>
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function PendingDataCard({ tab }) {
  return (
    <>
      <AdminSearchToolbar
        search=""
        onSearch={() => {}}
        placeholder={`Search ${tab.toLowerCase()} records...`}
        count={0}
        filters={[{ key: "status", label: "Status", value: "all", onChange: () => {}, options: [{ value: "all", label: "All statuses" }] }]}
      />
      <div className="card" style={{ padding: "36px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 8 }}>Data path pending</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          The <strong>{tab}</strong> tab is shaped and ready for backend integration. No data source has been connected yet.
        </div>
      </div>
    </>
  );
}

function useAdminData(fetcher) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => setData(result))
      .catch((err) => setError(err.message || "Failed to load."))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ── Customers ─────────────────────────────────────────────────────────────────

function CustomersView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.listCustomers());
  const [selected, setSelected] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [busy, setBusy] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const users = Array.isArray(data) ? data : (data?.users || []);
  const statusCounts = countByStatus(users);
  const filteredUsers = users.filter((user) => {
    const status = statusOf(user);
    return textMatchesRow(user, search) && (statusFilter === "all" || status === statusFilter);
  });

  async function handleAction(action, userId) {
    setBusy(action + userId);
    setActionError("");
    try {
      if (action === "suspend") {
        const reason = window.prompt("Reason for suspension?");
        if (reason == null) { setBusy(""); return; }
        await window.HEYA_API.suspendCustomer(userId, reason);
      } else if (action === "reactivate") {
        await window.HEYA_API.reactivateCustomer(userId);
      } else if (action === "delete") {
        if (!window.confirm("PERMANENTLY delete this customer from the main database?\n\nThis removes their login, profile, and related account rows. This cannot be undone.")) { setBusy(""); return; }
        await window.HEYA_API.deleteCustomer(userId, "Admin deleted");
      }
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err.message || "Action failed.");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteAllClients() {
    const clients = users.filter((u) => String(u.role || "").toLowerCase() !== "admin");
    if (!clients.length) {
      setActionError("No client accounts to delete.");
      return;
    }
    if (!window.confirm(`PERMANENTLY delete ALL ${clients.length} client account(s) from the main database?\n\nAdmin accounts are kept. This cannot be undone.`)) return;
    const typed = window.prompt('Type DELETE ALL to confirm hard-delete of every client account:');
    if (typed !== "DELETE ALL") {
      setActionError("Bulk delete cancelled — confirmation text did not match.");
      return;
    }
    setBusy("delete-all");
    setActionError("");
    const failures = [];
    for (const u of clients) {
      try {
        await window.HEYA_API.deleteCustomer(u.id, "Admin bulk deleted all clients");
      } catch (err) {
        failures.push(`${u.email || u.id}: ${err.message || "failed"}`);
      }
    }
    setSelected(null);
    reload();
    if (failures.length) setActionError(`Deleted with ${failures.length} error(s): ${failures.slice(0, 3).join("; ")}`);
    setBusy("");
  }

  const columns = [
    { key: "username",  label: "Username",  render: (v, r) => v || r.email || r.id },
    { key: "email",     label: "Email" },
    { key: "plan",      label: "Plan",      render: (v) => v || "—" },
    { key: "status",    label: "Status",    render: (v) => <StatusBadge status={v || "active"} /> },
    { key: "createdAt", label: "Joined",    render: (v) => <FmtDate value={v} /> },
  ];

  return (
    <AdminPage title="Customers" subtitle="All registered GlondiaSites customer accounts. Delete permanently removes the row from the main database."
      actions={
        <div className="cluster">
          <button className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={!!busy} onClick={handleDeleteAllClients}>
            {busy === "delete-all" ? "Deleting all…" : "Delete all clients"}
          </button>
          <button className="btn ghost sm" onClick={reload}>Refresh</button>
        </div>
      }
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        <>
          <AdminSearchToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search customers, email, plan, status, phone, or organization..."
            count={filteredUsers.length}
            filters={[{
              key: "status",
              label: "Status",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: "all", label: `All (${statusCounts.all || 0})` },
                { value: "active", label: `Active (${statusCounts.active || 0})` },
                { value: "suspended", label: `Suspended (${statusCounts.suspended || 0})` },
                { value: "disabled", label: `Disabled (${statusCounts.disabled || 0})` },
                { value: "deleted", label: `Deleted (${statusCounts.deleted || 0})` },
              ],
            }]}
          />
          <DataTable columns={columns} rows={filteredUsers} onRowClick={setSelected} />
        </>
      )}

      {selected && (
        <div className="publish-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="edit-modal">
            <div className="edit-modal-head">
              <div>
                <div className="mono eyebrow">Customer</div>
                <div className="edit-modal-title">{selected.username || selected.email || selected.id}</div>
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="edit-modal-body stack" style={{ gap: 8 }}>
              {[["ID", selected.id], ["Email", selected.email], ["Username", selected.username], ["Plan", selected.plan], ["Status", selected.status], ["Joined", selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—"]].map(([label, val]) => (
                <div key={label} style={{ display: "flex", gap: 12 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)", minWidth: 80 }}>{label}</span>
                  <span style={{ fontSize: 13 }}>{val || "—"}</span>
                </div>
              ))}
              {actionError && <div style={{ color: "var(--danger)", fontSize: 13 }}>{actionError}</div>}
            </div>
            <div className="edit-modal-foot">
              <div className="cluster">
                {(selected.status !== "suspended" && selected.status !== "disabled") ? (
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("suspend", selected.id)}>
                    {busy === "suspend" + selected.id ? "Suspending…" : "Suspend"}
                  </button>
                ) : (
                  <button className="btn accent sm" disabled={!!busy} onClick={() => handleAction("reactivate", selected.id)}>
                    {busy === "reactivate" + selected.id ? "Reactivating…" : "Reactivate"}
                  </button>
                )}
                <button className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={!!busy} onClick={() => handleAction("delete", selected.id)}>Delete</button>
                <button className="btn" onClick={() => setSelected(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

// ── Deployments ───────────────────────────────────────────────────────────────

function CustomerAccountsView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.listCustomers());
  const [selected, setSelected] = React.useState(null);
  const [selectedDetail, setSelectedDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailTab, setDetailTab] = React.useState("overview");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [busy, setBusy] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const users = Array.isArray(data) ? data : (data?.users || []);
  const statusCounts = countByStatus(users);
  const filteredUsers = users.filter((user) => {
    const status = statusOf(user);
    return textMatchesRow(user, search) && (statusFilter === "all" || status === statusFilter);
  });

  async function openCustomer(user) {
    setSelected(user);
    setSelectedDetail(null);
    setDetailTab("overview");
    setActionError("");
    setDetailLoading(true);
    try {
      const detail = await window.HEYA_API.getCustomer(user.id);
      setSelectedDetail(detail);
      setSelected(detail.user || user);
    } catch (err) {
      setSelectedDetail({ user, deployments: [], orders: [], receipts: [], totals: {} });
      setActionError(err.message || "Could not load customer detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleAction(action, userId) {
    setBusy(action + userId);
    setActionError("");
    try {
      if (action === "suspend") {
        const reason = window.prompt("Reason for suspension?");
        if (reason == null) { setBusy(""); return; }
        await window.HEYA_API.suspendCustomer(userId, reason);
      } else if (action === "reactivate") {
        await window.HEYA_API.reactivateCustomer(userId);
      } else if (action === "delete") {
        if (!window.confirm("PERMANENTLY delete this customer from the main database?\n\nThis removes their login, profile, and related account rows. This cannot be undone.")) { setBusy(""); return; }
        await window.HEYA_API.deleteCustomer(userId, "Admin deleted");
      }
      setSelected(null);
      setSelectedDetail(null);
      reload();
    } catch (err) {
      setActionError(err.message || "Action failed.");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteAllClients() {
    const targets = users.filter((u) => String(u.role || "").toLowerCase() !== "admin");
    if (!targets.length) {
      setActionError("No client accounts to delete.");
      return;
    }
    if (!window.confirm(`PERMANENTLY delete ALL ${targets.length} client account(s) from the main database?\n\nAdmin accounts are kept. This cannot be undone.`)) return;
    const typed = window.prompt("Type DELETE ALL to confirm hard-delete of every client account:");
    if (typed !== "DELETE ALL") {
      setActionError("Bulk delete cancelled — confirmation text did not match.");
      return;
    }
    setBusy("delete-all");
    setActionError("");
    const failures = [];
    for (const u of targets) {
      try {
        await window.HEYA_API.deleteCustomer(u.id, "Admin bulk deleted all clients");
      } catch (err) {
        failures.push(`${u.email || u.id}: ${err.message || "failed"}`);
      }
    }
    setSelected(null);
    setSelectedDetail(null);
    reload();
    if (failures.length) setActionError(`Deleted with ${failures.length} error(s): ${failures.slice(0, 3).join("; ")}`);
    setBusy("");
  }

  const tabs = [["all", "All customers"], ["active", "Active"], ["suspended", "Suspended"], ["disabled", "Disabled"], ["deleted", "Deleted"]];

  return (
    <AdminPage title="Customers" subtitle="Customer accounts created from the client app. Delete permanently removes them from the main database." actions={
      <div className="cluster">
        <button className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={!!busy} onClick={handleDeleteAllClients}>
          {busy === "delete-all" ? "Deleting all…" : "Delete all clients"}
        </button>
        <button className="btn ghost sm" onClick={reload}>Refresh</button>
      </div>
    }>
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        selected ? (
          <div className="customer-inline-panel">
            <div className="customer-inline-panel__bar">
              <button className="btn ghost sm" onClick={() => { setSelected(null); setSelectedDetail(null); setActionError(""); }}>Back to customers</button>
              <div className="cluster">
                {(selected.status !== "suspended" && selected.status !== "disabled") ? (
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("suspend", selected.id)}>
                    {busy === "suspend" + selected.id ? "Suspending..." : "Suspend"}
                  </button>
                ) : (
                  <button className="btn accent sm" disabled={!!busy} onClick={() => handleAction("reactivate", selected.id)}>
                    {busy === "reactivate" + selected.id ? "Reactivating..." : "Reactivate"}
                  </button>
                )}
                <button className="btn ghost sm" style={{ color: "var(--danger)" }} disabled={!!busy} onClick={() => handleAction("delete", selected.id)}>Delete</button>
              </div>
            </div>
            <CustomerDetailShell selected={selected} detail={selectedDetail} loading={detailLoading} activeTab={detailTab} setActiveTab={setDetailTab} />
            {actionError && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{actionError}</div>}
          </div>
        ) : (
          <div className="customer-pool talent-customer-pool">
            <div className="pool-tab-strip">
              {tabs.map(([key, label]) => (
                <button key={key} className={"pool-tab" + (statusFilter === key ? " is-active" : "")} onClick={() => setStatusFilter(key)}>
                  {label} <span className="pool-tab-count">{statusCounts[key] || 0}</span>
                </button>
              ))}
            </div>
            <AdminSearchToolbar
              search={search}
              onSearch={setSearch}
              placeholder="Search customers, email, plan, status, phone, organization, or database ID..."
              count={filteredUsers.length}
              filters={[{
                key: "status",
                label: "Status",
                value: statusFilter,
                onChange: setStatusFilter,
                options: tabs.map(([key, label]) => ({ value: key, label: `${label} (${statusCounts[key] || 0})` })),
              }]}
            />
            <div className="talent-grid">
              {filteredUsers.length === 0 && <div className="card talent-empty-card">No customer accounts match this view.</div>}
              {filteredUsers.map((user) => <CustomerProfileCard key={user.id} user={user} onOpen={() => openCustomer(user)} />)}
            </div>
          </div>
        )
      )}
    </AdminPage>
  );
}

function CustomerProfileCard({ user, onOpen }) {
  const name = user.username || user.email || user.id;
  const hints = customerServiceHints(user);
  const plan = user.plan || user.planId || "Starter";
  return (
    <div className={"talent-card clickable " + customerToneFor(user)} onClick={onOpen}>
      <div className="talent-card__banner">
        <StatusBadge status={user.status || "active"} />
        <div className="talent-card__menu-wrap">
          <button className="icon-btn" title="Customer actions" onClick={(event) => { event.stopPropagation(); onOpen(); }}>...</button>
        </div>
      </div>
      <div className="talent-card__avatar-wrap">
        <div className={"avatar talent-card__avatar " + customerToneFor(user)}>{initialsForCustomer(name)}</div>
      </div>
      <div className="talent-card__body">
        <div className="talent-card__name">{name}</div>
        <div className="talent-card__role">{user.email || "customer account"}</div>
        <div className="talent-card__meta">
          <span className="talent-card__meta-chip">{plan}</span>
          <span className="talent-card__meta-chip">Joined <FmtDate value={user.createdAt} /></span>
        </div>
        <div className="talent-card__chips">{hints.map((hint) => <span key={hint} className="talent-card__chip">{hint}</span>)}</div>
      </div>
    </div>
  );
}

function CustomerDetailShell({ selected, detail, loading, activeTab, setActiveTab }) {
  const account = detail?.user || selected;
  const deployments = detail?.services || [];
  const orders = detail?.billing?.orders || [];
  const receipts = detail?.billing?.receipts || [];
  const invoices = detail?.billing?.invoices || [];
  const subscriptions = detail?.billing?.subscriptions || [];
  const analytics = detail?.analytics || [];
  const activity = detail?.activity || [];
  const notes = detail?.notes || [];
  const ownership = detail?.ownership?.organizationIds || [];
  const summary = detail?.summary || {};
  const paidCents = orders.filter((item) => String(item.status || "").toLowerCase() === "paid").reduce((sum, item) => sum + Number(item.totalAmountCents || 0), 0);
  const tabs = [
    { id: "overview", short: "Overview", full: "Customer Overview", color: "#FCE9EC", border: "#E8B8C1" },
    { id: "services", short: "Services", full: "Assigned Services", color: "#E7F6EE", border: "#BFE5CD" },
    { id: "analytics", short: "Insights", full: "Analytics & Insights", color: "#EAF0FE", border: "#C8D7FB" },
    { id: "billing", short: "Billing", full: "Orders & Billing", color: "#FBF1DC", border: "#EAD7A8" },
    { id: "access", short: "Access", full: "Account Access", color: "#E8F4F2", border: "#BFD8D2" },
    { id: "activity", short: "Activity", full: "Customer Activity", color: "#F4E9FE", border: "#DAC2F2" },
    { id: "notes", short: "Notes", full: "Internal Notes", color: "#F1F4E8", border: "#D4DDBB" },
    { id: "settings", short: "Settings", full: "Customer Settings", color: "#EEF1F5", border: "#CFD6E0" },
  ];
  const serviceRows = customerServiceRows(deployments, [], []);
  const accountName = account.username || account.name || account.email || account.id;
  const plan = account.plan || account.planId || "Starter";

  return (
    <div className="cps-profile-outer customer-profile-outer">
      <div className="cps-tab-tray customer-cps-tab-tray">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            className={"cps-top-tab" + (activeTab === tab.id ? " is-active" : "")}
            style={{ background: tab.color, borderColor: tab.border, zIndex: index + 1 }}
            onClick={() => setActiveTab(tab.id)}
            title={tab.full}
          >
            <span className="cps-tab-num">{index + 1}</span>
            <span className="cps-tab-name">{tab.short}</span>
          </button>
        ))}
      </div>

      <div className="talent-profile-card customer-place-card">
        <div className="talent-profile-hero customer-place-hero">
          <div className={"avatar tone-c customer-place-avatar " + customerToneFor(account)}>
            {initialsForCustomer(accountName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 className="page-title customer-place-title">{accountName}</h1>
              <StatusBadge status={account.status || "active"} />
            </div>
            <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 6 }}>{account.email || "No email on file"}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {plan} - Joined {account.createdAt ? new Date(account.createdAt).toLocaleDateString("en-PG") : "not recorded"}
            </div>
            <div className="cluster customer-profile-chips">
              {customerServiceHints(account).map((hint) => <span key={hint} className="tag-pill talent-tag-pill">{hint}</span>)}
            </div>
          </div>
        </div>

        <div className="cps-tab-panel">
          {loading && <div className="customer-detail-loading">Loading customer profile...</div>}

          {!loading && activeTab === "overview" && (
            <div className="cps-panel-content talent-profile-body">
              <div className="stack" style={{ gap: 14 }}>
                <CustomerProfileSection title="Customer summary">
                  <div className="customer-detail-grid">
                    <CustomerMetric label="Services" value={summary.services ?? deployments.length} note="All assigned services" />
                    <CustomerMetric label="Orders" value={orders.length} note="Service requests" />
                    <CustomerMetric label="Receipts" value={receipts.length} note="Payment proof records" />
                    <CustomerMetric label="Paid" value={`$${(paidCents / 100).toFixed(2)}`} note="Confirmed revenue" />
                  </div>
                </CustomerProfileSection>
                <CustomerProfileSection title="Account profile">
                  <CustomerKV k="Client ID" v={account.clientId} />
                  <CustomerKV k="Internal User ID" v={account.id} />
                  <CustomerKV k="Account scope" v={ownership.join(", ")} />
                  <CustomerKV k="Name" v={account.name || account.username} />
                  <CustomerKV k="Organization" v={account.organizationName || account.profileDetails?.organizationName} />
                  <CustomerKV k="Plan" v={plan} />
                </CustomerProfileSection>
              </div>
              <div className="stack" style={{ gap: 14 }}>
                <CustomerProfileSection title="Contact">
                  <CustomerKV k="Email" v={account.email} />
                  <CustomerKV k="Phone" v={account.phone} />
                  <CustomerKV k="Status" v={account.status || account.accountStatus || "active"} />
                </CustomerProfileSection>
                <CustomerProfileSection title="Customer insight">
                  <CustomerKV k="Service footprint" v={`${deployments.length} service(s), ${orders.length} order(s), ${receipts.length} receipt(s)`} />
                  <CustomerKV k="Billing attention" v={orders.some((item) => String(item.status || "").toLowerCase() !== "paid") ? "Needs review" : "Clear"} />
                  <CustomerKV k="Receipt review" v={receipts.some((item) => String(item.status || "").toLowerCase() === "pending") ? "Pending approval" : "No pending receipt"} />
                </CustomerProfileSection>
              </div>
            </div>
          )}

          {!loading && activeTab === "services" && (
            <div className="cps-panel-content">
              <CustomerProfileSection title="Assigned services">
                <CustomerServiceList deployments={deployments} orders={[]} receipts={[]} />
              </CustomerProfileSection>
            </div>
          )}

          {!loading && activeTab === "analytics" && (
            <div className="cps-panel-content talent-profile-body">
              <div className="stack" style={{ gap: 14 }}>
                <CustomerProfileSection title="Analytics">
                  <div className="customer-detail-grid">
                    <CustomerMetric label="Active services" value={summary.activeServices ?? deployments.filter((item) => ["active", "live", "running"].includes(String(item.status || "").toLowerCase())).length} note="Currently live" />
                    <CustomerMetric label="Pending billing" value={orders.filter((item) => String(item.status || "").toLowerCase() !== "paid").length} note="Needs follow-up" />
                    <CustomerMetric label="Receipts pending" value={receipts.filter((item) => String(item.status || "").toLowerCase() === "pending").length} note="Awaiting approval" />
                    <CustomerMetric label="Plan" value={plan} note="Current account tier" />
                  </div>
                </CustomerProfileSection>
              </div>
              <div className="stack" style={{ gap: 14 }}>
                <CustomerProfileSection title="Insights">
                  <CustomerKV k="Analytics events" v={analytics.length} />
                  <CustomerKV k="Customer value" v={paidCents > 0 ? "Revenue confirmed" : "No confirmed revenue yet"} />
                  <CustomerKV k="Operational signal" v={deployments.length ? "Service relationship active" : "No service assigned"} />
                  <CustomerKV k="Next action" v={serviceRows.length ? "Review latest service state" : "Assign or onboard service"} />
                </CustomerProfileSection>
              </div>
              <div className="stack" style={{ gap: 14 }}>
                <CustomerProfileSection title="Database analytics events">
                  <CustomerRecordList rows={analytics} empty="No analytics events recorded for this client." />
                </CustomerProfileSection>
              </div>
            </div>
          )}

          {!loading && activeTab === "billing" && (
            <div className="cps-panel-content stack" style={{ gap: 14 }}>
              <CustomerProfileSection title="Billing overview">
                <div className="customer-detail-grid">
                  <CustomerMetric label="Orders" value={orders.length} note="Total records" />
                  <CustomerMetric label="Receipts" value={receipts.length} note="Uploaded proof" />
                  <CustomerMetric label="Paid" value={`$${(paidCents / 100).toFixed(2)}`} note="Confirmed" />
                  <CustomerMetric label="Pending" value={orders.filter((item) => String(item.status || "").toLowerCase() !== "paid").length} note="Open items" />
                  <CustomerMetric label="Invoices" value={invoices.length} note="Issued records" />
                  <CustomerMetric label="Subscriptions" value={subscriptions.length} note="Billing relationships" />
                </div>
              </CustomerProfileSection>
              <CustomerProfileSection title="Orders and receipts">
                <CustomerServiceList deployments={[]} orders={orders} receipts={receipts} />
              </CustomerProfileSection>
            </div>
          )}

          {!loading && activeTab === "access" && (
            <div className="cps-panel-content talent-profile-body">
              <CustomerProfileSection title="Access record">
                <CustomerKV k="Client ID" v={account.clientId} />
                <CustomerKV k="Internal User ID" v={account.id} />
                <CustomerKV k="Email" v={account.email} />
                <CustomerKV k="Username" v={account.username} />
                <CustomerKV k="Role" v={account.role || "member"} />
                <CustomerKV k="Status" v={account.status || account.accountStatus || "active"} />
                <CustomerKV k="Owned organizations" v={ownership.join(", ")} />
              </CustomerProfileSection>
              <CustomerProfileSection title="Security and lifecycle">
                <CustomerKV k="Created" v={account.createdAt ? new Date(account.createdAt).toLocaleString() : "-"} />
                <CustomerKV k="Updated" v={account.updatedAt ? new Date(account.updatedAt).toLocaleString() : "-"} />
                <CustomerKV k="Disabled reason" v={account.disabledReason} />
                <CustomerKV k="Deleted at" v={account.deletedAt ? new Date(account.deletedAt).toLocaleString() : ""} />
              </CustomerProfileSection>
              <CustomerProfileSection title="Service access">
                <CustomerAccessList services={deployments} />
              </CustomerProfileSection>
            </div>
          )}

          {!loading && activeTab === "activity" && (
            <div className="cps-panel-content stack" style={{ gap: 14 }}>
              <CustomerProfileSection title="Customer UX activity">
                <CustomerUxActivity analytics={analytics} />
              </CustomerProfileSection>
              <CustomerProfileSection title="Security and audit timeline">
                <CustomerRecordList rows={activity} empty="No audit events recorded for this client." />
              </CustomerProfileSection>
            </div>
          )}

          {!loading && activeTab === "notes" && (
            <div className="cps-panel-content">
              <CustomerRecordList rows={notes} empty="No private admin notes recorded for this client." />
            </div>
          )}

          {!loading && activeTab === "settings" && (
            <div className="cps-panel-content talent-profile-body">
              <CustomerProfileSection title="Customer settings">
                <CustomerKV k="Promo eligible" v={account.promoEligible === false ? "No" : "Yes"} />
                <CustomerKV k="Promo signup rank" v={account.promoSignupRank} />
                <CustomerKV k="Promo claimed" v={account.promoClaimedAt ? new Date(account.promoClaimedAt).toLocaleString() : "Not claimed"} />
              </CustomerProfileSection>
              <CustomerProfileSection title="Service controls">
                <CustomerKV k="Current mode" v="Admin managed" />
                <CustomerKV k="Deletion state" v={account.deletedAt ? "Deleted" : "Active record"} />
                <CustomerKV k="Suspension state" v={String(account.status || account.accountStatus || "active").toLowerCase() === "suspended" ? "Suspended" : "Not suspended"} />
              </CustomerProfileSection>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerMetric({ label, value, note }) {
  return <div className="customer-metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function CustomerProfileSection({ title, children }) {
  return (
    <div className="profile-section customer-profile-section">
      <div className="mono eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function CustomerKV({ k, v }) {
  return (
    <div className="customer-kv-row">
      <span>{k}</span>
      <strong>{v || "-"}</strong>
    </div>
  );
}

function CustomerServiceList({ deployments, orders, receipts }) {
  const rows = customerServiceRows(deployments, orders, receipts);
  if (!rows.length) return <div className="customer-pool-empty">No services, orders, or receipts are attached yet.</div>;
  return (
    <div className="customer-service-list">
      {rows.map((row, index) => (
        <div key={row.type + row.name + index} className="customer-service-row">
          <div><span>{row.type}</span><strong>{row.name}</strong></div>
          <StatusBadge status={row.status || "pending"} />
          <small><FmtDate value={row.date} /></small>
        </div>
      ))}
    </div>
  );
}

function CustomerActivityList({ account, deployments, orders, receipts }) {
  const rows = [
    { type: "Account", name: "Customer account created", status: account.status || account.accountStatus || "active", date: account.createdAt },
    ...customerServiceRows(deployments, orders, receipts),
  ].filter((row) => row.date || row.name);
  if (!rows.length) return <CustomerEmptyState title="No activity" body="No customer activity has been recorded yet." />;
  return (
    <div className="customer-service-list">
      {rows
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .map((row, index) => (
          <div key={row.type + row.name + index} className="cps-submission-row customer-activity-row">
            <div className="cps-submission-index">{index + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{row.name}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{row.type} - {row.date ? new Date(row.date).toLocaleString() : "No date"}</div>
            </div>
            <StatusBadge status={row.status || "recorded"} />
          </div>
        ))}
    </div>
  );
}

function CustomerRecordList({ rows = [], empty }) {
  if (!rows.length) return <CustomerEmptyState title="No records" body={empty} />;
  return (
    <div className="customer-service-list">
      {rows.map((row, index) => (
        <div key={row.id || index} className="cps-submission-row customer-activity-row">
          <div className="cps-submission-index">{index + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{row.body || row.action || row.eventType || row.message || row.name || "Recorded event"}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {[row.entityType, row.entityId, row.adminUserId, row.actorUserId].filter(Boolean).join(" · ") || "Client account record"}
              {row.createdAt ? " · " + new Date(row.createdAt).toLocaleString() : ""}
            </div>
          </div>
          <StatusBadge status={row.status || "recorded"} />
        </div>
      ))}
    </div>
  );
}

function parseAnalyticsMetadata(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function CustomerUxActivity({ analytics = [] }) {
  const rows = analytics.map((row) => ({ ...row, parsed: parseAnalyticsMetadata(row.metadata) }));
  const count = (type) => rows.filter((row) => row.eventType === type).length;
  const serviceCounts = {};
  const searchCounts = {};
  const zoneCounts = {};
  let maxScroll = 0;
  for (const row of rows) {
    if (row.eventType === "ux.service_used" && row.parsed.service) serviceCounts[row.parsed.service] = (serviceCounts[row.parsed.service] || 0) + 1;
    if (row.eventType === "ux.search" && row.parsed.query) searchCounts[row.parsed.query] = (searchCounts[row.parsed.query] || 0) + 1;
    if (row.eventType === "ux.pointer_summary") for (const [zone, value] of Object.entries(row.parsed.zoneCounts || {})) zoneCounts[zone] = (zoneCounts[zone] || 0) + Number(value || 0);
    maxScroll = Math.max(maxScroll, Number(row.parsed.maxScrollPercent || 0));
  }
  const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) return <CustomerEmptyState title="No UX telemetry" body="No authenticated customer interaction data has been recorded yet." />;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="customer-detail-grid">
        <CustomerMetric label="Page views" value={count("ux.page_view")} note="Tracked dashboard views" />
        <CustomerMetric label="Clicks" value={count("ux.click")} note="Interactive controls" />
        <CustomerMetric label="Searches" value={count("ux.search")} note="Search result sessions" />
        <CustomerMetric label="Rage clicks" value={count("ux.rage_click")} note="Possible UI friction" />
        <CustomerMetric label="UI errors" value={count("ux.ui_error")} note="Client-side failures" />
        <CustomerMetric label="Max scroll" value={maxScroll + "%"} note="Deepest recorded page" />
      </div>
      <div className="customer-ux-grids">
        <CustomerUxTable title="Most-used services" rows={top(serviceCounts)} empty="No service use recorded." />
        <CustomerUxTable title="Dashboard searches" rows={top(searchCounts)} empty="No searches recorded." />
        <CustomerUxTable title="Pointer heat zones" rows={top(zoneCounts)} empty="No pointer summaries recorded." />
      </div>
      <CustomerRecordList rows={rows} empty="No UX events recorded." />
    </div>
  );
}

function CustomerUxTable({ title, rows, empty }) {
  return <div className="customer-ux-table"><strong>{title}</strong>{rows.length ? <table><tbody>{rows.map(([label, value]) => <tr key={label}><td>{label}</td><td className="mono">{value}</td></tr>)}</tbody></table> : <span>{empty}</span>}</div>;
}

function CustomerAccessList({ services = [] }) {
  if (!services.length) return <CustomerEmptyState title="No service access" body="No service relationship is indexed for this client." />;
  return (
    <div className="customer-access-list">
      {services.map((service) => (
        <div key={service.id}>
          <span>{service.serviceType || "Service"}</span>
          <strong>{service.serviceName || service.name || service.id} · {service.accessStatus || "unindexed"} · {service.billingStatus || "billing unknown"} · {service.adminStatus || "allowed"}</strong>
        </div>
      ))}
    </div>
  );
}

function CustomerEmptyState({ title, body }) {
  return (
    <div className="cps-empty-state">
      <div className="cps-empty-title">{title}</div>
      <div className="cps-empty-body">{body}</div>
    </div>
  );
}

function customerServiceRows(deployments, orders, receipts) {
  return [
    ...deployments.map((item) => ({ type: item.serviceType || "Service", name: item.serviceName || item.name || item.id, status: item.status || item.accessStatus, date: item.updatedAt || item.createdAt })),
    ...orders.map((item) => ({ type: "Order", name: item.description || item.id, status: item.status, date: item.createdAt })),
    ...receipts.map((item) => ({ type: "Receipt", name: item.reference || item.id, status: item.status, date: item.createdAt })),
  ];
}

function customerToneFor(user) {
  const key = String(user?.id || user?.email || user?.username || "a");
  return ["tone-a", "tone-b", "tone-c", "tone-d"][key.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4];
}

function customerServiceHints(user) {
  const items = [user.plan || user.planId || "Starter", user.status || "Active"];
  if (user.email) items.push("Email linked");
  if (user.createdAt) items.push("Profile tracked");
  return items.slice(0, 4);
}

function initialsForCustomer(name) {
  const clean = String(name || "?").replace(/@.*/, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

function DeploymentsView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.listDeployments());
  const [selected, setSelected] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [billingFilter, setBillingFilter] = React.useState("all");
  const [busy, setBusy] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const deployments = Array.isArray(data) ? data : (data?.deployments || []);
  const statusCounts = countByStatus(deployments);
  const billingCounts = deployments.reduce((acc, item) => {
    const status = String(item.billingStatus || "unknown").toLowerCase();
    acc.all += 1;
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { all: 0 });
  const filteredDeployments = deployments.filter((dep) => {
    const status = statusOf(dep);
    const billing = String(dep.billingStatus || "unknown").toLowerCase();
    return textMatchesRow(dep, search)
      && (statusFilter === "all" || status === statusFilter)
      && (billingFilter === "all" || billing === billingFilter);
  });

  async function handleAction(action, dep) {
    setBusy(action + dep.id);
    setActionError("");
    try {
      if (action === "paid") await window.HEYA_API.markDeploymentPaid(dep.id);
      else if (action === "approveBilling") await window.HEYA_API.approveDeploymentBilling(dep.id);
      else if (action === "suspend") {
        const reason = window.prompt("Reason for suspension?");
        if (reason == null) { setBusy(""); return; }
        await window.HEYA_API.suspendDeployment(dep.id, reason);
      } else if (action === "reactivate") await window.HEYA_API.reactivateDeployment(dep.id);
      setSelected(null);
      reload();
    } catch (err) {
      setActionError(err.message || "Action failed.");
    } finally {
      setBusy("");
    }
  }

  const columns = [
    { key: "name",          label: "Deployment",  render: (v, r) => v || r.id },
    { key: "userId",        label: "Customer" },
    { key: "plan",          label: "Plan",         render: (v) => v || "—" },
    { key: "status",        label: "Status",       render: (v) => <StatusBadge status={v} /> },
    { key: "billingStatus", label: "Billing",      render: (v) => v ? <StatusBadge status={v} /> : "—" },
    { key: "createdAt",     label: "Created",      render: (v) => <FmtDate value={v} /> },
  ];

  return (
    <AdminPage title="Deployments" subtitle="All customer site and app deployments."
      actions={<button className="btn ghost sm" onClick={reload}>Refresh</button>}
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        <>
          <AdminSearchToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search deployments, customer IDs, plans, domains, status, or billing..."
            count={filteredDeployments.length}
            filters={[
              {
                key: "status",
                label: "Status",
                value: statusFilter,
                onChange: setStatusFilter,
                options: [
                  { value: "all", label: `All (${statusCounts.all || 0})` },
                  { value: "active", label: `Active (${statusCounts.active || 0})` },
                  { value: "pending", label: `Pending (${statusCounts.pending || 0})` },
                  { value: "suspended", label: `Suspended (${statusCounts.suspended || 0})` },
                  { value: "deleted", label: `Deleted (${statusCounts.deleted || 0})` },
                ],
              },
              {
                key: "billing",
                label: "Billing",
                value: billingFilter,
                onChange: setBillingFilter,
                options: [
                  { value: "all", label: `All billing (${billingCounts.all || 0})` },
                  { value: "paid", label: `Paid (${billingCounts.paid || 0})` },
                  { value: "pending", label: `Pending (${billingCounts.pending || 0})` },
                  { value: "approved", label: `Approved (${billingCounts.approved || 0})` },
                  { value: "unknown", label: `Unknown (${billingCounts.unknown || 0})` },
                ],
              },
            ]}
          />
          <DataTable columns={columns} rows={filteredDeployments} onRowClick={setSelected} />
        </>
      )}

      {selected && (
        <div className="publish-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelected(null); setActionError(""); } }}>
          <div className="edit-modal">
            <div className="edit-modal-head">
              <div>
                <div className="mono eyebrow">Deployment</div>
                <div className="edit-modal-title">{selected.name || selected.id}</div>
              </div>
              <button className="icon-btn" onClick={() => { setSelected(null); setActionError(""); }}>×</button>
            </div>
            <div className="edit-modal-body stack" style={{ gap: 8 }}>
              {[["ID", selected.id], ["Customer", selected.userId], ["Plan", selected.plan], ["Render plan", selected.renderPlan], ["Status", selected.status], ["Billing", selected.billingStatus], ["Created", selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—"]].map(([label, val]) => (
                <div key={label} style={{ display: "flex", gap: 12 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)", minWidth: 100 }}>{label}</span>
                  <span style={{ fontSize: 13 }}>{val || "—"}</span>
                </div>
              ))}
              {actionError && <div style={{ color: "var(--danger)", fontSize: 13 }}>{actionError}</div>}
            </div>
            <div className="edit-modal-foot">
              <div className="cluster">
                <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("paid", selected)}>
                  {busy === "paid" + selected.id ? "…" : "Mark Paid"}
                </button>
                <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("approveBilling", selected)}>
                  {busy === "approveBilling" + selected.id ? "…" : "Approve Billing"}
                </button>
                {selected.status !== "suspended" ? (
                  <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("suspend", selected)}>
                    {busy === "suspend" + selected.id ? "…" : "Suspend"}
                  </button>
                ) : (
                  <button className="btn accent sm" disabled={!!busy} onClick={() => handleAction("reactivate", selected)}>
                    {busy === "reactivate" + selected.id ? "…" : "Reactivate"}
                  </button>
                )}
                <button className="btn" onClick={() => { setSelected(null); setActionError(""); }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

// ── Billing (Orders) ──────────────────────────────────────────────────────────

function BillingView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.listOrders());
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const orders = Array.isArray(data) ? data : (data?.orders || []);
  const statusCounts = countByStatus(orders);
  const filteredOrders = orders.filter((order) => {
    const status = statusOf(order);
    return textMatchesRow(order, search) && (statusFilter === "all" || status === statusFilter);
  });

  const columns = [
    { key: "id",          label: "Order ID",    render: (v) => <span className="mono" style={{ fontSize: 12 }}>{String(v).slice(0, 12)}</span> },
    { key: "userId",      label: "Customer" },
    { key: "amount",      label: "Amount",      render: (v) => v != null ? `$${(Number(v) / 100).toFixed(2)}` : "—" },
    { key: "status",      label: "Status",      render: (v) => <StatusBadge status={v} /> },
    { key: "description", label: "Description", render: (v) => v || "—" },
    { key: "createdAt",   label: "Date",        render: (v) => <FmtDate value={v} /> },
  ];

  return (
    <AdminPage title="Billing" subtitle="Customer service orders and billing records."
      actions={<button className="btn ghost sm" onClick={reload}>Refresh</button>}
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        <>
          <AdminSearchToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search orders, customers, descriptions, amounts, or status..."
            count={filteredOrders.length}
            filters={[{
              key: "status",
              label: "Status",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: "all", label: `All (${statusCounts.all || 0})` },
                { value: "paid", label: `Paid (${statusCounts.paid || 0})` },
                { value: "pending", label: `Pending (${statusCounts.pending || 0})` },
                { value: "approved", label: `Approved (${statusCounts.approved || 0})` },
                { value: "rejected", label: `Rejected (${statusCounts.rejected || 0})` },
              ],
            }]}
          />
          <DataTable columns={columns} rows={filteredOrders} />
        </>
      )}
    </AdminPage>
  );
}

// ── Receipts ──────────────────────────────────────────────────────────────────

function ReceiptsView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.listReceipts());
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [busy, setBusy] = React.useState("");
  const [actionError, setActionError] = React.useState("");

  const receipts = Array.isArray(data) ? data : (data?.receipts || []);
  const statusCounts = countByStatus(receipts);
  const filteredReceipts = receipts.filter((receipt) => {
    const status = statusOf(receipt);
    return textMatchesRow(receipt, search) && (statusFilter === "all" || status === statusFilter);
  });

  async function handleAction(action, receiptId) {
    setBusy(action + receiptId);
    setActionError("");
    try {
      if (action === "approve") {
        await window.HEYA_API.approveReceipt(receiptId);
      } else if (action === "reject") {
        const note = window.prompt("Rejection note:");
        if (note == null) { setBusy(""); return; }
        await window.HEYA_API.rejectReceipt(receiptId, note);
      }
      reload();
    } catch (err) {
      setActionError(err.message || "Action failed.");
    } finally {
      setBusy("");
    }
  }

  const columns = [
    { key: "id",        label: "Receipt ID",  render: (v) => <span className="mono" style={{ fontSize: 12 }}>{String(v).slice(0, 12)}</span> },
    { key: "userId",    label: "Customer" },
    { key: "amount",    label: "Amount",      render: (v) => v != null ? `$${(Number(v) / 100).toFixed(2)}` : "—" },
    { key: "status",    label: "Status",      render: (v) => <StatusBadge status={v} /> },
    { key: "createdAt", label: "Date",        render: (v) => <FmtDate value={v} /> },
    {
      key: "_actions", label: "Actions",
      render: (_, row) => row.status === "pending" ? (
        <div className="cluster" onClick={(e) => e.stopPropagation()}>
          <button className="btn accent sm" disabled={!!busy} onClick={() => handleAction("approve", row.id)}>
            {busy === "approve" + row.id ? "…" : "Approve"}
          </button>
          <button className="btn ghost sm" disabled={!!busy} onClick={() => handleAction("reject", row.id)}>
            {busy === "reject" + row.id ? "…" : "Reject"}
          </button>
        </div>
      ) : null,
    },
  ];

  return (
    <AdminPage title="Receipts" subtitle="Payment receipts pending review and approval."
      actions={<button className="btn ghost sm" onClick={reload}>Refresh</button>}
    >
      {actionError && <ErrorCard message={actionError} />}
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        <>
          <AdminSearchToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search receipts, customers, references, amounts, or status..."
            count={filteredReceipts.length}
            filters={[{
              key: "status",
              label: "Status",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: "all", label: `All (${statusCounts.all || 0})` },
                { value: "pending", label: `Pending (${statusCounts.pending || 0})` },
                { value: "approved", label: `Approved (${statusCounts.approved || 0})` },
                { value: "rejected", label: `Rejected (${statusCounts.rejected || 0})` },
                { value: "paid", label: `Paid (${statusCounts.paid || 0})` },
              ],
            }]}
          />
          <DataTable columns={columns} rows={filteredReceipts} />
        </>
      )}
    </AdminPage>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────

function ActivityView() {
  const { data, loading, error, reload } = useAdminData(() => window.HEYA_API.getActivity({ limit: 50 }));
  const [search, setSearch] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("all");
  const items = Array.isArray(data) ? data : (data?.activity || data?.items || []);
  const actionOptions = React.useMemo(() => {
    const counts = items.reduce((acc, item) => {
      const action = String(item.action || "unknown");
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {});
    return [
      { value: "all", label: `All actions (${items.length})` },
      ...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([action, count]) => ({
        value: action,
        label: `${action} (${count})`,
      })),
    ];
  }, [items]);
  const filteredItems = items.filter((item) => {
    const action = String(item.action || "unknown");
    return textMatchesRow(item, search) && (actionFilter === "all" || action === actionFilter);
  });

  const columns = [
    { key: "action",    label: "Action" },
    { key: "userId",    label: "User",   render: (v) => v ? <span className="mono" style={{ fontSize: 12 }}>{v}</span> : "—" },
    { key: "detail",    label: "Detail", render: (v) => v || "—" },
    { key: "ip",        label: "IP",     render: (v) => v ? <span className="mono" style={{ fontSize: 12 }}>{v}</span> : "—" },
    { key: "createdAt", label: "Time",   render: (v) => v ? new Date(v).toLocaleString() : "—" },
  ];

  return (
    <AdminPage title="Activity" subtitle="Admin audit log — recent system events and account actions."
      actions={<button className="btn ghost sm" onClick={reload}>Refresh</button>}
    >
      {loading && <LoadingCard />}
      {error && <ErrorCard message={error} />}
      {!loading && !error && (
        <>
          <AdminSearchToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search activity, users, IP addresses, details, or actions..."
            count={filteredItems.length}
            filters={[{
              key: "action",
              label: "Action",
              value: actionFilter,
              onChange: setActionFilter,
              options: actionOptions,
            }]}
          />
          <DataTable columns={columns} rows={filteredItems} />
        </>
      )}
    </AdminPage>
  );
}

// ── Hosting, Domains, VPS, Tickets — placeholders ─────────────────────────────

function AdminRelationshipView({ section, title, subtitle, tabs }) {
  const [activeTab, setActiveTab] = React.useState(tabs[0].id);
  const { data, loading, error } = useAdminData(() => window.HEYA_API.getControlPlaneSection(section));
  const tab = tabs.find((item) => item.id === activeTab) || tabs[0];
  const rows = data ? tab.rows(data) : [];
  const columns = [
    { key: "name", label: tab.primaryLabel || "Record", render: (row) => row.name || row.label || row.hostname || row.serviceName || row.action || row.eventType || row.id || "—" },
    { key: "owner", label: "Client / UID", render: (row) => row.clientId || row.createdByUserId || row.userId || row.organizationId || row.actorUserId || "—" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status || row.accountStatus || row.accessStatus || row.paymentStatus || "recorded"} /> },
    { key: "detail", label: tab.detailLabel || "Details", render: (row) => tab.detail(row) },
    { key: "updatedAt", label: "Updated", render: (row) => <FmtDate value={row.updatedAt || row.createdAt} /> },
  ];
  return (
    <AdminPage title={title} subtitle={subtitle}>
      <div className="admin-relationship-tabs" role="tablist" aria-label={title + " sections"}>
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setActiveTab(item.id)}>{item.label}</button>)}
      </div>
      {loading ? <LoadingCard /> : error ? <ErrorCard message={error} /> : <div className="admin-relationship-panel">
        <div className="admin-relationship-panel__head"><div><strong>{tab.label}</strong><span>{tab.description}</span></div><span className="mono">{rows.length} records</span></div>
        <DataTable columns={columns} rows={rows} />
      </div>}
    </AdminPage>
  );
}

const serviceRows = (data) => data.services || [];
const billingRows = (data) => data.billing || [];
const metadataValue = (row, ...keys) => keys.map((key) => row.metadata?.[key]).find((value) => value !== undefined && value !== null && value !== "") || "—";

function HostingView() {
  const tabs = [
    { id: "services", label: "Hosting Services", description: "Every database-backed hosting UID and its lifecycle.", rows: serviceRows, primaryLabel: "Hosting UID", detail: (r) => r.url || r.providerServiceId || r.plan || "—" },
    { id: "billing", label: "Billing / Usage", description: "Hosting plans, payment state, and usage-linked orders.", rows: (d) => [...serviceRows(d), ...billingRows(d)], detail: (r) => r.paymentStatus || r.totalAmountCents || r.totalPriceCents || r.plan || "—" },
    { id: "source", label: "Repository & Branch", description: "Repository, branch, and upload source for each hosting UID.", rows: serviceRows, detail: (r) => [metadataValue(r, "repository", "repo", "repoName"), metadataValue(r, "branch")].join(" / ") },
    { id: "logs", label: "Build Logs", description: "Build and deployment results for ZIP uploads and repository pulls.", rows: serviceRows, detail: (r) => metadataValue(r, "buildStatus", "lastBuildStatus", "failureReason") },
  ];
  return <AdminRelationshipView section="hosting" title="Hosting" subtitle="Hosting UIDs, billing, source repositories, branches, and build results." tabs={tabs} />;
}

function VpsView() {
  const tabs = [
    { id: "services", label: "VPS Services", description: "Every VPS UID running for a client.", rows: serviceRows, primaryLabel: "VPS UID", detail: (r) => [r.region, r.plan, r.mainIp].filter(Boolean).join(" · ") || "—" },
    { id: "billing", label: "Billing / Usage", description: "VPS rate, markup, plan, and payment state.", rows: (d) => [...serviceRows(d), ...billingRows(d)], detail: (r) => r.totalPriceCents || r.totalAmountCents || r.monthlyCostCents || r.paymentStatus || "—" },
    { id: "setup", label: "Server Setup", description: "Safe server setup information; credentials are never included.", rows: serviceRows, detail: (r) => [r.vcpuCount && r.vcpuCount + " vCPU", r.ramMb && r.ramMb + " MB", r.diskGb && r.diskGb + " GB"].filter(Boolean).join(" · ") || r.osName || "—" },
    { id: "reports", label: "Crash & Reports", description: "Recent VPS action failures and operational reports.", rows: (d) => serviceRows(d).flatMap((r) => (r.actionLogs || []).map((log) => ({ ...log, name: r.label || r.hostname, organizationId: r.organizationId }))), detail: (r) => r.errorMessage || r.action || "—" },
  ];
  return <AdminRelationshipView section="vps" title="VPS" subtitle="VPS UIDs, usage billing, server setup, and operational reports." tabs={tabs} />;
}

function DomainsView() {
  const tabs = [
    { id: "registered", label: "Registered Names", description: "Registered domain UIDs and lifecycle information.", rows: serviceRows, primaryLabel: "Domain", detail: (r) => r.providerServiceId || r.provider || r.expiresAt || "—" },
    { id: "dns", label: "DNS Records", description: "DNS and verification data stored against each domain service.", rows: serviceRows, detail: (r) => metadataValue(r, "dnsStatus", "verificationStatus", "nameservers") },
    { id: "billing", label: "Billing Info", description: "Registration, renewal, and domain billing records.", rows: (d) => [...serviceRows(d), ...billingRows(d)], detail: (r) => r.paymentStatus || r.totalAmountCents || r.totalPriceCents || r.billingCycle || "—" },
  ];
  return <AdminRelationshipView section="domains" title="Domain Names" subtitle="Registered names, DNS records, verification, renewals, and billing." tabs={tabs} />;
}

function EmailServicesView() {
  const tabs = [
    { id: "plans", label: "Plans & Billing", description: "Email service plans and related billing records.", rows: (d) => [...serviceRows(d), ...billingRows(d)], primaryLabel: "Email UID", detail: (r) => r.paymentStatus || r.totalAmountCents || r.totalPriceCents || r.billingCycle || "—" },
    { id: "dns", label: "DNS Status", description: "Connected email-domain DNS and verification state.", rows: serviceRows, detail: (r) => metadataValue(r, "dnsStatus", "verificationStatus", "domain") },
    { id: "mailboxes", label: "Mailboxes & Storage", description: "Mailbox totals and safe storage information per email domain.", rows: serviceRows, detail: (r) => metadataValue(r, "mailboxCount", "storageUsed", "storageLimit") },
    { id: "reports", label: "Crash & Reports", description: "Email service incidents and provider reports.", rows: serviceRows, detail: (r) => metadataValue(r, "incident", "lastError", "report") },
  ];
  return <AdminRelationshipView section="email" title="Emails" subtitle="Email UIDs, billing, DNS status, mailboxes, storage, and reports." tabs={tabs} />;
}

function SecurityDataView() {
  const tabs = [
    { id: "activity", label: "Activities per UID", description: "Auditable user, client, service, and administrator actions.", rows: (d) => d.audit || [], primaryLabel: "Activity", detail: (r) => [r.entityType, r.entityId].filter(Boolean).join(" / ") || r.path || "—" },
    { id: "analytics", label: "Customer Analytics", description: "Operational activity events kept separate from audit records.", rows: (d) => d.analytics || [], detail: (r) => r.eventType || r.path || "—" },
    { id: "incidents", label: "Incidents", description: "Service health, crash, and incident records.", rows: (d) => d.incidents || [], detail: (r) => r.summary || r.description || r.severity || "—" },
    { id: "watchdog", label: "Watchdog", description: "Security-relevant warnings and review state.", rows: (d) => d.watchdog || [], detail: (r) => r.message || r.severity || "—" },
  ];
  return <AdminRelationshipView section="security" title="Security Data" subtitle="Activities by UID, analytics, incidents, and watchdog events." tabs={tabs} />;
}

function TicketsView() {
  return (
    <AdminPage title="Tickets" subtitle="Customer support requests, complaints, and service tickets.">
      <PendingDataCard tab="Tickets" />
    </AdminPage>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function AdminSettingsView({ settings, onSaveSettings, onSaveAccountSettings }) {
  const accountSettings = settings?.accountSettings || {};
  const profile = settings?.profile || {};
  const [fullName, setFullName] = React.useState(accountSettings.fullName || profile.displayName || "");
  const [email, setEmail] = React.useState(accountSettings.email || profile.email || "");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await onSaveAccountSettings({ fullName, email });
      setNotice("Settings saved.");
    } catch (err) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage title="Settings" subtitle="Admin account and dashboard preferences.">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-head">
          <div className="card-title">Account details</div>
        </div>
        <form onSubmit={handleSave}>
          <div className="stack" style={{ gap: 14, padding: "0 0 16px" }}>
            <label style={{ display: "block" }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Full name</div>
              <input className="ifield" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
            </label>
            <label style={{ display: "block" }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Email</div>
              <input className="ifield" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            </label>
          </div>
          {notice && <div style={{ fontSize: 13, color: "var(--accent)", marginBottom: 10 }}>{notice}</div>}
          {error && <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
          <div className="card-foot">
            <button type="submit" className="btn accent" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </AdminPage>
  );
}

window.AdminSearchToolbar = AdminSearchToolbar;
window.adminTextMatchesRow = textMatchesRow;
window.adminCountByStatus = countByStatus;
window.adminStatusOf = statusOf;

window.CustomersView     = CustomerAccountsView;
window.DeploymentsView   = DeploymentsView;
window.BillingView       = BillingView;
window.ReceiptsView      = ReceiptsView;
window.ActivityView      = ActivityView;
window.HostingView       = HostingView;
window.DomainsView       = DomainsView;
window.VpsView           = VpsView;
window.EmailServicesView = EmailServicesView;
window.SecurityDataView  = SecurityDataView;
window.TicketsView       = TicketsView;
window.AdminSettingsView = AdminSettingsView;
