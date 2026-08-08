import React from 'react';
import { Badge } from '../../components';
import { ICN } from '../../icons';
import { getBillingSummary } from '../../api/billing.js';

const { useCallback, useEffect, useMemo, useState } = React;

const scopeCopy = {
  workspace: ['Account billing', 'Billing Information', 'All charges, payments, invoices, and usage across your Glondia account.'],
  hosting: ['Hosted apps billing', 'Hosting Billing', 'Billing and usage across all hosted websites and applications.'],
  website: ['Website billing', 'Website Billing', 'Charges, payments, invoices, and usage for this website.'],
  vps: ['VPS service billing', 'VPS Billing', 'Billing and usage across all VPS servers.'],
  'vps-item': ['VPS server billing', 'VPS Server Billing', 'Charges and usage for this VPS server.'],
  'email-mailbox': ['Mailbox billing', 'Business Email Billing', 'Charges and usage for this business-email service.'],
  'cloud-storage': ['Cloud Storage billing', 'Cloud Storage Billing', 'Billing and usage across all Cloud Storage services.'],
  'cloud-storage-item': ['Storage service billing', 'Cloud Storage Billing', 'Charges, usage and invoices for this storage service.'],
};

function queryFor(scope, app, deploymentId) {
  if (scope === 'workspace') return {};
  if (scope === 'hosting') return { serviceType: 'hosting' };
  if (scope === 'website') return { serviceType: 'hosting', serviceId: deploymentId || app.deploymentId || app.id };
  if (scope === 'vps') return { serviceType: 'vps' };
  if (scope === 'vps-item') return { serviceType: 'vps', serviceId: app.id || app.serviceId };
  if (scope === 'email-mailbox') return { serviceType: 'email', serviceId: app.id || app.serviceId };
  if (scope === 'cloud-storage') return { serviceType: 'cloud_storage' };
  if (scope === 'cloud-storage-item') return { serviceType: 'cloud_storage', serviceId: app.id || app.serviceId };
  return {};
}

function money(cents = 0, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(cents || 0) / 100);
  } catch {
    return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;
  }
}

