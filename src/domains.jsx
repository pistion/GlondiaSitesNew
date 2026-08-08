// domains.jsx — My domains, Domain search/purchase flow, DNS editor
import React, { useEffect, useRef, useState as useStateD } from 'react';
import { ICN } from './icons';
import { GD } from './data';
import { StatusBadge, Tabs, Stat, Badge, Empty, ToggleRow } from './components';
import { activateCustomerDomainAddon, bulkDeleteDnsRecords, captureDomainAddonPayPalOrder, captureDomainPayPalOrder, checkDomainAvailability, createDnsRecord, createDomain, createDomainAddonPayPalOrder, createDomainPayPalOrder, deleteDnsRecord, exportZoneFile, getCustomerDomainProviderAccess, getCustomerDomainSettings, getPayPalClientSettings, getRegistrarOperation, getRegistrarSettings, getStoredAuth, importZoneFile, pullDnsFromSpaceship, pushDnsToSpaceship, syncCustomerDomains, ttlToSeconds, updateDnsRecord, updateNameservers, validateDomainCart, verifyDomain } from './api';
import { useDnsRecords, useDomains } from './use-domains';
import { isLiveMode } from './app/config.js';
import SandboxBanner from './features/sandbox/SandboxBanner.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON ROWS
// ─────────────────────────────────────────────────────────────────────────────

function DomainSkeletonRow({ delay = 0 }) {
  return (
    <tr style={{ animationDelay: `${delay}s` }} className="dom-tbl-row">
      <td><div className="row" style={{ gap: 8 }}><div className="skel skel-line" style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0 }} /><div className="skel skel-line" style={{ width: 130 }} /></div></td>
      <td><div className="skel skel-line" style={{ width: 80 }} /></td>
      <td><div className="skel skel-badge" style={{ width: 40 }} /></td>
      <td><div className="skel skel-line" style={{ width: 55 }} /></td>
      <td><div className="skel skel-badge" /></td>
      <td style={{ textAlign: 'right' }}><div className="skel skel-btn" style={{ marginLeft: 'auto' }} /></td>
    </tr>
  );
}

