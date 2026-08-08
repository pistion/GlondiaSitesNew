/**
 * email.controller.js — HTTP layer for Dashboard Business Email.
 */
import * as emailService from '../services/email.service.js';

export async function getPlans(req, res, next) {
  try {
    const data = await emailService.listEmailPlans(req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function selectPlan(req, res, next) {
  try {
    const data = await emailService.selectEmailPlan(req.user?.id, req.body?.planId);
    res.status(201).json({ data, requestId: req.id });
  } catch (err) {
    if ([400, 409].includes(err.status)) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'VALIDATION_ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}

export async function getStatus(req, res, next) {
  try {
    const data = await emailService.getEmailStatus(req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function getCapacity(req, res, next) {
  try {
    const data = await emailService.getEmailMailboxCapacity(req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function listMailboxes(req, res, next) {
  try {
    const data = await emailService.listMailboxes(req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function getMailbox(req, res, next) {
  try {
    const data = await emailService.getMailbox(req.user?.id, req.params.mailboxId);
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: { code: err.code, message: err.message }, requestId: req.id });
    }
    next(err);
  }
}

export async function getMailboxUsage(req, res, next) {
  try {
    const data = await emailService.getMailboxUsage(req.user?.id, req.params.mailboxId);
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, error: { code: err.code, message: err.message }, requestId: req.id });
    }
    next(err);
  }
}

export async function changeMailboxPassword(req, res, next) {
  try {
    const data = await emailService.changeMailboxPassword(req.user?.id, req.params.mailboxId, req.body?.newPassword);
    res.json({ data, requestId: req.id });
  } catch (err) {
    if ([400, 404].includes(err.status)) {
      return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message }, requestId: req.id });
    }
    next(err);
  }
}

export async function requestMailbox(req, res, next) {
  try {
    const data = await emailService.createMailboxRequest(req.user?.id, req.body || {});
    res.status(201).json({ data, requestId: req.id });
  } catch (err) {
    if ([400, 409].includes(err.status)) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'VALIDATION_ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}

export async function getDns(req, res, next) {
  try {
    const data = await emailService.getEmailDns(req.params.domain, req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function checkDns(req, res, next) {
  try {
    const data = await emailService.checkEmailDns(req.params.domain, req.user?.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({
        success: false,
        error: { code: err.code || 'VALIDATION_ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}
