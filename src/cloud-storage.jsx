import React, { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Empty, StatusBadge, Tabs } from "./components";
import { ICN } from "./icons";
import SandboxBanner from "./features/sandbox/SandboxBanner.jsx";
import {
  configureCloudStorageRepository,
  clearCloudDriveSession,
  createCloudStoragePayment,
  createCloudStorageRestorePoint,
  createCloudStorageService,
  deleteCloudStorageObject,
  getCloudStorageBilling,
  getCloudStorageCatalog,
  getCloudStorageCredentials,
  getCloudStorageLogs,
  getCloudStorageService,
  getCloudStorageUsage,
  getCloudDriveSecurity,
  revealCloudDrivePassword,
  updateCloudDrivePassword,
  loginCloudDrive,
  storeCloudDriveSession,
  verifyCloudDriveSession,
  listCloudStorageObjects,
  listCloudStorageRestorePoints,
  listCloudStorageServices,
  permanentlyDeleteCloudStorageObject,
  quoteCloudStorage,
  registerCloudStorageObject,
  restoreCloudStorageObject,
  restoreCloudStoragePoint,
  updateCloudStorageSettings,
} from "./api/cloudStorage.js";

const TYPES = [
  [
    "postgres",
    "Managed PostgreSQL",
    "Database",
    "PostgreSQL 15 or 16 with backups, pooling and trusted networks.",
  ],
  [
    "ssh_backup",
    "SSH Backup",
    "Archive",
    "Restricted SFTP and rsync backup space with recovery points.",
  ],
  [
    "private_vault",
    "Private File Storage",
    "Folder",
    "A private cloud hard drive for storing, organizing and accessing your files.",
  ],
  [
    "private_repository",
    "Private Repository",
    "Git",
    "Private Git history, deploy keys and branch-based hosting redeploys.",
  ],
];
const LABEL = Object.fromEntries(TYPES.map(([id, name]) => [id, name]));
const gb = (bytes) =>
  `${Math.round(Number(bytes || 0) / 1073741824).toLocaleString()} GB`;
const storagePercent = (used, capacity) =>
  Math.min(
    100,
    Math.max(0, (Number(used || 0) / Math.max(1, Number(capacity || 0))) * 100),
  );
const money = (cents, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    Number(cents || 0) / 100,
  );
const generateDatabasePassword = () => {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";
  const values = new Uint32Array(24);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
};

function Notice({ message, error }) {
  if (!message && !error) return null;
  return (
    <div className={`cloud-storage-notice ${error ? "is-error" : ""}`}>
      {error || message}
    </div>
  );
}

