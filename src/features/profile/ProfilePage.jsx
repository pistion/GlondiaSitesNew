/**
 * ProfilePage.jsx — Account settings page.
 * Design inspired by render-account-settings-preview.html.
 * Sections: Profile · Appearance · Account Security · Contact Details · Identity · Delete Account
 */
import React from 'react';
import './ProfilePage.css';
import {
  getProfile,
  updateProfile,
  updateEmail,
  deleteAccount,
  uploadAvatar,
  getAvatarUrl,
  uploadIdPhoto,
  changePassword,
} from '../../api/profile.js';
import { updateStoredAuthUser, logout, clearAuthSession } from '../../api/auth.js';
import {
  listPaymentMethods,
  createPayPalVaultSetup,
  completePayPalVaultSetup,
  getPayPalClientSettings,
} from '../../api/payments.js';

const { useState, useEffect, useCallback, useRef } = React;

const DETAIL_FIELDS = [
  { key: 'address',  label: 'Street Address' },
  { key: 'city',     label: 'City / Town' },
  { key: 'province', label: 'Province / State' },
  { key: 'country',  label: 'Country' },
  { key: 'idType',   label: 'ID Type (e.g. Passport)' },
  { key: 'idNumber', label: 'ID Number' },
  { key: 'companyName',            label: 'Company Name' },
  { key: 'billingEmail',           label: 'Billing Email' },
  { key: 'taxId',                  label: 'Tax ID (optional)' },
  { key: 'preferredContactMethod', label: 'Preferred Contact (email / phone)' },
  { key: 'timezone',               label: 'Timezone (e.g. Pacific/Port_Moresby)' },
];

const BILLING_INVOICE_FIELDS = [
  { key: 'billingName', label: 'Billing Name' },
  { key: 'billingEmail', label: 'Billing Email', type: 'email' },
  { key: 'companyName', label: 'Company' },
  { key: 'currency', label: 'Invoice Currency', as: 'select', options: ['USD', 'PGK'] },
];

const RECURRING_BILLING_FIELDS = [
  { key: 'country', label: 'Country' },
  { key: 'billingCycle', label: 'Renewal Cadence', as: 'select', options: ['monthly', 'annual'] },
];

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function fmt(val) {
  return val && String(val).trim() ? String(val).trim() : null;
}

