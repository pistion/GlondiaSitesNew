const now = () => new Date().toISOString();
const future = (hours = 12) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
const past = (hours = 6) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const sandboxEmailPlans = [
  { id: 'email-5', name: 'Starter Mail', mailboxLimit: 5, unitPriceCents: 100, monthlyPriceCents: 500, currency: 'USD' },
  { id: 'email-15', name: 'Business Mail', mailboxLimit: 15, unitPriceCents: 100, monthlyPriceCents: 1500, currency: 'USD' },
  { id: 'email-25', name: 'Team Mail', mailboxLimit: 25, unitPriceCents: 100, monthlyPriceCents: 2500, currency: 'USD' },
];

export function sandboxSelectedPlan(sandbox) {
  const planId = sandbox?.payload?.plan || 'email-5';
  return sandboxEmailPlans.find((plan) => plan.id === planId) || sandboxEmailPlans[0];
}

export function sandboxEmailCapacity(sandbox) {
  const selectedPlan = sandboxSelectedPlan(sandbox);
  const used = sandbox?.id === 'email.mailboxes' ? 2 : 1;
  const allowed = Number(selectedPlan.mailboxLimit || 0);
  const remaining = Math.max(0, allowed - used);
  return {
    selectedPlan,
    allowed,
    used,
    remaining,
    atLimit: remaining <= 0,
    percentUsed: allowed ? Math.round((used / allowed) * 100) : 0,
  };
}

export function sandboxEmailStatus(sandbox) {
  const domain = sandbox?.payload?.domain || 'glondia-sandbox.com';
  const capacity = sandboxEmailCapacity(sandbox);
  return {
    configured: true,
    dnsVerified: false,
    dnsStatus: 'partial',
    mailboxCount: capacity.used,
    domainCount: 1,
    webmailUrl: '/mailboxes',
    webmailConfigured: true,
    selectedPlan: capacity.selectedPlan,
    capacity,
    domains: [{ id: 'sandbox-domain-email', name: domain, status: 'connected' }],
    message: 'Sandbox mode is active. These email records are fixture data for UI review only.',
  };
}

export function sandboxEmailPlansResponse(sandbox) {
  return { plans: sandboxEmailPlans, selectedPlan: sandboxSelectedPlan(sandbox) };
}

export function sandboxEmailMailboxes(sandbox) {
  const domain = sandbox?.payload?.domain || 'glondia-sandbox.com';
  return {
    webmailUrl: '/mailboxes',
    webmailConfigured: true,
    mailboxes: [
      {
        id: 'sandbox-mailbox-info',
        email: `info@${domain}`,
        localPart: 'info',
        mailboxName: 'info',
        domain,
        status: 'active',
        storageLimitBytes: 5 * 1024 ** 3,
        storageUsedBytes: 1.4 * 1024 ** 3,
        usageAvailable: true,
        updatedAt: now(),
        webmailUrl: '/mailboxes',
      },
      {
        id: 'sandbox-mailbox-billing',
        email: `billing@${domain}`,
        localPart: 'billing',
        mailboxName: 'billing',
        domain,
        status: 'past_due',
        storageLimitBytes: 5 * 1024 ** 3,
        storageUsedBytes: 4.2 * 1024 ** 3,
        usageAvailable: true,
        updatedAt: past(18),
        webmailUrl: '/mailboxes',
      },
      {
        id: 'sandbox-mailbox-pending',
        email: `sales@${domain}`,
        localPart: 'sales',
        mailboxName: 'sales',
        domain,
        status: 'pending_setup',
        storageLimitBytes: 5 * 1024 ** 3,
        storageUsedBytes: 0,
        usageAvailable: false,
        updatedAt: now(),
        webmailUrl: '/mailboxes',
      },
    ],
  };
}

export function sandboxEmailMailbox(sandbox, mailboxId) {
  return sandboxEmailMailboxes(sandbox).mailboxes.find((mailbox) => mailbox.id === mailboxId)
    || sandboxEmailMailboxes(sandbox).mailboxes[0];
}

