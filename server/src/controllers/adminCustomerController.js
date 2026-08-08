/**
 * adminCustomerController.js — HTTP layer for admin customer oversight.
 *
 * Speaks HTTP only: parses params, calls adminCustomerOversightService, and
 * renders the pack's stable error format:
 *   { error: { code, message }, requestId }
 */

import * as oversight from '../services/adminCustomerOversightService.js';

function sectionQuery(req) {
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const err = new Error('limit must be between 1 and 100.');
    err.status = 400; err.code = 'ADMIN_INVALID_PAGINATION'; err.expose = true;
    throw err;
  }
  if (!Number.isInteger(offset) || offset < 0) {
    const err = new Error('offset must be non-negative.');
    err.status = 400; err.code = 'ADMIN_INVALID_PAGINATION'; err.expose = true;
    throw err;
  }
  for (const key of ['dateFrom', 'dateTo']) {
    if (req.query[key] && Number.isNaN(new Date(req.query[key]).getTime())) {
      const err = new Error(`${key} must be a valid date.`);
      err.status = 400; err.code = 'ADMIN_INVALID_FILTER'; err.expose = true;
      throw err;
    }
  }
  return { ...req.query, limit, offset };
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || 500).json({
        error: {
          code: err.code || (err.status === 404 ? 'ADMIN_CUSTOMER_NOT_FOUND' : 'ADMIN_CUSTOMER_ERROR'),
          message: err.expose || err.status ? err.message : 'Internal error.',
        },
        requestId: req.id,
      });
    }
  };
}

export const getOverview = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerOverview(req.params.userId), requestId: req.id });
});

export const getServices = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerServices(req.params.userId, sectionQuery(req)), requestId: req.id });
});

export const getBilling = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerBilling(req.params.userId, sectionQuery(req)), requestId: req.id });
});

export const getSupport = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerSupport(req.params.userId, sectionQuery(req)), requestId: req.id });
});

export const getOperations = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerOperations(req.params.userId, sectionQuery(req)), requestId: req.id });
});

export const getActivity = wrap(async (req, res) => {
  res.json({ data: await oversight.getCustomerActivity(req.params.userId, sectionQuery(req)), requestId: req.id });
});
