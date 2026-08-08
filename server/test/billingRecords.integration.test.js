import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USER_ID = 'billing-user';
const OTHER_USER_ID = 'billing-other-user';
let tempDir;
let prisma;
let disconnect;
let billingRecords;
let dashboard;
let billingLifecycle;
let deploymentBilling;
let providerSettlements;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'glondia-billing-'));
  const dbPath = join(tempDir, 'test.db');
  closeSync(openSync(dbPath, 'w'));
  process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
  execSync('npx prisma db push --skip-generate', {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'ignore',
  });
  ({ prisma, disconnectPrisma: disconnect } = await import('../src/services/db.js'));
  billingRecords = await import('../src/services/billingRecordsService.js');
  dashboard = await import('../src/services/billingDashboardService.js');
  billingLifecycle = await import('../src/services/billingLifecycleService.js');
  deploymentBilling = await import('../src/services/deploymentBillingService.js');
  providerSettlements = await import('../src/services/providerSettlementService.js');
  await prisma.user.createMany({
    data: [
      { id: USER_ID, email: 'billing@test.local', passwordHash: 'unused' },
      { id: OTHER_USER_ID, email: 'other-billing@test.local', passwordHash: 'unused' },
    ],
  });
});

after(async () => {
  if (disconnect) await disconnect().catch(() => {});
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test('usage is durable, costed, and mirrored into the unified ledger', async () => {
  const periodStart = new Date('2026-07-01T00:00:00.000Z');
  const periodEnd = new Date('2026-08-01T00:00:00.000Z');
  const usage = await billingRecords.recordBillingUsage({
    userId: USER_ID,
    organizationId: USER_ID,
    serviceType: 'vps',
    serviceId: 'vps-1',
    serviceName: 'Production VPS',
    meter: 'compute_hours',
    unit: 'hour',
    quantity: 100,
    includedQuantity: 20,
    unitCostMicros: 125_000,
    currency: 'USD',
    status: 'finalized',
    source: 'test',
    periodStart,
    periodEnd,
  });
  assert.equal(usage.billableQuantity, 80);
  assert.equal(usage.amountCents, 1000);
  const ledger = await prisma.billingLedger.findFirst({
    where: { sourceTable: 'billing_usage_records', sourceId: usage.id, billingType: 'usage' },
  });
  assert.equal(ledger.serviceType, 'vps');
  assert.equal(ledger.serviceId, 'vps-1');
  assert.equal(ledger.amountCents, 1000);
});

test('provider-rated usage stores base cost, per-unit markup, and customer cost separately', async () => {
  const usage = await billingRecords.recordBillingUsage({
    userId: USER_ID,
    organizationId: USER_ID,
    serviceType: 'cloud_storage',
    serviceId: 'storage-1',
    serviceName: 'Archive storage',
    chargeCategory: 'usage',
    meter: 'storage_gb_month',
    unit: 'GB-month',
    quantity: 10,
    provider: 'vultr',
    providerRateId: 'block-storage-standard',
    providerUsageId: 'vultr-usage-001',
    providerUnitCostMicros: 100_000,
    markupPercent: 30,
    currency: 'USD',
    status: 'finalized',
    source: 'vultr',
    pricingSource: 'provider_api',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(usage.providerAmountCents, 100);
  assert.equal(usage.markupUnitCostMicros, 30_000);
  assert.equal(usage.markupAmountCents, 30);
  assert.equal(usage.customerUnitCostMicros, 130_000);
  assert.equal(usage.customerAmountCents, 130);
  assert.equal(usage.amountCents, 130);
  const ledger = await prisma.billingLedger.findFirst({
    where: { sourceTable: 'billing_usage_records', sourceId: usage.id },
  });
  assert.equal(ledger.classification, 'usage_charge');
  assert.equal(ledger.stage, 'rated');
  assert.equal(ledger.providerAmountCents, 100);
  assert.equal(ledger.markupAmountCents, 30);
  assert.equal(ledger.amountCents, 130);
});

test('invoice lines retain service and usage ownership', async () => {
  const usage = await prisma.billingUsageRecord.findFirst({ where: { userId: USER_ID } });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    invoiceNumber: 'INV-TEST-001',
    dueAt: '2026-08-10T00:00:00.000Z',
    lineItems: [{
      serviceType: 'vps',
      serviceId: 'vps-1',
      usageRecordId: usage.id,
      description: 'Production VPS compute',
      quantity: 1,
      unitCents: 1000,
    }],
  });
  assert.equal(invoice.totalCents, 1000);
  assert.equal(invoice.lineItems[0].serviceType, 'vps');
  assert.equal(invoice.lineItems[0].serviceId, 'vps-1');
  assert.equal(invoice.lineItems[0].usageRecordId, usage.id);
  assert.equal((await prisma.billingUsageRecord.findUnique({ where: { id: usage.id } })).status, 'invoiced');
});

test('invoice totals use immutable usage charges and classified credits', async () => {
  const usage = await prisma.billingUsageRecord.findFirst({
    where: { serviceType: 'cloud_storage', serviceId: 'storage-1' },
  });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    invoiceNumber: 'INV-DETAIL-001',
    lineItems: [
      {
        usageRecordId: usage.id,
        description: 'Archive storage usage',
      },
      {
        serviceType: 'cloud_storage',
        serviceId: 'storage-1',
        lineClassification: 'coupon',
        adjustmentType: 'launch_coupon',
        direction: 'credit',
        description: 'Launch coupon',
        totalCents: 25,
      },
    ],
  });
  assert.equal(invoice.subtotalCents, 130);
  assert.equal(invoice.creditsCents, 25);
  assert.equal(invoice.totalCents, 105);
  const usageLine = invoice.lineItems.find((line) => line.usageRecordId === usage.id);
  assert.equal(usageLine.providerAmountCents, 100);
  assert.equal(usageLine.markupAmountCents, 30);
  assert.equal(usageLine.totalCents, 130);
  const creditLine = invoice.lineItems.find((line) => line.direction === 'credit');
  assert.equal(creditLine.lineClassification, 'coupon');
  const ledgerRows = await prisma.billingLedger.findMany({ where: { invoiceId: invoice.id } });
  assert.equal(ledgerRows.some((row) => row.invoiceLineItemId === usageLine.id && row.stage === 'invoiced'), true);
  assert.equal(ledgerRows.some((row) => row.invoiceLineItemId === creditLine.id
    && row.billingType === 'credit' && row.classification === 'coupon'), true);
});

