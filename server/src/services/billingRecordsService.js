import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';

function serviceTypeForOrder(order = {}) {
  if (order.type === 'deployment') return 'hosting';
  if (order.type === 'email_plan') return 'email';
  return order.type || 'other';
}

function centsFromMicros(quantity, unitCostMicros) {
  return Math.max(0, Math.round((Number(quantity || 0) * Number(unitCostMicros || 0)) / 10_000));
}

function safeProviderFromMetadata(value) {
  try {
    const metadata = typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
    return metadata.provider || null;
  } catch {
    return null;
  }
}

function paymentStageFor(transactionType, status, explicitStage) {
  if (explicitStage) return explicitStage;
  if (transactionType === 'refund') return 'refund';
  if (status === 'failed') return 'failure';
  // A completed client payment is a capture into Glondia's account. Provider
  // settlement is recorded separately in ProviderSettlement.
  if (status === 'completed') return 'capture';
  return 'attempt';
}

async function providerServiceReferenceFor(line, usage) {
  const serviceType = line.serviceType || usage?.serviceType;
  const serviceId = line.serviceId || usage?.serviceId;
  if (!serviceId) return null;
  if (serviceType === 'vps') {
    const service = await prisma.vpsService.findFirst({
      where: { OR: [{ id: serviceId }, { providerInstanceId: serviceId }] },
      select: { providerInstanceId: true },
    });
    return service?.providerInstanceId || null;
  }
  if (serviceType === 'hosting' || serviceType === 'website_hosting') {
    const service = await prisma.webHostingService.findFirst({
      where: { OR: [{ id: serviceId }, { providerServiceId: serviceId }] },
      select: { providerServiceId: true },
    });
    return service?.providerServiceId || null;
  }
  const resource = await prisma.providerResource.findFirst({
    where: { serviceId, provider: usage?.provider || undefined, deletedAt: null },
    select: { providerResourceId: true },
  });
  return resource?.providerResourceId || null;
}

