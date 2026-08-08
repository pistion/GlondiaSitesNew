import { prisma } from './db.js';
import renderApiService from './renderApiService.js';
import { listPaymentMethodsForUser } from './paymentMethodService.js';

function dbUserId(userId) {
  return userId && userId !== 'local-user' ? userId : null;
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function providerStatus() {
  return {
    renderConfigured: renderApiService.configured(),
    paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    manualReceiptUpload: true,
  };
}

function ownershipWhere(userId, organizationId) {
  const clauses = [];
  if (dbUserId(userId)) clauses.push({ userId: dbUserId(userId) });
  if (organizationId && organizationId !== 'me' && organizationId !== 'local-org') {
    clauses.push({ organizationId });
  }
  return clauses.length ? { OR: clauses } : { userId: null };
}

function scopedWhere(userId, organizationId, { serviceType, serviceId } = {}) {
  return {
    ...ownershipWhere(userId, organizationId),
    ...(serviceType ? { serviceType } : {}),
    ...(serviceId ? { serviceId } : {}),
  };
}

function publicLedger(row) {
  const {
    providerAmountCents: _providerAmountCents,
    markupPercent: _markupPercent,
    markupAmountCents: _markupAmountCents,
    ...safe
  } = row;
  return { ...safe, metadata: safeJson(row.metadata) };
}

function publicUsage(row) {
  const {
    provider: _provider,
    providerRateId: _providerRateId,
    providerUsageId: _providerUsageId,
    pricingSource: _pricingSource,
    providerUnitCostMicros: _providerUnitCostMicros,
    markupPercent: _markupPercent,
    markupUnitCostMicros: _markupUnitCostMicros,
    providerAmountCents: _providerAmountCents,
    markupAmountCents: _markupAmountCents,
    ...safe
  } = row;
  return { ...safe, metadata: safeJson(row.metadata) };
}

function publicInvoice(row) {
  const { settlementStatus: _settlementStatus, ...publicRow } = row;
  return {
    ...publicRow,
    metadata: safeJson(row.metadata),
    lineItems: (row.lineItems || []).map((line) => {
      const {
        providerAmountCents: _providerAmountCents,
        markupPercent: _markupPercent,
        markupAmountCents: _markupAmountCents,
        ...safe
      } = line;
      return { ...safe, metadata: safeJson(line.metadata) };
    }),
  };
}

function publicTransaction(row) {
  const {
    failureMessage: _failureMessage,
    metadata: _metadata,
    ...safe
  } = row;
  return {
    ...safe,
    metadata: {},
    customerMessage: row.status === 'failed'
      ? 'Your payment could not be completed. Review your payment method or try again.'
      : null,
  };
}

function publicOrder(row) {
  const {
    actualAmountCents: _actualAmountCents,
    markupPercent: _markupPercent,
    markupAmountCents: _markupAmountCents,
    metadata: rawMetadata,
    ...safe
  } = row;
  const {
    billingPayload: _billingPayload,
    providerCost: _providerCost,
    ...metadata
  } = safeJson(rawMetadata);
  return {
    ...safe,
    metadata,
    receipts: (row.receipts || []).map((receipt) => ({ ...receipt })),
  };
}

function totalsByCurrency(ledger, invoices, transactions) {
  const currencies = new Set([
    ...ledger.map((row) => row.currency),
    ...invoices.map((row) => row.currency),
    ...transactions.map((row) => row.currency),
  ].filter(Boolean));
  return [...currencies].map((currency) => {
    const currencyLedger = ledger.filter((row) => row.currency === currency);
    const debit = currencyLedger
      .filter((row) => row.direction === 'debit' && !['voided', 'cancelled', 'credited'].includes(row.status))
      .reduce((sum, row) => sum + row.amountCents, 0);
    const credit = currencyLedger
      .filter((row) => row.direction === 'credit' && !['voided', 'cancelled', 'failed'].includes(row.status))
      .reduce((sum, row) => sum + row.amountCents, 0);
    return {
      currency,
      balanceCents: Math.max(0, debit - credit),
      chargesCents: debit,
      paymentsCents: transactions
        .filter((row) => row.currency === currency && row.status === 'completed' && row.transactionType === 'payment')
        .reduce((sum, row) => sum + row.amountCents, 0),
      unpaidInvoiceCents: invoices
        .filter((row) => row.currency === currency && ['issued', 'overdue'].includes(row.status))
        .reduce((sum, row) => sum + row.totalCents, 0),
    };
  });
}

export async function getUserBillingSummary(userId, options = {}) {
  const organizationId = options.organizationId || null;
  const serviceType = options.serviceType || null;
  const serviceId = options.serviceId || null;
  const owner = ownershipWhere(userId, organizationId);
  const scoped = scopedWhere(userId, organizationId, { serviceType, serviceId });

  const [
    ledgerRows,
    usageRows,
    invoiceRows,
    transactionRows,
    orderRows,
    serviceRows,
    user,
    paymentMethods,
  ] = await Promise.all([
    prisma.billingLedger.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.billingUsageRecord.findMany({ where: scoped, orderBy: { periodStart: 'desc' }, take: 500 }),
    prisma.invoice.findMany({
      where: {
        ...owner,
        ...(serviceType || serviceId ? {
          lineItems: { some: {
            ...(serviceType ? { serviceType } : {}),
            ...(serviceId ? { serviceId } : {}),
          } },
        } : {}),
      },
      include: { lineItems: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.paymentTransaction.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.checkoutOrder.findMany({
      where: {
        ...owner,
        ...(serviceType ? {
          type: serviceType === 'hosting'
            ? 'deployment'
            : serviceType === 'email'
              ? { in: ['email', 'email_plan'] }
              : serviceType,
        } : {}),
        ...(serviceId ? { deploymentId: serviceId } : {}),
      },
      include: { receipts: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.serviceAccess.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, take: 300 }),
    dbUserId(userId)
      ? prisma.user.findUnique({ where: { id: dbUserId(userId) }, select: { email: true, name: true, planId: true } })
      : Promise.resolve(null),
    listPaymentMethodsForUser(userId),
  ]);

  const ledger = ledgerRows.map(publicLedger);
  const usage = usageRows.map(publicUsage);
  const invoices = invoiceRows.map(publicInvoice);
  const transactions = transactionRows.map(publicTransaction);
  const alerts = [
    ...invoices
      .filter((invoice) => invoice.status === 'overdue')
      .map((invoice) => ({
        id: `invoice:${invoice.id}`,
        type: 'invoice_overdue',
        severity: 'danger',
        title: 'Invoice overdue',
        message: `Invoice ${invoice.invoiceNumber} is overdue.`,
        invoiceId: invoice.id,
      })),
    ...transactions
      .filter((transaction) => transaction.status === 'failed')
      .map((transaction) => ({
        id: `payment:${transaction.id}`,
        type: 'payment_failed',
        severity: 'danger',
        title: 'Payment unsuccessful',
        message: transaction.customerMessage,
        transactionId: transaction.id,
        serviceType: transaction.serviceType,
        serviceId: transaction.serviceId,
      })),
  ].slice(0, 20);
  return {
    scope: {
      level: serviceId ? 'item' : serviceType ? 'service' : 'account',
      serviceType,
      serviceId,
    },
    account: {
      email: user?.email || null,
      name: user?.name || null,
      planId: user?.planId || 'free',
    },
    totals: totalsByCurrency(ledger, invoices, transactions),
    ledger,
    usage,
    invoices,
    transactions,
    alerts,
    orders: orderRows.map(publicOrder),
    services: serviceRows.map((row) => ({ ...row, metadata: safeJson(row.metadata) })),
    paymentMethods,
    provider: providerStatus(),
  };
}

export default { getUserBillingSummary };