test('hosting checkout is created only from an issued invoice total', async () => {
  const deployment = {
    deploymentId: 'invoice-hosting-1',
    userId: USER_ID,
    organizationId: USER_ID,
    serviceName: 'Invoice-backed website',
  };
  const beforeInvoice = await deploymentBilling.createDeploymentOrder({
    deployment,
    user: { id: USER_ID },
  });
  assert.equal(beforeInvoice.status, 'metering');
  assert.equal(beforeInvoice.checkoutOrderId, null);

  const usage = await billingRecords.recordBillingUsage({
    userId: USER_ID,
    organizationId: USER_ID,
    serviceType: 'hosting',
    serviceId: deployment.deploymentId,
    meter: 'hosting_month',
    unit: 'month',
    quantity: 1,
    provider: 'render',
    providerUnitCostMicros: 2_000_000,
    markupPercent: 30,
    source: 'render',
    pricingSource: 'provider_api',
    status: 'finalized',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    invoiceNumber: 'INV-HOSTING-DB-001',
    lineItems: [{ usageRecordId: usage.id, description: 'Website hosting usage' }],
  });
  const checkout = await deploymentBilling.createDeploymentOrder({
    deployment,
    user: { id: USER_ID },
  });
  const order = await prisma.checkoutOrder.findUnique({ where: { id: checkout.checkoutOrderId } });
  assert.equal(checkout.invoiceId, invoice.id);
  assert.equal(order.totalAmountCents, invoice.totalCents);
  assert.equal(order.actualAmountCents, invoice.totalCents);
  assert.equal(order.markupAmountCents, 0);
  assert.equal(JSON.parse(order.metadata).pricingSource, 'invoice');
});

