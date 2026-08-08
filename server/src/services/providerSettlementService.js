import { prisma } from './db.js';

function cents(value) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('A positive settlement amount is required.'), { status: 400 });
  }
  return amount;
}

/**
 * Records a provider-side payment observed through provider billing history or
 * made by an approved provider adapter. This function never initiates PayPal
 * Payouts and never treats a client capture as proof that a provider was paid.
 */
export async function recordProviderSettlement({
  provider,
  providerTransactionId,
  status = 'completed',
  amountCents,
  currency = 'USD',
  failureCode = null,
  failureMessage = null,
  allocations = [],
  metadata = {},
} = {}) {
  if (!provider || !providerTransactionId) {
    throw Object.assign(new Error('provider and providerTransactionId are required.'), { status: 400 });
  }
  const settledAmount = cents(amountCents);
  const normalizedCurrency = String(currency || 'USD').toUpperCase();
  const payableIds = allocations.map((entry) => entry.providerPayableId).filter(Boolean);
  const payables = payableIds.length
    ? await prisma.providerPayable.findMany({ where: { id: { in: payableIds } } })
    : [];
  const payableById = new Map(payables.map((entry) => [entry.id, entry]));
  if (payableById.size !== new Set(payableIds).size) {
    throw Object.assign(new Error('Every settlement allocation must reference an existing provider payable.'), { status: 400 });
  }
  const normalizedAllocations = allocations.map((entry) => {
    const payable = payableById.get(entry.providerPayableId);
    const allocatedCents = cents(entry.amountCents);
    if (payable.provider !== provider) {
      throw Object.assign(new Error('Settlement provider does not match its payable.'), { status: 400 });
    }
    if (payable.currency !== normalizedCurrency) {
      throw Object.assign(new Error('Settlement currency does not match its payable.'), { status: 400 });
    }
    if (allocatedCents > payable.amountCents) {
      throw Object.assign(new Error('Settlement allocation exceeds the provider payable.'), { status: 400 });
    }
    if (!['funded', 'settling', 'settled'].includes(payable.status)) {
      throw Object.assign(new Error('Provider payable must be funded before settlement.'), { status: 409 });
    }
    return { payable, amountCents: allocatedCents };
  });
  const allocatedTotal = normalizedAllocations.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (allocatedTotal > settledAmount) {
    throw Object.assign(new Error('Settlement allocations exceed the outgoing payment.'), { status: 400 });
  }

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.providerSettlement.upsert({
      where: { provider_providerTransactionId: { provider, providerTransactionId } },
      create: {
        provider,
        providerTransactionId,
        status,
        amountCents: settledAmount,
        currency: normalizedCurrency,
        failureCode,
        failureMessage,
        processedAt: status === 'completed' ? new Date() : null,
        metadata: JSON.stringify(metadata || {}),
      },
      update: {
        status,
        amountCents: settledAmount,
        currency: normalizedCurrency,
        failureCode,
        failureMessage,
        processedAt: status === 'completed' ? new Date() : undefined,
        metadata: JSON.stringify(metadata || {}),
      },
    });
    const affectedInvoiceIds = new Set();
    for (const allocation of normalizedAllocations) {
      await tx.settlementAllocation.upsert({
        where: {
          providerSettlementId_providerPayableId: {
            providerSettlementId: settlement.id,
            providerPayableId: allocation.payable.id,
          },
        },
        create: {
          providerSettlementId: settlement.id,
          providerPayableId: allocation.payable.id,
          amountCents: allocation.amountCents,
          currency: normalizedCurrency,
        },
        update: {
          amountCents: allocation.amountCents,
          currency: normalizedCurrency,
        },
      });
      const allocated = await tx.settlementAllocation.aggregate({
        where: { providerPayableId: allocation.payable.id },
        _sum: { amountCents: true },
      });
      const fullyAllocated = Number(allocated._sum.amountCents || 0) >= allocation.payable.amountCents;
      await tx.providerPayable.update({
        where: { id: allocation.payable.id },
        data: {
          status: status === 'completed' && fullyAllocated
            ? 'settled'
            : status === 'failed' ? 'failed' : 'settling',
          settledAt: status === 'completed' && fullyAllocated ? new Date() : null,
        },
      });
      if (allocation.payable.invoiceId) affectedInvoiceIds.add(allocation.payable.invoiceId);
    }
    for (const invoiceId of affectedInvoiceIds) {
      const remaining = await tx.providerPayable.count({
        where: { invoiceId, status: { notIn: ['settled', 'voided'] } },
      });
      const failed = await tx.providerPayable.count({ where: { invoiceId, status: 'failed' } });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          settlementStatus: remaining === 0 ? 'settled' : failed > 0 ? 'failed' : 'settling',
        },
      });
    }
    return settlement;
  });
}