function isEnabled(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function loadPayPalCardFieldsSdk(clientId) {
  if (!clientId) return Promise.reject(new Error('PayPal client ID is missing.'));
  if (window.paypalCardVault?.CardFields) return Promise.resolve(window.paypalCardVault);

  const existing = document.querySelector('script[data-glondia-paypal-card-fields="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.paypalCardVault), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load PayPal card fields.')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=card-fields`;
    script.async = true;
    script.dataset.glondiaPaypalCardFields = 'true';
    script.dataset.namespace = 'paypalCardVault';
    script.onload = () => {
      if (window.paypalCardVault?.CardFields) resolve(window.paypalCardVault);
      else reject(new Error('PayPal Card Fields are unavailable for this account.'));
    };
    script.onerror = () => reject(new Error('Could not load PayPal card fields.'));
    document.head.appendChild(script);
  });
}

export default function ProfilePage({ navigate, theme: themeProp = 'dark', onThemeChange }) {
  const [profile, setProfile] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paypalSettings, setPaypalSettings] = useState(null);
  const [paypalSetupId, setPaypalSetupId] = useState('');
  const cardFieldsRef = useRef(null);
  const cardRenderedRef = useRef(false);
  const cardNameRef = useRef(null);
  const cardNumberRef = useRef(null);
  const cardExpiryRef = useRef(null);
  const cardCvvRef = useRef(null);
  const [cardFieldsReady, setCardFieldsReady] = useState(false);
  const [cardFieldsError, setCardFieldsError] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  // editing: null | 'name' | 'phone' | 'avatar' | 'details' | 'theme' | 'password' | 'idphoto'
  const [editing, setEditing] = useState(null);

  // field values for single-field edits
  const [fieldVal, setFieldVal] = useState('');
  const [detailsVal, setDetailsVal] = useState({});
  const [billingVal, setBillingVal] = useState({});
  const [avatarFile, setAvatarFile] = useState(null);
  const [idFile, setIdFile] = useState(null);

  // password form
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });

  // email change + delete-account forms
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [deleteForm, setDeleteForm] = useState({ confirm: '', password: '' });

  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const handleSessionError = useCallback((error) => {
    const message = String(error?.message || '');
    const isSessionProblem =
      error?.status === 401 ||
      (error?.status === 404 && /user not found/i.test(message)) ||
      /session no longer matches|user not found|real account is required|valid access token is required/i.test(message);
    if (!isSessionProblem) return false;
    clearAuthSession();
    setProfile(null);
    setEditing(null);
    setMsg('');
    setErr('Please sign in again to continue.');
    navigate?.({ view: 'login' }, { replace: true });
    return true;
  }, [navigate]);

  // ── Data loading ──────────────────────────────────────────────────────────────

  const loadAvatar = useCallback(async () => {
    try {
      const url = await getAvatarUrl();
      setAvatarUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch { /* no avatar */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [p, methods, paypal] = await Promise.all([
        getProfile(),
        listPaymentMethods().catch(() => []),
        getPayPalClientSettings().catch(() => null),
      ]);
      setProfile(p);
      setPaymentMethods(Array.isArray(methods) ? methods : []);
      setPaypalSettings(paypal);
      if (p.hasAvatar) await loadAvatar();
    } catch (e) {
      if (handleSessionError(e)) return;
      setErr(e.message || 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [handleSessionError, loadAvatar]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { if (avatarUrl) URL.revokeObjectURL(avatarUrl); }, [avatarUrl]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('glondia-paypal-setup-token') || '';
      if (stored) setPaypalSetupId(stored);
    } catch {}
  }, []);

  // ── Edit helpers ──────────────────────────────────────────────────────────────

  const startEdit = (field) => {
    setEditing(field);
    setMsg(''); setErr('');
    if (field === 'name') setFieldVal(profile?.name || '');
    if (field === 'phone') setFieldVal(profile?.phone || '');
    if (field === 'org') setFieldVal(profile?.organizationName || profile?.profileDetails?.organizationName || '');
    if (field === 'details') setDetailsVal({ ...(profile?.profileDetails || {}) });
    if (field === 'billing') setBillingVal({ ...(profile?.billingInfo || profile?.profileDetails?.billingInfo || {}) });
    if (field === 'password') setPwForm({ current: '', newPw: '', confirm: '' });
    if (field === 'email') setEmailForm({ newEmail: '', password: '' });
    if (field === 'delete') setDeleteForm({ confirm: '', password: '' });
    if (field === 'avatar') setAvatarFile(null);
    if (field === 'idphoto') setIdFile(null);
  };

  const cancelEdit = () => setEditing(null);

  const flash = (ok, m) => { if (ok) setMsg(m); else setErr(m); };

  useEffect(() => {
    if (editing !== 'billing') {
      cardFieldsRef.current = null;
      cardRenderedRef.current = false;
      setCardFieldsReady(false);
      setCardFieldsError('');
      return undefined;
    }
    if (paypalSettings?.configured === false) {
      setCardFieldsError('PayPal is not configured on the server.');
      setCardFieldsReady(false);
      return undefined;
    }
    if (!paypalSettings?.clientId) return undefined;
    if (cardRenderedRef.current) return undefined;
    if (!cardNameRef.current || !cardNumberRef.current || !cardExpiryRef.current || !cardCvvRef.current) return undefined;

    let cancelled = false;
    cardRenderedRef.current = true;
    setCardFieldsReady(false);
    setCardFieldsError('');

    loadPayPalCardFieldsSdk(paypalSettings.clientId)
      .then((paypal) => {
        if (cancelled) return;
        const cardFields = paypal.CardFields({
          createVaultSetupToken: async () => {
            const setup = await createPayPalVaultSetup({ source: 'card' });
            if (!setup?.setupTokenId) throw new Error('PayPal did not return a card setup token.');
            return setup.setupTokenId;
          },
          onApprove: async (data = {}) => {
            const setupTokenId = data.vaultSetupToken || data.vault_setup_token || data.setupTokenId;
            if (!setupTokenId) throw new Error('PayPal did not approve a vault setup token.');
            const result = await completePayPalVaultSetup(setupTokenId);
            const methods = await listPaymentMethods().catch(() => result?.paymentMethod ? [result.paymentMethod] : []);
            if (!cancelled) {
              setPaymentMethods(Array.isArray(methods) ? methods : []);
              setCardFieldsReady(true);
              flash(true, 'Card saved for future renewals.');
            }
          },
          onError: (error) => {
            if (!cancelled && !handleSessionError(error)) {
              setCardFieldsError(error?.message || 'Could not save this card with PayPal.');
            }
          },
          onCancel: () => {
            if (!cancelled) setCardFieldsError('Card verification was cancelled.');
          },
        });

        if (typeof cardFields.isEligible === 'function' && !cardFields.isEligible()) {
          setCardFieldsError('PayPal Card Fields are not enabled for this account.');
          setCardFieldsReady(false);
          return;
        }

        cardFields.NameField().render(cardNameRef.current);
        cardFields.NumberField().render(cardNumberRef.current);
        cardFields.CVVField().render(cardCvvRef.current);
        cardFields.ExpiryField().render(cardExpiryRef.current);
        cardFieldsRef.current = cardFields;
        setCardFieldsReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          cardRenderedRef.current = false;
          setCardFieldsReady(false);
          setCardFieldsError(error?.message || 'Could not load PayPal card fields.');
        }
      });

    return () => {
      cancelled = true;
      cardFieldsRef.current = null;
      cardRenderedRef.current = false;
    };
  }, [editing, paypalSettings?.clientId, paypalSettings?.configured, handleSessionError]);

  // ── Save handlers ─────────────────────────────────────────────────────────────

  const saveName = async () => {
    setBusy('name'); setErr('');
    try {
      const p = await updateProfile({ name: fieldVal });
      setProfile(p);
      updateStoredAuthUser({ name: p.name });
      setEditing(null);
      flash(true, 'Name updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not save name.'); }
    finally { setBusy(''); }
  };

  const savePhone = async () => {
    setBusy('phone'); setErr('');
    try {
      const p = await updateProfile({ phone: fieldVal });
      setProfile(p);
      updateStoredAuthUser({ phone: p.phone });
      setEditing(null);
      flash(true, 'Phone number updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not save phone.'); }
    finally { setBusy(''); }
  };

  const saveOrg = async () => {
    setBusy('org'); setErr('');
    try {
      const p = await updateProfile({ organizationName: fieldVal });
      setProfile(p);
      updateStoredAuthUser({ organizationName: p.organizationName });
      setEditing(null);
      flash(true, 'Organization name updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not save organization name.'); }
    finally { setBusy(''); }
  };

  const saveEmail = async () => {
    if (!emailForm.newEmail.trim()) { setErr('Enter your new email address.'); return; }
    if (!emailForm.password) { setErr('Enter your current password to confirm the change.'); return; }
    setBusy('email'); setErr('');
    try {
      const p = await updateEmail(emailForm.newEmail.trim(), emailForm.password);
      setProfile(p);
      updateStoredAuthUser({ email: p.email });
      setEditing(null);
      setEmailForm({ newEmail: '', password: '' });
      flash(true, 'Email address updated. Use the new address next time you sign in.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not update email.'); }
    finally { setBusy(''); }
  };

  const confirmDelete = async () => {
    const typed = deleteForm.confirm.trim();
    const confirmed = typed === 'DELETE' || typed.toLowerCase() === (profile?.email || '').toLowerCase();
    if (!confirmed) {
      setErr('Type DELETE or your account email to confirm.');
      return;
    }
    if (!deleteForm.password) { setErr('Enter your password to confirm deletion.'); return; }
    setBusy('delete'); setErr('');
    try {
      await deleteAccount(deleteForm.password);
      await logout();
      window.location.href = '/';
    } catch (e) { flash(false, e.message || 'Could not delete account.'); }
    finally { setBusy(''); }
  };

  const saveDetails = async () => {
    setBusy('details'); setErr('');
    try {
      const p = await updateProfile({ profileDetails: detailsVal });
      setProfile(p);
      setEditing(null);
      flash(true, 'Contact details updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not save details.'); }
    finally { setBusy(''); }
  };

  const saveBilling = async () => {
    setBusy('billing'); setErr('');
    try {
      const current = profile?.billingInfo || profile?.profileDetails?.billingInfo || {};
      const {
        paymentProvider,
        paymentMethodId,
        cardholderName,
        cardBrand,
        cardLast4,
        cardExpMonth,
        cardExpYear,
        ...safeCurrent
      } = current;
      const p = await updateProfile({ billingInfo: { ...safeCurrent, ...billingVal } });
      setProfile(p);
      setEditing(null);
      flash(true, 'Billing information updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not save billing information.'); }
    finally { setBusy(''); }
  };

  const connectPayPal = async () => {
    setBusy('paypal-setup'); setErr('');
    try {
      if (paypalSettings && paypalSettings.configured === false) {
        throw new Error('PayPal is not configured on the server. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, then restart the app.');
      }
      const here = window.location.href.split('#')[0].split('?')[0];
      const setup = await createPayPalVaultSetup({
        returnUrl: `${here}?paypalVault=approved`,
        cancelUrl: `${here}?paypalVault=cancelled`,
      });
      if (!setup?.approvalUrl || !setup?.setupTokenId) throw new Error('PayPal did not return an approval link.');
      setPaypalSetupId(setup.setupTokenId);
      try { localStorage.setItem('glondia-paypal-setup-token', setup.setupTokenId); } catch {}
      window.open(setup.approvalUrl, '_blank', 'noopener,noreferrer');
      flash(true, 'Approve the PayPal connection, then return here and click Finish connection.');
    } catch (e) {
      if (!handleSessionError(e)) flash(false, e.message || 'Could not start PayPal connection.');
    } finally { setBusy(''); }
  };

  const finishPayPalConnection = async () => {
    const setupTokenId = paypalSetupId || (() => {
      try { return localStorage.getItem('glondia-paypal-setup-token') || ''; } catch { return ''; }
    })();
    if (!setupTokenId) { setErr('Start PayPal connection first.'); return; }
    setBusy('paypal-complete'); setErr('');
    try {
      const result = await completePayPalVaultSetup(setupTokenId);
      const methods = await listPaymentMethods().catch(() => result?.paymentMethod ? [result.paymentMethod] : []);
      setPaymentMethods(Array.isArray(methods) ? methods : []);
      setPaypalSetupId('');
      try { localStorage.removeItem('glondia-paypal-setup-token'); } catch {}
      flash(true, 'PayPal is connected for saved payments and auto-renewal.');
    } catch (e) {
      if (!handleSessionError(e)) flash(false, e.message || 'Could not finish PayPal connection.');
    } finally { setBusy(''); }
  };

  const saveCardWithPayPal = async () => {
    setErr('');
    setCardFieldsError('');
    try {
      if (paypalSettings?.configured === false) {
        throw new Error('PayPal is not configured on the server.');
      }
      if (!cardFieldsRef.current) {
        throw new Error(cardFieldsError || 'PayPal Card Fields are still loading.');
      }
      setBusy('paypal-card-submit');
      await cardFieldsRef.current.submit();
    } catch (e) {
      if (!handleSessionError(e)) {
        const message = e?.message || 'Could not save this card with PayPal.';
        setCardFieldsError(message);
        flash(false, message);
      }
    } finally {
      setBusy('');
    }
  };

  const saveAvatar = async () => {
    if (!avatarFile) { setErr('Choose a photo first.'); return; }
    setBusy('avatar'); setErr('');
    try {
      const p = await uploadAvatar(avatarFile);
      setProfile(p);
      await loadAvatar();
      updateStoredAuthUser({ hasAvatar: true, avatarUrl: `/api/v1/auth/profile/avatar?t=${Date.now()}` });
      setEditing(null);
      flash(true, 'Profile photo updated.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Upload failed.'); }
    finally { setBusy(''); }
  };

  const saveIdPhoto = async () => {
    if (!idFile) { setErr('Choose a photo of your ID first.'); return; }
    setBusy('idphoto'); setErr('');
    try {
      const p = await uploadIdPhoto(idFile);
      setProfile(p);
      setEditing(null);
      flash(true, 'ID photo uploaded.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Upload failed.'); }
    finally { setBusy(''); }
  };

  const savePassword = async () => {
    if (pwForm.newPw !== pwForm.confirm) { setErr('New passwords do not match.'); return; }
    if (pwForm.newPw.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    setBusy('password'); setErr('');
    try {
      await changePassword(pwForm.current, pwForm.newPw);
      setEditing(null);
      setPwForm({ current: '', newPw: '', confirm: '' });
      flash(true, 'Password updated successfully.');
    } catch (e) { if (!handleSessionError(e)) flash(false, e.message || 'Could not update password.'); }
    finally { setBusy(''); }
  };

  const applyTheme = async (v) => {
    onThemeChange?.(v);
    setEditing(null);
    // Persist alongside other display preferences (merged so nothing is wiped).
    try {
      const prevPrefs = profile?.profileDetails?.displayPreferences || {};
      const p = await updateProfile({
        profileDetails: { displayPreferences: { ...prevPrefs, theme: v } },
      });
      setProfile(p);
      flash(true, `Theme set to ${v}.`);
    } catch {
      flash(true, `Theme set to ${v} (saved locally; could not sync to your account).`);
    }
  };

  // ── Address summary ───────────────────────────────────────────────────────────

  const addressSummary = () => {
    const d = profile?.profileDetails || {};
    const parts = [d.address, d.city, d.province, d.country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  };

  const billingSummary = () => {
    const b = profile?.billingInfo || profile?.profileDetails?.billingInfo || {};
    const method = paymentMethods.find((m) => m.isDefault) || paymentMethods[0] || null;
    const name = b.billingName || b.companyName || profile?.organizationName || profile?.name;
    const email = b.billingEmail || profile?.email;
    return {
      name: fmt(name) || 'Not set',
      email: fmt(email) || 'Not set',
      location: fmt(b.country),
      currency: fmt(b.currency) || 'USD',
      card: method?.label || 'No saved payment method',
      cardExpiry: method?.expiryMonth && method?.expiryYear ? `${String(method.expiryMonth).padStart(2, '0')}/${method.expiryYear}` : null,
      provider: method?.provider ? String(method.provider).replace(/^./, (c) => c.toUpperCase()) : 'PayPal',
      hasSavedMethod: Boolean(method?.id),
      recurring: isEnabled(b.recurringBillingEnabled) ? `${b.billingCycle || 'monthly'} recurring` : 'Manual billing',
    };
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="acct-page">
        <div className="card" style={{ padding: 28, color: 'var(--text-muted)' }}>Loading account…</div>
      </div>
    );
  }

  const currentTheme = themeProp || 'dark';
  const billing = profile?.billingInfo || profile?.profileDetails?.billingInfo || {};
  const billingView = billingSummary();

  return (
    <div className="acct-page">

      {/* Page head */}
      <div className="acct-page-head">
        <div>
          <div className="acct-eyebrow">Account</div>
          <h1>Account settings</h1>
          <p>Manage your profile, security settings, and dashboard preferences.</p>
        </div>
        <div className="acct-badge">
          <span className="acct-badge-dot" />
          Personal account
        </div>
      </div>

      {/* Flash */}
      {msg && <div className="acct-flash ok">{msg}</div>}
      {err && <div className="acct-flash err">{err}</div>}

      {/* ── Main panel ── */}
      <div className="acct-panel">

        {/* ──── Profile ──── */}
        <div className="acct-section" id="profile">
          <div className="acct-section-head">
            <div>
              <h2>Profile</h2>
              <p>Your account name, email address, and profile image.</p>
            </div>
          </div>
          <div className="acct-rows">

            {/* Full Name */}
            <div className="acct-row">
              <div className="acct-row-label">Full Name</div>
              {editing === 'name' ? (
                <>
                  <input
                    className="acct-input"
                    value={fieldVal}
                    onChange={(e) => setFieldVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="acct-btn primary" disabled={busy === 'name'} onClick={saveName}>
                      {busy === 'name' ? 'Saving…' : 'Save'}
                    </button>
                    <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="acct-row-value">
                    <strong>{fmt(profile?.name) || '—'}</strong>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('name')}>Edit</button>
                </>
              )}
            </div>

            {/* Organization / Business Name */}
            <div className="acct-row">
              <div className="acct-row-label">Organization</div>
              {editing === 'org' ? (
                <>
                  <input
                    className="acct-input"
                    value={fieldVal}
                    onChange={(e) => setFieldVal(e.target.value)}
                    placeholder="Your business or organization name"
                    onKeyDown={(e) => e.key === 'Enter' && saveOrg()}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="acct-btn primary" disabled={busy === 'org'} onClick={saveOrg}>
                      {busy === 'org' ? 'Saving…' : 'Save'}
                    </button>
                    <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="acct-row-value">
                    <strong>{fmt(profile?.organizationName || profile?.profileDetails?.organizationName) || '—'}</strong>
                    <div className="acct-row-hint">Shown on invoices and workspace branding.</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('org')}>Edit</button>
                </>
              )}
            </div>

            {/* Email */}
            <div className="acct-row">
              <div className="acct-row-label">Email</div>
              {editing !== 'email' && (
                <>
                  <div className="acct-row-value">
                    <strong>{profile?.email}</strong>
                    <div className="acct-row-hint">Used to sign in. Changes require password confirmation.</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('email')}>Edit</button>
                </>
              )}
            </div>

            {/* Email expanded form */}
            {editing === 'email' && (
              <div className="acct-form-block">
                <div className="acct-row-label">Change Email</div>
                <div className="acct-form-grid">
                  <div className="acct-field">
                    <label>New Email Address</label>
                    <input
                      type="email"
                      className="acct-input"
                      value={emailForm.newEmail}
                      onChange={(e) => setEmailForm({ ...emailForm, newEmail: e.target.value })}
                      placeholder="you@newdomain.com"
                      autoFocus
                      autoComplete="email"
                    />
                  </div>
                  <div className="acct-field">
                    <label>Current Password</label>
                    <input
                      type="password"
                      className="acct-input"
                      value={emailForm.password}
                      onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <div className="acct-form-actions">
                  <button className="acct-btn primary" disabled={busy === 'email'} onClick={saveEmail}>
                    {busy === 'email' ? 'Saving…' : 'Update Email'}
                  </button>
                  <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}

            {/* Avatar */}
            <div className="acct-row">
              <div className="acct-row-label">Avatar</div>
              {editing === 'avatar' ? (
                <>
                  <div className="acct-file-row">
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                      onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="acct-btn primary" disabled={busy === 'avatar' || !avatarFile} onClick={saveAvatar}>
                      {busy === 'avatar' ? 'Uploading…' : 'Upload'}
                    </button>
                    <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="acct-row-value">
                    {avatarUrl
                      ? <img className="acct-avatar-img" src={avatarUrl} alt="Your avatar" />
                      : <div className="acct-avatar-box">{initials(profile?.name)}</div>}
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('avatar')}>Edit</button>
                </>
              )}
            </div>

          </div>
        </div>

        {/* Billing Information */}
        <div className="acct-section" id="billing-info">
          <div className="acct-section-head">
            <div>
              <h2>Billing</h2>
              <p>Invoice profile, auto-renew settings, and saved PayPal payment method.</p>
            </div>
          </div>
          <div className="acct-rows">
            {editing !== 'billing' && (
              <div className="acct-billing-overview">
                <div className="acct-payment-method">
                  <div className="acct-payment-brand">
                    <span>{billingView.provider}</span>
                  </div>
                  <div className="acct-payment-copy">
                    <div className="acct-summary-k">Saved Payment Method</div>
                    <strong>{billingView.card}</strong>
                    <span>{billingView.hasSavedMethod ? (billingView.cardExpiry ? `Expires ${billingView.cardExpiry}` : 'Ready for saved-method payments') : 'Pay once with PayPal to save a method securely.'}</span>
                    <div className="acct-payment-actions">
                      <button className="acct-btn primary" disabled={busy === 'paypal-setup'} onClick={connectPayPal}>
                        {busy === 'paypal-setup' ? 'Opening...' : (billingView.hasSavedMethod ? 'Reconnect PayPal' : 'Connect PayPal')}
                      </button>
                      {paypalSetupId && (
                        <button className="acct-btn" disabled={busy === 'paypal-complete'} onClick={finishPayPalConnection}>
                          {busy === 'paypal-complete' ? 'Finishing...' : 'Finish connection'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="acct-billing-mini">
                  <div>
                    <div className="acct-summary-k">Invoice To</div>
                    <strong>{billingView.name}</strong>
                    <span>{billingView.email}</span>
                  </div>
                  <div>
                    <div className="acct-summary-k">Auto-Renew</div>
                    <strong>{billingView.recurring}</strong>
                    <span>{billingView.currency}{billingView.location ? ` - ${billingView.location}` : ''}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="acct-row">
              <div className="acct-row-label">Invoice Profile</div>
              {editing !== 'billing' && (
                <>
                  <div className="acct-row-value">
                    <strong>{billingView.name}</strong>
                    <div className="acct-row-hint">{billingView.email}</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('billing')}>Edit</button>
                </>
              )}
            </div>

            {editing !== 'billing' && (
              <>
                <div className="acct-row">
                  <div className="acct-row-label">Auto-Renew</div>
                  <div className="acct-row-value">
                    <strong>{billingView.recurring}</strong>
                    <div className="acct-row-hint">{billingView.hasSavedMethod ? 'Charges active services with the saved PayPal payment method.' : 'Pay with PayPal once to save a method before enabling automatic renewal.'}</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('billing')}>Edit</button>
                </div>
                <div className="acct-row">
                  <div className="acct-row-label">Saved Method</div>
                  <div className="acct-row-value">
                    <strong>{billingView.card}</strong>
                    <div className="acct-row-hint">Connect or update the saved method through PayPal. This form never collects card numbers.</div>
                  </div>
                  <button className="acct-btn primary" disabled={busy === 'paypal-setup'} onClick={connectPayPal}>{billingView.hasSavedMethod ? 'Reconnect' : 'Connect'}</button>
                </div>
              </>
            )}

            {editing === 'billing' && (
              <div className="acct-form-block acct-billing-form">
                <div className="acct-billing-edit-section">
                  <div className="acct-form-heading">Invoice Profile</div>
                  <div className="acct-form-grid">
                    {BILLING_INVOICE_FIELDS.map((f) => (
                      <div key={f.key} className="acct-field">
                        <label>{f.label}</label>
                        {f.as === 'select' ? (
                          <select
                            className="acct-input"
                            value={billingVal[f.key] || ''}
                            onChange={(e) => setBillingVal({ ...billingVal, [f.key]: e.target.value })}
                          >
                            <option value="">Select</option>
                            {f.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            type={f.type || 'text'}
                            className="acct-input"
                            value={billingVal[f.key] || ''}
                            onChange={(e) => setBillingVal({ ...billingVal, [f.key]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="acct-billing-edit-section">
                  <div className="acct-form-heading">Automatic Renewal</div>
                  <div className="acct-autopay-panel">
                    <div>
                      <strong>{isEnabled(billingVal.recurringBillingEnabled) ? 'Auto-renew is on' : 'Auto-renew is off'}</strong>
                      <span>{billingView.hasSavedMethod ? 'Active services can renew automatically with your saved PayPal method.' : 'A saved PayPal method is required before automatic renewal can run.'}</span>
                    </div>
                    <label className="acct-switch">
                      <input
                        type="checkbox"
                        checked={isEnabled(billingVal.recurringBillingEnabled)}
                        onChange={(e) => setBillingVal({ ...billingVal, recurringBillingEnabled: e.target.checked })}
                      />
                      <span />
                    </label>
                  </div>
                  <div className="acct-form-grid">
                    {RECURRING_BILLING_FIELDS.map((f) => (
                      <div key={f.key} className="acct-field">
                        <label>{f.label}</label>
                        {f.as === 'select' ? (
                          <select
                            className="acct-input"
                            value={billingVal[f.key] || ''}
                            onChange={(e) => setBillingVal({ ...billingVal, [f.key]: e.target.value })}
                          >
                            <option value="">Select</option>
                            {f.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            className="acct-input"
                            value={billingVal[f.key] || ''}
                            onChange={(e) => setBillingVal({ ...billingVal, [f.key]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="acct-billing-edit-section">
                  <div className="acct-form-heading">Payment Method</div>
                  <div className="acct-payment-sheet">
                    <div className="acct-payment-sheet-head">
                      <div>
                        <h3>Update payment method</h3>
                        <p>{billingView.hasSavedMethod ? billingView.card : 'Add a card or PayPal account for renewals.'}</p>
                      </div>
                      <span className="acct-secure-badge">{paypalSettings?.configured === false ? 'PayPal not configured' : 'Secured by PayPal'}</span>
                    </div>

                    <div className="acct-security-row">
                      <span>Secure transmission</span>
                      <span>Payment details stay with PayPal</span>
                    </div>

                    <div className="acct-pay-option-grid">
                      <button type="button" className="acct-pay-option active">
                        <span className="acct-pay-icon">CARD</span>
                        <strong>Card</strong>
                      </button>
                      <button type="button" className="acct-pay-option" onClick={connectPayPal}>
                        <span className="acct-pay-icon">PP</span>
                        <strong>PayPal</strong>
                      </button>
                      <button type="button" className="acct-pay-option muted" disabled>
                        <span className="acct-pay-icon">BANK</span>
                        <strong>Bank</strong>
                      </button>
                    </div>

                    <div className="acct-pay-form">
                      <label className="acct-pay-field">
                        <span>Name on card</span>
                        <div className="acct-pay-hosted" ref={cardNameRef} />
                      </label>

                      <label className="acct-pay-field">
                        <span>Card number</span>
                        <div className="acct-pay-field-combo">
                          <div className="acct-pay-hosted inline" ref={cardNumberRef} />
                          <div className="acct-card-badges">
                            <b>VISA</b>
                            <b>MC</b>
                            <b>Pay</b>
                          </div>
                        </div>
                      </label>

                      <div className="acct-card-field-row">
                        <label className="acct-pay-field">
                          <span>CVC</span>
                          <div className="acct-pay-hosted" ref={cardCvvRef} />
                        </label>
                        <label className="acct-pay-field">
                          <span>Expire date</span>
                          <div className="acct-pay-hosted" ref={cardExpiryRef} />
                        </label>
                      </div>

                      <label className="acct-remember-row">
                        <input
                          type="checkbox"
                          checked={isEnabled(billingVal.recurringBillingEnabled)}
                          onChange={(e) => setBillingVal({ ...billingVal, recurringBillingEnabled: e.target.checked })}
                        />
                        <span>Remember this payment method for future renewals</span>
                      </label>

                      {cardFieldsError && <div className="acct-pay-error">{cardFieldsError}</div>}

                      <button
                        type="button"
                        className="acct-pay-continue"
                        disabled={busy === 'paypal-card-submit' || !cardFieldsReady || paypalSettings?.configured === false}
                        onClick={saveCardWithPayPal}
                      >
                        {busy === 'paypal-card-submit' ? 'Saving card...' : (billingView.hasSavedMethod ? 'Update card' : 'Save card')}
                      </button>
                      {paypalSetupId && (
                        <button type="button" className="acct-btn" disabled={busy === 'paypal-complete'} onClick={finishPayPalConnection}>
                          {busy === 'paypal-complete' ? 'Finishing...' : 'Finish connection'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="acct-card-collection">
                    <div className="acct-card-visual">
                      <div className="acct-card-chip" />
                      <div className="acct-card-number">{billingView.hasSavedMethod ? billingView.card : '••••  ••••  ••••  ••••'}</div>
                      <div className="acct-card-meta">
                        <span>{billingView.provider}</span>
                        <span>{billingView.cardExpiry || 'MM/YYYY'}</span>
                      </div>
                    </div>

                    <div className="acct-card-fields">
                      <div className="acct-field">
                        <label>Name on card</label>
                        <input
                          className="acct-input"
                          placeholder="Entered securely with PayPal"
                          readOnly
                          onClick={connectPayPal}
                        />
                      </div>
                      <div className="acct-field">
                        <label>Card number</label>
                        <input
                          className="acct-input"
                          placeholder="PayPal secure card entry"
                          readOnly
                          onClick={connectPayPal}
                        />
                      </div>
                      <div className="acct-card-field-row">
                        <div className="acct-field">
                          <label>Expiry</label>
                          <input className="acct-input" placeholder="MM / YY" readOnly onClick={connectPayPal} />
                        </div>
                        <div className="acct-field">
                          <label>Security code</label>
                          <input className="acct-input" placeholder="CVC" readOnly onClick={connectPayPal} />
                        </div>
                      </div>
                      <div className="acct-payment-actions">
                        <button className="acct-btn primary" disabled={busy === 'paypal-setup'} onClick={connectPayPal}>
                          {busy === 'paypal-setup' ? 'Opening...' : (billingView.hasSavedMethod ? 'Update card with PayPal' : 'Add card with PayPal')}
                        </button>
                        {paypalSetupId && (
                          <button className="acct-btn" disabled={busy === 'paypal-complete'} onClick={finishPayPalConnection}>
                            {busy === 'paypal-complete' ? 'Finishing...' : 'Finish connection'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="acct-card-note">Card details are entered in PayPal's secure checkout window. Glondia stores only the PayPal vault reference for future renewals.</div>
                </div>

                <div className="acct-form-actions">
                  <button className="acct-btn primary" disabled={busy === 'billing'} onClick={saveBilling}>
                    {busy === 'billing' ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ──── Appearance ──── */}
        <div className="acct-section" id="appearance">
          <div className="acct-section-head">
            <div>
              <h2>Appearance</h2>
              <p>Theme and display preferences for the dashboard.</p>
            </div>
          </div>
          <div className="acct-rows">

            {/* Dashboard Theme */}
            <div className="acct-row">
              <div className="acct-row-label">Dashboard Theme</div>
              {editing === 'theme' ? (
                <>
                  <div>
                    <div className="acct-theme-seg">
                      {['light', 'dark'].map((t) => (
                        <button
                          key={t}
                          className={`acct-theme-opt${currentTheme === t ? ' active' : ''}`}
                          onClick={() => applyTheme(t)}
                        >
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                </>
              ) : (
                <>
                  <div className="acct-row-value">
                    <strong>{currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1)}</strong>
                    <div className="acct-row-mono">themeSetting</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('theme')}>Edit</button>
                </>
              )}
            </div>

            {/* High Contrast (placeholder) */}
            <div className="acct-row">
              <div className="acct-row-label">High Contrast</div>
              <div className="acct-row-value">
                <span className="acct-status">
                  <span className="acct-status-dot" />
                  Disabled
                </span>
                <div className="acct-row-hint">Increases visibility of interactive elements.</div>
              </div>
              <button className="acct-btn" disabled>Enable</button>
            </div>

          </div>
        </div>

        {/* ──── Account Security ──── */}
        <div className="acct-section" id="security">
          <div className="acct-section-head">
            <div>
              <h2>Account Security</h2>
              <p>Password, login methods, and two-factor authentication.</p>
            </div>
          </div>
          <div className="acct-rows">

            {/* Password */}
            <div className="acct-row">
              <div className="acct-row-label">Password</div>
              {editing !== 'password' && (
                <>
                  <div className="acct-row-value">
                    <strong>••••••••</strong>
                    <div className="acct-row-hint">Update your account password.</div>
                  </div>
                  <button className="acct-btn primary" onClick={() => startEdit('password')}>Update</button>
                </>
              )}
            </div>

            {/* Password expanded form */}
            {editing === 'password' && (
              <div className="acct-form-block">
                <div className="acct-row-label">Change Password</div>
                <div className="acct-form-grid">
                  <div className="acct-field">
                    <label>Current Password</label>
                    <input
                      type="password"
                      className="acct-input"
                      value={pwForm.current}
                      onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                      autoFocus
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="acct-field">
                    <label>New Password</label>
                    <input
                      type="password"
                      className="acct-input"
                      value={pwForm.newPw}
                      onChange={(e) => setPwForm({ ...pwForm, newPw: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="acct-field">
                    <label>Confirm New Password</label>
                    <input
                      type="password"
                      className="acct-input"
                      value={pwForm.confirm}
                      onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <div className="acct-form-actions">
                  <button className="acct-btn primary" disabled={busy === 'password'} onClick={savePassword}>
                    {busy === 'password' ? 'Saving…' : 'Update Password'}
                  </button>
                  <button className="acct-btn" onClick={() => { cancelEdit(); setPwForm({ current: '', newPw: '', confirm: '' }); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Login Method */}
            <div className="acct-row">
              <div className="acct-row-label">Login Method</div>
              <div className="acct-row-value">
                <strong>{profile?.email}</strong>
                <div className="acct-row-hint">Your account is accessed using this email address.</div>
              </div>
              <button className="acct-btn" disabled>Options</button>
            </div>

            {/* Two-Factor Auth */}
            <div className="acct-row">
              <div className="acct-row-label">Two-Factor Auth</div>
              <div className="acct-row-value">
                <span className="acct-status">
                  <span className="acct-status-dot" />
                  Disabled
                </span>
                <div className="acct-row-hint">Time-based OTP compatible with major authenticator apps.</div>
              </div>
              <button className="acct-btn" disabled>Enable</button>
            </div>

          </div>
        </div>

        {/* ──── Contact Details ──── */}
        <div className="acct-section" id="contact">
          <div className="acct-section-head">
            <div>
              <h2>Contact Details</h2>
              <p>Phone number and postal address information.</p>
            </div>
          </div>
          <div className="acct-rows">

            {/* Phone */}
            <div className="acct-row">
              <div className="acct-row-label">Phone</div>
              {editing === 'phone' ? (
                <>
                  <input
                    className="acct-input"
                    value={fieldVal}
                    onChange={(e) => setFieldVal(e.target.value)}
                    placeholder="+675 7000 0000"
                    onKeyDown={(e) => e.key === 'Enter' && savePhone()}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="acct-btn primary" disabled={busy === 'phone'} onClick={savePhone}>
                      {busy === 'phone' ? 'Saving…' : 'Save'}
                    </button>
                    <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="acct-row-value">
                    <strong>{fmt(profile?.phone) || '—'}</strong>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('phone')}>Edit</button>
                </>
              )}
            </div>

            {/* Address */}
            <div className="acct-row">
              <div className="acct-row-label">Address</div>
              {editing !== 'details' && (
                <>
                  <div className="acct-row-value">
                    <strong>{addressSummary() || '—'}</strong>
                    {profile?.profileDetails?.country && (
                      <div className="acct-row-hint">{profile.profileDetails.country}</div>
                    )}
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('details')}>Edit</button>
                </>
              )}
            </div>

            {/* Address expanded form */}
            {editing === 'details' && (
              <div className="acct-form-block">
                <div className="acct-row-label">Address Details</div>
                <div className="acct-form-grid">
                  {DETAIL_FIELDS.map((f) => (
                    <div key={f.key} className="acct-field">
                      <label>{f.label}</label>
                      <input
                        className="acct-input"
                        value={detailsVal[f.key] || ''}
                        onChange={(e) => setDetailsVal({ ...detailsVal, [f.key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <div className="acct-form-actions">
                  <button className="acct-btn primary" disabled={busy === 'details'} onClick={saveDetails}>
                    {busy === 'details' ? 'Saving…' : 'Save Details'}
                  </button>
                  <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ──── Identity Verification ──── */}
        <div className="acct-section" id="identity">
          <div className="acct-section-head">
            <div>
              <h2>Identity Verification</h2>
              <p>Government ID photo for payment and account verification. Only visible to you and administrators.</p>
            </div>
          </div>
          <div className="acct-rows">

            <div className="acct-row">
              <div className="acct-row-label">ID Document</div>
              {editing !== 'idphoto' && (
                <>
                  <div className="acct-row-value">
                    <span className={`acct-status${profile?.hasIdPhoto ? ' on' : ''}`}>
                      <span className="acct-status-dot" />
                      {profile?.hasIdPhoto ? 'Uploaded' : 'Not uploaded'}
                    </span>
                    <div className="acct-row-hint">PNG, JPG or JPEG, up to 5 MB.</div>
                  </div>
                  <button className="acct-btn" onClick={() => startEdit('idphoto')}>
                    {profile?.hasIdPhoto ? 'Replace' : 'Upload'}
                  </button>
                </>
              )}
            </div>

            {editing === 'idphoto' && (
              <div className="acct-form-block">
                <div className="acct-row-label">Upload ID Photo</div>
                <div className="acct-file-row">
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className="acct-form-actions">
                  <button className="acct-btn primary" disabled={busy === 'idphoto' || !idFile} onClick={saveIdPhoto}>
                    {busy === 'idphoto' ? 'Uploading…' : 'Upload'}
                  </button>
                  <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>{/* end .acct-panel */}

      {/* ── Danger Zone ── */}
      <div className="acct-danger-panel">
        <div className="acct-section-head">
          <div>
            <h2>Delete Account</h2>
            <p>Deactivates your account and signs you out everywhere. Contact support to restore it.</p>
          </div>
          {editing !== 'delete' && (
            <button className="acct-btn danger" onClick={() => startEdit('delete')}>
              Delete Account
            </button>
          )}
        </div>

        {editing === 'delete' && (
          <div className="acct-form-block">
            <div className="acct-row-label">Confirm Account Deletion</div>
            <div className="acct-form-grid">
              <div className="acct-field">
                <label>Type DELETE or your account email</label>
                <input
                  className="acct-input"
                  value={deleteForm.confirm}
                  onChange={(e) => setDeleteForm({ ...deleteForm, confirm: e.target.value })}
                  placeholder="DELETE"
                  autoFocus
                />
              </div>
              <div className="acct-field">
                <label>Current Password</label>
                <input
                  type="password"
                  className="acct-input"
                  value={deleteForm.password}
                  onChange={(e) => setDeleteForm({ ...deleteForm, password: e.target.value })}
                  autoComplete="current-password"
                />
              </div>
            </div>
            <div className="acct-form-actions">
              <button className="acct-btn danger" disabled={busy === 'delete'} onClick={confirmDelete}>
                {busy === 'delete' ? 'Deleting…' : 'Permanently Delete'}
              </button>
              <button className="acct-btn" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