export function sandboxEmailUsage(sandbox, mailboxId) {
  const mailbox = sandboxEmailMailbox(sandbox, mailboxId);
  return {
    mailboxId: mailbox.id,
    usedBytes: mailbox.storageUsedBytes,
    limitBytes: mailbox.storageLimitBytes,
    percentUsed: Math.round((Number(mailbox.storageUsedBytes || 0) / Number(mailbox.storageLimitBytes || 1)) * 100),
    updatedAt: now(),
  };
}

export function sandboxEmailDns(domain = 'glondia-sandbox.com') {
  return {
    domain,
    provider: 'GlondiaMail',
    records: [
      { id: 'mx', type: 'MX', host: '@', name: '@', priority: 10, value: 'mail.glondia.com', status: 'found' },
      { id: 'spf', type: 'TXT', host: '@', name: '@', value: 'v=spf1 include:mail.glondia.com ~all', status: 'found' },
      { id: 'dkim', type: 'CNAME', host: 'glondia._domainkey', name: 'glondia._domainkey', value: 'glondia._domainkey.mail.glondia.com.', status: 'missing' },
      { id: 'dmarc', type: 'TXT', host: '_dmarc', name: '_dmarc', value: 'v=DMARC1; p=none; rua=mailto:dmarc@glondia.com', status: 'missing' },
    ],
  };
}

export function sandboxHostingService(sandbox) {
  const expired = sandbox?.id === 'hosting.expired';
  return {
    id: 'sandbox-hosting-1',
    deploymentId: 'sandbox-hosting-1',
    serviceName: expired ? 'past-due-site' : 'glondia-sandbox-site',
    siteName: expired ? 'past-due-site' : 'glondia-sandbox-site',
    status: expired ? 'suspended' : 'live',
    currentStep: expired ? 'Suspended until repayment' : 'Live and reachable',
    buildStatus: expired ? 'blocked' : 'succeeded',
    liveUrl: expired ? 'https://past-due-site.onrender.com' : 'https://glondia-sandbox-site.onrender.com',
    sourceType: 'zip',
    serviceType: 'static_site',
    renderServiceId: 'srv_sandbox_fixture',
    renderDeployId: 'dep_sandbox_fixture',
    urlReachable: !expired,
    subscriptionStatus: expired ? 'suspended' : 'active',
    billingDueAt: expired ? past(2) : future(72),
    sourceConfig: { branch: 'main', buildCommand: 'npm run build', outputDirectory: 'dist' },
    createdAt: past(48),
    updatedAt: now(),
  };
}

export function sandboxHostingList(sandbox) {
  return [sandboxHostingService(sandbox)];
}

export function sandboxHostingStatus(sandbox) {
  return sandboxHostingService(sandbox);
}

export function sandboxHostingDeployHistory() {
  return [
    { id: 'dep_sandbox_fixture', status: 'live', createdAt: past(2), finishedAt: past(1), commit: 'sandbox-ui' },
    { id: 'dep_sandbox_previous', status: 'succeeded', createdAt: past(28), finishedAt: past(27), commit: 'previous-ui' },
  ];
}

export function sandboxHostingLogs() {
  return [
    { timestamp: past(2), source: 'build', message: 'Installing dependencies...' },
    { timestamp: past(1.5), source: 'build', message: 'Build completed successfully.' },
    { timestamp: past(1), source: 'deploy', message: 'Sandbox service is live.' },
  ];
}

export function sandboxHostingEvents() {
  return [
    { id: 'sandbox-event-1', type: 'deploy.live', message: 'Deployment moved to live.', createdAt: past(1) },
    { id: 'sandbox-event-2', type: 'billing.checked', message: 'Billing relationship checked.', createdAt: past(2) },
  ];
}