test('verified payments persist transaction evidence and account/service summaries stay scoped', async () => {
  const order = await prisma.checkoutOrder.create({
    data: {
      id: 'billing-order-1',
      organizationId: USER_ID,
      userId: USER_ID,
      type: 'vps',
      provider: 'paypal',
      providerCaptureId: 'CAPTURE-TEST-1',
      status: 'paid',
      currency: 'USD',
      totalAmountCents: 1000,
      paidAt: new Date(),
    },
  });
  await billingRecords.recordPaymentTransaction({
    order,
    provider: 'paypal',
    providerTransactionId: 'CAPTURE-TEST-1',
    status: 'completed',
  });
  await billingRecords.recordBillingUsage({
    userId: OTHER_USER_ID,
    organizationId: OTHER_USER_ID,
    serviceType: 'vps',
    serviceId: 'other-vps',
    meter: 'compute_hours',
    unit: 'hour',
    quantity: 1,
    amountCents: 9999,
    source: 'test',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-08-01T00:00:00.000Z',
  });

  const account = await dashboard.getUserBillingSummary(USER_ID, { organizationId: USER_ID });
  const service = await dashboard.getUserBillingSummary(USER_ID, {
    organizationId: USER_ID,
    serviceType: 'vps',
    serviceId: 'vps-1',
  });
  assert.equal(account.transactions.length, 1);
  assert.equal(account.invoices.length, 3);
  assert.equal(account.usage.length, 3);
  assert.equal(service.scope.level, 'item');
  assert.equal(service.usage.length, 1);
  assert.equal(service.invoices.length, 1);
  assert.equal(service.ledger.every((row) => row.serviceType === 'vps' && row.serviceId === 'vps-1'), true);
  assert.equal(account.usage.some((row) => row.userId === OTHER_USER_ID), false);
  assert.equal(account.usage.every((row) => !('providerAmountCents' in row) && !('markupPercent' in row)), true);
  assert.equal(account.ledger.every((row) => !('providerAmountCents' in row) && !('markupAmountCents' in row)), true);
  assert.equal(account.invoices.every((invoice) => invoice.lineItems.every(
    (line) => !('providerAmountCents' in line) && !('markupPercent' in line),
  )), true);
});

test('payment attempts retain their stage and only settle a fully paid invoice', async () => {
  const invoice = await prisma.invoice.findUnique({
    where: { invoiceNumber: 'INV-DETAIL-001' },
  });
  const order = await prisma.checkoutOrder.create({
    data: {
      id: 'billing-detail-order',
      organizationId: USER_ID,
      userId: USER_ID,
      type: 'cloud_storage',
      provider: 'paypal',
      status: 'pending',
      currency: 'USD',
      totalAmountCents: invoice.totalCents,
    },
  });
  const failed = await billingRecords.recordPaymentTransaction({
    order,
    invoiceId: invoice.id,
    provider: 'paypal',
    providerTransactionId: 'DETAIL-FAILED-1',
    status: 'failed',
    attemptNumber: 1,
    failureCode: 'DECLINED',
  });
  assert.equal(failed.paymentStage, 'failure');
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).status, 'issued');

  const paid = await billingRecords.recordPaymentTransaction({
    order,
    invoiceId: invoice.id,
    provider: 'paypal',
    providerTransactionId: 'DETAIL-PAID-2',
    status: 'completed',
    attemptNumber: 2,
  });
  assert.equal(paid.paymentStage, 'capture');
  assert.equal(paid.amountCents, 105);
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).status, 'paid');
  const attempts = await prisma.paymentTransaction.findMany({ where: { invoiceId: invoice.id } });
  assert.equal(attempts.length, 2);
});