export async function recordPaymentTransaction({
  order,
  providerTransactionId,
  provider = order?.provider || 'manual',
  status = 'completed',
  transactionType = 'payment',
  paymentStage = null,
  attemptNumber = 1,
  paymentMethodId = null,
  receiptId = null,
  invoiceId = null,
  amountCents = null,
  currency = order?.currency || 'USD',
  failureCode = null,
  failureMessage = null,
  metadata = {},
} = {}) {
  if (!order?.id) return null;
  const transactionId = providerTransactionId || `${provider}:${order.id}:${transactionType}`;
  let serviceType = serviceTypeForOrder(order);
  const linkedInvoice = invoiceId
    ? await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } })
    : await prisma.invoice.findFirst({ where: { orderId: order.id }, include: { lineItems: true } });
  const linkedInvoiceId = linkedInvoice?.id || invoiceId || null;
  const invoiceServiceLine = linkedInvoice?.lineItems?.find((line) => line.serviceType || line.serviceId);
  if (invoiceServiceLine?.serviceType) serviceType = invoiceServiceLine.serviceType;
  const serviceId = order.deploymentId || invoiceServiceLine?.serviceId || null;
  const resolvedAmountCents = Math.max(0, Math.round(Number(
    amountCents ?? linkedInvoice?.totalCents ?? order.totalAmountCents ?? 0,
  )));
  const resolvedPaymentStage = paymentStageFor(transactionType, status, paymentStage);
  const transaction = await prisma.paymentTransaction.upsert({
    where: {
      provider_providerTransactionId_transactionType: {
        provider,
        providerTransactionId: transactionId,
        transactionType,
      },
    },
    create: {
      userId: order.userId || null,
      organizationId: order.organizationId || null,
      checkoutOrderId: order.id,
      invoiceId: linkedInvoiceId,
      paymentMethodId,
      receiptId,
      serviceType,
      serviceId,
      transactionType,
      paymentStage: resolvedPaymentStage,
      attemptNumber: Math.max(1, Math.round(Number(attemptNumber || 1))),
      provider,
      providerTransactionId: transactionId,
      status,
      amountCents: resolvedAmountCents,
      currency,
      failureCode,
      failureMessage,
      processedAt: status === 'completed' ? new Date() : null,
      metadata: JSON.stringify(metadata || {}),
    },
    update: {
      status,
      paymentStage: resolvedPaymentStage,
      attemptNumber: Math.max(1, Math.round(Number(attemptNumber || 1))),
      amountCents: resolvedAmountCents,
      currency,
      invoiceId: linkedInvoiceId,
      paymentMethodId,
      receiptId,
      failureCode,
      failureMessage,
      processedAt: status === 'completed' ? new Date() : undefined,
      metadata: JSON.stringify(metadata || {}),
    },
  });

  await prisma.billingLedger.upsert({
    where: {
      sourceTable_sourceId_billingType: {
        sourceTable: 'payment_transactions',
        sourceId: transaction.id,
        billingType: transactionType === 'refund' ? 'refund' : 'payment',
      },
    },
    create: {
      userId: transaction.userId,
      organizationId: transaction.organizationId,
      scope: transaction.serviceId ? 'item' : 'service',
      serviceType: serviceType || 'platform',
      serviceId: transaction.serviceId,
      billingType: transactionType === 'refund' ? 'refund' : 'payment',
      classification: status === 'failed'
        ? 'payment_attempt'
        : transactionType === 'refund' ? 'refund' : 'payment',
      stage: status === 'failed'
        ? 'payment_failed'
        : transactionType === 'refund' ? 'refunded' : status === 'completed' ? 'paid' : 'payment_pending',
      direction: status === 'completed' ? (transactionType === 'refund' ? 'debit' : 'credit') : 'neutral',
      sourceTable: 'payment_transactions',
      sourceId: transaction.id,
      checkoutOrderId: order.id,
      invoiceId: linkedInvoiceId,
      paymentMethodId,
      receiptId,
      description: status === 'failed'
        ? 'Payment attempt failed'
        : transactionType === 'refund' ? 'Payment refund' : 'Payment received',
      amountCents: resolvedAmountCents,
      unitCents: resolvedAmountCents,
      currency,
      status: status === 'completed' ? 'paid' : status,
      paidAt: transaction.processedAt,
      metadata: JSON.stringify(metadata || {}),
    },
    update: {
      status: status === 'completed' ? 'paid' : status,
      classification: status === 'failed'
        ? 'payment_attempt'
        : transactionType === 'refund' ? 'refund' : 'payment',
      stage: status === 'failed'
        ? 'payment_failed'
        : transactionType === 'refund' ? 'refunded' : status === 'completed' ? 'paid' : 'payment_pending',
      direction: status === 'completed' ? (transactionType === 'refund' ? 'debit' : 'credit') : 'neutral',
      description: status === 'failed'
        ? 'Payment attempt failed'
        : transactionType === 'refund' ? 'Payment refund' : 'Payment received',
      amountCents: resolvedAmountCents,
      unitCents: resolvedAmountCents,
      paidAt: transaction.processedAt,
      metadata: JSON.stringify(metadata || {}),
    },
  });
  if (status === 'completed' && linkedInvoice && linkedInvoice.status !== 'paid') {
    const captured = await prisma.paymentTransaction.aggregate({
      where: {
        invoiceId: linkedInvoice.id,
        transactionType: 'payment',
        status: 'completed',
      },
      _sum: { amountCents: true },
    });
    if (Number(captured._sum.amountCents || 0) < linkedInvoice.totalCents) return transaction;
    const paidAt = new Date();
    const providerPayableCount = await prisma.providerPayable.count({
      where: { invoiceId: linkedInvoice.id, status: { not: 'voided' } },
    });
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: linkedInvoice.id },
        data: {
          status: 'paid',
          paidAt,
          settlementStatus: providerPayableCount > 0 ? 'funded' : 'not_applicable',
        },
      }),
      prisma.billingLedger.updateMany({
        where: { invoiceId: linkedInvoice.id, billingType: 'invoice' },
        data: { status: 'paid', paidAt },
      }),
      prisma.providerPayable.updateMany({
        where: { invoiceId: linkedInvoice.id, status: 'recorded' },
        data: { status: 'funded', fundedByTransactionId: transaction.id },
      }),
      prisma.domainAddonService.updateMany({
        where: { invoiceId: linkedInvoice.id },
        data: {
          billingStatus: 'paid',
          paymentStatus: 'paid',
          paymentTransactionId: transaction.id,
          paymentMethodId,
        },
      }),
    ]);
    for (const line of linkedInvoice.lineItems || []) {
      if (!line.serviceType || !line.serviceId) continue;
      await prisma.serviceAccess.updateMany({
        where: { serviceType: line.serviceType, serviceId: line.serviceId },
        data: { billingStatus: 'paid', lastCheckedAt: paidAt },
      });
    }
    const paidAddons = await prisma.domainAddonService.findMany({
      where: { invoiceId: linkedInvoice.id, paymentStatus: 'paid' },
      select: { domainServiceId: true, addonKey: true },
    });
    if (paidAddons.length) {
      const { resumePaidDomainAddon } = await import('./customerDomainService.js');
      for (const addon of paidAddons) {
        await resumePaidDomainAddon(addon.domainServiceId, addon.addonKey);
      }
    }
  }
  return transaction;
}