export function sandboxHostingMetrics(type = 'cpu', options = {}) {
  const range = options.range || '12h';
  const data = [0.3, 0.4, 0.4, 0.6, 0.7, 1.2, 2.6, 4.1, 5.8, 4.9, 3.8, 2.4]
    .map((value, index) => ({ timestamp: past(12 - index), value }));
  return {
    type,
    unit: type === 'bandwidth' ? 'MB' : 'value',
    source: 'sandbox',
    range,
    resolution: 'hour',
    data,
    usageThisMonthMb: 24,
  };
}

export function sandboxHostingEnvVars() {
  return [{ id: 'env_sandbox_1', key: 'NODE_ENV', value: 'production', syncStatus: 'synced', updatedAt: now() }];
}

export function sandboxHostingDomains() {
  return [{
    id: 'domain_sandbox_1',
    domainId: 'domain_sandbox_1',
    name: 'www.glondia.com',
    status: 'pending_dns',
    verificationStatus: 'waiting_for_dns',
    sslStatus: 'pending_certificate',
    providerSyncStatus: 'sandbox_main_server',
    provider: 'glondia-main-server',
    providerError: null,
    createdAt: past(6),
    dnsRecords: [
      { id: 'www-cname', type: 'CNAME', name: 'www', host: 'www', value: '45.77.236.52', ttl: 300, status: 'pending' },
      { id: 'apex-a', type: 'A', name: '@', host: '@', value: '45.77.236.52', ttl: 300, status: 'optional' },
    ],
  }];
}

export function sandboxHostingDisks() {
  return [];
}

export function sandboxDomains() {
  return [
    {
      id: 'sandbox-domain-1',
      name: 'glondia-sandbox.com',
      hostname: 'glondia-sandbox.com',
      status: 'active',
      verified: true,
      autoRenew: true,
      expiresAt: future(24 * 180),
      linkedProject: 'glondia-sandbox-site',
      createdAt: past(24 * 14),
    },
  ];
}

export function sandboxDomainDnsRecords() {
  return [
    { id: 'dns-a', type: 'A', host: '@', name: '@', value: '203.0.113.10', ttl: 3600, status: 'propagating' },
    { id: 'dns-www', type: 'CNAME', host: 'www', name: 'www', value: 'glondia-sandbox.com', ttl: 3600, status: 'active' },
    ...sandboxEmailDns('glondia-sandbox.com').records,
  ];
}

export function sandboxDomainAvailability(domains = []) {
  return domains.map((domain) => ({
    domain,
    available: !String(domain).includes('taken'),
    status: String(domain).includes('taken') ? 'unavailable' : 'available',
    pricing: { currency: 'USD', registrationPriceCents: 1299, renewalPriceCents: 1299 },
  }));
}

