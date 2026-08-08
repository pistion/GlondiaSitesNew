// GlondiaSites Admin Dashboard — API client
// Exposed as window.HEYA_API for compatibility with all component references.
//
// Auth: reads glondia.accessToken from localStorage and sends it as
// "Authorization: Bearer <token>" on every request. On 401, redirects to
// the main GlondiaSites login page.

(function () {

  // ── Auth token helper ───────────────────────────────────────────────────────
  function getBearerToken() {
    try { return window.localStorage.getItem("glondia.accessToken") || ""; } catch { return ""; }
  }

  function getStoredUser() {
    try {
      const raw = window.localStorage.getItem("glondia.user");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function storeAuthSession(session) {
    try {
      if (session?.tokens?.accessToken)  window.localStorage.setItem("glondia.accessToken", session.tokens.accessToken);
      if (session?.tokens?.refreshToken) window.localStorage.setItem("glondia.refreshToken", session.tokens.refreshToken);
      if (session?.session?.id)          window.localStorage.setItem("glondia.sessionId", session.session.id);
      if (session?.organization?.id)     window.localStorage.setItem("glondia.organizationId", session.organization.id);
      if (session?.user)                 window.localStorage.setItem("glondia.user", JSON.stringify(session.user));
    } catch {}
  }

  function clearAuthSession() {
    try {
      ["glondia.accessToken", "glondia.refreshToken", "glondia.sessionId",
       "glondia.organizationId", "glondia.user"].forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  // ── Core request helper ─────────────────────────────────────────────────────
  async function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
    const token = getBearerToken();
    const authHeader = token ? { Authorization: "Bearer " + token } : {};
    const opts = {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...authHeader,
        ...headers,
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) {
      // Redirect to GlondiaSites login — clear stale token first
      clearAuthSession();
      const err = new Error("Your admin session has expired. Sign in again.");
      err.status = 401;
      throw err;
    }
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data?.error?.message || data?.message || "Request failed (" + res.status + ").");
    return data?.data ?? data;
  }

  // ── Field normalizers ───────────────────────────────────────────────────────
  // These make raw API shapes consistent for the dashboard views.

  function normalizeCustomer(u) {
    if (!u) return null;
    return {
      id:        u.id,
      email:     u.email || "",
      name:      u.name || u.email || u.id,
      username:  u.email ? u.email.split("@")[0] : u.id,
      role:      u.role || "member",
      status:    u.accountStatus || "active",
      planId:    u.planId || null,
      clientId:  u.clientId || null,
      phone:     u.phone || null,
      profileDetails: u.profileDetails || {},
      accountStatus: u.accountStatus || u.status || "active",
      updatedAt: u.updatedAt || null,
      disabledReason: u.disabledReason || null,
      disabledAt: u.disabledAt || null,
      deletedAt: u.deletedAt || null,
      promoEligible: u.promoEligible,
      promoSignupRank: u.promoSignupRank,
      promoClaimedAt: u.promoClaimedAt || null,
      avatarUrl: u.avatarUrl || null,
      createdAt: u.createdAt || null,
    };
  }

  function normalizeDeployment(d) {
    if (!d) return null;
    return {
      id:            d.deploymentId,
      name:          d.serviceName || d.deploymentId,
      userId:        d.userId || null,
      status:        d.status || "unknown",
      billingStatus: d.paymentStatus || "none",
      plan:          d.renderPlan || null,
      liveUrl:       d.liveUrl || null,
      renderPlan:    d.renderPlan || null,
      source:        d.source || null,
      createdAt:     d.createdAt || null,
      // keep originals accessible
      _raw: d,
    };
  }

  function normalizeOrder(o) {
    if (!o) return null;
    return {
      id:           o.id,
      userId:       o.userId || null,
      amount:       o.totalAmountCents != null ? o.totalAmountCents / 100 : null,
      currency:     o.currency || "PGK",
      status:       o.status || "unknown",
      description:  o.type || "deployment",
      deploymentId: o.deploymentId || null,
      createdAt:    o.createdAt || null,
    };
  }

  function normalizeReceipt(r) {
    if (!r) return null;
    const userId = r.userId || r.checkoutOrder?.userId || null;
    return {
      id:              r.id,
      userId:          userId,
      amount:          r.amountCents != null ? r.amountCents / 100 : null,
      currency:        r.currency || "PGK",
      status:          r.status || "pending",
      fileName:        r.fileName || null,
      checkoutOrderId: r.checkoutOrderId || null,
      deploymentId:    r.deploymentId || r.checkoutOrder?.deploymentId || null,
      createdAt:       r.createdAt || null,
    };
  }

  function normalizeActivity(a) {
    if (!a) return null;
    return {
      id:        a.id,
      action:    a.action || a.event || a.type || "event",
      userId:    a.userId || a.actorId || null,
      detail:    a.detail || a.description || a.message || null,
      ip:        a.ipAddress || a.ip || null,
      createdAt: a.createdAt || a.timestamp || null,
    };
  }

  // ── API surface ─────────────────────────────────────────────────────────────

  window.HEYA_API = {

    // ── Auth ──────────────────────────────────────────────────────────────────
    getStoredUser,
    hasAdminToken() {
      const user = getStoredUser();
      return Boolean(getBearerToken() && user?.role === "admin");
    },
    async loginAdmin(email, password) {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || data?.message || "Login failed.");
      const session = data?.data || data;
      if (session?.user?.role !== "admin") {
        clearAuthSession();
        throw new Error("This dashboard is restricted to GlondiaSites administrators.");
      }
      storeAuthSession(session);
      return session;
    },
    async requireAdminSession() {
      if (!getBearerToken()) {
        const err = new Error("Admin sign-in required.");
        err.status = 401;
        throw err;
      }
      const data = await apiRequest("/api/v1/auth/me");
      const user = data?.user || data;
      if (user?.role !== "admin") {
        clearAuthSession();
        const err = new Error("This dashboard is restricted to GlondiaSites administrators.");
        err.status = 403;
        throw err;
      }
      try { window.localStorage.setItem("glondia.user", JSON.stringify(user)); } catch {}
      return user;
    },
    async logout() {
      const refreshToken = (() => {
        try { return window.localStorage.getItem("glondia.refreshToken"); } catch { return null; }
      })();
      try {
        if (refreshToken) {
          await apiRequest("/api/v1/auth/logout", { method: "POST", body: { refreshToken } });
        }
      } finally {
        clearAuthSession();
      }
      return { redirectTo: "/dashboard?logged-out=1" };
    },

    // ── Admin overview ────────────────────────────────────────────────────────
    getAdminOverview() {
      return apiRequest("/api/admin/overview");
    },

    // Compatibility shim — keeps app.jsx initial load working
    getDashboardData() {
      return Promise.resolve({});
    },
    getRefreshConfig() {
      return Promise.resolve({ intervalMs: 60000 });
    },

    // ── Settings — use the current user from localStorage (no separate endpoint) ──
    getSettings() {
      const user = getStoredUser();
      return Promise.resolve({
        settings: {
          profile: user ? { displayName: user.name || user.email, username: user.email?.split("@")[0], email: user.email, avatarUrl: user.avatarUrl || null } : null,
          accountSettings: user ? { fullName: user.name || "", email: user.email || "", avatarUrl: user.avatarUrl || null } : null,
        },
      });
    },
    updateSettings(payload) {
      // Settings update goes through the profile endpoint
      return apiRequest("/api/v1/auth/profile", { method: "PATCH", body: payload }).catch(() => ({ settings: payload }));
    },
    getAccountSettings() {
      return this.getSettings().then((d) => ({ accountSettings: d.settings?.accountSettings || null }));
    },
    updateAccountSettings(payload) {
      return apiRequest("/api/v1/auth/profile", { method: "PATCH", body: payload }).catch(() => ({}));
    },

    // ── Customers ─────────────────────────────────────────────────────────────
    listCustomers() {
      return apiRequest("/api/admin/users")
        .then((d) => (Array.isArray(d) ? d : (d?.users || d?.items || [])).map(normalizeCustomer));
    },
    getControlPlaneSection(section) {
      return apiRequest("/api/admin/control-plane/" + encodeURIComponent(section));
    },
    getCustomer(userId) {
      const base = "/api/admin/customers/" + encodeURIComponent(userId);
      return Promise.all([
        apiRequest(base + "/overview"),
        apiRequest(base + "/services?limit=100"),
        apiRequest(base + "/billing?limit=100"),
        apiRequest(base + "/operations?limit=100"),
        apiRequest(base + "/activity?limit=100"),
      ]).then(([overview, services, billing, operations, activity]) => ({
        ...overview,
        user: normalizeCustomer(overview.customer),
        customer: overview.customer,
        services: services.items || overview.services || [],
        access: (services.items || []).filter((item) => item.accessId || item.accessStatus),
        billing: {
          orders: billing.orders?.items || overview.billing?.orders || [],
          receipts: billing.receipts?.items || overview.billing?.receipts || [],
          subscriptions: billing.subscriptions?.items || overview.billing?.subscriptions || [],
          invoices: billing.invoices?.items || overview.billing?.invoices || [],
          creditNotes: billing.creditNotes?.items || overview.billing?.creditNotes || [],
          paymentMethods: billing.paymentMethods?.items || overview.billing?.paymentMethods || [],
        },
        operations,
        activity: activity.audit?.items || overview.activity || [],
        adminCommands: activity.adminCommands || overview.adminCommands || [],
      }));
    },
    updateCustomer(userId, patch) {
      return apiRequest("/api/admin/users/" + encodeURIComponent(userId), { method: "PATCH", body: patch });
    },
    suspendCustomer(userId, reason) {
      return apiRequest("/api/admin/users/" + encodeURIComponent(userId) + "/suspend", { method: "POST", body: { reason } });
    },
    disableCustomer(userId, reason) {
      return apiRequest("/api/admin/users/" + encodeURIComponent(userId) + "/disable", { method: "POST", body: { reason } });
    },
    reactivateCustomer(userId, resumeDeployments) {
      return apiRequest("/api/admin/users/" + encodeURIComponent(userId) + "/reactivate", { method: "POST", body: { resumeDeployments: !!resumeDeployments } });
    },
    deleteCustomer(userId, reason) {
      return apiRequest("/api/admin/users/" + encodeURIComponent(userId) + "/delete", { method: "POST", body: { reason } });
    },

    // ── Deployments ───────────────────────────────────────────────────────────
    listDeployments() {
      return apiRequest("/api/admin/deployments")
        .then((d) => (Array.isArray(d) ? d : (d?.deployments || d?.items || [])).map(normalizeDeployment));
    },
    markDeploymentPaid(deploymentId) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/mark-paid", { method: "POST" });
    },
    suspendDeployment(deploymentId, reason) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/suspend", { method: "POST", body: { reason } });
    },
    reactivateDeployment(deploymentId) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/reactivate", { method: "POST" });
    },
    approveDeploymentBilling(deploymentId) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/approve-billing", { method: "POST" });
    },
    renewDeploymentManually(deploymentId) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/renew-manually", { method: "POST" });
    },
    deleteDeployment(deploymentId) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/delete", { method: "POST" });
    },
    setDeploymentRenderPlan(deploymentId, plan, redeploy) {
      return apiRequest("/api/admin/deployments/" + encodeURIComponent(deploymentId) + "/render-plan", { method: "POST", body: { plan, redeploy: !!redeploy } });
    },

    // ── Billing / Orders ──────────────────────────────────────────────────────
    listOrders() {
      return apiRequest("/api/admin/orders")
        .then((d) => (Array.isArray(d) ? d : (d?.orders || d?.items || [])).map(normalizeOrder));
    },
    deleteOrder(orderId) {
      return apiRequest("/api/admin/orders/" + encodeURIComponent(orderId) + "/delete", { method: "POST" });
    },

    // ── Receipts ──────────────────────────────────────────────────────────────
    listReceipts() {
      return apiRequest("/api/admin/receipts")
        .then((d) => (Array.isArray(d) ? d : (d?.receipts || d?.items || [])).map(normalizeReceipt));
    },
    approveReceipt(receiptId) {
      return apiRequest("/api/admin/receipts/" + encodeURIComponent(receiptId) + "/approve", { method: "POST" });
    },
    rejectReceipt(receiptId, note) {
      return apiRequest("/api/admin/receipts/" + encodeURIComponent(receiptId) + "/reject", { method: "POST", body: { note } });
    },

    // ── Activity ──────────────────────────────────────────────────────────────
    getActivity(params) {
      const qs = params ? "?" + new URLSearchParams(params) : "";
      return apiRequest("/api/admin/activity" + qs)
        .then((d) => {
          const items = Array.isArray(d) ? d : (d?.items || d?.activity || d?.logs || []);
          return { items: items.map(normalizeActivity) };
        });
    },

    // ── Config status ─────────────────────────────────────────────────────────
    getConfigStatus() {
      return apiRequest("/api/admin/config-status").catch(() => ({}));
    },

    // ── Notifications — real GlondiaSites endpoints ───────────────────────────
    getRecentNotifications(limit) {
      const qs = limit ? "?limit=" + limit + "&unread=false" : "";
      return apiRequest("/api/notifications" + qs)
        .then((d) => {
          const items = Array.isArray(d) ? d : (d?.items || d?.notifications || []);
          const unread = items.filter((n) => !n.readAt).length;
          return {
            notifications: items.slice(0, limit || 10).map((n) => ({
              id:     n.id,
              title:  n.title || n.message || "Notification",
              detail: n.body || n.detail || null,
              status: n.readAt ? "read" : "unread",
              tone:   n.type || "info",
              createdAt: n.createdAt || null,
            })),
            summary: { total: items.length, unread, read: items.length - unread },
          };
        })
        .catch(() => ({ notifications: [], summary: { total: 0, unread: 0, read: 0 } }));
    },
    getNotificationUnreadCount() {
      return apiRequest("/api/notifications/unread-count")
        .then((d) => ({ summary: { unread: d?.count || 0 } }))
        .catch(() => ({ summary: { unread: 0 } }));
    },
    markNotificationRead(id) {
      return apiRequest("/api/notifications/" + encodeURIComponent(id) + "/read", { method: "POST" }).catch(() => ({}));
    },
    markAllNotificationsRead() {
      return apiRequest("/api/notifications/read-all", { method: "POST" }).catch(() => ({}));
    },
    deleteNotification(id) {
      return apiRequest("/api/notifications/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => ({}));
    },

    // ── Inbox messages — no dedicated endpoint yet; return empty gracefully ────
    getRecentMessages() {
      return Promise.resolve({ messages: [], summary: { total: 0, unread: 0 } });
    },
    getMessageUnreadCount() {
      return Promise.resolve({ summary: { unread: 0 } });
    },
    markMessageRead() {
      return Promise.resolve({});
    },
    markAllMessagesRead() {
      return Promise.resolve({});
    },

    // ── Global search — no dedicated endpoint yet; return empty gracefully ─────
    // ── CRM Service Requests (intake — not support tickets) ─────────────────
    getCrmServiceRequests(params = {}) {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v != null && v !== "" && v !== "all") qs.set(k, v);
      });
      const path = "/api/admin/crm/service-requests" + (qs.toString() ? "?" + qs.toString() : "");
      return apiRequest(path).then((d) => ({
        serviceRequests: Array.isArray(d?.serviceRequests) ? d.serviceRequests : [],
        total: d?.total ?? 0,
        limit: d?.limit,
        offset: d?.offset,
      }));
    },
    getCrmServiceRequest(id) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id))
        .then((d) => d?.serviceRequest || d);
    },
    createCrmServiceRequest(payload) {
      return apiRequest("/api/admin/crm/service-requests", {
        method: "POST",
        body: JSON.stringify(payload || {}),
      }).then((d) => d?.serviceRequest || d);
    },
    updateCrmServiceRequest(id, patch) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(patch || {}),
      }).then((d) => d?.serviceRequest || d);
    },
    markCrmServiceRequestContacted(id, note) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id) + "/contacted", {
        method: "POST",
        body: JSON.stringify({ note: note || "" }),
      }).then((d) => d?.serviceRequest || d);
    },
    convertCrmServiceRequestToLead(id) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id) + "/convert-to-lead", {
        method: "POST",
        body: JSON.stringify({}),
      }).then((d) => d?.serviceRequest || d);
    },
    convertCrmServiceRequestToTicket(id) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id) + "/convert-to-ticket", {
        method: "POST",
        body: JSON.stringify({}),
      }).then((d) => d?.serviceRequest || d);
    },
    deleteCrmServiceRequest(id) {
      return apiRequest("/api/admin/crm/service-requests/" + encodeURIComponent(id), {
        method: "DELETE",
      });
    },
    bulkCrmServiceRequests({ ids = [], action } = {}) {
      // Soft bulk: sequential updates (no dedicated bulk route required)
      const list = Array.isArray(ids) ? ids : [];
      if (action === "delete") {
        return Promise.allSettled(list.map((id) => window.HEYA_API.deleteCrmServiceRequest(id)))
          .then((results) => ({
            processed: results.filter((r) => r.status === "fulfilled").length,
            failed: results.filter((r) => r.status === "rejected"),
          }));
      }
      return Promise.resolve({ processed: 0, updated: 0 });
    },
    getCrmEmailHealth() {
      return Promise.resolve({ configured: false, ok: false, message: "CRM email backend is not connected yet." });
    },
    // ── CRM contact emails (client accounts + captured contacts) ─────────────
    listCrmContacts(params = {}) {
      const qs = new URLSearchParams();
      if (params.listType) qs.set("listType", params.listType);
      if (params.q) qs.set("q", params.q);
      if (params.limit) qs.set("limit", String(params.limit));
      const path = "/api/admin/crm/contacts" + (qs.toString() ? "?" + qs.toString() : "");
      return apiRequest(path).then((d) => d?.contacts || d?.items || d || []);
    },
    getCrmContactsOverview() {
      return apiRequest("/api/admin/crm/contacts/overview").then((d) => d || {});
    },
    listCrmEmailLists() {
      return apiRequest("/api/admin/crm/email-lists").then((d) => d?.lists || d || []);
    },
    syncCrmContacts() {
      return apiRequest("/api/admin/crm/contacts/sync", { method: "POST" });
    },
    captureCrmContact(payload = {}) {
      return apiRequest("/api/admin/crm/contacts", { method: "POST", body: payload })
        .then((d) => d?.contact || d);
    },
    listCrmEmailMessages() {
      return Promise.resolve({ messages: [], items: [], summary: { total: 0, unread: 0 } });
    },
    getCrmEmailCounts() {
      return Promise.resolve({ counts: {}, summary: { total: 0, unread: 0 } });
    },
    syncCrmEmailInbox() {
      return Promise.resolve({ synced: false, message: "CRM inbox backend is not connected yet." });
    },
    markCrmEmailRead() {
      return Promise.resolve({});
    },
    starCrmEmail() {
      return Promise.resolve({});
    },
    markCrmEmailImportant() {
      return Promise.resolve({});
    },
    archiveCrmEmail() {
      return Promise.resolve({});
    },
    trashCrmEmail() {
      return Promise.resolve({});
    },
    restoreCrmEmail() {
      return Promise.resolve({});
    },
    spamCrmEmail() {
      return Promise.resolve({});
    },
    deleteCrmEmailForever() {
      return Promise.resolve({});
    },
    sendCrmEmail() {
      return Promise.resolve({ ok: false, message: "CRM email backend is not connected yet." });
    },
    createCrmEmailDraft(payload = {}) {
      return Promise.resolve({ draft: { id: "draft-" + Date.now(), ...payload } });
    },
    updateCrmEmailDraft(id, patch = {}) {
      return Promise.resolve({ draft: { id, ...patch } });
    },
    getCrmToolStatus() {
      return Promise.resolve({ tools: [], providers: {}, connected: false });
    },
    startSocialAuth(provider) {
      return Promise.resolve({ provider, authUrl: null, connected: false, message: "CRM social backend is not connected yet." });
    },
    disconnectSocial(provider) {
      return Promise.resolve({ provider, disconnected: false });
    },
    getCrmAiConversation(uid) {
      return Promise.resolve({ conversation: { uid, messages: [] } });
    },
    archiveCrmAiConversation(uid) {
      return Promise.resolve({ uid, archived: false });
    },
    runCrmAiChat() {
      return Promise.resolve({ ok: false, message: "CRM AI backend is not connected yet.", content: "CRM AI backend is not connected yet." });
    },
    confirmCrmAiAction() {
      return Promise.resolve({ ok: false, message: "CRM action backend is not connected yet." });
    },

    // ── Public bot / website bots — no backend endpoint yet ──────────────────
    getPublicBotSessions()        { return Promise.resolve({ sessions: [] }); },
    getPublicBotSessionMessages() { return Promise.resolve({ messages: [] }); },
    getPublicBotQuestions()       { return Promise.resolve({ questions: [] }); },
    getPublicBotKnowledge()       { return Promise.resolve({ entries: [] }); },
    createPublicBotKnowledge()    { return Promise.resolve({}); },
    updatePublicBotKnowledge()    { return Promise.resolve({}); },
    sendPublicBotFeedback()       { return Promise.resolve({}); },

    globalSearch() {
      return Promise.resolve({ results: [] });
    },

    // ── Tickets (admin) ───────────────────────────────────────────────────────
    listAdminTickets(params = {}) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
      return apiRequest("/api/admin/tickets" + (qs ? "?" + qs : ""))
        .then((d) => ({ items: d?.items || [], total: d?.total || 0 }))
        .catch(() => ({ items: [], total: 0 }));
    },
    getAdminTicket(id) {
      return apiRequest("/api/admin/tickets/" + encodeURIComponent(id))
        .catch(() => null);
    },
    replyAdminTicket(id, body) {
      return apiRequest("/api/admin/tickets/" + encodeURIComponent(id) + "/reply", { method: "POST", body: { body } });
    },
    updateAdminTicket(id, data) {
      return apiRequest("/api/admin/tickets/" + encodeURIComponent(id), { method: "PATCH", body: data });
    },

    // ── Service Access management ─────────────────────────────────────────────
    listServiceAccess(params = {}) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
      return apiRequest("/api/admin/service-access" + (qs ? "?" + qs : ""))
        .then((d) => ({ items: d?.items || [], total: d?.total || 0, limit: d?.limit || 30, offset: d?.offset || 0 }))
        .catch(() => ({ items: [], total: 0 }));
    },
    getServiceAccess(id) {
      return apiRequest("/api/admin/service-access/" + encodeURIComponent(id)).catch(() => null);
    },
    updateServiceAccess(id, patch) {
      return apiRequest("/api/admin/service-access/" + encodeURIComponent(id), { method: "PATCH", body: patch });
    },
    suspendServiceAccess(id, reason) {
      return apiRequest("/api/admin/service-access/" + encodeURIComponent(id) + "/suspend", { method: "POST", body: { reason } });
    },
    reactivateServiceAccess(id) {
      return apiRequest("/api/admin/service-access/" + encodeURIComponent(id) + "/reactivate", { method: "POST" });
    },

    // ── DashboardWarnings ─────────────────────────────────────────────────────
    listWarnings(params = {}) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
      return apiRequest("/api/admin/warnings" + (qs ? "?" + qs : ""))
        .then((d) => ({ items: d?.items || [], total: d?.total || 0 }))
        .catch(() => ({ items: [], total: 0 }));
    },
    dismissWarning(id) {
      return apiRequest("/api/admin/warnings/" + encodeURIComponent(id) + "/dismiss", { method: "POST" }).catch(() => ({}));
    },
    escalateWarning(id) {
      return apiRequest("/api/admin/warnings/" + encodeURIComponent(id) + "/escalate", { method: "POST" }).catch(() => ({}));
    },

    // ── WatchdogEvents ────────────────────────────────────────────────────────
    listWatchdog(params = {}) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
      return apiRequest("/api/admin/watchdog" + (qs ? "?" + qs : ""))
        .then((d) => ({ items: d?.items || [], total: d?.total || 0 }))
        .catch(() => ({ items: [], total: 0 }));
    },
    reviewWatchdog(id, note) {
      return apiRequest("/api/admin/watchdog/" + encodeURIComponent(id) + "/review", { method: "POST", body: note ? { note } : {} }).catch(() => ({}));
    },
    dismissWatchdog(id) {
      return apiRequest("/api/admin/watchdog/" + encodeURIComponent(id) + "/dismiss", { method: "POST" }).catch(() => ({}));
    },
  };

})();
