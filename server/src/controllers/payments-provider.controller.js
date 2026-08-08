/**
 * payments-provider.controller.js
 *
 * Thin HTTP wrappers around payments-provider.service.js.
 * No business logic here — all logic lives in the service.
 */

import * as paymentsProviderService from '../services/payments-provider.service.js';

function publicAmounts(amounts = {}) {
  return {
    currency: amounts.currency || 'USD',
    totalAmountCents: amounts.totalAmountCents || 0,
    totalAmount: amounts.totalAmount || ((Number(amounts.totalAmountCents || 0) / 100).toFixed(2)),
  };
}

function publicCheckout(payload = {}) {
  return {
    ...payload,
    ...(payload.amounts ? { amounts: publicAmounts(payload.amounts) } : {}),
    ...(payload.lineItems ? {
      lineItems: payload.lineItems.map((line) => ({
        type: line.type,
        name: line.name,
        years: line.years,
        customerAmountCents: line.customerAmountCents,
      })),
    } : {}),
  };
}

async function getPaypalClient(req, res, next) {
  try {
    const { markupPercent: _markupPercent, ...settings } = paymentsProviderService.getPaypalClientSettings();
    res.json(settings);
  } catch (error) {
    next(error);
  }
}

async function createDomainOrder(req, res, next) {
  try {
    res.json(publicCheckout(await paymentsProviderService.createDomainPaymentOrder(req.body || {}, req.user || {})));
  } catch (error) {
    next(error);
  }
}

async function validateDomainCart(req, res, next) {
  try {
    const quote = await paymentsProviderService.validateDomainCart(req.body || {});
    res.json({
      valid: quote.valid,
      provider: quote.provider,
      checkedAt: quote.checkedAt,
      domains: quote.domains.map((domain) => ({
        name: domain.name,
        years: domain.years,
        available: domain.available,
        status: domain.status,
        customerAmountCents: domain.customerAmountCents,
      })),
      amounts: publicAmounts(quote.amounts),
    });
  } catch (error) {
    next(error);
  }
}

async function captureDomainOrder(req, res, next) {
  try {
    res.json(publicCheckout(await paymentsProviderService.captureDomainPaymentOrder(req.body || {}, req.user || {})));
  } catch (error) {
    next(error);
  }
}

async function createDomainAddonOrder(req, res, next) {
  try {
    res.json(publicCheckout(await paymentsProviderService.createDomainAddonPaymentOrder(req.body || {}, req.user || {})));
  } catch (error) {
    next(error);
  }
}

async function captureDomainAddonOrder(req, res, next) {
  try {
    res.json(publicCheckout(await paymentsProviderService.captureDomainAddonPaymentOrder(req.body || {}, req.user || {})));
  } catch (error) {
    next(error);
  }
}

async function createHostingOrder(req, res, next) {
  try {
    res.json(await paymentsProviderService.createHostingPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
}

async function captureHostingOrder(req, res, next) {
  try {
    res.json(await paymentsProviderService.captureHostingPaymentOrder(req.body || {}, req.user || {}));
  } catch (error) {
    next(error);
  }
}

async function getHostingStatus(req, res, next) {
  try {
    res.json(await paymentsProviderService.getHostingPaymentStatus(req.params.deploymentId, req.user || {}));
  } catch (error) {
    next(error);
  }
}

export default {
  getPaypalClient,
  validateDomainCart,
  createDomainOrder,
  captureDomainOrder,
  createDomainAddonOrder,
  captureDomainAddonOrder,
  createHostingOrder,
  captureHostingOrder,
  getHostingStatus,
};