export function sandboxBillingSummary(sandbox) {
  if (sandbox?.id === 'billing.settlement') {
    const currency = sandbox?.payload?.currency || 'USD';
    const providerCostCents = Number(sandbox?.payload?.providerCostCents || 10000);
    const markupPercent = Number(sandbox?.payload?.markupPercent ?? 30);
    const customerTotalCents = Number(sandbox?.payload?.customerTotalCents
      || providerCostCents + Math.round(providerCostCents * markupPercent / 100));
    const markupCents = customerTotalCents - providerCostCents;
    const invoiceId = 'sandbox-invoice-vultr-settled';
    const paymentId = 'sandbox-payment-paypal-capture';
    return {
      scope: { level: 'account', serviceType: null, serviceId: null },
      account: { email: 'accounts@northstar.example', name: sandbox?.payload?.account || 'Northstar Trading', planId: 'business' },
      provider: { sandbox: true, configured: true },
      totals: [{
        currency,
        chargesCents: customerTotalCents,
        paymentsCents: customerTotalCents,
        balanceCents: 0,
        unpaidInvoiceCents: 0,
      }],
      usage: [{
        id: 'sandbox-vultr-usage-july',
        serviceType: 'vps',
        serviceId: 'vps-production',
        serviceName: 'Production VPS',
        meter: 'compute_hours',
        unit: 'hours',
        quantity: 744,
        includedQuantity: 0,
        billableQuantity: 744,
        amountCents: customerTotalCents,
        currency,
        status: 'invoiced',
        periodStart: past(24 * 30),
        periodEnd: now(),
        createdAt: past(2),
        metadata: {},
      }],
      ledger: [{
        id: 'sandbox-ledger-vultr-charge',
        scope: 'item',
        serviceType: 'vps',
        serviceId: 'vps-production',
        serviceName: 'Production VPS',
        billingType: 'usage',
        direction: 'debit',
        description: 'July VPS compute usage',
        quantity: 744,
        amountCents: customerTotalCents,
        currency,
        status: 'paid',
        createdAt: past(2),
        metadata: {},
      }, {
        id: 'sandbox-ledger-paypal-capture',
        scope: 'item',
        serviceType: 'vps',
        serviceId: 'vps-production',
        serviceName: 'Production VPS',
        billingType: 'payment',
        direction: 'credit',
        description: 'Payment received',
        quantity: 1,
        amountCents: customerTotalCents,
        currency,
        status: 'paid',
        createdAt: past(1),
        metadata: {},
      }],
      invoices: [{
        id: invoiceId,
        invoiceNumber: 'INV-2026-VPS-071',
        status: 'paid',
        currency,
        subtotalCents: customerTotalCents,
        taxCents: 0,
        discountCents: 0,
        creditsCents: 0,
        totalCents: customerTotalCents,
        issuedAt: past(2),
        paidAt: past(1),
        createdAt: past(2),
        metadata: {},
        lineItems: [{
          id: 'sandbox-line-vultr-july',
          serviceType: 'vps',
          serviceId: 'vps-production',
          usageRecordId: 'sandbox-vultr-usage-july',
          description: 'Production VPS — July compute usage',
          quantity: 1,
          unitCents: customerTotalCents,
          totalCents: customerTotalCents,
          metadata: {},
        }],
      }],
      transactions: [{
        id: paymentId,
        invoiceId,
        serviceType: 'vps',
        serviceId: 'vps-production',
        transactionType: 'payment',
        paymentStage: 'capture',
        provider: 'paypal',
        providerTransactionId: 'PAYPAL-CAPTURE-456',
        status: 'completed',
        amountCents: customerTotalCents,
        currency,
        processedAt: past(1),
        createdAt: past(1),
        metadata: {},
      }],
      alerts: [],
      services: [{
        id: 'access-vps',
        serviceType: 'vps',
        serviceId: 'vps-production',
        serviceName: 'Production VPS',
        accessStatus: 'active',
        billingStatus: 'paid',
        metadata: {},
      }],
      paymentMethods: [{
        id: 'sandbox-method-paypal',
        provider: 'paypal',
        methodType: 'paypal',
        brand: 'paypal',
        isDefault: true,
        status: 'active',
        label: 'PayPal account',
      }],
      pricing: { displayAmount: 'Usage based', deploymentCurrency: currency, graceHours: 12 },
      orders: [{
        id: 'sandbox-order-vultr',
        status: 'paid',
        currency,
        totalAmountCents: customerTotalCents,
        paidAt: past(1),
        type: 'vps',
        receipts: [],
        metadata: { sandbox: true },
      }],
      sandboxFlow: {
        provider: 'Vultr',
        providerServiceReference: 'vultr-instance-123',
        providerUsageReference: 'vultr-usage-july-071',
        clientCaptureReference: 'PAYPAL-CAPTURE-456',
        providerSettlementReference: 'VULTR-PAYMENT-789',
        providerCostCents,
        markupCents,
        customerTotalCents,
        currency,
        stages: [
          { label: 'Usage rated', state: 'completed', detail: 'Actual Vultr cost recorded against the exact VPS instance.' },
          { label: 'Invoice paid', state: 'paid', detail: 'PayPal captured the complete markup-inclusive client invoice into Glondia.' },
          { label: 'Provider liability funded', state: 'funded', detail: 'The underlying Vultr cost became eligible for provider settlement.' },
          { label: 'Vultr payment verified', state: 'settled', detail: 'Vultr billing evidence matched the payable and provider service reference.' },
        ],
      },
    };
  }
  const periodStart = past(27);
  const periodEnd = future(4);
  const createdAt = past(2);
  const usage = [
    { id: 'usage-host-compute', serviceType: 'hosting', serviceId: 'site-storefront', serviceName: 'Storefront Website', meter: 'compute_hours', unit: 'hours', quantity: 412, amountCents: 2600 },
    { id: 'usage-host-bandwidth', serviceType: 'hosting', serviceId: 'site-storefront', serviceName: 'Storefront Website', meter: 'bandwidth', unit: 'GB', quantity: 86.4, amountCents: 325 },
    { id: 'usage-email-mailboxes', serviceType: 'email', serviceId: 'email-business', serviceName: 'Business Email', meter: 'mailboxes', unit: 'mailboxes', quantity: 5, amountCents: 650 },
    { id: 'usage-email-storage', serviceType: 'email', serviceId: 'email-business', serviceName: 'Business Email', meter: 'mail_storage', unit: 'GB-month', quantity: 18.2, amountCents: 195 },
    { id: 'usage-vps-compute', serviceType: 'vps', serviceId: 'vps-production', serviceName: 'Production VPS', meter: 'compute_hours', unit: 'hours', quantity: 744, amountCents: 5200 },
    { id: 'usage-vps-bandwidth', serviceType: 'vps', serviceId: 'vps-production', serviceName: 'Production VPS', meter: 'bandwidth', unit: 'GB', quantity: 312.7, amountCents: 455 },
    { id: 'usage-vps-backups', serviceType: 'vps', serviceId: 'vps-production', serviceName: 'Production VPS', meter: 'automated_backups', unit: 'month', quantity: 1, amountCents: 780 },
    { id: 'usage-object-storage', serviceType: 'cloud_storage', serviceId: 'storage-assets', serviceName: 'Website Asset Storage', meter: 'object_storage', unit: 'GB-month', quantity: 1240.5, amountCents: 1560 },
    { id: 'usage-storage-egress', serviceType: 'cloud_storage', serviceId: 'storage-assets', serviceName: 'Website Asset Storage', meter: 'storage_bandwidth', unit: 'GB', quantity: 206.8, amountCents: 260 },
    { id: 'usage-block-storage', serviceType: 'cloud_storage', serviceId: 'storage-database', serviceName: 'Database Block Storage', meter: 'block_storage', unit: 'GB-month', quantity: 80, amountCents: 1040 },
  ].map((item) => ({
    ...item,
    includedQuantity: 0,
    billableQuantity: item.quantity,
    currency: 'USD',
    status: 'accruing',
    periodStart,
    periodEnd,
    createdAt,
    metadata: {},
  }));
  const ledger = usage.map((item) => ({
    id: `ledger-${item.id}`,
    userId: 'sandbox-user',
    organizationId: 'sandbox-org',
    scope: 'item',
    serviceType: item.serviceType,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    billingType: 'usage',
    direction: 'debit',
    description: `${item.meter.replaceAll('_', ' ')} usage`,
    quantity: Math.max(1, Math.round(item.quantity)),
    amountCents: item.amountCents,
    currency: item.currency,
    status: item.status,
    periodStart,
    periodEnd,
    createdAt,
    metadata: {},
  }));
  const totalCents = usage.reduce((sum, item) => sum + item.amountCents, 0);
  const paidCents = 9120;
  const failedPayment = sandbox?.id === 'billing.failed' || sandbox?.payload?.paymentStatus === 'failed';
  const failedTransaction = failedPayment ? {
    id: 'sandbox-payment-failed',
    serviceType: 'vps',
    serviceId: 'vps-production',
    transactionType: 'payment',
    provider: 'paypal',
    providerTransactionId: 'SANDBOX-DECLINED-7281',
    status: 'failed',
    amountCents: 5200,
    currency: 'USD',
    processedAt: past(1),
    createdAt: past(1),
    customerMessage: 'Your payment could not be completed. Review your payment method or try again.',
    metadata: {},
  } : null;
  return {
    scope: { level: 'account', serviceType: null, serviceId: null },
    account: { email: 'accounts@northstar.example', name: 'Northstar Trading', planId: 'business' },
    provider: { sandbox: true, configured: true },
    totals: [{
      currency: 'USD',
      chargesCents: totalCents,
      paymentsCents: paidCents,
      balanceCents: totalCents - paidCents,
      unpaidInvoiceCents: totalCents,
    }],
    ledger,
    usage,
    invoices: [{
      id: 'sandbox-invoice-july',
      invoiceNumber: 'INV-2026-0071',
      status: 'issued',
      currency: 'USD',
      subtotalCents: totalCents,
      taxCents: 0,
      discountCents: 0,
      totalCents,
      issuedAt: past(2),
      dueAt: future(12),
      createdAt: past(2),
      metadata: {},
      lineItems: usage.map((item) => ({
        id: `line-${item.id}`,
        serviceType: item.serviceType,
        serviceId: item.serviceId,
        usageRecordId: item.id,
        description: `${item.serviceName} — ${item.meter.replaceAll('_', ' ')}`,
        quantity: 1,
        unitCents: item.amountCents,
        totalCents: item.amountCents,
        metadata: {},
      })),
    }],
    transactions: [{
      id: 'sandbox-payment-1',
      serviceType: 'platform',
      transactionType: 'payment',
      provider: 'paypal',
      providerTransactionId: 'SANDBOX-PAY-78219',
      status: 'completed',
      amountCents: paidCents,
      currency: 'USD',
      processedAt: past(18),
      createdAt: past(18),
      metadata: {},
    }, ...(failedTransaction ? [failedTransaction] : [])],
    alerts: failedTransaction ? [{
      id: 'payment:sandbox-payment-failed',
      type: 'payment_failed',
      severity: 'danger',
      title: 'Payment unsuccessful',
      message: failedTransaction.customerMessage,
      transactionId: failedTransaction.id,
      serviceType: failedTransaction.serviceType,
      serviceId: failedTransaction.serviceId,
    }] : [],
    services: [
      { id: 'access-hosting', serviceType: 'hosting', serviceId: 'site-storefront', serviceName: 'Storefront Website', accessStatus: 'active', billingStatus: 'paid', metadata: {} },
      { id: 'access-email', serviceType: 'email', serviceId: 'email-business', serviceName: 'Business Email', accessStatus: 'active', billingStatus: 'paid', metadata: {} },
      { id: 'access-vps', serviceType: 'vps', serviceId: 'vps-production', serviceName: 'Production VPS', accessStatus: 'active', billingStatus: 'paid', metadata: {} },
      { id: 'access-storage-assets', serviceType: 'cloud_storage', serviceId: 'storage-assets', serviceName: 'Website Asset Storage', accessStatus: 'active', billingStatus: 'paid', metadata: {} },
      { id: 'access-storage-db', serviceType: 'cloud_storage', serviceId: 'storage-database', serviceName: 'Database Block Storage', accessStatus: 'active', billingStatus: 'paid', metadata: {} },
    ],
    paymentMethods: [{
      id: 'sandbox-method-paypal',
      provider: 'paypal',
      methodType: 'paypal',
      brand: 'paypal',
      isDefault: true,
      status: 'active',
      label: 'PayPal account',
    }],
    pricing: {
      displayAmount: 'Usage based',
      deploymentCurrency: 'USD',
      graceHours: 12,
    },
    orders: [{
      id: 'sandbox-order-1',
      status: 'paid',
      currency: 'USD',
      totalAmountCents: paidCents,
      paidAt: past(18),
      deploymentId: null,
      type: 'account_usage',
      receipts: [],
      metadata: { sandbox: true },
    }],
  };
}