test('failed payment attempts remain retryable and create durable UI notifications', async () => {
  const order = await prisma.checkoutOrder.create({
    data: {
      id: 'billing-failed-order',
      organizationId: USER_ID,
      userId: USER_ID,
      type: 'deployment',
      deploymentId: 'failed-site-1',
      provider: 'paypal',
      providerOrderId: 'PAYPAL-FAILED-1',
      status: 'pending',
      currency: 'USD',
      totalAmountCents: 2500,
    },
  });
  await prisma.serviceAccess.create({
    data: {
      userId: USER_ID,
      organizationId: USER_ID,
      serviceType: 'hosting',
      serviceId: 'failed-site-1',
      checkoutOrderId: order.id,
      accessStatus: 'pending',
      billingStatus: 'pending',
    },
  });
  const transaction = await billingLifecycle.recordFailedPayment({
    order,
    provider: 'paypal',
    providerTransactionId: 'CAPTURE-DENIED-1',
    error: Object.assign(new Error('Provider card decline detail'), { code: 'CARD_DECLINED' }),
    source: 'integration_test',
  });
  assert.equal(transaction.status, 'failed');
  assert.equal((await prisma.checkoutOrder.findUnique({ where: { id: order.id } })).status, 'pending');
  assert.equal((await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'hosting', serviceId: 'failed-site-1' } },
  })).billingStatus, 'failed');
  const customerNotice = await prisma.notification.findFirst({
    where: { userId: USER_ID, entityType: 'payment_transaction', entityId: transaction.id },
  });
  assert.equal(customerNotice.title, 'Payment unsuccessful');
  assert.doesNotMatch(customerNotice.message, /provider|decline detail/i);
  const summary = await dashboard.getUserBillingSummary(USER_ID, { organizationId: USER_ID });
  const publicFailure = summary.transactions.find((item) => item.id === transaction.id);
  assert.equal(publicFailure.status, 'failed');
  assert.equal('failureMessage' in publicFailure, false);
  assert.match(publicFailure.customerMessage, /could not be completed/i);
  assert.equal(summary.alerts.some((item) => item.transactionId === transaction.id), true);
});

test('async invoice checks mark overdue services and notify only once', async () => {
  await prisma.serviceAccess.create({
    data: {
      userId: USER_ID,
      organizationId: USER_ID,
      serviceType: 'email',
      serviceId: 'overdue-email-1',
      accessStatus: 'active',
      billingStatus: 'paid',
    },
  });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    invoiceNumber: 'INV-OVERDUE-001',
    dueAt: '2026-01-01T00:00:00.000Z',
    lineItems: [{
      serviceType: 'email',
      serviceId: 'overdue-email-1',
      description: 'Business Email',
      unitCents: 500,
    }],
  });
  await billingLifecycle.reconcileOverdueInvoices({ now: new Date('2026-02-01T00:00:00.000Z'), userId: USER_ID });
  await billingLifecycle.reconcileOverdueInvoices({ now: new Date('2026-02-01T00:00:00.000Z'), userId: USER_ID });
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).status, 'overdue');
  assert.equal((await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId: 'overdue-email-1' } },
  })).billingStatus, 'overdue');
  assert.equal(await prisma.notification.count({
    where: { userId: USER_ID, entityType: 'invoice', entityId: invoice.id, title: 'Invoice overdue' },
  }), 1);
});

test('completed payment asynchronously settles its linked invoice and service', async () => {
  const order = await prisma.checkoutOrder.create({
    data: {
      id: 'billing-invoice-payment-order',
      organizationId: USER_ID,
      userId: USER_ID,
      type: 'email_plan',
      provider: 'paypal',
      providerCaptureId: 'CAPTURE-INVOICE-PAID',
      status: 'paid',
      currency: 'USD',
      totalAmountCents: 700,
      paidAt: new Date(),
    },
  });
  await prisma.serviceAccess.create({
    data: {
      userId: USER_ID,
      organizationId: USER_ID,
      serviceType: 'email',
      serviceId: 'paid-email-1',
      checkoutOrderId: order.id,
      accessStatus: 'active',
      billingStatus: 'overdue',
    },
  });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    orderId: order.id,
    invoiceNumber: 'INV-PAID-001',
    dueAt: '2026-08-10T00:00:00.000Z',
    lineItems: [{
      serviceType: 'email',
      serviceId: 'paid-email-1',
      description: 'Business Email',
      unitCents: 700,
    }],
  });
  await billingLifecycle.reconcilePaymentOrder(order.id);
  const paidInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  assert.equal(paidInvoice.status, 'paid');
  assert.ok(paidInvoice.paidAt);
  assert.equal((await prisma.serviceAccess.findUnique({
    where: { serviceType_serviceId: { serviceType: 'email', serviceId: 'paid-email-1' } },
  })).billingStatus, 'paid');
});