function DnsSkeletonRow({ delay = 0 }) {
  return (
    <tr style={{ animationDelay: `${delay}s` }} className="dns-anim-row">
      <td><div className="skel skel-badge" style={{ width: 46 }} /></td>
      <td><div className="skel skel-line" style={{ width: 70 }} /></td>
      <td><div className="skel skel-line" style={{ width: 160 }} /></td>
      <td><div className="skel skel-line" style={{ width: 45 }} /></td>
      <td><div className="skel skel-badge" style={{ width: 58 }} /></td>
      <td style={{ textAlign: 'right' }}><div className="skel skel-btn" style={{ marginLeft: 'auto' }} /></td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MY DOMAINS
// ─────────────────────────────────────────────────────────────────────────────

export function DomainsMine({ navigate }) {
  const { domains, loading, source, error, providerConfigured } = useDomains();
  const [verifyingId, setVerifyingId] = useStateD(null);
  const [providerAccess, setProviderAccess] = useStateD(null);
  const [syncingProvider, setSyncingProvider] = useStateD('');
  const [syncMessage, setSyncMessage] = useStateD('');
  const connectedCount = domains.filter(d => d.linkedProject).length;
  const canBuy = providerConfigured !== false;
  const isProviderClient = getStoredAuth().user?.clientId === 'glondiac-4108';

  useEffect(() => {
    if (!isProviderClient || !isLiveMode()) return;
    getCustomerDomainProviderAccess()
      .then(setProviderAccess)
      .catch(() => setProviderAccess(null));
  }, [isProviderClient]);

  const syncProvider = async (provider) => {
    setSyncingProvider(provider);
    setSyncMessage('');
    try {
      const result = await syncCustomerDomains(provider);
      const label = provider === 'domains' ? 'Glondia domain' : 'Glondia protection';
      setSyncMessage(`${result.imported} ${label}${result.imported === 1 ? '' : 's'} synced to this account.`);
    } catch (syncError) {
      setSyncMessage(syncError.message || `Could not sync ${provider}.`);
    } finally {
      setSyncingProvider('');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Domains / My domains</div>
          <h1>My domains</h1>
          <p className="sub">Manage every domain you've registered or transferred to Glondia. Link them to projects, edit DNS, set up renewals.</p>
        </div>
        <div className="actions">
          {providerAccess?.services?.domains?.configured && (
            <button className="btn btn-outline" disabled={Boolean(syncingProvider)} onClick={() => syncProvider('domains')}>
              <ICN.Refresh size={14} /> {syncingProvider === 'domains' ? 'Syncing domains...' : 'Sync domains'}
            </button>
          )}
          {providerAccess?.services?.protection?.configured && (
            <button className="btn btn-outline" disabled={Boolean(syncingProvider)} onClick={() => syncProvider('protection')}>
              <ICN.Refresh size={14} /> {syncingProvider === 'protection' ? 'Syncing protection...' : 'Sync protection'}
            </button>
          )}
          {!loading && domains.length > 0 && (
            <button
              className="btn btn-primary"
              disabled={!canBuy}
              title={canBuy ? undefined : 'Domain registration is not configured yet.'}
              onClick={() => canBuy && navigate({ view: "domains-buy" })}
            >
              <ICN.Plus size={14} /> Buy a domain
            </button>
          )}
        </div>
      </div>

      <SandboxBanner service="domains-mine" />

      {isProviderClient && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 650, marginBottom: 5 }}>Glondia domain services</div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Glondia handles registration, DNS, security, and domain add-ons. All infrastructure credentials remain securely on the server.
              </p>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Badge tone={providerAccess?.services?.domains?.configured ? 'success' : 'muted'}>Glondia Domains</Badge>
              <Badge tone={providerAccess?.services?.protection?.configured ? 'success' : 'muted'}>Glondia Protection</Badge>
            </div>
          </div>
          {syncMessage && <div style={{ marginTop: 10, fontSize: 13 }}>{syncMessage}</div>}
        </div>
      )}

      {providerConfigured === false && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Domain registration is not configured yet.</div>
          <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: 56 + 'ch' }}>
            Your administrator needs to enable Glondia Domains and payments before domains can be searched or purchased. No service credentials are available in this browser.
          </p>
        </div>
      )}

      <div className="grid-4">
        <Stat k="My domains" v={domains.length} d="across all TLDs" />
        <Stat k="Renewing in 30d" v={domains.filter(d => d.auto).length} d="auto-renew protects you" />
        <Stat k="Connected" v={connectedCount} d={domains.length ? `of ${domains.length} domain${domains.length === 1 ? '' : 's'}` : "No domains yet"} />
        <Stat k="Total this year" v="—" d="Loaded from billing API" />
      </div>

      {source === "api" && (
        <div className="card" style={{ padding: "10px 14px", fontSize: 13 }}>
          <span className="row" style={{ gap: 8 }}><ICN.Server size={14} /> Local workspace (demo)</span>
        </div>
      )}
      {error && (
        <div className="card" style={{ padding: "10px 14px", fontSize: 13, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="card card-flush dns-records-card">
        <div className="card-head">
          <h2>My domains</h2>
          <div className="row" style={{ gap: 8 }}>
            <Tabs value="All" onChange={() => {}} options={["All", "Active", "Pending DNS", "Transferring"]} />
            <button className="btn btn-sm btn-outline"><ICN.Filter size={14} /> TLD</button>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Connected to</th>
              <th>Auto-renew</th>
              <th>Expires</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3].map(i => <DomainSkeletonRow key={i} delay={i * 0.06} />)
            ) : domains.length === 0 ? (
              <tr className="anim-fadeIn">
                <td colSpan={6}>
                  <Empty icon="Globe" title="No domains yet"
                    body={providerConfigured === false
                      ? "Domain registration is not configured yet. Contact support when you're ready to connect a registrar."
                      : "Buy a domain to get started."}
                    action={canBuy ? (
                      <button className="btn btn-sm btn-primary" onClick={() => navigate({ view: "domains-buy" })}>
                        <ICN.Plus size={13} /> Buy a domain
                      </button>
                    ) : null} />
                </td>
              </tr>
            ) : domains.map((d, i) => (
              <tr key={d.id} className="dom-tbl-row" style={{ animationDelay: `${i * 0.045}s` }}>
                <td>
                  <a href="#" className="row" style={{ gap: 8, color: "inherit", fontWeight: 600 }}
                     onClick={(e) => { e.preventDefault(); navigate({ view: "dns", params: { domain: d.name } }); }}>
                    <ICN.Globe size={15} style={{ color: "var(--accent)" }} />
                    <span>{d.name}</span>
                  </a>
                </td>
                <td>
                  {d.linkedProject
                    ? <a href="#" className="mono" style={{ color: "var(--accent)" }}
                         onClick={(e) => { e.preventDefault(); navigate({ view: "hosting-detail", params: { id: d.linkedProject } }); }}>
                        {d.linkedProjectName || d.linkedProject}
                      </a>
                    : <span className="faint">— Not connected</span>}
                </td>
                <td>{d.auto ? <Badge tone="success" dot={false}>On</Badge> : <Badge tone="muted" dot={false}>Off</Badge>}</td>
                <td>{d.expires}</td>
                <td><StatusBadge value={d.status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {(d.rawStatus === 'pending_verification' || d.rawStatus === 'misconfigured') && (
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ color: 'var(--accent)', borderColor: 'var(--accent)', marginRight: 6 }}
                      onClick={() => setVerifyingId(verifyingId === d.id ? null : d.id)}>
                      <ICN.ShieldCheck size={14} /> Verify
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost"
                          onClick={() => navigate({ view: "dns", params: { domain: d.name } })}>
                    <ICN.Network size={14} /> Records
                  </button>
                  <button className="btn btn-sm btn-ghost" title="Domain settings"
                          onClick={() => navigate({ view: "dns", params: { domain: d.name, section: "settings" } })}>
                    <ICN.Settings size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {verifyingId && (() => {
        const d = domains.find(x => x.id === verifyingId);
        return d ? (
          <DomainVerifyPanel
            domain={d}
            onClose={() => setVerifyingId(null)}
            onVerified={() => setVerifyingId(null)}
          />
        ) : null;
      })()}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN VERIFY PANEL
// ─────────────────────────────────────────────────────────────────────────────

function CopyField({ value, mono = false, small = false }) {
  const [copied, setCopied] = useStateD(false);
  const timerRef = useRef(null);
  const doCopy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1800);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="row between" style={{
      padding: '9px 12px', background: 'var(--bg-deep)',
      borderRadius: 'var(--r-sm)', gap: 8,
      border: copied ? '1px solid var(--accent)' : '1px solid transparent',
      transition: 'border-color .2s ease',
    }}>
      <span style={{
        fontFamily: mono ? 'var(--mono)' : undefined,
        fontSize: small ? 12 : 13,
        wordBreak: 'break-all', flex: 1,
      }}>{value}</span>
      <button className="btn btn-icon btn-ghost" onClick={doCopy} title="Copy"
              style={{ flexShrink: 0, color: copied ? 'var(--accent)' : undefined, transition: 'color .2s ease' }}>
        {copied ? <ICN.Check size={13} /> : <ICN.Copy size={13} />}
      </button>
    </div>
  );
}

function DomainVerifyPanel({ domain, onClose, onVerified }) {
  const [busy, setBusy] = useStateD(false);
  const [result, setResult] = useStateD(null);
  const [err, setErr] = useStateD(null);

  const check = async () => {
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      const res = await verifyDomain(domain.id);
      setResult(res);
      if (res.verified) setTimeout(onVerified, 1800);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <div className="card dom-verify-wrap" style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, var(--border))' }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>
            Verify <span className="mono" style={{ color: 'var(--accent)' }}>{domain.hostname}</span>
          </h2>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            Add the TXT record below to your DNS provider's zone for <b>{domain.rootDomain}</b>.
            Propagation can take a few minutes.
          </p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}><ICN.X size={14} /></button>
      </div>

      <div className="grid-2" style={{ gap: 12, marginBottom: 18 }}>
        <div>
          <label className="label">Type</label>
          <div style={{ padding: '9px 12px', background: 'var(--bg-deep)', borderRadius: 'var(--r-sm)', fontFamily: 'var(--mono)', fontSize: 13 }}>TXT</div>
        </div>
        <div>
          <label className="label">Host&nbsp;/&nbsp;Name</label>
          <CopyField value="@" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Value</label>
          <CopyField value={domain.verificationToken} mono small />
        </div>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={check} disabled={busy}>
          <span className={busy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}>
            <ICN.Refresh size={14} />
          </span>
          {busy ? ' Checking…' : ' Check DNS'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Dismiss</button>
      </div>

      {result && !err && (
        <div className="dom-verify-result" style={{
          marginTop: 14, padding: '11px 14px', borderRadius: 'var(--r-sm)', fontSize: 13,
          background: result.verified ? 'var(--accent-soft)' : 'var(--bg-deep)',
          border: `1px solid ${result.verified ? 'var(--accent)' : 'var(--border)'}`,
          color: result.verified ? 'var(--accent-ink)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {result.verified
            ? <><ICN.ShieldCheck size={15} /> Domain verified! SSL certificate is being provisioned automatically.</>
            : <><ICN.AlertCircle size={15} /> TXT record not found yet. {result.hint || 'DNS may still be propagating — try again in a few minutes.'}</>}
        </div>
      )}
      {err && (
        <div className="dom-verify-result" style={{ marginTop: 14, padding: '11px 14px', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)', color: 'var(--danger)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          <ICN.AlertCircle size={14} /> {err}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BUY A DOMAIN — search + results + cart + checkout
// ─────────────────────────────────────────────────────────────────────────────

// Default empty contact form
const EMPTY_CONTACT = {
  firstName: '', lastName: '', company: '',
  email: '', phone: '',
  address1: '', address2: '',
  city: '', postalCode: '',
  country: '',
};

const FEATURED_TLDS = [".com", ".com.pg", ".com.fj", ".com.vu"];

export function DomainsBuy({ navigate }) {
  const [step, setStep] = useStateD("search"); // search | results | checkout | done
  const [query, setQuery] = useStateD("");
  const [selectedTld, setSelectedTld] = useStateD(".com");
  const [cart, setCart] = useStateD([]);
  const [contact, setContact] = useStateD(EMPTY_CONTACT);
  const [registering, setRegistering] = useStateD(false);
  const [registerError, setRegisterError] = useStateD(null);
  const [operations, setOperations] = useStateD([]); // [{ domain, operationId, status }]
  const [paidAmounts, setPaidAmounts] = useStateD(null); // amounts returned by capture
  const [providerReady, setProviderReady] = useStateD(null); // null loading | true | false
  const [checkoutReady, setCheckoutReady] = useStateD(false);
  const [providerMessage, setProviderMessage] = useStateD('');
  const [searchTransitioning, setSearchTransitioning] = useStateD(false);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isLiveMode()) {
          if (!cancelled) {
            setProviderReady(false);
            setProviderMessage('Domain registration requires live mode (VITE_APP_MODE=live) and a configured registrar.');
          }
          return;
        }
        const [registrar, paypal] = await Promise.all([
          getRegistrarSettings().catch(() => ({ configured: false })),
          getPayPalClientSettings().catch(() => ({ configured: false })),
        ]);
        if (cancelled) return;
        if (!registrar?.configured) {
          setProviderReady(false);
          setProviderMessage('Domain registration is not configured yet. The domain provider is not connected on the server.');
          return;
        }
        if (!paypal?.configured) {
          setProviderReady(true);
          setCheckoutReady(false);
          setProviderMessage('Checkout is unavailable until PayPal is configured on the server.');
          return;
        }
        setProviderReady(true);
        setCheckoutReady(true);
        setProviderMessage('');
      } catch {
        if (!cancelled) {
          setProviderReady(false);
          setCheckoutReady(false);
          setProviderMessage('Domain registration is not configured yet.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
  }, []);

  const addToCart = (item) => {
    if (providerReady !== true) return;
    setCart((current) => (
      current.find(c => c.name === item.name)
        ? current
        : [...current, item]
    ));
  };
  const removeFromCart = (name) => setCart(cart.filter(c => c.name !== name));
  const subtotal = cart.reduce((a, c) => a + c.price, 0);

  const completeOrder = async () => {
    setRegistering(true);
    setRegisterError(null);

    try {
      const order = await createDomainPayPalOrder({
        domains: cart.map((item) => ({ name: item.name, years: 1 })),
        contact,
        autoRenew: true,
        privacyProtection: true,
      });
      if (!order.approvalUrl) throw new Error('PayPal did not return an approval link.');
      window.open(order.approvalUrl, '_blank', 'noopener,noreferrer');
      setRegisterError('Approve the PayPal order in the new tab, then use PayPal checkout here to finish registration.');
    } catch (error) {
      setRegisterError(error.message || 'Registration failed — please check your details and try again.');
    } finally {
      setRegistering(false);
    }
  };

  const finishPaidOrder = (result) => {
    setOperations(result.operations || []);
    setPaidAmounts(result.amounts || null);
    setStep("done");
  };

  const canCheckout = providerReady === true;
  const beginSearch = () => {
    if (!query.trim() || providerReady === null || searchTransitioning) return;
    setSearchTransitioning(true);
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      setSearchTransitioning(false);
      setStep("results");
    }, 520);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Domains / Buy a domain</div>
          <h1>{step === "checkout" ? "Checkout" : step === "done" ? "All set" : "Find your domain"}</h1>
          {step !== "done" && <p className="sub">
            Search live registrar availability across curated TLDs. WHOIS privacy and auto-renew included.
          </p>}
        </div>
        {step !== "done" && (
          <div className="actions">
            <button className="btn btn-outline" onClick={() => navigate({ view: 'domains-mine' })}>
              <ICN.Globe size={14} /> My domains
            </button>
            {canCheckout && cart.length > 0 && step !== "checkout" && (
              <button className="btn btn-primary" onClick={() => setStep("checkout")}>
                <ICN.Cart size={14} /> Checkout · {cart.length} item{cart.length === 1 ? "" : "s"} · ${subtotal.toFixed(2)}
              </button>
            )}
          </div>
        )}
      </div>

      <SandboxBanner service="domains-buy" />

      {providerReady === null && (
        <div className="card muted" style={{ padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          Checking domain provider readiness…
        </div>
      )}
      {providerReady === false && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Domain registration is not fully configured yet</div>
          <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: 60 + 'ch' }}>
            {providerMessage || 'Enable Glondia Domains and payments on the server to use live search and checkout.'}
          </p>
        </div>
      )}

      {step === "search" && (
        <SearchPanel
          query={query}
          setQuery={setQuery}
          selectedTld={selectedTld}
          setSelectedTld={setSelectedTld}
          onSearch={beginSearch}
          searchDisabled={providerReady === null || searchTransitioning}
          searching={searchTransitioning}
          providerReady={providerReady}
          checkoutReady={checkoutReady}
          providerMessage={providerMessage}
        />
      )}
      {step === "results" && (
        <SearchResults
          query={query}
          cart={cart}
          addToCart={addToCart}
          removeFromCart={removeFromCart}
          selectedTld={selectedTld}
          onBack={() => setStep("search")}
          onCheckout={() => cart.length > 0 && canCheckout && setStep("checkout")}
          checkoutEnabled={canCheckout}
        />
      )}
      {step === "checkout" && (
        canCheckout ? (
          <Checkout
            cart={cart}
            subtotal={subtotal}
            contact={contact}
            setContact={setContact}
            onBack={() => setStep("results")}
            onComplete={completeOrder}
            onPaid={finishPaidOrder}
            busy={registering}
            error={registerError}
          />
        ) : (
          <div className="card" style={{ padding: 24 }}>
            <Empty
              icon="Cart"
              title="Checkout unavailable"
              body={providerMessage || 'Domain checkout requires Glondia Domains and payments to be enabled.'}
              action={
                <button className="btn btn-primary" onClick={() => setStep('search')}>
                  Back to search
                </button>
              }
            />
          </div>
        )
      )}
      {step === "done" && (
        <Done
          cart={cart}
          subtotal={subtotal}
          amounts={paidAmounts}
          operations={operations}
          onNew={() => { setCart([]); setContact(EMPTY_CONTACT); setOperations([]); setPaidAmounts(null); setStep("search"); }}
          onManage={() => navigate({ view: "domains-mine" })}
        />
      )}
    </>
  );
}

function SearchPanel({
  query,
  setQuery,
  selectedTld,
  setSelectedTld,
  onSearch,
  searchDisabled = false,
  searching = false,
  providerReady = null,
  checkoutReady = false,
  providerMessage = '',
}) {
  const selectedIndex = Math.max(0, FEATURED_TLDS.indexOf(selectedTld));
  const [pushAnimating, setPushAnimating] = useStateD(false);
  const [previousTld, setPreviousTld] = useStateD(null);
  const shiftTld = () => {
    if (pushAnimating) return;
    setPushAnimating(true);
    setPreviousTld(selectedTld);
    const nextIndex = (selectedIndex + 1) % FEATURED_TLDS.length;
    setSelectedTld(FEATURED_TLDS[nextIndex]);
    window.setTimeout(() => {
      setPushAnimating(false);
      setPreviousTld(null);
    }, 430);
  };

  return (
    <div className={`dom-hero ${searching ? 'is-searching' : ''}`}>
      <h2>Search for the perfect name.</h2>
      <p>Type a name, business, or idea. We'll check live registrar availability for supported TLDs.</p>
      <form className="dom-search input-group lg" onSubmit={(e) => { e.preventDefault(); if (!searchDisabled && query.trim()) onSearch(); }}>
        <button
          className="tld-push-input"
          type="button"
          aria-live="polite"
          aria-label={`Selected domain extension ${selectedTld}. Click to change.`}
          onClick={shiftTld}
          disabled={searchDisabled}
        >
          {previousTld && (
            <span className="tld-push-item item-out">
              <span className="tld-push-label">{previousTld}</span>
            </span>
          )}
          <span key={selectedTld} className={`tld-push-item ${pushAnimating ? "item-in" : ""}`}>
            <span className="tld-push-label">{selectedTld}</span>
          </span>
        </button>
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. mybusiness, kumul-shop, talimedia" autoFocus disabled={searchDisabled} />
        <button className="btn btn-primary" type="submit" disabled={searchDisabled || !query.trim()}>
          {searching ? (
            <>
              <span className="anim-spin" style={{ display: 'inline-flex' }}><ICN.Refresh size={16} /></span>
              Searching
            </>
          ) : (
            <>
              <ICN.Search size={16} /> Search
            </>
          )}
        </button>
      </form>
      {searching && (
        <div className="dom-search-status" role="status">
          Preparing availability check for <b className="mono">{query.trim().toLowerCase()}{selectedTld}</b>
        </div>
      )}
      <div className="row" style={{ justifyContent: "center", gap: 18, marginTop: 22, color: "var(--text-muted)", fontSize: 12.5, flexWrap: "wrap" }}>
        <span className="row" style={{ gap: 6 }}><ICN.ShieldCheck size={14} /> WHOIS privacy free</span>
        <span className="row" style={{ gap: 6 }}><ICN.Refresh size={14} /> Free auto-renew</span>
        <span className="row" style={{ gap: 6 }}><ICN.Zap size={14} /> One-click to your projects</span>
        <span className="row" style={{ gap: 6 }}><ICN.Globe size={14} /> Live Glondia availability</span>
      </div>
    </div>
  );
}

function SearchResults({ query, cart, addToCart, removeFromCart, selectedTld, onBack, onCheckout, checkoutEnabled = true }) {
  const base = (query || "yourdomain").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const [results, setResults] = useStateD(null); // null = loading, array = done
  const [searchError, setSearchError] = useStateD(null);

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    const startedAt = Date.now();
    setResults(null);
    setSearchError(null);

    const tlds = GD.tldPrices.map(t => base + t.tld);
    // Spaceship max 20 at a time — chunk if needed
    const chunks = [];
    for (let i = 0; i < tlds.length; i += 20) chunks.push(tlds.slice(i, i + 20));

    const finish = (callback) => {
      const remaining = Math.max(0, 720 - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (!cancelled) callback();
      }, remaining);
    };

    Promise.all(chunks.map(chunk => checkDomainAvailability(chunk)))
      .then(chunkResults => {
        const flat = chunkResults.flat();
        // Only show TLDs we actually got a registrar answer for — never invent availability.
        const merged = GD.tldPrices.map(t => {
          const name = base + t.tld;
          const apiResult = flat.find(d => d.domain === name);
          if (!apiResult) {
            return {
              ...t,
              name,
              available: false,
              premium: false,
              price: t.price,
              unchecked: true,
            };
          }
          const pricing = apiResult.pricing;
          const premiumAmount = pricing && typeof pricing === 'object' && !Array.isArray(pricing)
            ? pricing.amount
            : (Array.isArray(pricing)
              ? pricing.find(p => p.operation === 'register' || p.operation === 'registration')?.price
              : null);
          return {
            ...t,
            name,
            available: Boolean(apiResult.available),
            premium: premiumAmount != null,
            // Registrar premium amounts are treated as cents (same as checkout).
            price: premiumAmount != null ? Number(premiumAmount) / 100 : t.price,
            unchecked: false,
          };
        });
        finish(() => setResults(merged));
      })
      .catch(err => {
        // Do not fabricate availability when the provider fails.
        finish(() => {
          setSearchError(err.message || 'Domain provider is not configured yet.');
          setResults(GD.tldPrices.map(t => ({
            ...t,
            name: base + t.tld,
            available: false,
            premium: false,
            unchecked: true,
          })));
        });
      });

    return () => { cancelled = true; };
  }, [base]);

  const subtotal = cart.reduce((a, c) => a + c.price, 0);
  const loading = results === null;
  const availableCount = (results || []).filter(r => r.available).length;
  const selectedResult = (results || []).find(r => r.name === base + selectedTld);
  const selectedAvailable = selectedResult?.available ?? false;

  return (
    <div className="grid-side dom-results-shell" style={{ alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row dom-results-toolbar" style={{ gap: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={onBack}><ICN.ArrowLeft size={14} /> Modify search</button>
          <span className="muted">Results for <b className="mono" style={{ color: "var(--text)" }}>{base}</b></span>
          {loading && <span className="row" style={{ gap: 6, color: 'var(--text-muted)', fontSize: 13 }}><span className="anim-spin" style={{ display: 'inline-flex' }}><ICN.Refresh size={13} /></span> Checking availability…</span>}
        </div>

        {searchError && (
          <div className="card anim-fadeIn" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--danger)' }}>
            {/not configured|503|configured/i.test(searchError)
              ? 'Domain provider is not configured yet. Live availability cannot be shown.'
              : `Could not check availability: ${searchError}`}
          </div>
        )}

        {/* Featured (top match) */}
        <div className={`card dom-featured-result ${loading ? 'is-loading' : 'is-ready'}`} style={{ background: "linear-gradient(180deg, var(--accent-soft), transparent), var(--bg-elev)", borderColor: "color-mix(in srgb, var(--accent) 30%, var(--border))" }}>
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div>
              <Badge tone={selectedAvailable ? "success" : "warning"}>
                {loading ? "Checking..." : selectedAvailable ? "Top match" : "Taken - see alternatives"}
              </Badge>
              <div className="mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 10 }}>
                {base}<span style={{ color: "var(--accent)" }}>{selectedTld}</span>
              </div>
              {!loading && !selectedAvailable && (
                <p className="muted" style={{ margin: "8px 0 0", maxWidth: 50 + "ch" }}>
                  {selectedTld} is taken - but we found <b>{availableCount}</b> great alternatives below.
                </p>
              )}
              {!loading && selectedAvailable && (
                <p className="muted" style={{ margin: "8px 0 0" }}>
                  Great news — <b className="mono" style={{ color: 'var(--text)' }}>{base}{selectedTld}</b> is available!
                </p>
              )}
            </div>
            <div className="row" style={{ alignItems: "flex-end", flexDirection: "column", gap: 10 }}>
              {!loading && (selectedAvailable
                ? <Badge tone="success">Available</Badge>
                : <Badge tone="danger">Taken</Badge>
              )}
              {!loading && selectedAvailable && selectedResult && (
                <button className="btn btn-primary btn-sm"
                  onClick={() => addToCart({ name: selectedResult.name, price: selectedResult.price, renewal: selectedResult.renewal ?? selectedResult.price, premium: !!selectedResult.premium })}>
                  Add to cart
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card card-flush">
          <div className="card-head">
            <h2>All TLDs</h2>
            <span className="meta">{loading ? "…" : `${availableCount} available`}</span>
          </div>
          <div className={loading ? 'dom-loading-list' : 'dom-ready-list'}>
            {loading
              ? [0,1,2,3,4,5,6,7].map(i => (
                  <div key={i} className="dom-result dom-result-skeleton" style={{ animationDelay: `${i * 0.06}s` }}>
                    <div className="skel skel-line" style={{ width: 160, height: 18 }} />
                    <div className="skel skel-badge" style={{ width: 70 }} />
                    <div className="skel skel-btn" />
                  </div>
                ))
              : (results || []).map((r, i) => (
                  <DomainResultRow
                    key={r.tld}
                    r={r}
                    delay={i * 0.04}
                    inCart={!!cart.find(c => c.name === r.name)}
                    onAdd={() => addToCart({ name: r.name, price: r.price, renewal: r.renewal ?? r.price, premium: !!r.premium })}
                    onRemove={() => removeFromCart(r.name)}
                  />
                ))
            }
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12.5 }}>
          Prices shown in USD. Availability and final pricing are checked live through Glondia.
        </div>
      </div>

      {/* CART */}
      <div className="card" style={{ position: "sticky", top: 80 }}>
        <h2 style={{ marginTop: 0 }}>Your cart</h2>
        {cart.length === 0 ? (
          <Empty icon="Cart" title="No domains added yet" body="Tap “Add” on any available domain to start a cart." />
        ) : (
          <>
            {cart.map(c => (
              <div className="cart-row" key={c.name}>
                <div>
                  <div className="mono">{c.name}</div>
                  <div className="faint" style={{ fontSize: 12 }}>1 year · renews ${c.renewal.toFixed(2)}/yr</div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 18 }}>${c.price.toFixed(2)}</span>
                  <button className="btn btn-icon btn-ghost" onClick={() => removeFromCart(c.name)}><ICN.X size={14} /></button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <div className="row between"><span className="muted">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              <div className="row between"><span className="muted">WHOIS privacy</span><span style={{ color: "var(--accent)" }}>Free</span></div>
              <div className="row between"><span className="muted">Tax</span><span>Calculated at checkout</span></div>
            </div>
            <div className="row between" style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
              <b>Total today</b>
              <b style={{ fontFamily: "var(--serif)", fontSize: 24 }}>${subtotal.toFixed(2)}</b>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 14 }}
              onClick={onCheckout}
              disabled={!checkoutEnabled}
              title={checkoutEnabled ? undefined : 'Checkout requires the domain provider on the server'}
            >
              Continue to checkout <ICN.ArrowRight size={14} />
            </button>
            {!checkoutEnabled && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Checkout is unavailable until the domain provider is configured.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DomainResultRow({ r, delay = 0, inCart, onAdd, onRemove }) {
  if (!r.available) {
    return (
      <div className="dom-result taken" style={{ animationDelay: `${delay}s` }}>
        <div>
          <span className="dname">{r.name.slice(0, -r.tld.length)}<span className="tld">{r.tld}</span></span>
        </div>
        <Badge tone="danger" dot={false}>Taken</Badge>
        <button className="btn btn-sm btn-outline">View options</button>
      </div>
    );
  }
  return (
    <div className={`dom-result ${r.premium ? "premium" : ""}`} style={{ animationDelay: `${delay}s` }}>
      <div>
        <span className="dname">
          {r.name.slice(0, -r.tld.length)}<span className="tld">{r.tld}</span>
          {r.premium && <span className="premium-tag">Premium</span>}
        </span>
        <div className="meta" style={{ marginTop: 4 }}>
          Renews at ${r.renewal.toFixed(2)}/yr · WHOIS privacy included
        </div>
      </div>
      <div className="price">
        ${r.price.toFixed(2)}
        <small> /1st year</small>
      </div>
      {inCart
        ? <button className="btn btn-sm btn-outline" onClick={onRemove}><ICN.Check size={14} /> In cart · Remove</button>
        : <button className="btn btn-sm btn-primary" onClick={onAdd}><ICN.Plus size={14} /> Add</button>}
    </div>
  );
}

// Country list (ISO 3166-1 alpha-2 codes) — common ones first
const COUNTRIES = [
  { code: 'PG', label: 'Papua New Guinea' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'SB', label: 'Solomon Islands' },
  { code: 'FJ', label: 'Fiji' },
  { code: 'TO', label: 'Tonga' },
  { code: 'WS', label: 'Samoa' },
  { code: 'VU', label: 'Vanuatu' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'SG', label: 'Singapore' },
  { code: 'JP', label: 'Japan' },
  { code: 'IN', label: 'India' },
  { code: 'PH', label: 'Philippines' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'ZA', label: 'South Africa' },
];

function Checkout({ cart, subtotal, contact, setContact, onBack, onComplete, onPaid, busy, error }) {
  const [pay, setPay] = useStateD("paypal");
  const [quote, setQuote] = useStateD(null);
  const [quoteLoading, setQuoteLoading] = useStateD(false);
  const [quoteError, setQuoteError] = useStateD('');
  const [paypalError, setPaypalError] = useStateD('');
  const set = (field) => (e) => setContact(prev => ({ ...prev, [field]: e.target.value }));

  const quotePayload = () => ({
    domains: cart.map((item) => ({ name: item.name, years: 1 })),
  });

  const refreshQuote = async () => {
    if (!cart.length) return null;
    setQuoteLoading(true);
    setQuoteError('');
    try {
      const nextQuote = await validateDomainCart(quotePayload());
      setQuote(nextQuote);
      return nextQuote;
    } catch (err) {
      const message = err.message || 'Could not validate this cart against live registrar availability.';
      setQuoteError(message);
      setQuote(null);
      throw err;
    } finally {
      setQuoteLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!cart.length) return undefined;
    setQuoteLoading(true);
    setQuoteError('');
    validateDomainCart(quotePayload())
      .then((nextQuote) => { if (!cancelled) setQuote(nextQuote); })
      .catch((err) => {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err.message || 'Could not validate this cart against live registrar availability.');
        }
      })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [cart.map((item) => item.name).join('|')]);

  // Basic required-field validation before submit
  const required = ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'postalCode', 'country'];
  const missing = required.filter(f => !contact[f].trim());
  const phoneOk = /^\+\d{1,3}\.\d{4,14}$/.test(contact.phone.trim());
  const cartValid = quote?.valid === true && !quoteError;
  const canSubmit = cart.length > 0 && missing.length === 0 && phoneOk && cartValid && !quoteLoading;
  const estimatedMarkup = quote?.amounts?.markupAmount ?? (subtotal * 0.3).toFixed(2);
  const estimatedTotal = quote?.amounts?.totalAmount ?? (subtotal * 1.3).toFixed(2);

  return (
    <div className="domain-checkout-page">
      <section className="domain-checkout-main">
        <div className="domain-checkout-card domain-checkout-intro">
          <button className="btn btn-outline btn-sm" onClick={onBack}><ICN.ArrowLeft size={14} /> Back to results</button>
          <div>
            <h2>Checkout details</h2>
            <p className="muted">Add the registrant contact once. Glondia keeps WHOIS privacy enabled and verifies the cart again before payment.</p>
          </div>
          <Badge tone="info" dot={false}>Private registration included</Badge>
        </div>

        <div className="domain-checkout-card">
          <div className="domain-checkout-card-head">
            <div>
              <span className="domain-checkout-step">1</span>
              <h3>Registrant information</h3>
            </div>
            <span className="muted">Required for domain ownership</span>
          </div>
          <div className="grid-2">
            <div>
              <label className="label">First name <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" placeholder="Jane" value={contact.firstName} onChange={set('firstName')} />
            </div>
            <div>
              <label className="label">Last name <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" placeholder="Smith" value={contact.lastName} onChange={set('lastName')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="label">Organization <span className="faint">(optional)</span></label>
              <input className="input" placeholder="Acme Inc." value={contact.company} onChange={set('company')} />
            </div>
            <div>
              <label className="label">Email <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" type="email" placeholder="you@example.com" value={contact.email} onChange={set('email')} />
            </div>
            <div>
              <label className="label">
                Phone <span style={{ color: 'var(--danger)' }}>*</span>
                <span className="faint" style={{ fontWeight: 400, marginLeft: 4 }}>e.g. +1.5550001234</span>
              </label>
              <input
                className="input mono"
                type="tel"
                placeholder="+675.70001234"
                value={contact.phone}
                onChange={set('phone')}
                style={{ borderColor: contact.phone && !phoneOk ? 'var(--danger)' : undefined }}
              />
              {contact.phone && !phoneOk && (
                <span style={{ color: 'var(--danger)', fontSize: 11.5, marginTop: 4, display: 'block' }}>
                  Format: +countrycode.number — e.g. +675.70001234
                </span>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="label">Street address <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" placeholder="123 Main St" value={contact.address1} onChange={set('address1')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="label">Address line 2 <span className="faint">(optional)</span></label>
              <input className="input" placeholder="Suite 4, PO Box, etc." value={contact.address2} onChange={set('address2')} />
            </div>
            <div>
              <label className="label">City <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" placeholder="Port Moresby" value={contact.city} onChange={set('city')} />
            </div>
            <div>
              <label className="label">Postal / ZIP code <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input mono" placeholder="121" value={contact.postalCode} onChange={set('postalCode')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="label">Country <span style={{ color: 'var(--danger)' }}>*</span></label>
              <select className="select" value={contact.country} onChange={set('country')}>
                <option value="">Select country…</option>
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="domain-checkout-card">
          <div className="domain-checkout-card-head">
            <div>
              <span className="domain-checkout-step">2</span>
              <h3>Setup options</h3>
            </div>
            <span className="muted">Applied after checkout</span>
          </div>
          <ToggleRow label="Enable auto-renew" sub="We'll renew before expiry and email a receipt." defaultOn />
          <ToggleRow label="Enable WHOIS privacy" sub="Hide your registrant details from public lookups. Free with every domain." defaultOn />
          <ToggleRow label="Use Glondia nameservers" sub="Recommended — gives you DNS management inside this workspace." defaultOn />
          <ToggleRow label="Forward www to apex" sub="Redirect www.yourdomain to yourdomain automatically." defaultOn />
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-outline" onClick={onBack}><ICN.ArrowLeft size={14} /> Back to results</button>
        </div>
      </section>

      {/* Sticky summary */}
      <aside className="domain-checkout-summary">
      <div className="domain-checkout-card">
        <div className="domain-checkout-card-head">
          <div>
            <span className="domain-checkout-step">Review</span>
            <h3>Order summary</h3>
          </div>
          <Badge tone={cartValid ? "success" : "info"} dot={false}>{cartValid ? "Verified" : "Checking"}</Badge>
        </div>
        {cart.length === 0
          ? <Empty icon="Cart" title="Your cart is empty" />
          : (
            <>
              {cart.map(c => (
                <div className="cart-row" key={c.name}>
                  <div>
                    <div className="mono">{c.name}</div>
                    <div className="faint" style={{ fontSize: 12 }}>1 year</div>
                  </div>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 18 }}>${c.price.toFixed(2)}</span>
                </div>
              ))}
              {quoteLoading && (
                <div className="muted row" style={{ gap: 6, fontSize: 12, marginTop: 10 }}>
                  <span className="anim-spin" style={{ display: 'inline-flex' }}><ICN.Refresh size={12} /></span>
                  Checking live registrar availability...
                </div>
              )}
              {quote?.checkedAt && !quoteLoading && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Live cart verified by Glondia at {new Date(quote.checkedAt).toLocaleTimeString()}.
                </div>
              )}
              {quoteError && (
                <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-deep)', borderRadius: 'var(--r-sm)', border: '1px solid var(--danger)' }}>
                  <ICN.AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  {quoteError}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                <div className="row between"><span className="muted">Domain price</span><span>${quote?.amounts?.actualAmount ?? subtotal.toFixed(2)}</span></div>
                <div className="row between"><span className="muted">WHOIS privacy</span><span style={{ color: "var(--accent)" }}>Free</span></div>
                <div className="row between"><span className="muted">Platform/service fee</span><span>${estimatedMarkup}</span></div>
              </div>
              <div className="row between" style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
                <b>Total today</b>
                <b style={{ fontFamily: "var(--serif)", fontSize: 24 }}>${estimatedTotal}</b>
              </div>
              <div className="domain-checkout-final">
                <div className="domain-checkout-payhead">
                  <span>Payment method</span>
                  <span className="muted">Final checkout</span>
                </div>
                <div className="row domain-checkout-paymethods">
                  <PayPill icon="CreditCard" label="PayPal" active={pay === "paypal"} onClick={() => setPay("paypal")} />
                  <PayPill icon="Cube" label="Bank transfer" active={pay === "bank"} onClick={() => setPay("bank")} />
                </div>
                {pay === "paypal" && (
                  <PayPalCheckoutButton
                    disabled={!canSubmit || busy}
                    createOrder={async () => {
                      await refreshQuote();
                      const order = await createDomainPayPalOrder({
                        domains: cart.map((item) => ({ name: item.name, years: 1 })),
                        contact,
                        autoRenew: true,
                        privacyProtection: true,
                      });
                      setQuote(order);
                      return order;
                    }}
                    captureOrder={captureDomainPayPalOrder}
                    onPaid={onPaid}
                    onError={(message) => setPaypalError(message)}
                  />
                )}
                {pay === "bank" && (
                  <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>We'll email payment instructions for bank transfer in USD or PGK. Domain registration begins once the transfer clears.</p>
                )}
              </div>
              {paypalError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{paypalError}</p>}
              {error && (
                <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-deep)', borderRadius: 'var(--r-sm)', border: '1px solid var(--danger)' }}>
                  <ICN.AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  {error}
                </div>
              )}
              {!canSubmit && !busy && (
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {missing.length > 0 ? 'Fill in all required fields above.' : !phoneOk ? 'Fix the phone number format.' : quoteLoading ? 'Checking the live cart before payment.' : quoteError ? 'Update the cart before continuing.' : ''}
                </p>
              )}
              {pay !== 'paypal' && (
                <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} onClick={onComplete} disabled={busy || !canSubmit}>
                  <span className={busy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.ShieldCheck size={14} /></span>
                  {busy ? " Registering…" : " Complete order"}
                </button>
              )}
              <p className="muted" style={{ fontSize: 11.5, marginTop: 12, textAlign: "center" }}>
                Registrations are final once submitted. By continuing you agree to the registrar policy.
              </p>
            </>
          )}
      </div>
      </aside>
    </div>
  );
}

function PayPill({ icon, label, active, onClick }) {
  const Icon = ICN[icon];
  return (
    <button
      onClick={onClick}
      className="row"
      style={{
        gap: 8, padding: "10px 14px",
        borderRadius: "var(--r-sm)",
        border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
        background: active ? "var(--accent-soft)" : "var(--bg-elev)",
        color: active ? "var(--accent-ink)" : "var(--text)",
        fontWeight: 500,
        fontSize: 13.5,
      }}>
      <Icon size={15} /> {label}
    </button>
  );
}

function PayPalCheckoutButton({ disabled, createOrder, captureOrder, onPaid, onError }) {
  const ref = useRef(null);
  const checkoutRef = useRef(null);
  const disabledRef = useRef(disabled);
  const buttonsRef = useRef(null);

  // Keep disabledRef current without triggering SDK reload
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  // Load SDK and render buttons exactly once — disabled state is read via ref
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        const settings = await getPayPalClientSettings();
        if (!settings.configured || !settings.clientId) throw new Error('PayPal is not configured yet.');
        await loadPayPalSdk(settings.clientId);
        if (cancelled || !ref.current || !window.paypal?.Buttons) return;
        ref.current.innerHTML = '';
        const buttons = window.paypal.Buttons({
          style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
          onClick: () => {
            if (disabledRef.current) {
              onError?.('Complete the required checkout fields before paying.');
              return false;
            }
            return true;
          },
          createOrder: async () => {
            const order = await createOrder();
            checkoutRef.current = order.checkoutOrderId;
            return order.providerOrderId;
          },
          onApprove: async (data) => {
            const result = await captureOrder({ checkoutOrderId: checkoutRef.current, providerOrderId: data.orderID });
            onPaid?.(result);
          },
          onError: (err) => onError?.(err?.message || 'PayPal checkout failed.'),
          onCancel: () => onError?.('PayPal checkout was cancelled.'),
        });
        buttonsRef.current = buttons;
        await buttons.render(ref.current);
      } catch (error) {
        if (!cancelled) onError?.(error.message || 'PayPal checkout is unavailable.');
      }
    };
    setup();
    return () => {
      cancelled = true;
      buttonsRef.current?.close?.();
      buttonsRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }} />;
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve();
  const existing = document.querySelector('script[data-glondia-paypal]');
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener('load', resolve, { once: true });
    existing.addEventListener('error', reject, { once: true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.dataset.glondiaPaypal = 'true';
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load PayPal checkout.'));
    document.head.appendChild(script);
  });
}