export function sandboxBillingNotifications(sandbox) {
  if (sandbox?.service !== 'billing') return [];
  const failed = sandbox?.id === 'billing.failed' || sandbox?.payload?.paymentStatus === 'failed';
  return [{
    id: failed ? 'sandbox-notification-payment-failed' : 'sandbox-notification-invoice',
    type: failed ? 'danger' : 'billing',
    title: failed ? 'Payment unsuccessful' : 'Invoice ready',
    message: failed
      ? 'Your payment could not be completed. Please review your payment method or try again.'
      : 'Your current usage invoice is ready to review.',
    actionUrl: '/dashboard/billing',
    entityType: failed ? 'payment_transaction' : 'invoice',
    entityId: failed ? 'sandbox-payment-failed' : 'sandbox-invoice-july',
    audience: 'user',
    metadata: { sandbox: true },
    readAt: null,
    read: false,
    createdAt: past(failed ? 1 : 2),
  }];
}

export function sandboxVpsSettings() {
  return { configured: true, provider: 'vultr', sandbox: true, message: 'Sandbox VPS provider is active.' };
}

export function sandboxVpsRegions() {
  return [
    { id: 'syd', city: 'Sydney', country: 'AU', continent: 'Asia-Pacific' },
    { id: 'sgp', city: 'Singapore', country: 'SG', continent: 'Asia-Pacific' },
  ];
}