export async function recordBillingUsage(input = {}) {
  const quantity = Number(input.quantity || 0);
  const includedQuantity = Number(input.includedQuantity || 0);
  const billableQuantity = Math.max(0, input.billableQuantity == null
    ? quantity - includedQuantity
    : Number(input.billableQuantity));
  const hasProviderPricing = input.providerUnitCostMicros != null || input.providerAmountCents != null;
  const markupPercent = hasProviderPricing
    ? Math.max(0, Number(input.markupPercent ?? process.env.PLATFORM_MARKUP_PERCENT ?? 30))
    : Math.max(0, Number(input.markupPercent || 0));
  const providerUnitCostMicros = input.providerUnitCostMicros == null
    ? null
    : Math.max(0, Math.round(Number(input.providerUnitCostMicros)));
  const markupUnitCostMicros = providerUnitCostMicros == null
    ? Math.max(0, Math.round(Number(input.markupUnitCostMicros || 0)))
    : Math.round(providerUnitCostMicros * markupPercent / 100);
  const customerUnitCostMicros = providerUnitCostMicros == null
    ? Math.max(0, Math.round(Number(input.customerUnitCostMicros ?? input.unitCostMicros ?? 0)))
    : providerUnitCostMicros + markupUnitCostMicros;
  const providerAmountCents = input.providerAmountCents == null
    ? providerUnitCostMicros == null ? null : centsFromMicros(billableQuantity, providerUnitCostMicros)
    : Math.max(0, Math.round(Number(input.providerAmountCents)));
  const calculatedCustomerAmountCents = providerAmountCents != null && providerUnitCostMicros == null
    ? providerAmountCents + Math.round(providerAmountCents * markupPercent / 100)
    : centsFromMicros(billableQuantity, customerUnitCostMicros);
  const customerAmountCents = input.customerAmountCents == null && input.amountCents == null
    ? calculatedCustomerAmountCents
    : Math.max(0, Math.round(Number(input.customerAmountCents ?? input.amountCents)));
  const markupAmountCents = providerAmountCents == null
    ? Math.max(0, Math.round(Number(input.markupAmountCents || 0)))
    : Math.max(0, customerAmountCents - providerAmountCents);
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (!input.serviceType || !input.meter || !input.unit || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw Object.assign(new Error('serviceType, meter, unit, periodStart, and periodEnd are required.'), { status: 400 });
  }

  const usage = await prisma.billingUsageRecord.upsert({
    where: {
      serviceType_serviceId_meter_periodStart_periodEnd_source: {
        serviceType: input.serviceType,
        serviceId: input.serviceId || null,
        meter: input.meter,
        periodStart,
        periodEnd,
        source: input.source || 'platform',
      },
    },
    create: {
      id: input.id || randomUUID(),
      userId: input.userId || null,
      organizationId: input.organizationId || null,
      serviceType: input.serviceType,
      serviceId: input.serviceId || null,
      serviceName: input.serviceName || null,
      chargeCategory: input.chargeCategory || 'usage',
      meter: input.meter,
      unit: input.unit,
      quantity,
      includedQuantity,
      billableQuantity,
      provider: input.provider || input.source || 'platform',
      providerRateId: input.providerRateId || null,
      providerUsageId: input.providerUsageId || input.sourceRecordId || null,
      pricingModel: input.pricingModel || 'metered',
      pricingSource: input.pricingSource || (hasProviderPricing ? 'provider_api' : 'legacy'),
      providerUnitCostMicros,
      markupPercent,
      markupUnitCostMicros,
      customerUnitCostMicros,
      unitCostMicros: customerUnitCostMicros,
      providerAmountCents,
      markupAmountCents,
      customerAmountCents,
      amountCents: customerAmountCents,
      currency: input.currency || 'USD',
      status: input.status || 'accruing',
      source: input.source || 'platform',
      sourceRecordId: input.sourceRecordId || null,
      periodStart,
      periodEnd,
      metadata: JSON.stringify(input.metadata || {}),
    },
    update: {
      serviceName: input.serviceName || undefined,
      chargeCategory: input.chargeCategory || 'usage',
      quantity,
      includedQuantity,
      billableQuantity,
      provider: input.provider || input.source || 'platform',
      providerRateId: input.providerRateId || null,
      providerUsageId: input.providerUsageId || input.sourceRecordId || null,
      pricingModel: input.pricingModel || 'metered',
      pricingSource: input.pricingSource || (hasProviderPricing ? 'provider_api' : 'legacy'),
      providerUnitCostMicros,
      markupPercent,
      markupUnitCostMicros,
      customerUnitCostMicros,
      unitCostMicros: customerUnitCostMicros,
      providerAmountCents,
      markupAmountCents,
      customerAmountCents,
      amountCents: customerAmountCents,
      currency: input.currency || 'USD',
      status: input.status || 'accruing',
      sourceRecordId: input.sourceRecordId || undefined,
      metadata: JSON.stringify(input.metadata || {}),
    },
  });

  await prisma.billingLedger.upsert({
    where: {
      sourceTable_sourceId_billingType: {
        sourceTable: 'billing_usage_records',
        sourceId: usage.id,
        billingType: 'usage',
      },
    },
    create: {
      userId: usage.userId,
      organizationId: usage.organizationId,
      scope: usage.serviceId ? 'item' : 'service',
      serviceType: usage.serviceType,
      serviceId: usage.serviceId,
      serviceName: usage.serviceName,
      billingType: 'usage',
      classification: `${usage.chargeCategory}_charge`,
      stage: usage.status === 'invoiced' ? 'invoiced' : usage.status === 'accruing' ? 'metered' : 'rated',
      direction: customerAmountCents > 0 ? 'debit' : 'neutral',
      sourceTable: 'billing_usage_records',
      sourceId: usage.id,
      description: `${usage.meter} usage`,
      quantity: Math.max(1, Math.round(billableQuantity)),
      unitCents: Math.round(Number(usage.customerUnitCostMicros || 0) / 10_000),
      providerAmountCents: usage.providerAmountCents,
      markupPercent: usage.markupPercent,
      markupAmountCents: usage.markupAmountCents,
      amountCents: customerAmountCents,
      currency: usage.currency,
      status: usage.status,
      periodStart,
      periodEnd,
      metadata: usage.metadata,
    },
    update: {
      serviceName: usage.serviceName,
      classification: `${usage.chargeCategory}_charge`,
      stage: usage.status === 'invoiced' ? 'invoiced' : usage.status === 'accruing' ? 'metered' : 'rated',
      direction: customerAmountCents > 0 ? 'debit' : 'neutral',
      quantity: Math.max(1, Math.round(billableQuantity)),
      unitCents: Math.round(Number(usage.customerUnitCostMicros || 0) / 10_000),
      providerAmountCents: usage.providerAmountCents,
      markupPercent: usage.markupPercent,
      markupAmountCents: usage.markupAmountCents,
      amountCents: customerAmountCents,
      currency: usage.currency,
      status: usage.status,
      metadata: usage.metadata,
    },
  });
  return usage;
}