function Done({ cart, subtotal, amounts, operations, onNew, onManage }) {
  const [opStatuses, setOpStatuses] = useStateD(operations); // [{ domain, operationId, status }]
  const [polling, setPolling] = useStateD(false);
  const [pollError, setPollError] = useStateD(null);

  // Keep local op statuses in sync if parent updates operations
  useEffect(() => { setOpStatuses(operations); }, [operations]);

  const hasPending = opStatuses.some(op => op.status === 'pending');
  const allDone = opStatuses.length > 0 && opStatuses.every(op => op.status === 'success');

  const pollStatuses = async () => {
    setPolling(true);
    setPollError(null);
    try {
      const updated = await Promise.all(
        opStatuses.map(async (op) => {
          if (!op.operationId || op.status === 'success' || op.status === 'failed') return op;
          try {
            const result = await getRegistrarOperation(op.operationId);
            return { ...op, status: result.status };
          } catch {
            return op; // keep previous status on individual poll failure
          }
        })
      );
      setOpStatuses(updated);
    } catch (e) {
      setPollError(e.message);
    } finally {
      setPolling(false);
    }
  };

  const opBadge = (status) => {
    if (status === 'success') return <Badge tone="success">Registered</Badge>;
    if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
    return <Badge tone="muted">Processing…</Badge>;
  };

  // If no operations (e.g. not logged in), show optimistic success
  const isOptimistic = opStatuses.length === 0;

  return (
    <div className="card anim-slideUp" style={{ textAlign: "center", padding: 48 }}>
      <div className="anim-pop" style={{ width: 64, height: 64, borderRadius: 999, background: allDone || isOptimistic ? "var(--accent-soft)" : "var(--bg-deep)", color: allDone || isOptimistic ? "var(--accent)" : "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
        {allDone || isOptimistic ? <ICN.ShieldCheck size={28} /> : <ICN.Refresh size={28} />}
      </div>

      {isOptimistic ? (
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 36, letterSpacing: "-0.015em", margin: 0 }}>
          Your domains are registered.
        </h2>
      ) : allDone ? (
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 36, letterSpacing: "-0.015em", margin: 0 }}>
          Registration complete!
        </h2>
      ) : (
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 36, letterSpacing: "-0.015em", margin: 0 }}>
          Registration submitted.
        </h2>
      )}

      <p className="muted" style={{ maxWidth: 60 + "ch", margin: "12px auto 0" }}>
        {isOptimistic || allDone
          ? `We've issued the registration${cart.length > 1 ? "s" : ""} and queued DNS setup. SSL certificates will be issued automatically once the domain${cart.length > 1 ? "s point" : " points"} at a project.`
          : "Glondia is processing your registration — this usually takes a minute. Click \"Check status\" to refresh."}
      </p>

      <div style={{ maxWidth: 480, margin: "32px auto 0", textAlign: "left" }}>
        {opStatuses.length > 0
          ? opStatuses.map(op => (
              <div className="row between" key={op.domain} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <span className="mono">{op.domain}</span>
                  {op.operationId && (
                    <div className="faint mono" style={{ fontSize: 11.5, marginTop: 3 }}>op: {op.operationId}</div>
                  )}
                </div>
                {opBadge(op.status)}
              </div>
            ))
          : cart.map(c => (
              <div className="row between" key={c.name} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="mono">{c.name}</span>
                <Badge tone="success">Registered</Badge>
              </div>
            ))
        }

        <div className="row between" style={{ paddingTop: 16, fontWeight: 600 }}>
          <span>Order total</span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 22 }}>${amounts?.totalAmount ?? subtotal.toFixed(2)}</span>
        </div>
      </div>

      {pollError && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 14 }}>{pollError}</p>
      )}

      <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 28 }}>
        <button className="btn btn-outline" onClick={onNew}>Buy another</button>
        {hasPending && (
          <button className="btn btn-outline" onClick={pollStatuses} disabled={polling}>
            <span className={polling ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.Refresh size={14} /></span>
            {polling ? ' Checking…' : ' Check status'}
          </button>
        )}
        <button className="btn btn-primary" onClick={onManage}>Go to my domains <ICN.ArrowRight size={14} /></button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS EDITOR
// ─────────────────────────────────────────────────────────────────────────────

const DNS_TABS = ["All", "A / AAAA", "CNAME", "MX", "TXT"];

function filterByTab(records, tab) {
  if (tab === "All") return records;
  if (tab === "A / AAAA") return records.filter(r => r.type === "A" || r.type === "AAAA");
  return records.filter(r => r.type === tab);
}

export function DnsEditor({ domain = "", navigate }) {
  const { domain: managedDomain, records: loadedRecords, loading, source, error } = useDnsRecords(domain);
  const [records, setRecords] = useStateD(GD.dnsRecords);
  const [editing, setEditing] = useStateD(null);
  const [adding, setAdding] = useStateD(false);
  const [actionError, setActionError] = useStateD(null);
  const [activeTab, setActiveTab] = useStateD("All");
  const [selected, setSelected] = useStateD(new Set());
  const [showImport, setShowImport] = useStateD(false);
  const [exportBusy, setExportBusy] = useStateD(false);
  const [bulkDeleting, setBulkDeleting] = useStateD(false);
  const [syncPushBusy, setSyncPushBusy] = useStateD(false);
  const [syncPullBusy, setSyncPullBusy] = useStateD(false);
  const [syncMsg, setSyncMsg] = useStateD(null);

  useEffect(() => { setRecords(loadedRecords); }, [loadedRecords]);

  const domainLabel = managedDomain?.name || domain || 'your domain';
  const canMutate = source === "api" && managedDomain?.id;
  const filtered = filterByTab(records, activeTab);
  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(r => r.id)));
  };

  const handleTabChange = (tab) => { setActiveTab(tab); setSelected(new Set()); };

  const update = async (id, patch) => {
    setActionError(null);
    if (!canMutate) { setRecords(records.map(r => r.id === id ? { ...r, ...patch } : r)); return; }
    try {
      await updateDnsRecord(managedDomain.id, id, dnsPayloadFromRecord(patch));
      setEditing(null);
    } catch (e) { setActionError(e.message); }
  };

  const remove = async (id) => {
    setActionError(null);
    if (!canMutate) { setRecords(records.filter(r => r.id !== id)); return; }
    try { await deleteDnsRecord(managedDomain.id, id); }
    catch (e) { setActionError(e.message); }
  };

  const add = async (rec) => {
    setActionError(null);
    if (!canMutate) {
      setRecords([...records, { ...rec, id: Math.max(0, ...records.map(r => Number(r.id) || 0)) + 1 }]);
      return;
    }
    try { await createDnsRecord(managedDomain.id, dnsPayloadFromRecord(rec)); setAdding(false); }
    catch (e) { setActionError(e.message); }
  };

  const handleBulkDelete = async () => {
    if (!canMutate || selected.size === 0) return;
    setBulkDeleting(true);
    setActionError(null);
    try {
      await bulkDeleteDnsRecords(managedDomain.id, [...selected]);
      setSelected(new Set());
    } catch (e) { setActionError(e.message); }
    finally { setBulkDeleting(false); }
  };

  const handleExport = async () => {
    if (!canMutate) return;
    setExportBusy(true);
    try {
      const { hostname, content } = await exportZoneFile(managedDomain.id);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${hostname}.zone`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { setActionError(e.message); }
    finally { setExportBusy(false); }
  };

  const handlePushToSpaceship = async () => {
    if (!canMutate) return;
    setSyncPushBusy(true);
    setSyncMsg(null);
    setActionError(null);
    try {
      const { pushed } = await pushDnsToSpaceship(managedDomain.id);
      setSyncMsg(`✓ Published ${pushed} Glondia record${pushed === 1 ? '' : 's'}`);
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (e) { setActionError(e.message); }
    finally { setSyncPushBusy(false); }
  };

  const handlePullFromSpaceship = async () => {
    if (!canMutate) return;
    setSyncPullBusy(true);
    setSyncMsg(null);
    setActionError(null);
    try {
      const { pulled } = await pullDnsFromSpaceship(managedDomain.id);
      setSyncMsg(`✓ Refreshed ${pulled} Glondia record${pulled === 1 ? '' : 's'}`);
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (e) { setActionError(e.message); }
    finally { setSyncPullBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a className="page-eyebrow" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: "domains-mine" }); }}>
            ← My domains
          </a>
          <h1 style={{ marginTop: 8 }}>
            DNS records: <span className="mono" style={{ fontSize: 32, color: "var(--accent)" }}>{domainLabel}</span>
          </h1>
          <p className="sub">Manage the DNS records stored for this domain. Provider changes synchronize through the backend.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline" onClick={() => navigate({ view: "dns", params: { domain: domainLabel, section: "settings" } })}>
            <ICN.Settings size={14} /> Domain settings
          </button>
          <button className="btn btn-outline" onClick={() => setShowImport(v => !v)}>
            <ICN.Code size={14} /> Import zone file
          </button>
          {canMutate && (
            <>
              <button className="btn btn-outline" onClick={handlePullFromSpaceship} disabled={syncPullBusy} title="Refresh DNS records from Glondia">
                <span className={syncPullBusy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.ArrowLeft size={14} /></span>
                {syncPullBusy ? ' Pulling…' : ' Pull from registrar'}
              </button>
              <button className="btn btn-outline" onClick={handlePushToSpaceship} disabled={syncPushBusy} title="Publish DNS records through Glondia">
                <span className={syncPushBusy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.ArrowRight size={14} /></span>
                {syncPushBusy ? ' Pushing…' : ' Push to registrar'}
              </button>
            </>
          )}
          {canMutate && (
            <button className="btn btn-outline" onClick={handleExport} disabled={exportBusy}>
              <span className={exportBusy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.ArrowRight size={14} /></span>
              {exportBusy ? ' Exporting…' : ' Export zone'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <ICN.Plus size={14} /> Add record
          </button>
        </div>
      </div>

      <SandboxBanner service="domains-mine" />

      <div className="grid-4">
        <Stat k="Records" v={records.length} d="across all types" />
        <Stat k="Provider" v={managedDomain?.provider || "Pending"} d="stored service provider" />
        <Stat k="Protected" v={records.filter((record) => record.proxy).length} d="Glondia-protected records" />
        <Stat k="Filtered" v={filtered.length} d={activeTab === "All" ? "showing all" : `type: ${activeTab}`} />
      </div>

      {syncMsg && (
        <div className="card anim-slideUp" style={{ padding: "10px 14px", fontSize: 13, color: "var(--success, #22c55e)", borderColor: "var(--success, #22c55e)" }}>
          <span className="row" style={{ gap: 8 }}><ICN.CheckCircle size={14} /> {syncMsg}</span>
        </div>
      )}

      {source === "api" && (
        <div className="card anim-fadeIn" style={{ padding: "10px 14px", fontSize: 13 }}>
          <span className="row" style={{ gap: 8 }}><ICN.Server size={14} /> Local workspace</span>
        </div>
      )}
      {(error || actionError) && (
        <div className="card anim-fadeIn" style={{ padding: "10px 14px", fontSize: 13, color: actionError ? "var(--danger)" : "var(--text-muted)" }}>
          {actionError || "Showing local workspace DNS records."}
        </div>
      )}

      {showImport && (
        <ImportZonePanel
          domainId={managedDomain?.id}
          canMutate={!!canMutate}
          onClose={() => setShowImport(false)}
          onDone={() => setShowImport(false)}
        />
      )}

      <div className="card card-flush">
        <div className="card-head">
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Records</h2>
            {selected.size > 0 && (
              <button className="btn btn-sm btn-outline anim-fadeIn"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={handleBulkDelete} disabled={bulkDeleting}>
                <span className={bulkDeleting ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.Trash size={13} /></span>
                {bulkDeleting ? ' Deleting…' : ` Delete ${selected.size}`}
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Tabs value={activeTab} onChange={handleTabChange} options={DNS_TABS} />
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <button className={`chk ${allSelected ? 'on' : ''}`} onClick={toggleAll}>
                  {allSelected && <ICN.Check size={11} stroke={3} />}
                </button>
              </th>
              <th style={{ width: 80 }}>Type</th>
              <th style={{ width: 160 }}>Host</th>
              <th>Value</th>
              <th style={{ width: 85 }}>TTL</th>
              <th style={{ width: 80 }}>Status</th>
              <th style={{ width: 75 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3,4].map(i => <DnsSkeletonRow key={i} delay={i * 0.05} />)
            ) : filtered.length === 0 && !adding ? (
              <tr className="anim-fadeIn">
                <td colSpan={7}>
                  <Empty icon="Network" title={activeTab === "All" ? "No DNS records" : `No ${activeTab} records`}
                    body="Add records to control how this domain resolves." />
                </td>
              </tr>
            ) : filtered.map((r, i) => editing === r.id ? (
              <EditingRecord key={r.id} r={r}
                onSave={(patch) => { update(r.id, patch); setEditing(null); }}
                onCancel={() => setEditing(null)} />
            ) : (
              <tr key={r.id} className={`dns-anim-row ${selected.has(r.id) ? 'is-selected' : ''}`}
                  style={{ animationDelay: `${i * 0.04}s` }}>
                <td>
                  <button className={`chk ${selected.has(r.id) ? 'on' : ''}`} onClick={() => toggleSelect(r.id)}>
                    {selected.has(r.id) && <ICN.Check size={11} stroke={3} />}
                  </button>
                </td>
                <td><span className="dns-record-type">{r.type}</span></td>
                <td className="mono" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.host}</td>
                <td className={`mono ${r.value ? '' : 'dns-empty-value'}`} style={{ wordBreak: "break-all", color: "var(--text)", maxWidth: 280 }}>{r.value || 'Not set'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.ttl}</td>
                <td><DnsStatusBadge status={r.status} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(r.id); setAdding(false); }}><ICN.Edit size={14} /></button>
                  <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)} style={{ color: "var(--danger)" }}><ICN.Trash size={14} /></button>
                </td>
              </tr>
            ))}
            {adding && <NewRecord onSave={(rec) => { add(rec); setAdding(false); }} onCancel={() => setAdding(false)} />}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row between" style={{ gap: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>Domain configuration</h2>
            <p className="muted" style={{ margin: '5px 0 0' }}>Billing, nameservers, DNSSEC, security, bot controls, and health checks are available in Domain settings.</p>
          </div>
          <button className="btn btn-outline" onClick={() => navigate({ view: "dns", params: { domain: domainLabel, section: "settings" } })}>
            <ICN.Settings size={14} /> Open settings
          </button>
        </div>
      </div>
    </>
  );
}

const DOMAIN_SETTINGS_TABS = [
  ['overview', 'Overview'],
  ['billing', 'Billing'],
  ['dns', 'Records'],
  ['addons', 'Add-ons'],
];

function domainFeature(settings, feature) {
  return settings?.providerServices?.find((item) => item.feature === feature) || null;
}

function formatDomainMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(cents || 0) / 100);
}

function formatDomainDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function SettingRows({ rows = [] }) {
  return (
    <div style={{ display: 'grid', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
      {rows.map(([label, value]) => (
        <div key={label} className="row between" style={{ gap: 18, padding: '11px 14px', background: 'var(--bg-elev)' }}>
          <span className="muted" style={{ fontSize: 13 }}>{label}</span>
          <strong style={{ fontSize: 13, textAlign: 'right', overflowWrap: 'anywhere' }}>{value ?? 'Not available'}</strong>
        </div>
      ))}
    </div>
  );
}

function capabilityState(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  const available = value !== null && value !== undefined && normalized !== '' && normalized !== 'not available';
  const offValues = ['false', 'off', 'disabled', 'inactive', '0'];
  return {
    available,
    enabled: available && !offValues.includes(normalized),
    displayValue: available
      ? (normalized === 'true' || normalized === 'on' ? 'Enabled' : normalized === 'false' || normalized === 'off' ? 'Disabled' : String(value))
      : 'Not available',
  };
}

function CapabilityRows({ rows = [], onStatusClick }) {
  return (
    <div className="domain-capability-list">
      {rows.map(([id, label, value]) => {
        const state = capabilityState(value);
        return (
          <div className={`domain-capability-row${state.available ? '' : ' unavailable'}`} key={id}>
            <div className="domain-capability-copy">
              <span>{label}</span>
              <strong>{state.displayValue}</strong>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              aria-label={`${label}: ${state.displayValue}`}
              className={`domain-capability-switch${state.enabled ? ' is-on' : ''}`}
              data-testid={`domain-capability-${id}`}
              onClick={() => onStatusClick(label, state)}
            >
              <span />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function DomainSettings({ domain = '', navigate }) {
  const { domains, loading: domainsLoading } = useDomains();
  const managedDomain = domains.find((item) => item.id === domain || item.name === domain);
  const [activeTab, setActiveTab] = useStateD('overview');
  const settingsTabsRef = useRef(null);
  const settingsTabRefs = useRef({});
  const [tabIndicator, setTabIndicator] = useStateD({ left: 0, width: 0, ready: false });
  const [settings, setSettings] = useStateD(null);
  const [loading, setLoading] = useStateD(true);
  const [error, setError] = useStateD('');
  const [addonBusy, setAddonBusy] = useStateD('');
  const [addonMessage, setAddonMessage] = useStateD('');
  const [settingsToast, setSettingsToast] = useStateD(null);
  const settingsToastTimer = useRef(null);

  useEffect(() => () => {
    if (settingsToastTimer.current) window.clearTimeout(settingsToastTimer.current);
  }, []);

  const showSettingsToast = (message, tone = 'error') => {
    if (settingsToastTimer.current) window.clearTimeout(settingsToastTimer.current);
    setSettingsToast({ id: Date.now(), message, tone });
    settingsToastTimer.current = window.setTimeout(() => setSettingsToast(null), 3800);
  };

  const handleCapabilityClick = (label, state) => {
    if (!state.available) {
      showSettingsToast(`${label} is not available until this domain is fully connected.`);
      return;
    }
    showSettingsToast(`${label} is synchronized and managed automatically by Glondia.`, 'info');
  };

  useEffect(() => {
    if (domainsLoading) return;
    if (!managedDomain?.id) {
      setLoading(false);
      setError('Domain is not assigned to this account.');
      return;
    }
    let alive = true;
    setLoading(true);
    getCustomerDomainSettings(managedDomain.id)
      .then((result) => { if (alive) setSettings(result); })
      .catch((requestError) => { if (alive) setError(requestError.message || 'Could not load domain settings.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [domainsLoading, managedDomain?.id]);

  useEffect(() => {
    const tabs = settingsTabsRef.current;
    const activeButton = settingsTabRefs.current[activeTab];
    if (!tabs || !activeButton) return undefined;
    const updateIndicator = () => {
      setTabIndicator({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
        ready: true,
      });
    };
    updateIndicator();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateIndicator) : null;
    observer?.observe(tabs);
    observer?.observe(activeButton);
    window.addEventListener('resize', updateIndicator);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateIndicator);
    };
  }, [activeTab]);

  const domainLabel = managedDomain?.name || domain || 'Domain';
  const zone = domainFeature(settings, 'zone');
  const zoneSettings = domainFeature(settings, 'zone_settings');
  const dnssec = domainFeature(settings, 'dnssec');
  const botManagement = domainFeature(settings, 'bot_management');
  const healthChecks = domainFeature(settings, 'health_checks');
  const availablePlans = domainFeature(settings, 'available_plans');
  const zoneSubscription = domainFeature(settings, 'zone_subscription');
  const importantSettings = Array.isArray(zoneSettings?.data) ? zoneSettings.data : [];
  const setting = (id) => importantSettings.find((item) => item.id === id);
  const checker = settings?.checker || {};
  const addonFeature = (id) => domainFeature(settings, `addon:${id}`);
  const addonBilling = (id) => settings?.billing?.addons?.find((item) => item.addonKey === id);
  const refreshSettings = async () => {
    if (managedDomain?.id) setSettings(await getCustomerDomainSettings(managedDomain.id));
  };
  const requestAddon = async (addonId) => {
    if (!managedDomain?.id || addonBusy) return;
    setAddonBusy(addonId);
    setAddonMessage('');
    try {
      const result = await activateCustomerDomainAddon(managedDomain.id, addonId);
      setAddonMessage(`${result.addon} is ${String(result.status || 'being prepared').replaceAll('_', ' ')}. Nameserver and activation checks are running in the background.`);
      await refreshSettings();
      for (const delay of [1800, 5000, 10_000]) {
        window.setTimeout(() => refreshSettings().catch(() => {}), delay);
      }
    } catch (requestError) {
      setAddonMessage(requestError.message || 'The add-on could not be prepared.');
    } finally {
      setAddonBusy('');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a className="page-eyebrow" href="#" onClick={(event) => { event.preventDefault(); navigate({ view: 'domains-mine' }); }}>← My domains</a>
          <h1 style={{ marginTop: 8 }}>Domain settings: <span className="mono" style={{ fontSize: 32, color: 'var(--accent)' }}>{domainLabel}</span></h1>
          <p className="sub">Stored billing, Glondia configuration, security, and health. Synchronization runs securely in the background.</p>
        </div>
        <div className="actions">
          <button className="btn btn-outline" onClick={() => navigate({ view: 'dns', params: { domain: domainLabel, section: 'records' } })}>
            <ICN.Network size={14} /> Records
          </button>
        </div>
      </div>

      <div className="card domain-settings-tabs-card">
        <div className="domain-settings-tabs" ref={settingsTabsRef}>
          <span
            className="domain-settings-tab-indicator"
            aria-hidden="true"
            style={{
              width: tabIndicator.width,
              opacity: tabIndicator.ready ? 1 : 0,
              transform: `translateX(${tabIndicator.left}px)`,
            }}
          />
          {DOMAIN_SETTINGS_TABS.map(([id, label]) => (
            <button
              key={id}
              ref={(node) => { if (node) settingsTabRefs.current[id] = node; }}
              className={`domain-settings-tab${activeTab === id ? ' active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="card" style={{ padding: 24 }}>Loading saved domain service data…</div>}
      {error && <div className="card" style={{ padding: 16, color: 'var(--danger)' }}>{error}</div>}

      {!loading && settings && activeTab === 'overview' && (
        <div key="overview" className="grid-2 domain-settings-panel">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Service overview</h2>
            <SettingRows rows={[
              ['Provider', settings.domain?.provider],
              ['Domain status', settings.domain?.status],
              ['Glondia network', zone?.status || 'Not connected'],
              ['Zone type', zone?.data?.type],
              ['Last provider sync', formatDomainDate(zone?.lastSyncedAt)],
            ]} />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Configuration checks</h2>
            <SettingRows rows={[
              ['Zone active', checker.zoneActive ? 'Passed' : 'Needs attention'],
              ['DNS records present', checker.dnsPresent ? 'Passed' : 'Needs attention'],
              ['Nameservers assigned', checker.nameserversAssigned ? 'Passed' : 'Needs attention'],
              ['DNSSEC', checker.dnssecStatus],
              ['Checked', formatDomainDate(checker.checkedAt)],
            ]} />
          </div>
        </div>
      )}

      {!loading && settings && activeTab === 'billing' && (
        <div key="billing" className="grid-2 domain-settings-panel">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Domain billing</h2>
            <SettingRows rows={[
              ['Price', formatDomainMoney(settings.billing?.amountCents, settings.billing?.currency)],
              ['Add-ons', formatDomainMoney(settings.billing?.addonAmountCents, settings.billing?.currency)],
              ['Combined recurring total', formatDomainMoney(settings.billing?.combinedRecurringAmountCents, settings.billing?.currency)],
              ['Billing cycle', settings.billing?.cycle],
              ['Payment status', settings.billing?.paymentStatus],
              ['Auto-renew', settings.billing?.autoRenew ? 'Enabled' : 'Disabled'],
              ['Renews', formatDomainDate(settings.billing?.renewsAt)],
              ['Expires', formatDomainDate(settings.billing?.expiresAt)],
            ]} />
            <h3 style={{ marginTop: 20 }}>Glondia domain services</h3>
            <SettingRows rows={[
              ['Current plan', zoneSubscription?.data?.rate_plan?.name || 'Not connected'],
              ['Glondia service adjustment', `${settings.billing?.addonMarkupPercent ?? 30}%`],
              ['Client price', zoneSubscription?.data?.rate_plan ? formatDomainMoney(zoneSubscription.data.rate_plan.customerPrice * 100, zoneSubscription.data.rate_plan.currency || 'USD') : 'Not available'],
              ['Pricing source', zoneSubscription?.data?.pricingSource === 'glondia_api' ? 'Glondia API' : 'Not synchronized'],
            ]} />
            <h3 style={{ marginTop: 20 }}>Add-on billing</h3>
            {settings.billing?.addons?.length ? (
              <SettingRows rows={settings.billing.addons.map((addon) => [
                addon.name,
                `${formatDomainMoney(addon.totalAmountCents, addon.currency)} / ${addon.billingCycle} · ${addon.paymentStatus} · ${addon.invoiceId ? 'invoiced' : addon.billingStatus}`,
              ])} />
            ) : <p className="muted">No add-on charges are attached to this domain.</p>}
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Glondia plans and add-ons</h2>
            {Array.isArray(availablePlans?.data) && availablePlans.data.length ? (
              <SettingRows rows={availablePlans.data.map((plan) => [
                plan.name || plan.id,
                `${formatDomainMoney(plan.customerPrice * 100, plan.currency || 'USD')} / ${plan.frequency || 'month'} · includes ${plan.markupPercent}% markup`,
              ])} />
            ) : <p className="muted">{availablePlans?.error || 'No Glondia plan catalog has been synchronized for this domain.'}</p>}
            <h3 style={{ marginTop: 20 }}>Billing records</h3>
            {settings.billing?.ledger?.length ? (
              <SettingRows rows={settings.billing.ledger.slice(0, 8).map((item) => [
                item.classification || item.billingType,
                `${formatDomainMoney(item.totalAmountCents ?? item.amountCents, item.currency || settings.billing.currency)} · ${item.stage}`,
              ])} />
            ) : <p className="muted">No item-level billing ledger records have been recorded for this domain.</p>}
          </div>
        </div>
      )}

      {!loading && settings && activeTab === 'dns' && (
        <div key="dns" className="grid-2 domain-settings-panel">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>DNS record snapshot</h2>
            <SettingRows rows={[
              ['Total records', settings.records?.total],
              ['Proxied records', settings.records?.proxied],
              ['Record types', Object.entries(settings.records?.byType || {}).map(([type, count]) => `${type} ${count}`).join(' · ') || 'None'],
              ['Last synchronized', formatDomainDate(settings.records?.lastSyncedAt)],
            ]} />
            <button className="btn btn-outline" style={{ marginTop: 14 }} onClick={() => navigate({ view: 'dns', params: { domain: domainLabel, section: 'records' } })}>
              <ICN.Network size={14} /> Manage records
            </button>
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Nameservers</h2>
            {settings.nameservers?.length ? settings.nameservers.map((nameserver) => (
              <div key={nameserver} className="row between" style={{ padding: '10px 12px', marginBottom: 7, background: 'var(--bg-deep)', borderRadius: 'var(--r-sm)' }}>
                <span className="mono">{nameserver}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(nameserver)}><ICN.Copy size={14} /></button>
              </div>
            )) : <p className="muted">No provider nameserver data has been synchronized.</p>}
          </div>
        </div>
      )}

      {!loading && settings && activeTab === 'addons' && (
        <div key="security" className="grid-2 domain-settings-panel" style={{ marginBottom: 18 }}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>TLS and visitor security</h2>
            <CapabilityRows onStatusClick={handleCapabilityClick} rows={[
              ['ssl', 'SSL mode', setting('ssl')?.value],
              ['always-use-https', 'Always use HTTPS', setting('always_use_https')?.value],
              ['minimum-tls', 'Minimum TLS', setting('min_tls_version')?.value],
              ['security-level', 'Security level', setting('security_level')?.value],
              ['browser-integrity', 'Browser integrity check', setting('browser_check')?.value],
              ['challenge-ttl', 'Challenge TTL', setting('challenge_ttl')?.value],
            ]} />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>DNSSEC and delivery</h2>
            <CapabilityRows onStatusClick={handleCapabilityClick} rows={[
              ['dnssec', 'DNSSEC status', dnssec?.data?.status || dnssec?.status],
              ['dnssec-algorithm', 'Algorithm', dnssec?.data?.algorithm],
              ['dnssec-digest', 'Digest algorithm', dnssec?.data?.digest_algorithm],
              ['ipv6', 'IPv6', setting('ipv6')?.value],
              ['websockets', 'WebSockets', setting('websockets')?.value],
              ['hotlink-protection', 'Hotlink protection', setting('hotlink_protection')?.value],
            ]} />
          </div>
        </div>
      )}

      {!loading && settings && activeTab === 'addons' && (
        <div key="bots" className="card domain-settings-panel" style={{ marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Protection services</h2>
          <p className="muted">Turn on a service to begin. Included services activate directly; charged services open Glondia checkout before provisioning.</p>
          <div className="domain-addon-service-grid">
            {[
              { id: 'bot_control', name: 'Bot control', description: 'Challenges known automated traffic across the domain.' },
              { id: 'anti_scraping', name: 'Anti-scraping', description: 'Blocks baseline AI and content-scraping bots.' },
            ].map((service) => {
              const feature = addonFeature(service.id);
              const billing = addonBilling(service.id);
              const status = billing?.status || feature?.data?.status || 'inactive';
              const active = ['active', 'provisioning', 'queued', 'pending_activation', 'activating'].includes(status);
              const charged = Number(billing?.totalAmountCents || 0) > 0;
              const needsPayment = charged && billing?.paymentStatus !== 'paid';
              return (
                <div className={`domain-addon-service${active ? ' active' : ''}`} key={service.id}>
                  <div className="row between" style={{ alignItems: 'flex-start', gap: 14 }}>
                    <div>
                      <h3>{service.name}</h3>
                      <p>{service.description}</p>
                    </div>
                    <button type="button" role="switch" aria-checked={active}
                      className={`domain-addon-switch${active ? ' on' : ''}`}
                      disabled={Boolean(addonBusy) || active || needsPayment}
                      onClick={() => requestAddon(service.id)}>
                      <span />
                    </button>
                  </div>
                  <div className="domain-addon-service-meta">
                    <Badge tone={status === 'active' ? 'success' : status === 'inactive' ? 'muted' : 'warning'}>
                      {String(status).replaceAll('_', ' ')}
                    </Badge>
                    <strong>{charged ? `${formatDomainMoney(billing.totalAmountCents, billing.currency)} / ${billing.billingCycle}` : 'Included · $0.00'}</strong>
                  </div>
                  {needsPayment && (
                    <div className="domain-addon-checkout">
                      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Payment is required before this service can start.</div>
                      <PayPalCheckoutButton disabled={false}
                        createOrder={() => createDomainAddonPayPalOrder(billing.id)}
                        captureOrder={captureDomainAddonPayPalOrder}
                        onPaid={async () => {
                          setAddonMessage(`${service.name} payment confirmed. Activation has started.`);
                          await refreshSettings();
                        }}
                        onError={setAddonMessage} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {addonMessage && <div className="card anim-fadeIn" style={{ padding: 12, margin: '16px 0' }}>{addonMessage}</div>}
          {botManagement?.status === 'synced' ? (
            <SettingRows rows={[
              ['Bot Fight Mode', botManagement.data?.fight_mode ? 'Enabled' : 'Disabled'],
              ['AI bot protection', botManagement.data?.ai_bots_protection],
              ['Content bot protection', botManagement.data?.content_bots_protection],
              ['Crawler protection', botManagement.data?.crawler_protection],
              ['Managed robots.txt', botManagement.data?.is_robots_txt_managed ? 'Enabled' : 'Disabled'],
              ['JavaScript detection', botManagement.data?.enable_js ? 'Enabled' : 'Disabled'],
            ]} />
          ) : <p className="muted">{botManagement?.error || 'Bot Management has not been synchronized for this zone.'}</p>}
        </div>
      )}

      {!loading && settings && activeTab === 'addons' && (
        <div key="health" className="grid-2 domain-settings-panel">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Domain checker</h2>
            <SettingRows rows={[
              ['Glondia protection connected', checker.cloudflareConnected ? 'Passed' : 'Not connected'],
              ['Zone status', checker.zoneActive ? 'Active' : 'Needs attention'],
              ['DNS', checker.dnsPresent ? `${settings.records.total} records` : 'No records'],
              ['Nameservers', checker.nameserversAssigned ? `${settings.nameservers.length} assigned` : 'Not synchronized'],
              ['DNSSEC', checker.dnssecStatus],
            ]} />
          </div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Glondia health checks</h2>
            {Array.isArray(healthChecks?.data) && healthChecks.data.length ? (
              <SettingRows rows={healthChecks.data.map((check) => [check.name || check.id, `${check.status || 'unknown'} · ${check.type || 'HTTP'} ${check.address || ''}`])} />
            ) : <p className="muted">{healthChecks?.error || 'No Glondia health checks are configured for this zone.'}</p>}
          </div>
        </div>
      )}

      {settingsToast && (
        <div
          key={settingsToast.id}
          className={`domain-settings-toast ${settingsToast.tone}`}
          role="status"
          aria-live="polite"
        >
          <span className="domain-settings-toast-mark" aria-hidden="true">
            {settingsToast.tone === 'error' ? '!' : 'i'}
          </span>
          <span>{settingsToast.message}</span>
        </div>
      )}

    </>
  );
}

function DnsStatusBadge({ status }) {
  const normalized = String(status || 'active').toLowerCase();
  const label = normalized === 'active'
    ? 'Active'
    : normalized === 'pending'
      ? 'Pending'
      : normalized === 'failed'
        ? 'Failed'
        : status;
  return (
    <span className={`dns-status dns-status-${normalized.replace(/[^a-z0-9-]/g, '-')}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function ImportZonePanel({ domainId, canMutate, onClose, onDone }) {
  const [content, setContent] = useStateD('');
  const [overwrite, setOverwrite] = useStateD(false);
  const [busy, setBusy] = useStateD(false);
  const [result, setResult] = useStateD(null);
  const [err, setErr] = useStateD(null);

  const handleImport = async () => {
    if (!content.trim()) return;
    setBusy(true); setResult(null); setErr(null);
    try {
      const r = await importZoneFile(domainId, content, overwrite);
      setResult(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="card dom-verify-wrap" style={{ borderColor: 'color-mix(in srgb, var(--accent) 25%, var(--border))' }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Import zone file</h2>
          <p className="muted" style={{ margin: '5px 0 0', fontSize: 13 }}>
            Paste a BIND-format zone file. Supports A, AAAA, CNAME, MX, TXT, NS, SRV, CAA records.
          </p>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}><ICN.X size={14} /></button>
      </div>

      <textarea
        className="input"
        style={{ fontFamily: 'var(--mono)', fontSize: 12, minHeight: 200, resize: 'vertical', marginBottom: 12 }}
        placeholder={`; Example zone file\n$ORIGIN example.com.\n$TTL 3600\n@ IN A 93.184.216.34\nwww IN CNAME @\n@ IN MX 10 mail.example.com.\n@ IN TXT "v=spf1 ~all"`}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />

      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label className="row" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <button className={`chk ${overwrite ? 'on' : ''}`} onClick={() => setOverwrite(v => !v)}>
            {overwrite && <ICN.Check size={11} stroke={3} />}
          </button>
          <span>Delete all existing records before import</span>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport}
                  disabled={busy || !content.trim() || !canMutate}>
            <span className={busy ? 'anim-spin' : ''} style={{ display: 'inline-flex' }}><ICN.ArrowRight size={14} /></span>
            {busy ? ' Importing…' : ' Import records'}
          </button>
        </div>
      </div>

      {!canMutate && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Live DNS import is not available in local workspace mode.</p>
      )}

      {result && (
        <div className="dom-verify-result" style={{
          marginTop: 14, padding: '12px 16px', borderRadius: 'var(--r-sm)', fontSize: 13,
          background: result.imported > 0 ? 'var(--accent-soft)' : 'var(--bg-deep)',
          border: `1px solid ${result.imported > 0 ? 'var(--accent)' : 'var(--border)'}`,
          color: result.imported > 0 ? 'var(--accent-ink)' : 'var(--text-muted)',
        }}>
          <div className="row" style={{ gap: 8, marginBottom: result.warnings?.length ? 8 : 0 }}>
            <ICN.CheckCircle size={15} />
            <span>Imported <b>{result.imported}</b> record{result.imported !== 1 ? 's' : ''}
              {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
            </span>
            {result.imported > 0 && (
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={onDone}>Done</button>
            )}
          </div>
          {result.warnings?.length > 0 && (
            <ul style={{ margin: '4px 0 0 20px', padding: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      {err && (
        <div className="dom-verify-result" style={{ marginTop: 14, padding: '12px 16px', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)', color: 'var(--danger)', fontSize: 13 }}>
          <ICN.AlertCircle size={14} /> {err}
        </div>
      )}
    </div>
  );
}

function EditingRecord({ r, onSave, onCancel }) {
  const [draft, setDraft] = useStateD({ ...r });
  return (
    <tr className="anim-slideDown" style={{ background: "var(--accent-soft)" }}>
      <td></td>
      <td>
        <select className="select" style={{ height: 32 }} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
          {["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"].map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td><input className="input mono" style={{ height: 32 }} value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} /></td>
      <td><input className="input mono" style={{ height: 32 }} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></td>
      <td>
        <select className="select" style={{ height: 32 }} value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: e.target.value })}>
          <option>Auto</option><option>5 min</option><option>1 hour</option><option>1 day</option>
        </select>
      </td>
      <td></td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(draft)}>Save</button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

function NewRecord({ onSave, onCancel }) {
  const [draft, setDraft] = useStateD({ type: "A", host: "@", value: "", ttl: "Auto", proxy: false });
  return (
    <tr className="anim-slideDown" style={{ background: "var(--bg-deep)" }}>
      <td></td>
      <td>
        <select className="select" style={{ height: 32 }} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
          {["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"].map(t => <option key={t}>{t}</option>)}
        </select>
      </td>
      <td><input className="input mono" style={{ height: 32 }} value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="@ or sub" /></td>
      <td><input className="input mono" style={{ height: 32 }} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="76.76.84.21" /></td>
      <td>
        <select className="select" style={{ height: 32 }} value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: e.target.value })}>
          <option>Auto</option><option>5 min</option><option>1 hour</option><option>1 day</option>
        </select>
      </td>
      <td></td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(draft)} disabled={!draft.value}>Add</button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

function dnsPayloadFromRecord(record) {
  return {
    type: record.type,
    name: record.host || '@',
    value: record.value,
    ttl: ttlToSeconds(record.ttl),
    priority: record.priority ?? undefined,
    proxied: !!record.proxy,
  };
}