export function sandboxVpsPlans() {
  return [
    { id: 'vc2-1c-1gb', type: 'regular', label: '1 vCPU / 1 GB RAM', vcpu_count: 1, ram: 1024, disk: 25, bandwidth: 1, monthly_cost: 6 },
    { id: 'vc2-2c-4gb', type: 'regular', label: '2 vCPU / 4 GB RAM', vcpu_count: 2, ram: 4096, disk: 80, bandwidth: 3, monthly_cost: 24 },
  ];
}

export function sandboxVpsOperatingSystems() {
  return [{ id: 2284, name: 'Ubuntu 24.04 LTS', family: 'ubuntu' }, { id: 2136, name: 'Debian 12', family: 'debian' }];
}

export function sandboxVpsServices() {
  return [{
    id: 'sandbox-vps-1',
    label: 'sandbox-vps',
    status: 'running',
    region: 'syd',
    plan: 'vc2-1c-1gb',
    os: 'Ubuntu 24.04 LTS',
    mainIp: '203.0.113.24',
    monthlyCost: 6,
    createdAt: past(12),
    updatedAt: now(),
  }];
}

export function sandboxVpsSummary(id = 'sandbox-vps-1') {
  return {
    service: sandboxVpsServices().find((item) => item.id === id) || sandboxVpsServices()[0],
    metrics: { cpu: 12, memory: 38, disk: 21 },
    billing: { status: 'active', nextDueAt: future(24 * 20), amount: 'USD 6.00' },
  };
}

export function sandboxTickets() {
  const ticket = {
    id: 'sandbox-ticket-1',
    subject: 'Sandbox support test',
    category: 'email',
    priority: 'normal',
    status: 'pending_customer',
    unreadForCustomer: 1,
    createdAt: past(4),
    updatedAt: past(1),
    lastMessage: { senderRole: 'admin', status: 'sent', body: 'We checked the DNS records; DKIM and DMARC are still missing.', createdAt: past(1) },
  };
  return { items: [ticket], total: 1 };
}

export function sandboxTicket(ticketId = 'sandbox-ticket-1') {
  return {
    ...sandboxTickets().items[0],
    id: ticketId,
    messages: [
      { id: 'msg-1', senderRole: 'customer', status: 'replied', body: 'Can you check why my mailbox setup is not completing?', createdAt: past(4) },
      { id: 'msg-2', senderRole: 'admin', status: 'sent', body: 'We checked the DNS records; DKIM and DMARC are still missing.', createdAt: past(1) },
    ],
  };
}