function date(value, monthOnly = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, monthOnly
    ? { month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function tone(status) {
  const value = String(status || '').toLowerCase();
  if (['paid', 'completed', 'active', 'finalized', 'free'].includes(value)) return 'success';
  if (['failed', 'overdue', 'reversed', 'suspended'].includes(value)) return 'danger';
  return 'warning';
}

function Section({ id, title, children, action }) {
  return (
    <section className="hosting-billing-section" id={id}>
      <div className="hosting-billing-section-head"><h3>{title}</h3>{action}</div>
      {children}
    </section>
  );
}

function SettlementWalkthrough({ flow }) {
  if (!flow) return null;
  return (
    <Section id="billing-settlement-walkthrough" title="Sandbox Payment Walkthrough">
      <div className="hosting-charge-list">
        <div className="hosting-charge-row"><span>Client paid Glondia</span><strong>{money(flow.customerTotalCents, flow.currency)}</strong></div>
        <div className="hosting-charge-row"><span>Glondia provider liability</span><strong>{money(flow.providerCostCents, flow.currency)}</strong></div>
        <div className="hosting-charge-row"><span>Gross platform margin</span><strong>{money(flow.markupCents, flow.currency)}</strong></div>
      </div>
      <div className="hosting-charge-list" style={{ marginTop: 14 }}>
        {(flow.stages || []).map((stage, index) => (
          <div className="hosting-charge-row" key={stage.label}>
            <span>
              <strong>{index + 1}. {stage.label}</strong><br />
              <small>{stage.detail}</small>
            </span>
            <Badge tone={tone(stage.state)}>{stage.state}</Badge>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Demo-only internal trace: {flow.clientCaptureReference} → {flow.provider} service {flow.providerServiceReference} → {flow.providerSettlementReference}
      </p>
    </Section>
  );
}

function exportCsv(summary) {
  const rows = [['Date', 'Service', 'Description', 'Type', 'Status', 'Currency', 'Amount']];
  (summary.ledger || []).forEach((entry) => rows.push([
    date(entry.createdAt),
    entry.serviceName || entry.serviceType,
    entry.description || '',
    entry.billingType,
    entry.status,
    entry.currency,
    (Number(entry.amountCents || 0) / 100).toFixed(2),
  ]));
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `glondia-billing-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BillingSection({ app = {}, scope = 'website', deploymentId = null }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const copy = scopeCopy[scope] || scopeCopy.website;
  const query = useMemo(
    () => queryFor(scope, app, deploymentId),
    [scope, app.id, app.serviceId, app.deploymentId, deploymentId],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setSummary(await getBillingSummary(query)); }
    catch (err) { setError(err.message || 'Billing records could not be loaded.'); }
    finally { setLoading(false); }
  }, [query.serviceType, query.serviceId]);
  useEffect(() => { load(); }, [load]);

  const totals = summary?.totals || [];
  const ledger = summary?.ledger || [];
  const usage = summary?.usage || [];
  const invoices = summary?.invoices || [];
  const transactions = summary?.transactions || [];
  const services = summary?.services || [];
  const methods = summary?.paymentMethods || [];
  const alerts = summary?.alerts || [];
  const attention = invoices.some((item) => item.status === 'overdue')
    || services.some((item) => ['overdue', 'failed'].includes(item.billingStatus))
    || alerts.length > 0;

  if (loading) return <div className="card" style={{ padding: 24 }}>Loading billing records…</div>;
  if (error) return <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>{error} <button className="btn btn-outline btn-sm" onClick={load}>Retry</button></div>;

  return (
    <div className="hosting-billing-page">
      {attention && (
        <div className="hosting-billing-alert">
          <div className="hosting-billing-alert-icon"><ICN.AlertCircle size={18} /></div>
          <div>
            <strong>{alerts[0]?.title || 'Billing attention required'}</strong>
            <p>{alerts[0]?.message || 'An invoice or service requires payment to remain active.'}</p>
          </div>
        </div>
      )}

      <div className="hosting-billing-title">
        <div><p className="eyebrow">{copy[0]}</p><h2>{copy[1]}</h2><p className="muted">{copy[2]}</p></div>
      </div>

      <div className="hosting-billing-layout">
        <aside className="hosting-billing-toc" aria-label="Billing table of contents">
          <span>Table of contents</span>
          {['Summary', 'Payment Method', 'Usage', 'Charges', 'Payments', 'Invoices'].map((item) => (
            <a key={item} href={`#billing-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</a>
          ))}
        </aside>

        <div className="hosting-billing-stack">
          <SettlementWalkthrough flow={summary?.sandboxFlow} />
          <Section id="billing-summary" title="Account Summary">
            <div className="hosting-charge-list">
              {totals.length ? totals.map((total) => (
                <React.Fragment key={total.currency}>
                  <div className="hosting-charge-row"><span>Outstanding balance ({total.currency})</span><strong>{money(total.balanceCents, total.currency)}</strong></div>
                  <div className="hosting-charge-row"><span>Recorded payments</span><strong>{money(total.paymentsCents, total.currency)}</strong></div>
                  <div className="hosting-charge-row"><span>Unpaid invoices</span><strong>{money(total.unpaidInvoiceCents, total.currency)}</strong></div>
                </React.Fragment>
              )) : <p className="muted">No billed totals have been recorded for this scope.</p>}
            </div>
          </Section>

          <Section id="billing-payment-method" title="Payment Method">
            {methods.length ? methods.map((method) => (
              <div className="hosting-billing-info-row" key={method.id}>
                <div className="hosting-billing-info-icon"><ICN.CreditCard size={18} /></div>
                <div><span>{method.provider}</span><strong>{method.label}</strong></div>
                {method.isDefault && <Badge tone="success">Default</Badge>}
              </div>
            )) : <p className="muted">No saved payment method. A method can be securely saved after a supported PayPal checkout.</p>}
            <p className="muted" style={{ marginTop: 12 }}>Billing email: {summary?.account?.email || app.billingEmail || 'Not provided'}</p>
          </Section>

          <Section id="billing-usage" title="Metered Usage">
            {usage.length ? <div className="hosting-charge-list">{usage.map((item) => (
              <div className="hosting-charge-row" key={item.id}>
                <span><strong>{item.serviceName || item.serviceType}</strong><br /><small>{item.meter} · {date(item.periodStart)}–{date(item.periodEnd)}</small></span>
                <span>{Number(item.quantity).toLocaleString()} {item.unit} / {money(item.amountCents, item.currency)}</span>
              </div>
            ))}</div> : <p className="muted">No metered usage has been recorded for this scope.</p>}
          </Section>

          <Section id="billing-charges" title="Charges and Credits" action={<button className="btn btn-outline" onClick={() => exportCsv(summary)}><ICN.File size={14} /> Download CSV</button>}>
            {ledger.length ? <div className="hosting-charge-list">{ledger.map((entry) => (
              <div className="hosting-charge-row" key={entry.id}>
                <span><strong>{entry.description || entry.billingType}</strong><br /><small>{entry.serviceName || entry.serviceType} · {date(entry.createdAt)}</small></span>
                <span><Badge tone={tone(entry.status)}>{entry.status}</Badge> &nbsp; {entry.direction === 'credit' ? '−' : ''}{money(entry.amountCents, entry.currency)}</span>
              </div>
            ))}</div> : <p className="muted">No ledger entries have been recorded for this scope.</p>}
          </Section>

          <Section id="billing-payments" title="Payment History">
            {transactions.length ? <div className="hosting-charge-list">{transactions.map((payment) => (
              <div className="hosting-charge-row" key={payment.id}>
                <span><strong>{payment.provider} {payment.transactionType}</strong><br /><small>{date(payment.processedAt || payment.createdAt)} · {payment.providerTransactionId || 'manual reference'}</small></span>
                <span>
                  <Badge tone={tone(payment.status)}>{payment.status}</Badge> &nbsp; {money(payment.amountCents, payment.currency)}
                  {payment.customerMessage && <small style={{ display: 'block', color: 'var(--danger)', marginTop: 4 }}>{payment.customerMessage}</small>}
                </span>
              </div>
            ))}</div> : <p className="muted">No completed or pending payment transactions.</p>}
          </Section>

          <Section id="billing-invoices" title="Invoice History">
            {invoices.length ? <div className="hosting-invoice-table-wrap"><table className="hosting-invoice-table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Total</th><th>Services</th></tr></thead>
              <tbody>{invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoiceNumber}</td><td>{date(invoice.issuedAt || invoice.createdAt, true)}</td>
                  <td><Badge tone={tone(invoice.status)}>{invoice.status}</Badge></td>
                  <td>{money(invoice.totalCents, invoice.currency)}</td>
                  <td>{[...new Set(invoice.lineItems.map((line) => line.serviceType).filter(Boolean))].join(', ') || 'Account'}</td>
                </tr>
              ))}</tbody>
            </table></div> : <p className="muted">No invoices have been issued for this scope.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