export async function issueInvoice({
  userId = null,
  organizationId = null,
  orderId = null,
  invoiceNumber,
  currency = 'USD',
  status = 'issued',
  dueAt = null,
  taxCents = 0,
  discountCents = 0,
  creditsCents = 0,
  lineItems = [],
  metadata = {},
} = {}) {
  if (!invoiceNumber || !Array.isArray(lineItems) || lineItems.length === 0) {
    throw Object.assign(new Error('invoiceNumber and at least one line item are required.'), { status: 400 });
  }
  const usageIds = lineItems.map((line) => line.usageRecordId).filter(Boolean);
  const usageRecords = usageIds.length
    ? await prisma.billingUsageRecord.findMany({ where: { id: { in: usageIds } } })
    : [];
  const usageById = new Map(usageRecords.map((usage) => [usage.id, usage]));
  if (usageById.size !== new Set(usageIds).size) {
    throw Object.assign(new Error('Every usage-backed invoice line must reference an existing billing usage record.'), { status: 400 });
  }
  const normalizedLines = lineItems.map((line) => {
    const usage = line.usageRecordId ? usageById.get(line.usageRecordId) : null;
    const quantity = Math.max(1, Math.round(Number(line.quantity || 1)));
    const direction = line.direction === 'credit' ? 'credit' : 'debit';
    const lineClassification = line.lineClassification
      || (usage ? `${usage.chargeCategory}_charge` : direction === 'credit' ? 'credit' : 'one_time_charge');
    const authoritativeTotalCents = usage?.customerAmountCents ?? usage?.amountCents;
    const unitCents = authoritativeTotalCents == null
      ? Math.max(0, Math.round(Number(line.unitCents || 0)))
      : Math.max(0, Math.round(Number(line.unitCents ?? authoritativeTotalCents)));
    const totalCents = authoritativeTotalCents == null
      ? Math.max(0, line.totalCents == null ? quantity * unitCents : Math.round(Number(line.totalCents)))
      : Math.max(0, Math.round(Number(authoritativeTotalCents)));
    return {
      serviceType: usage?.serviceType || line.serviceType || null,
      serviceId: usage?.serviceId || line.serviceId || null,
      usageRecordId: line.usageRecordId || null,
      lineClassification,
      adjustmentType: line.adjustmentType || (direction === 'credit' ? lineClassification : null),
      direction,
      sourceTable: line.sourceTable || (usage ? 'billing_usage_records' : null),
      sourceId: line.sourceId || usage?.id || null,
      description: line.description || 'Service charge',
      quantity,
      unitCents,
      providerAmountCents: usage?.providerAmountCents ?? line.providerAmountCents ?? null,
      markupPercent: Number(usage?.markupPercent ?? line.markupPercent ?? 0),
      markupAmountCents: Math.max(0, Math.round(Number(usage?.markupAmountCents ?? line.markupAmountCents ?? 0))),
      totalCents,
      metadata: JSON.stringify(line.metadata || {}),
    };
  });
  const subtotalCents = normalizedLines
    .filter((line) => line.direction === 'debit')
    .reduce((sum, line) => sum + line.totalCents, 0);
  const lineCreditsCents = normalizedLines
    .filter((line) => line.direction === 'credit')
    .reduce((sum, line) => sum + line.totalCents, 0);
  const appliedCreditsCents = lineCreditsCents + Math.max(0, Math.round(Number(creditsCents || 0)));
  const totalCents = Math.max(0, subtotalCents + Math.round(Number(taxCents || 0))
    - Math.round(Number(discountCents || 0)) - appliedCreditsCents);
  const issuedAt = status === 'draft' ? null : new Date();
  const invoice = await prisma.invoice.create({
    data: {
      userId,
      organizationId,
      orderId,
      invoiceNumber,
      status,
      currency,
      subtotalCents,
      taxCents: Math.round(Number(taxCents || 0)),
      discountCents: Math.round(Number(discountCents || 0)),
      creditsCents: appliedCreditsCents,
      totalCents,
      dueAt: dueAt ? new Date(dueAt) : null,
      issuedAt,
      metadata: JSON.stringify(metadata || {}),
      lineItems: { create: normalizedLines },
    },
    include: { lineItems: true },
  });
  await prisma.billingLedger.create({
    data: {
      userId,
      organizationId,
      scope: 'platform',
      serviceType: 'platform',
      billingType: 'invoice',
      classification: 'invoice',
      stage: status === 'draft' ? 'rated' : 'invoiced',
      direction: 'neutral',
      sourceTable: 'invoices',
      sourceId: invoice.id,
      invoiceId: invoice.id,
      description: `Invoice ${invoice.invoiceNumber}`,
      unitCents: totalCents,
      amountCents: totalCents,
      currency,
      status,
      dueAt: invoice.dueAt,
      metadata: invoice.metadata,
    },
  });
  for (const line of invoice.lineItems) {
    const usage = line.usageRecordId ? usageById.get(line.usageRecordId) : null;
    const providerAmountCents = Math.max(0, Number(line.providerAmountCents || 0));
    const provider = usage?.provider || safeProviderFromMetadata(line.metadata);
    if (providerAmountCents > 0 && provider && provider !== 'platform') {
      const providerServiceReference = await providerServiceReferenceFor(line, usage);
      await prisma.providerPayable.upsert({
        where: { invoiceLineItemId: line.id },
        create: {
          userId,
          organizationId,
          provider,
          serviceType: line.serviceType || usage?.serviceType || 'other',
          serviceId: line.serviceId || usage?.serviceId || null,
          invoiceId: invoice.id,
          invoiceLineItemId: line.id,
          usageRecordId: line.usageRecordId || null,
          providerReference: usage?.providerUsageId || null,
          providerServiceReference,
          status: invoice.status === 'paid' ? 'funded' : 'recorded',
          amountCents: providerAmountCents,
          currency,
          dueAt: invoice.dueAt,
          metadata: JSON.stringify({ pricingSource: usage?.pricingSource || null }),
        },
        update: {
          provider,
          providerServiceReference,
          amountCents: providerAmountCents,
          currency,
          dueAt: invoice.dueAt,
        },
      });
    }
    if (line.sourceTable === 'domain_addon_services' && line.sourceId) {
      await prisma.$transaction([
        prisma.domainAddonService.update({
          where: { id: line.sourceId },
          data: {
            invoiceId: invoice.id,
            invoiceLineItemId: line.id,
            billingStatus: 'invoiced',
          },
        }),
        prisma.billingLedger.updateMany({
          where: {
            sourceTable: 'domain_addon_services',
            sourceId: line.sourceId,
            billingType: 'charge',
          },
          data: {
            invoiceId: invoice.id,
            invoiceLineItemId: line.id,
            status: 'invoiced',
            stage: 'invoiced',
          },
        }),
      ]);
    }
    if (line.usageRecordId) {
      await prisma.$transaction([
        prisma.billingUsageRecord.update({
          where: { id: line.usageRecordId },
          data: { status: 'invoiced' },
        }),
        prisma.billingLedger.updateMany({
          where: {
            sourceTable: 'billing_usage_records',
            sourceId: line.usageRecordId,
            billingType: 'usage',
          },
          data: {
            invoiceId: invoice.id,
            invoiceLineItemId: line.id,
            status: 'invoiced',
            stage: 'invoiced',
          },
        }),
      ]);
      continue;
    }
    await prisma.billingLedger.create({
      data: {
        userId,
        organizationId,
        scope: line.serviceId ? 'item' : line.serviceType ? 'service' : 'platform',
        serviceType: line.serviceType || 'platform',
        serviceId: line.serviceId,
        billingType: line.direction === 'credit' ? 'credit' : 'charge',
        classification: line.lineClassification,
        stage: 'invoiced',
        direction: line.direction,
        sourceTable: 'invoice_line_items',
        sourceId: line.id,
        invoiceId: invoice.id,
        invoiceLineItemId: line.id,
        description: line.description,
        quantity: line.quantity,
        unitCents: line.unitCents,
        providerAmountCents: line.providerAmountCents,
        markupPercent: line.markupPercent,
        markupAmountCents: line.markupAmountCents,
        amountCents: line.totalCents,
        currency,
        status,
        dueAt: invoice.dueAt,
        metadata: line.metadata,
      },
    });
  }
  const providerPayableCount = await prisma.providerPayable.count({ where: { invoiceId: invoice.id } });
  if (providerPayableCount === 0) {
    return prisma.invoice.update({
      where: { id: invoice.id },
      data: { settlementStatus: 'not_applicable' },
      include: { lineItems: true },
    });
  }
  return invoice;
}

export default { recordPaymentTransaction, recordBillingUsage, issueInvoice };
