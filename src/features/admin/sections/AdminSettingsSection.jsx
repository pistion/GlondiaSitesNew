// AdminSettingsSection.jsx — read-only platform settings overview
import React from 'react';
import { ICN } from '../../../icons';
import { StatusPill } from '../adminStatus.jsx';

function SettingsCard({ title, icon: Icon, children }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        {Icon && (
          <span style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)',
            color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon size={15} />
          </span>
        )}
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, note }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {value}
        {note && <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>{note}</span>}
      </span>
    </div>
  );
}

export function AdminSettingsSection({ overview }) {
  const ov = overview || {};
  const providerCost = ov.providerCost || {};

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
      <SettingsCard title="Billing configuration" icon={ICN.CreditCard}>
        <Row label="Currency" value="Per provider invoice" />
        <Row label="Platform markup" value={ov.platformMargin?.markupPercent != null ? `${ov.platformMargin.markupPercent}%` : '—'} note="applied on top of provider cost" />
        <Row label="Charge source" value="Recorded service usage" note="usage to invoice to payment" />
        <Row
          label="Margin note"
          value={ov.platformMargin?.note ? (
            <span style={{ fontSize: 12, fontStyle: 'italic' }}>{ov.platformMargin.note}</span>
          ) : '—'}
        />
      </SettingsCard>

      <SettingsCard title="Hosting plan defaults" icon={ICN.Server}>
        <Row label="Free tier" value="Free" note="no billing required" />
        <Row label="Starter tier" value="Starter" note="paid, basic resources" />
        <Row label="Standard tier" value="Standard" note="paid, full resources" />
        <Row label="Default new deployment" value="free" note="until payment received" />
        <Row label="After payment" value="standard" note="standard hosting tier" />
      </SettingsCard>

      <SettingsCard title="Render config status" icon={ICN.Activity}>
        <Row
          label="Provider cost display"
          value={providerCost.display || '—'}
          note="from server env"
        />
        <Row
          label="Cleanup jobs"
          value={ov.cleanupJobs ?? '—'}
          note="scheduled tasks"
        />
        <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-deep)', borderRadius: 6 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            Render.com API credentials are stored in server environment variables (<code>RENDER_API_KEY</code>).
            Check your Render service's Environment tab to verify the key is set.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="PayPal configuration" icon={ICN.Globe}>
        <Row label="Payment method" value="Bank transfer (primary)" />
        <Row label="PayPal" value={<StatusPill value="unknown" />} />
        <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-deep)', borderRadius: 6 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            PayPal integration status is not exposed via the admin API.
            Contact the server administrator to verify <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> are set in the server environment.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard title="Manual bank payment" icon={ICN.Briefcase}>
        <Row label="Collection method" value="Manual bank transfer" />
        <Row label="Receipt upload" value={<StatusPill value="active" />} note="users upload proof" />
        <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-deep)', borderRadius: 6 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
            Configure bank account details in the server environment variables:
            <code style={{ display: 'block', marginTop: 4 }}>BANK_NAME, BANK_ACCOUNT_NUMBER, BANK_ACCOUNT_NAME, BANK_BSB</code>
            These appear in customer payment instructions.
          </p>
        </div>
      </SettingsCard>
    </div>
  );
}