test('client capture funds a distinct provider payable and provider evidence settles it', async () => {
  await prisma.vpsService.create({
    data: {
      id: 'vultr-vps-settlement-1',
      organizationId: USER_ID,
      createdByUserId: USER_ID,
      providerInstanceId: 'vultr-instance-exact-1',
      label: 'Vultr VPS',
      hostname: 'vultr-vps.test',
      region: 'syd',
      plan: 'vc2-1c-1gb',
      osId: 2284,
      monthlyCostCents: 100,
      markupAmountCents: 30,
      totalPriceCents: 130,
      paymentStatus: 'pending',
    },
  });
  const usage = await billingRecords.recordBillingUsage({
    userId: USER_ID,
    organizationId: USER_ID,
    serviceType: 'vps',
    serviceId: 'vultr-vps-settlement-1',
    serviceName: 'Vultr VPS',
    meter: 'compute_hours',
    unit: 'hour',
    quantity: 10,
    provider: 'vultr',
    providerUsageId: 'vultr-usage-1',
    providerUnitCostMicros: 100_000,
    currency: 'USD',
    status: 'finalized',
    source: 'vultr_api',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-10-01T00:00:00.000Z'),
  });
  const invoice = await billingRecords.issueInvoice({
    userId: USER_ID,
    organizationId: USER_ID,
    invoiceNumber: 'INV-VULTR-SETTLEMENT-001',
    lineItems: [{
      usageRecordId: usage.id,
      description: 'Vultr compute usage',
    }],
  });
  const payableBeforeCapture = await prisma.providerPayable.findUnique({
    where: { invoiceLineItemId: invoice.lineItems[0].id },
  });
  assert.equal(payableBeforeCapture.provider, 'vultr');
  assert.equal(payableBeforeCapture.providerServiceReference, 'vultr-instance-exact-1');
  assert.equal(payableBeforeCapture.amountCents, usage.providerAmountCents);
  assert.equal(payableBeforeCapture.status, 'recorded');

  const order = await prisma.checkoutOrder.create({
    data: {
      id: 'provider-payable-client-order',
      organizationId: USER_ID,
      userId: USER_ID,
      type: 'vps',
      provider: 'paypal',
      providerCaptureId: 'CLIENT-CAPTURE-PAYABLE-1',
      status: 'paid',
      currency: invoice.currency,
      totalAmountCents: invoice.totalCents,
      paidAt: new Date(),
      metadata: JSON.stringify({ invoiceId: invoice.id }),
    },
  });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { orderId: order.id } });
  const clientPayment = await billingRecords.recordPaymentTransaction({
    order,
    invoiceId: invoice.id,
    provider: 'paypal',
    providerTransactionId: 'CLIENT-CAPTURE-PAYABLE-1',
    status: 'completed',
  });
  assert.equal(clientPayment.paymentStage, 'capture');
  const fundedPayable = await prisma.providerPayable.findUnique({ where: { id: payableBeforeCapture.id } });
  assert.equal(fundedPayable.status, 'funded');
  assert.equal(fundedPayable.fundedByTransactionId, clientPayment.id);
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).settlementStatus, 'funded');

  const processed = await providerSettlements.processFundedProviderPayables({
    provider: 'vultr',
    payableIds: [fundedPayable.id],
    paymentAdapter: async (request) => {
      assert.equal(request.providerServiceReference, 'vultr-instance-exact-1');
      assert.equal(request.providerReference, 'vultr-usage-1');
      assert.equal(request.amountCents, fundedPayable.amountCents);
      assert.equal(request.idempotencyKey, `provider-payable:${fundedPayable.id}`);
      return {
        providerTransactionId: 'VULTR-PAYMENT-1',
        status: 'completed',
        amountCents: request.amountCents,
        currency: request.currency,
        source: 'vultr_billing_history',
      };
    },
  });
  assert.equal(processed[0].status, 'completed', processed[0].error);
  const settlement = await prisma.providerSettlement.findUnique({
    where: { provider_providerTransactionId: { provider: 'vultr', providerTransactionId: 'VULTR-PAYMENT-1' } },
  });
  assert.equal(settlement.status, 'completed');
  assert.equal((await prisma.providerPayable.findUnique({ where: { id: fundedPayable.id } })).status, 'settled');
  assert.equal((await prisma.invoice.findUnique({ where: { id: invoice.id } })).settlementStatus, 'settled');
  assert.equal(await prisma.settlementAllocation.count({
    where: { providerSettlementId: settlement.id, providerPayableId: fundedPayable.id },
  }), 1);
});