/**
 * Claims funded liabilities from the DB and hands their exact provider/service
 * references to a provider-specific payment adapter. The adapter must return
 * durable provider evidence; only then is a payable recorded as settled.
 */
export async function processFundedProviderPayables({
  provider,
  paymentAdapter,
  limit = 25,
  payableIds = null,
} = {}) {
  if (!provider || typeof paymentAdapter !== 'function') {
    throw Object.assign(new Error('provider and paymentAdapter are required.'), { status: 400 });
  }
  const candidates = await prisma.providerPayable.findMany({
    where: {
      provider,
      status: 'funded',
      ...(Array.isArray(payableIds) && payableIds.length ? { id: { in: payableIds } } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(100, Number(limit) || 25)),
  });
  const results = [];
  for (const payable of candidates) {
    const claimed = await prisma.providerPayable.updateMany({
      where: { id: payable.id, status: 'funded' },
      data: { status: 'settling' },
    });
    if (claimed.count !== 1) continue;
    if (payable.invoiceId) {
      await prisma.invoice.update({
        where: { id: payable.invoiceId },
        data: { settlementStatus: 'settling' },
      });
    }
    try {
      const evidence = await paymentAdapter({
        payableId: payable.id,
        provider: payable.provider,
        providerReference: payable.providerReference,
        providerServiceReference: payable.providerServiceReference,
        serviceType: payable.serviceType,
        serviceId: payable.serviceId,
        amountCents: payable.amountCents,
        currency: payable.currency,
        idempotencyKey: `provider-payable:${payable.id}`,
      });
      if (!evidence?.providerTransactionId) {
        throw new Error('Provider adapter returned no transaction reference.');
      }
      const settlement = await recordProviderSettlement({
        provider,
        providerTransactionId: evidence.providerTransactionId,
        status: evidence.status || 'completed',
        amountCents: evidence.amountCents ?? payable.amountCents,
        currency: evidence.currency || payable.currency,
        failureCode: evidence.failureCode || null,
        failureMessage: evidence.failureMessage || null,
        allocations: [{ providerPayableId: payable.id, amountCents: payable.amountCents }],
        metadata: {
          source: evidence.source || 'provider_api',
          providerReference: payable.providerReference,
          providerServiceReference: payable.providerServiceReference,
          ...(evidence.metadata || {}),
        },
      });
      results.push({ payableId: payable.id, status: settlement.status, settlementId: settlement.id });
    } catch (error) {
      await prisma.providerPayable.update({
        where: { id: payable.id },
        data: { status: 'failed', metadata: JSON.stringify({ settlementError: error.message }) },
      });
      if (payable.invoiceId) {
        await prisma.invoice.update({
          where: { id: payable.invoiceId },
          data: { settlementStatus: 'failed' },
        });
      }
      results.push({ payableId: payable.id, status: 'failed', error: error.message });
    }
  }
  return results;
}

export async function listProviderPayables({ provider = null, status = null } = {}) {
  return prisma.providerPayable.findMany({
    where: {
      ...(provider ? { provider } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function reconcileProviderSettlementStates({ invoiceId = null } = {}) {
  const invoices = await prisma.invoice.findMany({
    where: { ...(invoiceId ? { id: invoiceId } : {}), status: 'paid' },
    select: { id: true },
  });
  let updated = 0;
  for (const invoice of invoices) {
    const payables = await prisma.providerPayable.findMany({
      where: { invoiceId: invoice.id, status: { not: 'voided' } },
      select: { status: true },
    });
    const settlementStatus = payables.length === 0
      ? 'not_applicable'
      : payables.every((entry) => entry.status === 'settled')
        ? 'settled'
        : payables.some((entry) => entry.status === 'failed')
          ? 'failed'
          : payables.some((entry) => entry.status === 'settling')
            ? 'settling'
            : 'funded';
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { settlementStatus },
    });
    updated += 1;
  }
  return { checked: invoices.length, updated };
}

export default {
  recordProviderSettlement,
  processFundedProviderPayables,
  reconcileProviderSettlementStates,
  listProviderPayables,
};