export function CloudStorageList({ navigate }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    listCloudStorageServices()
      .then(setServices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <SandboxBanner service="cloud-storage" />
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Infrastructure</div>
          <h1>Cloud Storage</h1>
          <p className="sub">
            Databases, private file storage, backups and private
            repositories—managed as Glondia services.
          </p>
        </div>
        {!loading && services.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={() => navigate({ view: "cloud-storage-create" })}
          >
            <ICN.Plus size={15} /> Add service
          </button>
        )}
      </div>
      <Notice error={error} />
      <div className="section-head cloud-storage-list-head">
        <div>
          <h2>Your services</h2>
        </div>
      </div>
      {loading ? (
        <div className="card cloud-storage-pad">Loading database records…</div>
      ) : services.length === 0 ? (
        <Empty
          icon="Database"
          title="No Cloud Storage services yet"
          body="Add a service when you are ready. We will guide you through the choices one step at a time."
          action={
            <button
              className="btn btn-primary"
              onClick={() => navigate({ view: "cloud-storage-create" })}
            >
              <ICN.Plus size={14} /> Add your first service
            </button>
          }
        />
      ) : (
        <div className="cloud-storage-service-list">
          {services.map((service) => {
            const serviceType = TYPES.find(
              ([kind]) => kind === service.serviceKind,
            );
            const ServiceIcon = ICN[serviceType?.[2]] || ICN.Database;
            const isCloudDrive = service.serviceKind === "private_vault";
            const storageLabel = {
              postgres: "Database storage",
              ssh_backup: "Backup storage",
              private_vault: "MyDrive storage",
              private_repository: "Repository storage",
            }[service.serviceKind] || "Cloud storage";
            const usedPercent = storagePercent(
              service.storageUsedBytes,
              service.capacityBytes,
            );
            const availableBytes = Math.max(
              0,
              Number(service.capacityBytes || 0) -
                Number(service.storageUsedBytes || 0),
            );
            return (
              <button
                className="cloud-storage-service-row is-cloud-drive"
                key={service.id}
                onClick={() =>
                  navigate({
                    view: "cloud-storage-detail",
                    params: { id: service.id },
                  })
                }
              >
                <span className="cloud-storage-service-main">
                  {isCloudDrive ? (
                    <span className="cloud-storage-drive-glyph" aria-hidden="true">
                      <span className="cloud-storage-drive-mark"><i /><i /><i /><i /></span>
                      <span className="cloud-storage-drive-body"><i /></span>
                    </span>
                  ) : (
                    <span className="cloud-storage-service-icon">
                      <ServiceIcon size={28} />
                    </span>
                  )}
                  <span className="cloud-storage-service-copy">
                    <strong>{service.name}</strong>
                    <span>{LABEL[service.serviceKind]}</span>
                    <small>
                      {service.tenancy} · {service.region}
                    </small>
                  </span>
                </span>
                <span className="cloud-storage-drive-overview">
                  <span className="cloud-storage-drive-title">
                    <strong>{storageLabel}</strong>
                    <span>{Math.round(usedPercent)}% used</span>
                  </span>
                  <span
                    className="cloud-storage-drive-meter"
                    role="meter"
                    aria-label={`${service.name} storage used`}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={Math.round(usedPercent)}
                  >
                    <span style={{ width: `${usedPercent}%` }} />
                  </span>
                  <span className="cloud-storage-drive-totals">
                    <strong>{gb(service.storageUsedBytes)} used</strong>
                    <span>
                      {gb(availableBytes)} free of {gb(service.capacityBytes)}
                    </span>
                  </span>
                </span>
                <span className="cloud-storage-service-side">
                  <StatusBadge status={service.status} />
                  <span className="cloud-storage-service-open">
                    Open <ICN.ArrowRight size={14} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function CloudStorageCreate({ navigate, initialKind = "postgres", initialProjectId = "" }) {
  const [catalog, setCatalog] = useState(null);
  const [form, setForm] = useState({
    serviceKind: initialKind,
    tenancy: "shared",
    planSize: initialKind === "postgres" ? "10gb" : "smallest",
    region: "syd",
    postgresVersion: "16",
    name: "",
    externalAccessEnabled: false,
    externalPassword: "",
    trustedNetworks: [],
  });
  const [step, setStep] = useState(1);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showExternalPassword, setShowExternalPassword] = useState(false);
  useEffect(() => {
    getCloudStorageCatalog()
      .then(setCatalog)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!catalog) return;
    quoteCloudStorage(form)
      .then(setQuote)
      .catch((e) => setError(e.message));
  }, [
    catalog,
    form.serviceKind,
    form.tenancy,
    form.planSize,
    form.region,
    form.postgresVersion,
  ]);
  const plans = useMemo(
    () =>
      (catalog?.plans || []).filter(
        (p) => p.serviceKind === form.serviceKind && p.tenancy === form.tenancy,
      ),
    [catalog, form.serviceKind, form.tenancy],
  );
  const selectedPlan = plans.find((plan) => plan.size === form.planSize);
  const selectedRegion = (catalog?.regions || []).find(
    (region) => region.id === form.region,
  );
  const selectedType = TYPES.find(([kind]) => kind === form.serviceKind);
  const SelectedServiceIcon = ICN[selectedType?.[2]] || ICN.Database;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const service = await createCloudStorageService({
        ...form,
        clientProjectId: initialProjectId || undefined,
        trustedNetworks: form.trustedNetworks
          .map((value) => value.trim())
          .filter(Boolean),
        name: form.name || `${LABEL[form.serviceKind]} service`,
      });
      if (service.status === "pending_payment") {
        const payment = await createCloudStoragePayment(service.id);
        window.location.assign(payment.approvalUrl);
        return;
      }
      navigate({ view: "cloud-storage-detail", params: { id: service.id } });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <>
      <SandboxBanner service="cloud-storage" />
      <div className="page-head">
        <div>
          <button
            className="cloud-storage-back"
            onClick={() => navigate({ view: "cloud-storage" })}
          >
            <ICN.ArrowLeft size={14} /> Cloud Storage
          </button>
          <div className="page-eyebrow">Add service</div>
          <h1>What would you like to store?</h1>
          <p className="sub">
            Start with the service you need. We will guide you through tenancy,
            location and plan size next.
          </p>
        </div>
      </div>
      <Notice error={error} />
      <div className="cloud-storage-wizard">
        <div className="cloud-storage-stepper">
          {["Service", "Tenancy", "Plan", "Confirm"].map((label, index) => (
            <span className={step >= index + 1 ? "is-active" : ""} key={label}>
              <b>{index + 1}</b>
              {label}
            </span>
          ))}
        </div>
        {step === 1 && (
          <section className="dashboard-view-enter">
            <div className="cloud-storage-section-title">
              <span className="cloud-storage-section-icon">
                <ICN.Database size={24} />
              </span>
              <div>
                <h3>Choose a service</h3>
                <p>Select the kind of private storage your work needs.</p>
              </div>
            </div>
            <div className="cloud-storage-choice-grid">
              {TYPES.map(([id, title, icon, description]) => {
                const Icon = ICN[icon];
                return (
                  <button
                    key={id}
                    className={`cloud-storage-choice service-choice ${form.serviceKind === id ? "is-selected" : ""}`}
                    onClick={() =>
                      setForm({
                        ...form,
                        serviceKind: id,
                        planSize: id === "postgres" ? "10gb" : "smallest",
                      })
                    }
                  >
                    <span className="cloud-storage-choice-icon">
                      <Icon size={28} />
                    </span>
                    <strong>{title}</strong>
                    <span>{description}</span>
                    <small>
                      {form.serviceKind === id ? "Selected" : "Select service"}{" "}
                      <ICN.ArrowRight size={13} />
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="cloud-storage-wizard-actions">
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                Continue <ICN.ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="dashboard-view-enter">
            <div className="cloud-storage-section-title">
              <span className="cloud-storage-section-icon">
                <ICN.Server size={24} />
              </span>
              <div>
                <h3>Choose how it is hosted</h3>
                <p>
                  Pick shared infrastructure or a separate dedicated resource.
                </p>
              </div>
            </div>
            <div className="cloud-storage-choice-grid two">
              {[
                [
                  "shared",
                  "Shared",
                  "Isolated space on managed Glondia infrastructure",
                  "Cloud",
                ],
                [
                  "dedicated",
                  "Dedicated",
                  "A separate managed resource or server bundle",
                  "Server",
                ],
              ].map(([id, title, copy, icon]) => {
                const Icon = ICN[icon];
                return (
                  <button
                    key={id}
                    className={`cloud-storage-choice tall tenancy-choice ${form.tenancy === id ? "is-selected" : ""}`}
                    onClick={() => setForm({ ...form, tenancy: id })}
                  >
                    <span className="cloud-storage-choice-icon">
                      <Icon size={30} />
                    </span>
                    <strong>{title}</strong>
                    <span>{copy}</span>
                    <small>
                      {form.tenancy === id ? "Selected" : "Choose option"}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="cloud-storage-wizard-actions">
              <button className="btn btn-outline" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                Continue <ICN.ArrowRight size={14} />
              </button>
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="dashboard-view-enter">
            <div className="cloud-storage-section-title">
              <span className="cloud-storage-section-icon">
                <ICN.ChartBar size={24} />
              </span>
              <div>
                <h3>Choose a plan and location</h3>
                <p>
                  {form.serviceKind === "postgres"
                    ? "Choose 10 GB, 50 GB or 100 GB for your database."
                    : "Choose the storage size that fits your work."}
                </p>
              </div>
            </div>
            <div className="cloud-storage-plan-grid">
              {(form.serviceKind === "postgres"
                ? ["10gb", "50gb", "100gb"]
                : ["smallest", "largest"]
              ).map((size) => {
                const plan = plans.find((p) => p.size === size);
                return (
                  <button
                    key={size}
                    className={`cloud-storage-plan ${form.planSize === size ? "is-selected" : ""}`}
                    onClick={() => setForm({ ...form, planSize: size })}
                  >
                    <Badge>{size}</Badge>
                    <strong>
                      {plan ? money(plan.totalPriceCents, plan.currency) : "—"}
                      <small>/month</small>
                    </strong>
                    <span>
                      {plan
                        ? `${gb(plan.capacityBytes)} storage · ${gb(plan.transferIncludedBytes)} transfer`
                        : "Loading verified plan…"}
                    </span>
                    <small>
                      {form.planSize === size
                        ? "Selected plan"
                        : "Select this plan"}
                    </small>
                  </button>
                );
              })}
            </div>
            {form.serviceKind === "postgres" && (
              <div
                className={`cloud-storage-postgres-access ${form.externalAccessEnabled ? "is-enabled" : ""}`}
              >
                <div className="cloud-storage-postgres-access-head">
                  <span className="cloud-storage-postgres-access-icon">
                    <ICN.ShieldCheck size={22} />
                  </span>
                  <div>
                    <strong>External database access</strong>
                    <small>
                      Connect applications running outside the Glondia private
                      network.
                    </small>
                  </div>
                  <label className="cloud-storage-access-switch">
                    <input
                      type="checkbox"
                      checked={form.externalAccessEnabled}
                      onChange={(e) => {
                        if (!e.target.checked) setShowExternalPassword(false);
                        setForm({
                          ...form,
                          externalAccessEnabled: e.target.checked,
                          externalPassword: e.target.checked
                            ? form.externalPassword
                            : "",
                        });
                      }}
                    />
                    <span aria-hidden="true" />
                    <em>{form.externalAccessEnabled ? "On" : "Off"}</em>
                  </label>
                </div>
                {form.externalAccessEnabled && (
                  <div className="cloud-storage-postgres-access-body dashboard-view-enter">
                    <div className="cloud-storage-postgres-access-fields">
                      <label>
                        <span>Connection password</span>
                        <div className="cloud-storage-password-input">
                          <input
                            type={showExternalPassword ? "text" : "password"}
                            minLength={12}
                            autoComplete="new-password"
                            value={form.externalPassword}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                externalPassword: e.target.value,
                              })
                            }
                            placeholder="Minimum 12 characters"
                          />
                          <button
                            type="button"
                            className="is-generate"
                            aria-label="Generate secure password"
                            title="Generate secure password"
                            onClick={() =>
                              setForm({
                                ...form,
                                externalPassword: generateDatabasePassword(),
                              })
                            }
                          >
                            <ICN.RefreshCw size={15} />
                          </button>
                          <button
                            type="button"
                            className="is-visibility"
                            aria-label={
                              showExternalPassword
                                ? "Hide password"
                                : "Show password"
                            }
                            title={
                              showExternalPassword
                                ? "Hide password"
                                : "Show password"
                            }
                            onClick={() =>
                              setShowExternalPassword(
                                (currentValue) => !currentValue,
                              )
                            }
                          >
                            {showExternalPassword ? (
                              <ICN.EyeOff size={16} />
                            ) : (
                              <ICN.Eye size={16} />
                            )}
                          </button>
                        </div>
                        <small>Used only by external applications.</small>
                      </label>
                      <div className="cloud-storage-trusted-networks">
                        <div className="cloud-storage-trusted-networks-head">
                          <span>
                            Trusted IP addresses <em>Optional</em>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                trustedNetworks: [...form.trustedNetworks, ""],
                              })
                            }
                          >
                            Add <ICN.Plus size={12} />
                          </button>
                        </div>
                        {form.trustedNetworks.length ? (
                          <div className="cloud-storage-ip-list">
                            {form.trustedNetworks.map((network, index) => (
                              <div
                                className="cloud-storage-ip-row"
                                key={`trusted-network-${index}`}
                              >
                                <input
                                  aria-label={`Trusted IP address ${index + 1}`}
                                  value={network}
                                  onChange={(event) => {
                                    const trustedNetworks = [
                                      ...form.trustedNetworks,
                                    ];
                                    trustedNetworks[index] = event.target.value;
                                    setForm({ ...form, trustedNetworks });
                                  }}
                                  placeholder="Example: 203.0.113.10/32"
                                />
                                <button
                                  type="button"
                                  aria-label={`Remove trusted IP address ${index + 1}`}
                                  title="Remove address"
                                  onClick={() =>
                                    setForm({
                                      ...form,
                                      trustedNetworks:
                                        form.trustedNetworks.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                    })
                                  }
                                >
                                  <ICN.X size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <small className="cloud-storage-ip-empty">
                            Add an address to restrict external connections.
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="cloud-storage-postgres-access-note">
                      <ICN.Info size={15} />
                      <span>
                        Dedicated Glondia servers use external access unless
                        private networking is attached.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="cloud-storage-form-row">
              <label>
                Region
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                >
                  {(catalog?.regions || []).map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {form.serviceKind === "postgres" && (
                <label>
                  PostgreSQL
                  <select
                    value={form.postgresVersion}
                    onChange={(e) =>
                      setForm({ ...form, postgresVersion: e.target.value })
                    }
                  >
                    <option value="16">PostgreSQL 16</option>
                    <option value="15">PostgreSQL 15</option>
                  </select>
                </label>
              )}
              <label>
                Service name
                <input
                  value={form.name}
                  maxLength={80}
                  placeholder={LABEL[form.serviceKind]}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
            </div>
            <div className="cloud-storage-wizard-actions">
              <button className="btn btn-outline" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(4)}>
                Review service
              </button>
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="cloud-storage-review dashboard-view-enter">
            <div className="cloud-storage-review-head">
              <span className="cloud-storage-review-icon">
                <SelectedServiceIcon size={26} />
              </span>
              <div>
                <span className="cloud-storage-review-eyebrow">
                  Ready for checkout
                </span>
                <h3>
                  {form.name.trim() || `${LABEL[form.serviceKind]} service`}
                </h3>
                <p>Review the configuration before provisioning begins.</p>
              </div>
              <Badge tone="success">Configuration ready</Badge>
            </div>

            <div className="cloud-storage-review-layout">
              <div className="cloud-storage-review-details">
                <div>
                  <span>Service</span>
                  <strong>{LABEL[form.serviceKind]}</strong>
                  {form.serviceKind === "postgres" && (
                    <small>PostgreSQL {form.postgresVersion}</small>
                  )}
                </div>
                <div>
                  <span>Hosting</span>
                  <strong>
                    {form.tenancy === "dedicated" ? "Dedicated" : "Shared"}
                  </strong>
                  <small>
                    {form.tenancy === "dedicated"
                      ? "Separate managed resource"
                      : "Isolated managed space"}
                  </small>
                </div>
                <div>
                  <span>Capacity</span>
                  <strong>
                    {selectedPlan ? gb(selectedPlan.capacityBytes) : "—"}
                  </strong>
                  <small>{form.planSize.toUpperCase()} plan</small>
                </div>
                <div>
                  <span>Region</span>
                  <strong>{selectedRegion?.name || form.region}</strong>
                  <small>Deployment location</small>
                </div>
                {form.serviceKind === "postgres" && (
                  <div>
                    <span>Database access</span>
                    <strong>
                      {form.externalAccessEnabled
                        ? "Internal + external"
                        : "Internal only"}
                    </strong>
                    <small>
                      {form.externalAccessEnabled
                        ? `${form.trustedNetworks.filter((value) => value.trim()).length || "No"} trusted IP restriction${form.trustedNetworks.filter((value) => value.trim()).length === 1 ? "" : "s"}`
                        : "Glondia private network"}
                    </small>
                  </div>
                )}
                <div>
                  <span>Included transfer</span>
                  <strong>
                    {selectedPlan
                      ? gb(selectedPlan.transferIncludedBytes)
                      : "—"}
                  </strong>
                  <small>Monthly allowance</small>
                </div>
              </div>

              <aside className="cloud-storage-review-price">
                <span>Monthly total</span>
                <strong>
                  {quote
                    ? money(quote.totalPriceCents, quote.currency)
                    : "Calculating…"}
                </strong>
                <small>
                  Glondia management included. Usage overages are billed
                  separately.
                </small>
                <div className="cloud-storage-review-process">
                  <span>
                    <b>1</b> Service and billing records created
                  </span>
                  <span>
                    <b>2</b> Payment securely confirmed
                  </span>
                  <span>
                    <b>3</b> Provisioning starts with live logs
                  </span>
                </div>
              </aside>
            </div>

            <div className="cloud-storage-review-actions">
              <button className="btn btn-outline" onClick={() => setStep(3)}>
                <ICN.ArrowLeft size={14} /> Edit configuration
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !quote}
                onClick={submit}
              >
                {busy ? "Creating records…" : "Continue to checkout"}
                {!busy && <ICN.ArrowRight size={14} />}
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export function CloudStorageDetail({ id, navigate }) {
  const [service, setService] = useState(null);
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadService = () =>
    getCloudStorageService(id)
      .then(setService)
      .catch((e) => setError(e.message));
  useEffect(() => {
    loadService();
  }, [id]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const loaders = {
      usage: getCloudStorageUsage,
      logs: getCloudStorageLogs,
      billing: getCloudStorageBilling,
      backups: listCloudStorageRestorePoints,
    };
    const loader = loaders[tab];
    if (!loader) return undefined;
    const refresh = () =>
      loader(id)
        .then((result) => {
          if (!active) return;
          setData(result);
          if (tab === "usage" && result?.service) setService(result.service);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const refreshTimer = ["usage", "logs"].includes(tab)
      ? window.setInterval(refresh, 8000)
      : null;
    return () => {
      active = false;
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [id, tab]);
  useEffect(() => {
    let active = true;
    if (tab === "credentials" && service?.sandbox) {
      getCloudStorageCredentials(id)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [id, tab, service?.sandbox]);
  if (!service && !error)
    return (
      <div className="card cloud-storage-pad">Loading service record…</div>
    );
  if (!service)
    return (
      <Empty icon="AlertCircle" title="Service unavailable" body={error} />
    );
  const saveSettings = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      setService(
        await updateCloudStorageSettings(id, {
          deploymentBranch: values.get("branch"),
          retentionDaily: values.get("daily"),
          retentionWeekly: values.get("weekly"),
        }),
      );
      setNotice("Settings saved.");
    } catch (e) {
      setError(e.message);
    }
  };
  const reveal = async () => {
    try {
      setData(await getCloudStorageCredentials(id));
    } catch (e) {
      setError(e.message);
    }
  };
  const openDrive = () => {
    const driveUrl = new URL(window.location.href);
    driveUrl.pathname = `${driveUrl.pathname.replace(/\/+$/, "")}/drive`;
    driveUrl.search = "";
    driveUrl.hash = "";
    window.open(driveUrl.toString(), "_blank", "noopener,noreferrer");
  };
  const extraTab =
    service.serviceKind === "ssh_backup"
      ? ["backups", "Restore points"]
      : null;
  return (
    <>
      <SandboxBanner service="cloud-storage" />
      <div className="page-head">
        <div>
          <button
            className="cloud-storage-back"
            onClick={() => navigate({ view: "cloud-storage" })}
          >
            <ICN.ArrowLeft size={14} /> Cloud Storage
          </button>
          <h1>{service.name}</h1>
          <p className="sub">
            {LABEL[service.serviceKind]} · {service.tenancy} · {service.region}
          </p>
        </div>
        <StatusBadge status={service.status} />
      </div>
      <Notice message={notice} error={error} />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          ["overview", "Overview"],
          ["usage", "Metrics"],
          ...(extraTab ? [extraTab] : []),
          ["settings", "Settings"],
          ["billing", "Billing"],
          ["logs", "Logs"],
          ["credentials", "Access"],
        ].map(([value, label]) => ({ value, label }))}
      />
      <div className="cloud-storage-detail-body cloud-storage-tab-panel" key={tab}>
        {tab === "overview" && (
          <>
            <div className="cloud-storage-summary-grid">
              {[
                ["Service", LABEL[service.serviceKind]],
                ["Tenancy", service.tenancy],
                ["Capacity", gb(service.capacityBytes)],
                ["Included transfer", gb(service.transferIncludedBytes)],
                [
                  "Monthly price",
                  money(service.totalPriceCents, service.currency),
                ],
                ["Sync", service.syncStatus],
              ].map(([k, v]) => (
                <div className="card" key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <ServiceFeatures
              service={service}
              onOpen={(target) =>
                target === "drive" ? openDrive() : setTab(target)
              }
            />
          </>
        )}
        {tab === "usage" && (
          <StorageMetricsPanel
            service={service}
            samples={data?.samples || []}
          />
        )}
        {tab === "backups" && (
          <BackupsPanel
            id={id}
            items={data || []}
            refresh={() => listCloudStorageRestorePoints(id).then(setData)}
          />
        )}
        {tab === "settings" && (
          <>
          {service.serviceKind !== "private_vault" && (
            <form className="card cloud-storage-settings" onSubmit={saveSettings}>
            <label>
              Deployment branch
              <input
                name="branch"
                defaultValue={service.deploymentBranch || "main"}
              />
            </label>
            <label>
              Daily restore points
              <input
                name="daily"
                type="number"
                min="1"
                max="90"
                defaultValue={service.retentionDaily}
              />
            </label>
            <label>
              Weekly restore points
              <input
                name="weekly"
                type="number"
                min="0"
                max="52"
                defaultValue={service.retentionWeekly}
              />
            </label>
            {service.serviceKind === "private_repository" && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={async () => {
                  try {
                    const result = await configureCloudStorageRepository(id, {
                      repositoryName: service.name,
                      deploymentBranch: service.deploymentBranch,
                    });
                    setNotice(`Repository webhook ready: ${result.webhookUrl}`);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Configure repository webhook
              </button>
            )}
              <button className="btn btn-primary">Save settings</button>
            </form>
          )}
          {service.serviceKind === "private_vault" && (
            <DriveSecuritySettings id={id} />
          )}
          </>
        )}
        {tab === "billing" && (
          <CloudStorageBillingPanel
            service={service}
            ledger={data?.ledger || []}
            invoices={data?.invoices || []}
          />
        )}
        {tab === "logs" && (
          <ProvisioningLogsPanel service={service} items={data || []} />
        )}
        {tab === "credentials" && (
          <div className="card cloud-storage-pad cloud-storage-access-panel">
            <div className="cloud-storage-access-panel-head">
              <span>
                <ICN.Key size={20} />
              </span>
              <div>
                <h3>Protected access</h3>
                <p className="muted">
                  Credentials stay server-side and are never included in
                  service, billing or log responses.
                </p>
              </div>
            </div>
            {data?.credentials ? (
              service.serviceKind === "postgres" ? (
                <PostgresConnectionsPanel
                  credentials={data.credentials}
                  sandbox={service.sandbox}
                />
              ) : service.serviceKind === "private_vault" ? (
                <DriveTransferAccessPanel
                  credentials={data.credentials.transferAccess}
                  sandbox={service.sandbox}
                />
              ) : (
                <pre className="cloud-storage-credentials">
                  {JSON.stringify(data.credentials, null, 2)}
                </pre>
              )
            ) : (
              <button className="btn btn-outline" onClick={reveal}>
                Reveal connection instructions
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function CloudDriveDashboard({ id, navigate }) {
  const [service, setService] = useState(null);
  const [items, setItems] = useState([]);
  const [security, setSecurity] = useState(null);
  const [driveAuthenticated, setDriveAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refreshFiles = () =>
    listCloudStorageObjects(id, true).then(setItems).catch((e) => setError(e.message));
  useEffect(() => {
    Promise.all([getCloudStorageService(id), getCloudDriveSecurity(id)])
      .then(async ([serviceRecord, securityRecord]) => {
        if (serviceRecord.serviceKind !== "private_vault") {
          throw new Error("This service does not include a file drive.");
        }
        setService(serviceRecord);
        setSecurity(securityRecord);
        const session = await verifyCloudDriveSession(id).catch(() => null);
        if (session?.authenticated) {
          setDriveAuthenticated(true);
          setItems(await listCloudStorageObjects(id, true));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  const returnToService = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    navigate({ view: "cloud-storage-detail", params: { id } });
  };
  if (loading)
    return (
      <div className="cloud-drive-page is-loading">
        <div className="cloud-drive-page-loader">
          <ICN.Folder size={28} />
          <strong>Opening My Drive…</strong>
        </div>
      </div>
    );
  if (!service)
    return (
      <div className="cloud-drive-page is-loading">
        <Empty
          icon="AlertCircle"
          title="Drive unavailable"
          body={error}
          action={
            <button className="btn btn-outline" onClick={returnToService}>
              Return to Cloud Storage
            </button>
          }
        />
      </div>
    );
  if (!driveAuthenticated)
    return (
      <DriveSignIn
        id={id}
        email={security?.accountEmail || ""}
        onAuthenticated={async () => {
          setDriveAuthenticated(true);
          setItems(await listCloudStorageObjects(id, true));
        }}
      />
    );
  return (
    <div className="cloud-drive-page">
      <main className="cloud-drive-page-main">
        <Notice error={error} />
        <FilesPanel
          id={id}
          service={service}
          items={items}
          refresh={refreshFiles}
          onSignOut={() => {
            clearCloudDriveSession(id);
            setItems([]);
            setDriveAuthenticated(false);
          }}
        />
      </main>
    </div>
  );
}

function DriveSignIn({ id, email, onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await loginCloudDrive(id, email, password);
      storeCloudDriveSession(id, result.token);
      await onAuthenticated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cloud-drive-signin">
      <section className="cloud-drive-signin-visual">
        <div className="cloud-drive-signin-visual-shade" />
        <div className="cloud-drive-signin-brand">
          <span className="cloud-drive-signin-brand-icon"><ICN.Folder size={25} /></span>
          <span>GLONDIA DRIVE</span>
        </div>
        <div className="cloud-drive-signin-message">
          <span className="cloud-drive-signin-kicker">Private cloud storage</span>
          <h2>Your work.<br />Securely within reach.</h2>
          <p>Store, organise, and access your files from one private Glondia workspace.</p>
          <div className="cloud-drive-signin-proof">
            <span><ICN.ShieldCheck size={15} /> Private by design</span>
            <span><ICN.Folder size={15} /> Built for your files</span>
          </div>
        </div>
      </section>
      <section className="cloud-drive-signin-panel">
        <form onSubmit={submit}>
          <div className="cloud-drive-signin-heading">
            <img className="cloud-drive-signin-logo" src="/glondia-logo.png" alt="Glondia" />
            <div>
              <span className="page-eyebrow">Cloud storage</span>
              <h1>Welcome back</h1>
              <p>Sign in to continue to your private drive.</p>
            </div>
          </div>
          <Notice error={error} />
          <div className="cloud-drive-signin-fields">
            <label><span>Account email</span><input value={email} readOnly type="email" /></label>
            <label><span>Drive password</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Enter your Drive password" required autoFocus /></label>
          </div>
          <button className="btn btn-primary cloud-drive-signin-submit" disabled={busy}>{busy ? "Signing in…" : "Open My Drive"}</button>
          <div className="cloud-drive-signin-security">
            <ICN.ShieldCheck size={17} />
            <p><strong>Protected access</strong><span>Your Drive uses a separate password from your Glondia account.</span></p>
          </div>
        </form>
        <p className="cloud-drive-signin-footer">Secure file storage by <strong>Glondia</strong></p>
      </section>
    </div>
  );
}

function DriveSecuritySettings({ id }) {
  const [security, setSecurity] = useState(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    getCloudDriveSecurity(id).then(setSecurity).catch((e) => setError(e.message));
  }, [id]);
  const revealPassword = async () => {
    if (password || initialPassword) {
      setShowPassword((current) => !current);
      return;
    }
    try {
      const result = await revealCloudDrivePassword(id);
      setInitialPassword(result.password);
      setShowPassword(true);
      setSecurity({ ...security, initialPasswordAvailable: false });
    } catch (e) {
      setError(e.message);
    }
  };
  const copyPassword = async () => {
    let value = password || initialPassword;
    try {
      if (!value && security?.initialPasswordAvailable) {
        const result = await revealCloudDrivePassword(id);
        value = result.password;
        setInitialPassword(value);
        setShowPassword(true);
        setSecurity({ ...security, initialPasswordAvailable: false });
      }
      if (!value) return;
      await window.navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(e.message);
    }
  };
  const generatePassword = () => {
    setPassword(generateDatabasePassword());
    setInitialPassword("");
    setShowPassword(true);
    setNotice("New password generated. Select Save to apply it.");
  };
  const savePassword = async (event) => {
    event.preventDefault();
    try {
      const result = await updateCloudDrivePassword(id, password);
      setSecurity(result);
      setPassword("");
      setInitialPassword("");
      setShowPassword(false);
      setNotice("Drive password saved. Existing Drive sessions were signed out.");
    } catch (e) {
      setError(e.message);
    }
  };
  const currentPassword = password || initialPassword;
  return (
    <section className="cloud-drive-security-settings">
      <div className="cloud-storage-section-title"><span className="cloud-storage-section-icon"><ICN.Key size={21} /></span><div><h3>My Drive sign-in</h3><p>Separate credentials protecting this file dashboard.</p></div></div>
      <Notice message={notice} error={error} />
      <div className="cloud-drive-security-email"><span>Sign-in email</span><strong>{security?.accountEmail || "Loading…"}</strong><small>This follows the main dashboard account email.</small></div>
      <form className="cloud-drive-password-form" onSubmit={savePassword}>
        <label>
          <span>Drive password</span>
          <small>Reveal the first password, copy it, or generate a secure replacement.</small>
          <span className="cloud-drive-password-input">
            <input
              minLength="12"
              value={currentPassword}
              onChange={(event) => { setPassword(event.target.value); setInitialPassword(""); }}
              type={showPassword ? "text" : "password"}
              placeholder={security?.initialPasswordAvailable ? "•••••••••••••••" : "At least 12 characters"}
              autoComplete="new-password"
            />
            <span className="cloud-drive-password-actions">
              <button type="button" onClick={revealPassword} aria-label={showPassword ? "Hide Drive password" : "Show Drive password"} title={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <ICN.EyeOff size={15} /> : <ICN.Eye size={15} />}
              </button>
              <button type="button" className={copied ? "is-copied" : ""} onClick={copyPassword} aria-label="Copy Drive password" title="Copy password">
                {copied ? <ICN.Check size={15} /> : <ICN.Copy size={15} />}
              </button>
              <button type="button" onClick={generatePassword} aria-label="Generate a new Drive password" title="Generate password">
                <ICN.RefreshCw size={15} />
              </button>
            </span>
          </span>
        </label>
        <button className="btn btn-primary cloud-drive-password-save" disabled={!password}>Save</button>
      </form>
      <div className="cloud-drive-2fa-preview"><ICN.ShieldCheck size={16} /><div><strong>Two-factor authentication</strong><small>Authenticator apps and recovery codes will be configured here later.</small></div><Badge>Not available yet</Badge></div>
    </section>
  );
}
function DriveTransferAccessPanel({ credentials, sandbox }) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState("");
  if (!credentials) return <Notice error="Drive file-transfer access is not provisioned yet." />;
  const copy = async (key, value) => {
    await window.navigator.clipboard.writeText(String(value || ""));
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1600);
  };
  const downloadKey = () => {
    const blob = new Blob([credentials.privateKey], { type: "application/x-pem-file" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `glondia-drive-${credentials.username}.pem`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="cloud-drive-transfer-access">
      {(sandbox || !credentials.configured) && <div className="cloud-storage-connection-disabled"><ICN.ShieldCheck size={17} /><div><strong>{sandbox ? "Sandbox preview" : "Gateway setup pending"}</strong><span>{sandbox ? "These credentials demonstrate the container-scoped Drive connection." : "Configure the Glondia Drive SFTP gateway before sharing these credentials with customers."}</span></div><Badge>Disabled</Badge></div>}
      <div className="cloud-drive-transfer-notice">
        <ICN.ShieldCheck size={18} />
        <div><strong>Cloud Drive only</strong><span>This account is restricted to <code>{credentials.root || "/drive"}</code>. It cannot access the host server, system files, or other customers.</span></div>
      </div>
      <div className="cloud-drive-transfer-grid">
        <div><span>Host</span><code>{credentials.host}</code></div>
        <div><span>Port</span><code>{credentials.port}</code></div>
        <div><span>Username</span><code>{credentials.username}</code></div>
        <div><span>Protocol</span><code>SFTP / SSH</code></div>
      </div>
      <div className="cloud-drive-transfer-secret">
        <span>Password</span>
        <code>{showPassword ? credentials.password : "••••••••••••••••••••"}</code>
        <div>
          <button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? <ICN.EyeOff size={15} /> : <ICN.Eye size={15} />}</button>
          <button type="button" className={copied === "password" ? "is-copied" : ""} onClick={() => copy("password", credentials.password)}>{copied === "password" ? <ICN.Check size={15} /> : <ICN.Copy size={15} />}</button>
        </div>
      </div>
      <div className="cloud-drive-transfer-commands">
        <div><span>SFTP command</span><code>{credentials.sftpCommand}</code><button type="button" onClick={() => copy("sftp", credentials.sftpCommand)}>{copied === "sftp" ? <ICN.Check size={14} /> : <ICN.Copy size={14} />}</button></div>
        <div><span>SSH command</span><code>{credentials.sshCommand}</code><button type="button" onClick={() => copy("ssh", credentials.sshCommand)}>{copied === "ssh" ? <ICN.Check size={14} /> : <ICN.Copy size={14} />}</button></div>
      </div>
      <button type="button" className="btn btn-outline cloud-drive-transfer-key" onClick={downloadKey}><ICN.Key size={16} /> Download pre-created private key</button>
      <p className="muted">Use SFTP for fast uploads and downloads. SSH access is restricted to file-management operations inside this Drive.</p>
    </div>
  );
}

function PostgresConnectionsPanel({ credentials, sandbox }) {
  const isDisabled = sandbox || credentials.sandboxDisabled;
  const [copiedCredential, setCopiedCredential] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const copyCredential = async (credentialKey, value) => {
    try {
      await window.navigator.clipboard.writeText(value);
    } catch {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = value;
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      document.execCommand("copy");
      temporaryInput.remove();
    }
    setCopiedCredential(credentialKey);
    window.setTimeout(
      () =>
        setCopiedCredential((current) =>
          current === credentialKey ? "" : current,
        ),
      1800,
    );
  };
  return (
    <div className="cloud-storage-connection-preview">
      {isDisabled && (
        <div className="cloud-storage-connection-disabled">
          <ICN.ShieldCheck size={17} />
          <div>
            <strong>Sandbox connection preview</strong>
            <span>
              These values are available for building and testing the UI only.
              No database connection is active.
            </span>
          </div>
          <Badge>Disabled</Badge>
        </div>
      )}
      <div className="cloud-storage-connection-grid">
        {[
          [
            "Internal connection",
            "Private Glondia network",
            credentials.internal,
          ],
          [
            "External connection",
            "Applications outside the private network",
            credentials.external,
          ],
        ].map(
          ([title, description, connection], connectionIndex) =>
            connection && (
              <article key={title}>
                <div className="cloud-storage-connection-head">
                  <span>
                    <ICN.Database size={19} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </div>
                </div>
                <div className="cloud-storage-connection-fields">
                  <div>
                    <span>Host</span>
                    <code>{connection.host}</code>
                  </div>
                  <div>
                    <span>Port</span>
                    <code>{connection.port}</code>
                  </div>
                  <div>
                    <span>Database</span>
                    <code>{connection.database}</code>
                  </div>
                  <div>
                    <span>Username</span>
                    <code>{connection.username}</code>
                  </div>
                  <div>
                    <span>TLS</span>
                    <code>{connection.sslMode || "require"}</code>
                  </div>
                  <div className="is-wide cloud-storage-secret-field">
                    <span>Password</span>
                    <div>
                      <code>
                        {visiblePasswords[connectionIndex]
                          ? connection.password
                          : "••••••••••••••••••••"}
                      </code>
                      <div className="cloud-storage-secret-actions">
                        <button
                          type="button"
                          aria-label={`${visiblePasswords[connectionIndex] ? "Hide" : "Show"} ${title.toLowerCase()} password`}
                          title={
                            visiblePasswords[connectionIndex]
                              ? "Hide password"
                              : "Show password"
                          }
                          onClick={() =>
                            setVisiblePasswords((current) => ({
                              ...current,
                              [connectionIndex]: !current[connectionIndex],
                            }))
                          }
                        >
                          {visiblePasswords[connectionIndex] ? (
                            <ICN.EyeOff size={14} />
                          ) : (
                            <ICN.Eye size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={
                            copiedCredential === `${title}-password`
                              ? "is-copied"
                              : ""
                          }
                          aria-label={`Copy ${title.toLowerCase()} password`}
                          title={
                            copiedCredential === `${title}-password`
                              ? "Password copied"
                              : "Copy password"
                          }
                          onClick={() =>
                            copyCredential(
                              `${title}-password`,
                              connection.password,
                            )
                          }
                        >
                          {copiedCredential === `${title}-password` ? (
                            <ICN.Check size={14} />
                          ) : (
                            <ICN.Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="cloud-storage-connection-url">
                  <div>
                    <span>Connection link</span>
                    <button
                      type="button"
                      className={
                        copiedCredential === `${title}-url` ? "is-copied" : ""
                      }
                      aria-label={`Copy ${title.toLowerCase()} link`}
                      title={
                        copiedCredential === `${title}-url`
                          ? "Connection link copied"
                          : "Copy connection link"
                      }
                      onClick={() =>
                        copyCredential(`${title}-url`, connection.url)
                      }
                    >
                      {copiedCredential === `${title}-url` ? (
                        <>
                          <ICN.Check size={13} /> Copied
                        </>
                      ) : (
                        <>
                          <ICN.Copy size={13} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <code>{connection.url}</code>
                </div>
              </article>
            ),
        )}
      </div>
    </div>
  );
}

function ServiceFeatures({ service, onOpen }) {
  const features =
    {
      postgres: [
        [
          "Database",
          `PostgreSQL ${service.postgresVersion || "16"}`,
          "Connection pooling and SSL-required connections.",
        ],
        [
          "ShieldCheck",
          "Trusted networks",
          "Restrict database access to approved addresses.",
        ],
        [
          "Archive",
          "Managed backups",
          "Recovery status and restore history are kept with the service.",
        ],
      ],
      private_vault: [
        [
          "Folder",
          "File manager",
          "Folders, file history and recoverable deletion.",
          "drive",
        ],
        [
          "ShieldCheck",
          "Private access",
          "Short-lived signed operations keep storage credentials hidden.",
          "credentials",
        ],
        [
          "Search",
          "Search and versions",
          "Find stored files and retain their version history.",
        ],
      ],
      ssh_backup: [
        [
          "Terminal",
          "SFTP and rsync",
          "Restricted file transfer access with no interactive shell.",
          "credentials",
        ],
        [
          "Archive",
          "Restore points",
          `${service.retentionDaily || 7} daily and ${service.retentionWeekly || 4} weekly restore points.`,
          "backups",
        ],
        [
          "ShieldCheck",
          "Isolated backup space",
          "Backup data remains separated from website hosting.",
        ],
      ],
      private_repository: [
        [
          "Git",
          "Private Git repository",
          "Clone, push and retain commit history.",
          "credentials",
        ],
        [
          "Rocket",
          "Automatic deployment",
          `Pushes to ${service.deploymentBranch || "main"} can trigger linked hosting deployments.`,
          "settings",
        ],
        [
          "Key",
          "Deploy keys",
          "Protected repository access without exposing provider credentials.",
          "credentials",
        ],
      ],
    }[service.serviceKind] || [];
  return (
    <section className="cloud-storage-feature-section">
      <div className="section-head">
        <div>
          <h2>Included features</h2>
          <p>Tools available with this running service.</p>
        </div>
      </div>
      <div className="cloud-storage-feature-grid">
        {features.map(([icon, title, copy, target]) => {
          const Icon = ICN[icon] || ICN.CheckCircle;
          return (
            <button
              type="button"
              key={title}
              className="cloud-storage-feature-card"
              onClick={() => target && onOpen(target)}
            >
              <span>
                <Icon size={22} />
              </span>
              <strong>{title}</strong>
              <small>{copy}</small>
              {target && (
                <em>
                  Open <ICN.ArrowRight size={12} />
                </em>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CloudStorageBillingPanel({ service, ledger, invoices }) {
  const usageCharges = ledger.filter(
    (entry) =>
      entry.classification === "usage_charge" || entry.billingType === "usage",
  );
  const recordedUsageCents = usageCharges
    .filter((entry) => !["cancelled", "voided"].includes(entry.status))
    .reduce((total, entry) => total + Number(entry.amountCents || 0), 0);
  const outstandingCents = invoices
    .filter((invoice) =>
      ["issued", "overdue", "draft"].includes(invoice.status),
    )
    .reduce((total, invoice) => total + Number(invoice.totalCents || 0), 0);
  const paidCents = ledger
    .filter(
      (entry) => entry.billingType === "payment" && entry.status === "paid",
    )
    .reduce(
      (total, entry) => total + Math.abs(Number(entry.amountCents || 0)),
      0,
    );
  const classificationLabel = (value) =>
    ({
      recurring_charge: "Monthly plan",
      usage_charge: "Metered usage",
      one_time_charge: "One-time charge",
      adjustment: "Adjustment",
      credit: "Credit",
      payment: "Payment",
    })[value] || String(value || "Charge").replaceAll("_", " ");
  return (
    <div className="cloud-storage-billing">
      <div className="cloud-storage-metrics-head">
        <div>
          <span className="cloud-storage-review-eyebrow">Service billing</span>
          <h2>Charges and invoices</h2>
          <p>
            Every amount below is tied to a recorded plan, usage measurement,
            invoice or payment.
          </p>
        </div>
        <StatusBadge status={service.paymentStatus || "pending"} />
      </div>

      <div className="cloud-storage-billing-summary">
        <article>
          <span>Monthly plan</span>
          <strong>{money(service.totalPriceCents, service.currency)}</strong>
          <small>
            {service.planSize.toUpperCase()} · {service.tenancy}
          </small>
        </article>
        <article>
          <span>Recorded usage charges</span>
          <strong>{money(recordedUsageCents, service.currency)}</strong>
          <small>
            {usageCharges.length} metered line
            {usageCharges.length === 1 ? "" : "s"}
          </small>
        </article>
        <article>
          <span>Outstanding invoices</span>
          <strong>{money(outstandingCents, service.currency)}</strong>
          <small>Issued, overdue or draft records</small>
        </article>
        <article>
          <span>Recorded payments</span>
          <strong>{money(paidCents, service.currency)}</strong>
          <small>Confirmed service payments</small>
        </article>
      </div>

      <section className="cloud-storage-billing-section">
        <div className="cloud-storage-billing-section-head">
          <div>
            <h3>Charge ledger</h3>
            <p>Exact service-level entries used to build invoices.</p>
          </div>
          <Badge>{ledger.length} records</Badge>
        </div>
        {ledger.length ? (
          <div className="cloud-storage-billing-table">
            <div className="is-head">
              <span>Description</span>
              <span>Calculation</span>
              <span>Status</span>
              <span>Amount</span>
            </div>
            {ledger.map((entry) => (
              <div key={entry.id}>
                <span>
                  <strong>
                    {entry.description ||
                      classificationLabel(entry.classification)}
                  </strong>
                  <small>
                    {classificationLabel(entry.classification)} ·{" "}
                    {entry.createdAt
                      ? new Date(entry.createdAt).toLocaleDateString()
                      : "Recorded"}
                  </small>
                </span>
                <span>
                  {Number(entry.quantity || 1).toLocaleString()} ×{" "}
                  {money(entry.unitCents, entry.currency)}
                </span>
                <StatusBadge status={entry.status} />
                <strong
                  className={entry.direction === "credit" ? "is-credit" : ""}
                >
                  {entry.direction === "credit" ? "−" : ""}
                  {money(
                    Math.abs(Number(entry.amountCents || 0)),
                    entry.currency,
                  )}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="cloud-storage-billing-empty">
            <ICN.CreditCard size={20} />
            <div>
              <strong>No charge ledger entries yet</strong>
              <span>
                Charges appear only after a billing record is created.
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="cloud-storage-billing-section">
        <div className="cloud-storage-billing-section-head">
          <div>
            <h3>Invoices</h3>
            <p>Combined totals with their original line items.</p>
          </div>
          <Badge>{invoices.length} invoices</Badge>
        </div>
        {invoices.length ? (
          <div className="cloud-storage-invoice-list">
            {invoices.map((invoice) => (
              <article key={invoice.id}>
                <div className="cloud-storage-invoice-head">
                  <div>
                    <span>Invoice</span>
                    <strong>{invoice.invoiceNumber}</strong>
                    <small>
                      {invoice.issuedAt
                        ? new Date(invoice.issuedAt).toLocaleDateString()
                        : new Date(invoice.createdAt).toLocaleDateString()}
                    </small>
                  </div>
                  <StatusBadge status={invoice.status} />
                  <strong>{money(invoice.totalCents, invoice.currency)}</strong>
                </div>
                <div className="cloud-storage-invoice-lines">
                  {(invoice.lineItems || []).map((line) => (
                    <div key={line.id}>
                      <span>
                        <strong>{line.description}</strong>
                        <small>
                          {classificationLabel(line.lineClassification)}
                        </small>
                      </span>
                      <span>
                        {line.quantity} ×{" "}
                        {money(line.unitCents, invoice.currency)}
                      </span>
                      <strong>
                        {money(line.totalCents, invoice.currency)}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="cloud-storage-invoice-total">
                  <span>
                    Subtotal {money(invoice.subtotalCents, invoice.currency)}
                  </span>
                  {invoice.taxCents > 0 && (
                    <span>Tax {money(invoice.taxCents, invoice.currency)}</span>
                  )}
                  {invoice.discountCents > 0 && (
                    <span>
                      Discount −{money(invoice.discountCents, invoice.currency)}
                    </span>
                  )}
                  <strong>
                    Total {money(invoice.totalCents, invoice.currency)}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="cloud-storage-billing-empty">
            <ICN.File size={20} />
            <div>
              <strong>No invoices issued yet</strong>
              <span>
                No invoice total will appear without recorded line items.
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StorageMetricsPanel({ service, samples }) {
  const storageUsed = Number(service.storageUsedBytes || 0);
  const storageLimit = Number(service.capacityBytes || 0);
  const transferUsed = Number(service.transferUsedBytes || 0);
  const transferLimit = Number(service.transferIncludedBytes || 0);
  const storagePercent = storageLimit
    ? Math.min(100, (storageUsed / storageLimit) * 100)
    : 0;
  const transferPercent = transferLimit
    ? Math.min(100, (transferUsed / transferLimit) * 100)
    : 0;
  const overageBytes =
    Number(service.overageStorageBytes || 0) +
    Number(service.overageTransferBytes || 0);
  const latest = samples[0];
  return (
    <div className="cloud-storage-metrics">
      <div className="cloud-storage-metrics-head">
        <div>
          <span className="cloud-storage-review-eyebrow">
            Live service data
          </span>
          <h2>Usage metrics</h2>
          <p>
            Automatically refreshed every eight seconds while this tab is open.
          </p>
        </div>
        <Badge tone={overageBytes > 0 ? "danger" : "success"}>
          {overageBytes > 0 ? "Overage active" : "Within allowance"}
        </Badge>
      </div>
      <div className="cloud-storage-meter-grid">
        {[
          {
            icon: "Database",
            label: "Storage",
            used: storageUsed,
            limit: storageLimit,
            percent: storagePercent,
          },
          {
            icon: "Activity",
            label: "Data transfer",
            used: transferUsed,
            limit: transferLimit,
            percent: transferPercent,
          },
        ].map((meter) => {
          const Icon = ICN[meter.icon] || ICN.ChartBar;
          return (
            <article className="cloud-storage-meter" key={meter.label}>
              <div className="cloud-storage-meter-title">
                <span>
                  <Icon size={19} />
                </span>
                <div>
                  <small>{meter.label}</small>
                  <strong>{gb(meter.used)}</strong>
                </div>
                <em>{Math.round(meter.percent)}%</em>
              </div>
              <div className="cloud-storage-meter-track">
                <i style={{ width: `${meter.percent}%` }} />
              </div>
              <div className="cloud-storage-meter-foot">
                <span>
                  {gb(Math.max(0, meter.limit - meter.used))} remaining
                </span>
                <span>{gb(meter.limit)} included</span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="cloud-storage-metric-summary">
        <div>
          <span>Requests</span>
          <strong>{Number(latest?.requestCount || 0).toLocaleString()}</strong>
          <small>Latest sample</small>
        </div>
        <div>
          <span>Current overage</span>
          <strong>{gb(overageBytes)}</strong>
          <small>
            {overageBytes ? "Metered separately" : "No additional usage"}
          </small>
        </div>
        <div>
          <span>Last measured</span>
          <strong>
            {latest?.sampledAt
              ? new Date(latest.sampledAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Waiting"}
          </strong>
          <small>{latest?.source || "Service monitor"}</small>
        </div>
      </div>
      <UsageHistory items={samples} />
    </div>
  );
}

function UsageHistory({ items }) {
  if (!items.length)
    return <Empty icon="ChartBar" title="No usage samples recorded yet." />;
  return (
    <section className="cloud-storage-usage-history">
      <div className="section-head">
        <div>
          <h2>Usage history</h2>
          <p>Measurements saved for this service.</p>
        </div>
      </div>
      <div className="cloud-storage-usage-table">
        <div className="is-head">
          <span>Measured</span>
          <span>Storage</span>
          <span>Transfer</span>
          <span>Requests</span>
        </div>
        {items.map((item) => (
          <div key={item.id}>
            <span>
              {item.sampledAt
                ? new Date(item.sampledAt).toLocaleString()
                : "Recorded"}
            </span>
            <strong>{gb(item.storageBytes || 0)}</strong>
            <strong>{gb(item.transferBytes || 0)}</strong>
            <strong>{Number(item.requestCount || 0).toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProvisioningLogsPanel({ service, items }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const eventType = (item) => {
    const value = `${item.stage || ""} ${item.action || ""}`.toLowerCase();
    if (value.includes("upload")) return "upload";
    if (value.includes("download")) return "download";
    if (value.includes("ssh") || value.includes("sftp") || value.includes("session")) return "ssh";
    if (value.includes("delete")) return "delete";
    if (value.includes("backup") || value.includes("restore")) return "backup";
    return "system";
  };
  const filteredItems = items.filter((item) => {
    if (filter !== "all" && eventType(item) !== filter) return false;
    if (!query.trim()) return true;
    return `${item.stage || ""} ${item.action || ""} ${item.errorMessage || ""} ${JSON.stringify(item.metadata || {})}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const formatStamp = (value) => {
    const date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) return "—";
    return `${date.toLocaleString([], { month: "short" })} ${String(date.getDate()).padStart(2, "0")} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  };
  return (
    <div className="cloud-storage-logs-panel">
      <div className="cloud-storage-metrics-head">
        <div>
          <span className="cloud-storage-review-eyebrow">Service activity</span>
          <h2>Drive logs</h2>
          <p>Uploads, downloads, SSH/SFTP sessions, and system activity for {service.name}.</p>
        </div>
        <span className="cloud-storage-live-indicator">
          <i /> Live refresh
        </span>
      </div>
      <div className="cloud-drive-log-console">
        <div className="cloud-drive-log-toolbar">
          <div className="cloud-drive-log-filters" role="tablist" aria-label="Filter Drive logs">
            {[
              ["all", "All activity"],
              ["upload", "Uploads"],
              ["download", "Downloads"],
              ["ssh", "SSH / SFTP"],
              ["delete", "Deletes"],
              ["backup", "Backups"],
              ["system", "System"],
            ].map(([value, label]) => (
              <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{label}</button>
            ))}
          </div>
          <label className="cloud-drive-log-search">
            <ICN.Search size={18} />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs" />
          </label>
          <span className="cloud-drive-log-live"><ICN.Zap size={15} /><span>Live activity</span></span>
        </div>
        <div className="cloud-drive-log-status">
          <Badge tone="success" dot={false}>Active</Badge>
          <span>{filteredItems.length} of {items.length} events</span>
          <span>Scope: /drive</span>
        </div>
        <div className="cloud-drive-log-list">
          {!filteredItems.length && <div className="cloud-drive-log-empty"><span>No matching Drive activity.</span><small>Uploads, downloads, and SSH/SFTP events will appear here.</small></div>}
          {filteredItems.map((item) => {
            const type = eventType(item);
            const failed = item.status === "failed";
            return (
              <div key={item.id} className={`cloud-drive-log-row is-${failed ? "error" : item.status === "completed" ? "success" : "info"}`}>
                <time>{formatStamp(item.createdAt)}</time>
                <span className="cloud-drive-log-level" title={item.status}>{failed ? "!" : "i"}</span>
                <span className="cloud-drive-log-prefix">{type === "ssh" ? "$" : type === "upload" ? "↑" : type === "download" ? "↓" : "›"}</span>
                <span className="cloud-drive-log-message">
                  <span>[{type}] </span>
                  {String(item.action || item.stage || "service activity").replaceAll("_", " ")}
                  {item.errorMessage && ` — ${item.errorMessage}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RecordList({ items = [], empty, logs = false }) {
  if (!items?.length)
    return <Empty icon={logs ? "Terminal" : "ChartBar"} title={empty} />;
  return (
    <div className="cloud-storage-records">
      {items.map((item, index) => (
        <div key={item.id || index}>
          <div>
            <strong>
              {logs ? item.stage : item.kind || item.metric || "Usage sample"}
            </strong>
            <span>{logs ? item.action : item.status || item.sampledAt}</span>
          </div>
          <Badge tone={item.status === "failed" ? "danger" : "success"}>
            {item.status || "recorded"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function DriveActionDialog({ dialog, onResolve }) {
  const [value, setValue] = useState("");
  useEffect(() => { setValue(dialog?.value || ""); }, [dialog]);
  useEffect(() => {
    if (!dialog) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") onResolve(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialog, onResolve]);
  if (!dialog) return null;
  const DialogIcon = dialog.kind === "input" ? (dialog.action === "rename" ? ICN.Edit : ICN.FolderPlus) : dialog.kind === "properties" ? ICN.Info : ICN.Trash2;
  const submit = (event) => {
    event.preventDefault();
    onResolve(dialog.kind === "input" ? value.trim() : true);
  };
  return (
    <div className="cloud-drive-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(null); }}>
      <form className={`cloud-drive-dialog ${dialog.tone === "danger" ? "is-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="cloud-drive-dialog-title" onSubmit={submit}>
        <div className="cloud-drive-dialog-head">
          <span><DialogIcon size={18} /></span>
          <div><h3 id="cloud-drive-dialog-title">{dialog.title}</h3><p>{dialog.message}</p></div>
        </div>
        {dialog.kind === "input" && <label><span>Folder name</span><input value={value} onChange={(event) => setValue(event.target.value)} autoFocus maxLength="120" placeholder="Enter folder name" /></label>}
        {dialog.kind === "properties" && <dl className="cloud-drive-dialog-properties">{dialog.details.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>}
        <div className="cloud-drive-dialog-actions">
          {dialog.kind !== "properties" && <button type="button" className="btn btn-outline" onClick={() => onResolve(null)}>Cancel</button>}
          <button className={`btn ${dialog.tone === "danger" ? "cloud-drive-dialog-danger" : "btn-primary"}`} disabled={dialog.kind === "input" && !value.trim()}>{dialog.kind === "properties" ? "Close" : dialog.confirmLabel || "Confirm"}</button>
        </div>
      </form>
    </div>
  );
}

const DEFAULT_DRIVE_FOLDERS = {
  Documents: ["Work", "Personal", "Shared"],
  Pictures: ["Photos", "Screenshots", "Wallpapers"],
  Videos: ["Movies", "Clips", "Recordings"],
  Music: ["Albums", "Playlists", "Podcasts"],
  Downloads: ["Recent", "Installers", "Archives"],
};

function FilesPanel({ id, service, items, refresh, onSignOut }) {
  const [location, setLocation] = useState("Documents");
  const [expandedLocations, setExpandedLocations] = useState(["Documents"]);
  const [search, setSearch] = useState("");
  const [hiddenDefaultFolders, setHiddenDefaultFolders] = useState([]);
  const [trashedDefaultFolders, setTrashedDefaultFolders] = useState([]);
  const [renamedDefaultFolders, setRenamedDefaultFolders] = useState({});
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [folderClipboard, setFolderClipboard] = useState(null);
  const [createFileMenuOpen, setCreateFileMenuOpen] = useState(false);
  const [documentEditor, setDocumentEditor] = useState(null);
  const [deleteToast, setDeleteToast] = useState(null);
  const deleteToastTimer = useRef(null);
  const [driveDialog, setDriveDialog] = useState(null);
  const driveDialogResolver = useRef(null);
  const openDriveDialog = (config) => new Promise((resolve) => {
    driveDialogResolver.current = resolve;
    setDriveDialog(config);
  });
  const resolveDriveDialog = (result) => {
    const resolve = driveDialogResolver.current;
    driveDialogResolver.current = null;
    setDriveDialog(null);
    resolve?.(result);
  };
  useEffect(() => {
    setSelectedFolderIds([]);
    setFolderClipboard(null);
  }, [location]);
  const fileInput = useRef(null);
  const standardLocations = [
    ["Documents", "File"],
    ["Pictures", "Image"],
    ["Videos", "Video"],
    ["Music", "Music"],
    ["Downloads", "Download"],
  ];
  const rootLocation = location.split("/")[0];
  const openLocation = (path) => {
    setLocation(String(path).replace(/\/$/, ""));
    setExpandedLocations((current) => [
      ...new Set([...current, String(path).split("/")[0]]),
    ]);
  };
  const createFolder = async (parentLocation = location) => {
    const name = await openDriveDialog({ kind: "input", action: "create", title: "Create a new folder", message: `Add a folder inside ${parentLocation}.`, confirmLabel: "Create folder" });
    if (!name?.trim()) return;
    const parent = `${parentLocation}/`;
    await registerCloudStorageObject(id, {
      objectKey: `${parent}${name.trim()}/`,
      displayName: name.trim(),
      sizeBytes: 0,
      contentType: "application/x-directory",
    });
    refresh();
  };
  const registerFile = async (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    const parent = `${location}/`;
    await registerCloudStorageObject(id, {
      objectKey: `${parent}${file.name}`,
      displayName: file.name,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
    });
    fileInput.current.value = "";
    refresh();
  };
  const activeItems = items.filter((item) => !item.deletedAt && item.status !== "deleted");
  const deletedItems = items.filter((item) => item.deletedAt || item.status === "deleted");
  const showDeleteToast = (deletedRecords) => {
    window.clearTimeout(deleteToastTimer.current);
    setDeleteToast({
      records: Array.isArray(deletedRecords) ? deletedRecords : [deletedRecords],
    });
    deleteToastTimer.current = window.setTimeout(() => setDeleteToast(null), 5200);
  };
  useEffect(() => () => window.clearTimeout(deleteToastTimer.current), []);
  const undoDelete = async () => {
    if (!deleteToast?.records?.length) return;
    const defaults = deleteToast.records.filter((record) => record.isDefault);
    const stored = deleteToast.records.filter((record) => !record.isDefault && record.id);
    if (defaults.length) {
      const keys = defaults.map((record) => record.defaultKey);
      setHiddenDefaultFolders((current) => current.filter((key) => !keys.includes(key)));
      setTrashedDefaultFolders((current) => current.filter((record) => !keys.includes(record.defaultKey)));
    }
    await Promise.all(stored.map((record) => restoreCloudStorageObject(id, record.id)));
    window.clearTimeout(deleteToastTimer.current);
    setDeleteToast(null);
    if (stored.length) refresh();
  };
  const undoDeleteItem = async (item) => {
    if (item.isDefault) {
      setHiddenDefaultFolders((current) => current.filter((key) => key !== item.defaultKey));
      setTrashedDefaultFolders((current) => current.filter((record) => record.defaultKey !== item.defaultKey));
      return;
    }
    await restoreCloudStorageObject(id, item.id);
    refresh();
  };
  const permanentlyDeleteItem = async (item) => {
    const confirmed = await openDriveDialog({
      kind: "confirm",
      tone: "danger",
      title: "Delete permanently?",
      message: `${item.displayName} cannot be restored after this action.`,
      confirmLabel: "Delete permanently",
    });
    if (!confirmed) return;
    if (item.isDefault) {
      setTrashedDefaultFolders((current) => current.filter((record) => record.defaultKey !== item.defaultKey));
      return;
    }
    await permanentlyDeleteCloudStorageObject(id, item.id);
    refresh();
  };
  const readObjectMetadata = (item) => {
    if (item?.metadata && typeof item.metadata === "object") return item.metadata;
    try {
      return JSON.parse(item?.metadata || "{}");
    } catch {
      return {};
    }
  };
  const createDocument = (documentType) => {
    const extension = documentType === "word" ? "docx" : "txt";
    setCreateFileMenuOpen(false);
    setDocumentEditor({
      item: null,
      documentType,
      name: `Untitled.${extension}`,
      content: "",
      isSaving: false,
    });
  };
  const openDocument = (item) => {
    const metadata = readObjectMetadata(item);
    const extension = String(item.displayName || "").split(".").pop().toLowerCase();
    if (!metadata.documentType && !["docx", "txt"].includes(extension)) return;
    setDocumentEditor({
      item,
      documentType: metadata.documentType || (extension === "docx" ? "word" : "text"),
      name: item.displayName,
      content: metadata.documentContent || "",
      isSaving: false,
    });
  };
  const saveDocument = async () => {
    if (!documentEditor || !documentEditor.name.trim()) return;
    setDocumentEditor((current) => ({ ...current, isSaving: true }));
    const extension = documentEditor.documentType === "word" ? "docx" : "txt";
    const baseName = documentEditor.name.trim().replace(/\.(docx|txt)$/i, "");
    const displayName = `${baseName}.${extension}`;
    const objectKey = `${location}/${displayName}`;
    await registerCloudStorageObject(id, {
      objectKey,
      displayName,
      sizeBytes: new Blob([documentEditor.content]).size,
      contentType: documentEditor.documentType === "word"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain",
      metadata: {
        documentType: documentEditor.documentType,
        documentContent: documentEditor.content,
      },
    });
    if (documentEditor.item?.id) {
      await deleteCloudStorageObject(id, documentEditor.item.id);
    }
    setDocumentEditor(null);
    refresh();
  };
  const currentPrefix = `${location}/`;
  const visibleItems = activeItems.filter((item) => {
    const key = String(item.objectKey || "");
    if (!key.startsWith(currentPrefix) || key === `${location}/`) return false;
    const remainder = key.slice(currentPrefix.length).replace(/\/$/, "");
    if (remainder.includes("/")) return false;
    return String(item.displayName || key)
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  const existingNames = new Set(
    visibleItems.map((item) => String(item.displayName || "").toLowerCase()),
  );
  const defaultItems = (DEFAULT_DRIVE_FOLDERS[location] || [])
    .map((name) => ({ name, key: `${location}/${name}` }))
    .filter(({ key }) => !hiddenDefaultFolders.includes(key))
    .map(({ name, key }) => ({ name, key, displayName: renamedDefaultFolders[key] || name }))
    .filter(({ displayName }) => displayName.toLowerCase().includes(search.toLowerCase()))
    .filter(({ displayName }) => !existingNames.has(displayName.toLowerCase()))
    .map(({ name, key, displayName }) => ({
      id: `default-${location}-${name}`,
      objectKey: `${location}/${displayName}/`,
      displayName,
      originalName: name,
      defaultKey: key,
      sizeBytes: 0,
      status: "Ready",
      isDefault: true,
    }));
  const trashItems = [...trashedDefaultFolders, ...deletedItems]
    .filter((item) => String(item.displayName || item.objectKey || "")
      .toLowerCase()
      .includes(search.toLowerCase()));
  const displayItems = location === "Trash" ? trashItems : [...defaultItems, ...visibleItems];
  const sidebarFolders = Object.fromEntries(
    standardLocations.map(([root]) => {
      const storedFolders = activeItems
        .filter((item) => {
          const key = String(item.objectKey || "");
          if (!key.endsWith("/") || !key.startsWith(`${root}/`)) return false;
          return !key.slice(root.length + 1).replace(/\/$/, "").includes("/");
        })
        .map((item) => ({
          key: String(item.objectKey).replace(/\/$/, ""),
          label: item.displayName || String(item.objectKey).split("/").filter(Boolean).at(-1),
        }));
      const storedNames = new Set(storedFolders.map(({ label }) => String(label).toLowerCase()));
      const starterFolders = (DEFAULT_DRIVE_FOLDERS[root] || [])
        .map((name) => ({
          originalName: name,
          defaultKey: `${root}/${name}`,
          key: `${root}/${renamedDefaultFolders[`${root}/${name}`] || name}`,
          label: renamedDefaultFolders[`${root}/${name}`] || name,
        }))
        .filter(({ defaultKey }) => !hiddenDefaultFolders.includes(defaultKey))
        .filter(({ label }) => !storedNames.has(label.toLowerCase()));
      return [root, [...starterFolders, ...storedFolders]];
    }),
  );
  const editFolder = async (item) => {
    const nextName = await openDriveDialog({ kind: "input", action: "rename", title: "Rename folder", message: "Choose a clear name for this folder.", value: item.displayName || "", confirmLabel: "Save name" });
    if (!nextName?.trim() || nextName.trim() === item.displayName) return;
    if (item.isDefault) {
      setRenamedDefaultFolders((current) => ({ ...current, [item.defaultKey]: nextName.trim() }));
      return;
    }
    await registerCloudStorageObject(id, {
      objectKey: `${location}/${nextName.trim()}/`,
      displayName: nextName.trim(),
      sizeBytes: 0,
      contentType: "application/x-directory",
    });
    await deleteCloudStorageObject(id, item.id);
    refresh();
  };
  const editFile = async (item) => {
    const nextName = await openDriveDialog({ kind: "input", action: "rename", title: "Rename file", message: "Choose a clear name for this file.", value: item.displayName || "", confirmLabel: "Save name" });
    if (!nextName?.trim() || nextName.trim() === item.displayName) return;
    await registerCloudStorageObject(id, {
      objectKey: `${location}/${nextName.trim()}`,
      displayName: nextName.trim(),
      sizeBytes: item.sizeBytes || 0,
      contentType: item.contentType || "application/octet-stream",
      metadata: readObjectMetadata(item),
    });
    await deleteCloudStorageObject(id, item.id);
    refresh();
  };
  const deleteFolder = async (item) => {
    const confirmed = await openDriveDialog({ kind: "confirm", tone: "danger", title: "Delete folder?", message: `${item.displayName} will be removed from this Drive location.`, confirmLabel: "Delete folder" });
    if (!confirmed) return;
    if (item.isDefault) {
      setHiddenDefaultFolders((current) => [...current, item.defaultKey]);
      setTrashedDefaultFolders((current) => [...current, { ...item, status: "deleted", deletedAt: new Date().toISOString() }]);
      showDeleteToast(item);
      return;
    }
    await deleteCloudStorageObject(id, item.id);
    showDeleteToast(item);
    refresh();
  };
  const deleteFile = async (item) => {
    const confirmed = await openDriveDialog({ kind: "confirm", tone: "danger", title: "Delete file?", message: `${item.displayName} will be removed from this Drive location.`, confirmLabel: "Delete file" });
    if (!confirmed) return;
    await deleteCloudStorageObject(id, item.id);
    showDeleteToast(item);
    refresh();
  };
  const showFolderProperties = (item) =>
    openDriveDialog({
      kind: "properties",
      title: item.displayName,
      message: "Folder properties",
      details: [
        ["Type", "Folder"],
        ["Location", location],
        ["Status", item.status || "Stored"],
        ["Starter folder", item.isDefault ? "Yes" : "No"],
      ],
    });
  const showFileProperties = (item) =>
    openDriveDialog({
      kind: "properties",
      title: item.displayName,
      message: "File properties",
      details: [
        ["Type", item.contentType || "File"],
        ["Location", location],
        ["Size", gb(item.sizeBytes || 0)],
        ["Status", item.status || "Stored"],
      ],
    });
  const toggleFolderSelection = (item) => {
    const key = item.id || item.objectKey;
    setSelectedFolderIds((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };
  const stageFolder = (item, mode) => {
    const key = item.id || item.objectKey;
    setFolderClipboard({ keys: [key], mode, objectKeys: [item.objectKey] });
    window.navigator.clipboard?.writeText(item.objectKey).catch(() => {});
  };
  const visibleFolders = displayItems.filter((item) =>
    String(item.objectKey || "").endsWith("/"),
  );
  const visibleFolderKeys = visibleFolders.map((item) => item.id || item.objectKey);
  const allVisibleFoldersSelected =
    visibleFolderKeys.length > 0 &&
    visibleFolderKeys.every((key) => selectedFolderIds.includes(key));
  const toggleAllFolders = () => {
    setSelectedFolderIds((current) =>
      allVisibleFoldersSelected
        ? current.filter((key) => !visibleFolderKeys.includes(key))
        : [...new Set([...current, ...visibleFolderKeys])],
    );
  };
  const copySelectedFolders = () => {
    const selected = visibleFolders.filter((item) =>
      selectedFolderIds.includes(item.id || item.objectKey),
    );
    const keys = selected.map((item) => item.id || item.objectKey);
    const objectKeys = selected.map((item) => item.objectKey);
    setFolderClipboard({ keys, mode: "copied", objectKeys });
    window.navigator.clipboard?.writeText(objectKeys.join("\n")).catch(() => {});
  };
  const deleteSelectedFolders = async () => {
    const selected = visibleFolders.filter((item) =>
      selectedFolderIds.includes(item.id || item.objectKey),
    );
    if (!selected.length) return;
    const confirmed = await openDriveDialog({ kind: "confirm", tone: "danger", title: `Delete ${selected.length} folders?`, message: "All selected folders will be removed from this Drive location.", confirmLabel: "Delete all" });
    if (!confirmed) return;
    const defaultKeys = selected.filter((item) => item.isDefault).map((item) => item.defaultKey);
    const storedItems = selected.filter((item) => !item.isDefault);
    if (defaultKeys.length) {
      setHiddenDefaultFolders((current) => [...new Set([...current, ...defaultKeys])]);
    }
    await Promise.all(storedItems.map((item) => deleteCloudStorageObject(id, item.id)));
    if (defaultKeys.length) {
      setTrashedDefaultFolders((current) => [
        ...current,
        ...selected.filter((item) => item.isDefault).map((item) => ({ ...item, status: "deleted", deletedAt: new Date().toISOString() })),
      ]);
    }
    showDeleteToast(selected);
    setSelectedFolderIds([]);
    setFolderClipboard(null);
    if (storedItems.length) refresh();
  };
  const used = Number(service.storageUsedBytes || 0);
  const capacity = Number(service.capacityBytes || 0);
  const parentLocation = location.includes("/")
    ? location.split("/").slice(0, -1).join("/")
    : null;
  return (
    <div className={`cloud-drive-manager ${selectedFolderIds.length > 0 ? "is-marking" : ""}`.trim()}>
      <aside className="cloud-drive-sidebar">
        <div className="cloud-drive-brand">
          <span><ICN.Cloud size={24} /></span>
          <div><strong>My Drive</strong><small>Private cloud SSD</small></div>
        </div>
        <nav aria-label="File locations">
          {standardLocations.map(([path, icon]) => {
            const Icon = ICN[icon];
            const isExpanded = expandedLocations.includes(path);
            const rootFolders = sidebarFolders[path] || [];
            return (
              <div className={`cloud-drive-nav-root ${isExpanded ? "is-expanded" : ""}`} key={path}>
                <div className="cloud-drive-nav-row">
                  <button
                    type="button"
                    className={rootLocation === path ? "is-active" : ""}
                    onClick={() => openLocation(path)}
                    title={path}
                  >
                    <Icon size={17} /><span>{path}</span>
                  </button>
                  <button
                    type="button"
                    className="cloud-drive-nav-toggle"
                    onClick={() => setExpandedLocations((current) =>
                      current.includes(path)
                        ? current.filter((value) => value !== path)
                        : [...current, path],
                    )}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${path}`}
                    aria-expanded={isExpanded}
                  >
                    <ICN.ChevronDown size={14} />
                  </button>
                </div>
                <div className="cloud-drive-nav-children" aria-hidden={!isExpanded}>
                    {rootFolders.map((folder) => (
                      <button
                        type="button"
                        key={folder.key}
                        className={location === folder.key ? "is-active" : ""}
                        onClick={() => openLocation(folder.key)}
                        title={folder.key}
                      >
                        <ICN.Folder size={14} /><span>{folder.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="cloud-drive-nav-create"
                      onClick={() => createFolder(path)}
                      title={`Create folder in ${path}`}
                    >
                      <ICN.FolderPlus size={14} /><span>New folder</span>
                    </button>
                </div>
              </div>
            );
          })}
          <div className="cloud-drive-nav-root cloud-drive-trash-root">
            <div className="cloud-drive-nav-row">
              <button type="button" className={location === "Trash" ? "is-active" : ""} onClick={() => openLocation("Trash")} title="Trash">
                <ICN.Trash2 size={17} /><span>Trash</span>
                {trashItems.length > 0 && <small>{trashItems.length}</small>}
              </button>
            </div>
          </div>
        </nav>
        <div className="cloud-drive-space">
          <div><span>Storage</span><strong>{Math.round(storagePercent(used, capacity))}%</strong></div>
          <span className="cloud-drive-space-meter"><span style={{ width: `${storagePercent(used, capacity)}%` }} /></span>
          <small>{gb(used)} of {gb(capacity)} used</small>
        </div>
      </aside>
      <section className="cloud-drive-content">
        <header className="cloud-drive-toolbar">
          <div>
            <span className="page-eyebrow">Cloud SSD</span>
            <div className="cloud-drive-route-heading">
              {parentLocation && (
                <button
                  type="button"
                  className="cloud-drive-back"
                  onClick={() => openLocation(parentLocation)}
                  aria-label={`Back to ${parentLocation}`}
                  title={`Back to ${parentLocation}`}
                >
                  <ICN.ArrowLeft size={16} />
                </button>
              )}
              <h2>{location.split("/").join(" / ")}</h2>
            </div>
          </div>
          <button type="button" className="cloud-drive-signout" onClick={onSignOut}>
            Sign out <ICN.ArrowRight size={14} />
          </button>
        </header>
        <div className="cloud-drive-actions">
          {location !== "Trash" && (
            <>
              <button className="btn btn-primary" type="button" onClick={() => createFolder()}>
                <ICN.FolderPlus size={15} /> Create folder
              </button>
              <button className="btn btn-outline cloud-drive-action-plain" type="button" onClick={() => fileInput.current?.click()}>
                <ICN.Upload size={15} /> Upload file
              </button>
              <div className="cloud-drive-create-file">
                <button className="btn btn-outline cloud-drive-action-plain" type="button" onClick={() => setCreateFileMenuOpen((current) => !current)} aria-expanded={createFileMenuOpen}>
                  <ICN.File size={15} /> Create file <ICN.ChevronDown size={12} />
                </button>
                {createFileMenuOpen && (
                  <div className="cloud-drive-create-file-menu">
                    <button type="button" onClick={() => createDocument("word")}><span className="is-word">W</span><div><strong>Word document</strong><small>Create an online .docx file</small></div></button>
                    <button type="button" onClick={() => createDocument("text")}><span className="is-text">TXT</span><div><strong>Text document</strong><small>Create a plain .txt file</small></div></button>
                  </div>
                )}
              </div>
            </>
          )}
          <label className="cloud-drive-search">
            <ICN.Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this drive" />
          </label>
          <input ref={fileInput} hidden type="file" onChange={(event) => registerFile(event.target.files)} />
        </div>
        {selectedFolderIds.length > 0 && (
          <div className="cloud-drive-selection-toolbar">
            <div>
              <span className="cloud-drive-selection-check"><ICN.Check size={12} /></span>
              <strong>{selectedFolderIds.length} marked</strong>
            </div>
            <span className="cloud-drive-selection-actions">
              <button type="button" onClick={toggleAllFolders}><span className="cloud-drive-folder-check">{allVisibleFoldersSelected && <ICN.Check size={11} />}</span>{allVisibleFoldersSelected ? "Unmark all" : "Mark all"}</button>
              <button type="button" className={folderClipboard?.mode === "copied" && folderClipboard.keys?.length > 1 ? "is-active" : ""} onClick={copySelectedFolders}>{folderClipboard?.mode === "copied" && folderClipboard.keys?.length > 1 ? <ICN.Check size={13} /> : <ICN.Copy size={13} />}Copy all</button>
              <button type="button" className="is-delete" onClick={deleteSelectedFolders}><ICN.Trash2 size={13} />Delete all</button>
              <button type="button" onClick={() => setSelectedFolderIds([])}><ICN.X size={13} />Clear</button>
            </span>
          </div>
        )}
        <div className="cloud-drive-files-head">
          <div><strong>Files and folders</strong><span>{displayItems.length} items</span></div>
          <small>Apps for opening files will be available here later.</small>
        </div>
        {displayItems.length ? (
          <div className="cloud-drive-file-grid">
            {displayItems.map((item) => {
              const isFolder = String(item.objectKey || "").endsWith("/");
              const FileIcon = isFolder ? ICN.Folder : ICN.File;
              const folderKey = item.id || item.objectKey;
              const isSelected = selectedFolderIds.includes(folderKey);
              const clipboardMode = folderClipboard?.keys?.includes(folderKey) ? folderClipboard.mode : "";
              const itemMetadata = readObjectMetadata(item);
              const fileExtension = String(item.displayName || "").split(".").pop().toLowerCase();
              const isEditableDocument = !isFolder && (
                Boolean(itemMetadata.documentType) || ["docx", "txt"].includes(fileExtension)
              );
              return (
                <div
                  key={folderKey}
                  className={`cloud-drive-file ${isFolder ? "is-folder" : ""} ${item.isDefault ? "is-default" : ""} ${isSelected ? "is-selected" : ""} ${clipboardMode ? `is-${clipboardMode}` : ""}`.trim()}
                  role={isFolder && location !== "Trash" ? "button" : undefined}
                  tabIndex={isFolder && location !== "Trash" ? 0 : undefined}
                  onClick={() => isFolder && location !== "Trash" && openLocation(item.objectKey)}
                  onKeyDown={(event) => {
                    if (isFolder && location !== "Trash" && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      openLocation(item.objectKey);
                    }
                  }}
                >
                  <span><FileIcon size={25} /></span>
                  <strong>{item.displayName || item.objectKey}</strong>
                  <small>{isFolder ? "Folder" : gb(item.sizeBytes)} · {item.status || "Stored"}</small>
                  {isFolder && selectedFolderIds.length > 0 && (
                    <button
                      type="button"
                      className={`cloud-drive-folder-mark-toggle ${isSelected ? "is-checked" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFolderSelection(item);
                      }}
                      aria-label={`${isSelected ? "Unmark" : "Mark"} ${item.displayName}`}
                      title={isSelected ? "Unmark folder" : "Mark folder"}
                    >
                      {isSelected && <ICN.Check size={11} />}
                    </button>
                  )}
                  {location !== "Trash" && <span className="cloud-drive-folder-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="cloud-drive-folder-more" aria-label={`Actions for ${item.displayName}`} title="Item actions">•••</button>
                    <span className="cloud-drive-folder-menu">
                      {isFolder && <button type="button" className={isSelected ? "is-active" : ""} onClick={() => toggleFolderSelection(item)} title={isSelected ? "Unmark folder" : "Mark folder"} aria-label={`${isSelected ? "Unmark" : "Mark"} ${item.displayName}`}><span className="cloud-drive-folder-check">{isSelected && <ICN.Check size={11} />}</span></button>}
                      <button type="button" className={clipboardMode === "copied" ? "is-active" : ""} onClick={() => stageFolder(item, "copied")} title={`Copy ${isFolder ? "folder" : "file"}`} aria-label={`Copy ${item.displayName}`}>{clipboardMode === "copied" ? <ICN.Check size={13} /> : <ICN.Copy size={13} />}</button>
                      <button type="button" className={clipboardMode === "cut" ? "is-active" : ""} onClick={() => stageFolder(item, "cut")} title={`Cut ${isFolder ? "folder" : "file"}`} aria-label={`Cut ${item.displayName}`}><ICN.Scissors size={13} /></button>
                      <button type="button" onClick={() => isFolder ? editFolder(item) : editFile(item)} title={`Rename ${isFolder ? "folder" : "file"}`} aria-label={`Rename ${item.displayName}`}><ICN.Edit size={13} /></button>
                      <button type="button" onClick={() => isFolder ? showFolderProperties(item) : showFileProperties(item)} title="Properties" aria-label={`Properties for ${item.displayName}`}><ICN.Info size={13} /></button>
                      <button type="button" className="is-delete" onClick={() => isFolder ? deleteFolder(item) : deleteFile(item)} title={`Delete ${isFolder ? "folder" : "file"}`} aria-label={`Delete ${item.displayName}`}><ICN.Trash2 size={13} /></button>
                    </span>
                  </span>}
                  {location === "Trash" && (
                    <span className="cloud-drive-folder-actions cloud-drive-trash-actions" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="cloud-drive-folder-more" aria-label={`Trash actions for ${item.displayName}`} title="Trash actions">•••</button>
                      <span className="cloud-drive-folder-menu">
                        <button type="button" onClick={() => undoDeleteItem(item)} title="Restore" aria-label={`Restore ${item.displayName}`}><ICN.ArrowLeft size={13} /></button>
                        <button type="button" className="is-delete" onClick={() => permanentlyDeleteItem(item)} title="Delete permanently" aria-label={`Permanently delete ${item.displayName}`}><ICN.Trash2 size={13} /></button>
                        <button type="button" onClick={() => isFolder ? showFolderProperties(item) : showFileProperties(item)} title="Info" aria-label={`Information for ${item.displayName}`}><ICN.Info size={13} /></button>
                      </span>
                    </span>
                  )}
                  {location !== "Trash" && isEditableDocument && (
                    <button type="button" className="cloud-drive-file-open" onClick={() => openDocument(item)} aria-label={`Open ${item.displayName}`}>Open</button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cloud-drive-empty">
            <span><ICN.Folder size={30} /></span>
            <strong>This folder is empty</strong>
            <small>Create a folder or upload files to begin.</small>
          </div>
        )}
      </section>
      {documentEditor && (
        <div className="cloud-drive-editor-backdrop" role="presentation">
          <section className={`cloud-drive-editor is-${documentEditor.documentType}`} role="dialog" aria-modal="true" aria-labelledby="cloud-drive-editor-title">
            <header>
              <span className="cloud-drive-editor-type">{documentEditor.documentType === "word" ? "W" : "TXT"}</span>
              <div>
                <span>{documentEditor.documentType === "word" ? "Word document" : "Text document"}</span>
                <input id="cloud-drive-editor-title" value={documentEditor.name} onChange={(event) => setDocumentEditor((current) => ({ ...current, name: event.target.value }))} aria-label="File name" />
              </div>
              <button type="button" onClick={() => setDocumentEditor(null)} aria-label="Close editor"><ICN.X size={17} /></button>
            </header>
            <div className="cloud-drive-editor-status"><span><ICN.Cloud size={14} /> Saved to My Drive when you press Save</span><small>{documentEditor.content.length.toLocaleString()} characters</small></div>
            <textarea value={documentEditor.content} onChange={(event) => setDocumentEditor((current) => ({ ...current, content: event.target.value }))} placeholder="Start writing..." autoFocus />
            <footer>
              <button type="button" className="btn btn-outline" onClick={() => setDocumentEditor(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveDocument} disabled={documentEditor.isSaving || !documentEditor.name.trim()}>{documentEditor.isSaving ? "Saving..." : "Save"}</button>
            </footer>
          </section>
        </div>
      )}
      {deleteToast && (
        <div className="cloud-drive-delete-toast" role="status">
          <span><ICN.Trash2 size={16} /></span>
          <div>
            <strong>{deleteToast.records.length > 1 ? `${deleteToast.records.length} items deleted` : `${deleteToast.records[0].displayName} deleted`}</strong>
            <small>Moved to Trash</small>
          </div>
          <button type="button" onClick={undoDelete}>Undo</button>
        </div>
      )}
      <DriveActionDialog dialog={driveDialog} onResolve={resolveDriveDialog} />
    </div>
  );
}

function BackupsPanel({ id, items, refresh }) {
  return (
    <>
      <button
        className="btn btn-primary"
        onClick={async () => {
          await createCloudStorageRestorePoint(id);
          refresh();
        }}
      >
        <ICN.Plus size={14} /> Create restore point
      </button>
      <div className="cloud-storage-records">
        {items.length ? (
          items.map((point) => (
            <div key={point.id}>
              <div>
                <strong>{point.kind} backup</strong>
                <span>{new Date(point.createdAt).toLocaleString()}</span>
              </div>
              <button
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  await restoreCloudStoragePoint(id, point.id);
                  refresh();
                }}
              >
                Restore
              </button>
            </div>
          ))
        ) : (
          <Empty icon="Archive" title="No restore points yet." />
        )}
      </div>
    </>
  );
}
