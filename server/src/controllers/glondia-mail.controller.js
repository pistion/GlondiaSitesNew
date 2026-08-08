/**
 * glondia-mail.controller.js — HTTP layer for GlondiaMail webmail.
 */
import * as mailService from '../services/glondia-mail.service.js';

export async function login(req, res, next) {
  try {
    const data = await mailService.login(req.body || {});
    res.setHeader('Set-Cookie', `glondia_mail_session=${encodeURIComponent(data.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    const { token, ...publicData } = data;
    res.json({ data: publicData, requestId: req.id });
  } catch (err) {
    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message },
        requestId: req.id,
      });
    }
    if (err.status === 503) {
      return res.status(503).json({
        success: false,
        error: { code: err.code || 'GLONDIA_MAIL_NOT_CONFIGURED', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const data = await mailService.logout(req);
    res.setHeader('Set-Cookie', 'glondia_mail_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function session(req, res, next) {
  try {
    const data = await mailService.getSession(req);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function folders(req, res, next) {
  try {
    const data = await mailService.listFolders(req);
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function messages(req, res, next) {
  try {
    const data = await mailService.listMessages(req, req.query || {});
    res.json({ data, requestId: req.id });
  } catch (err) {
    next(err);
  }
}

export async function message(req, res, next) {
  try {
    const data = await mailService.getMessage(req, req.params.id);
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}

export async function updateMessage(req, res, next) {
  try {
    const data = await mailService.updateMessage(req, req.params.id, req.body || {});
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code || 'ERROR', message: err.message }, requestId: req.id });
    next(err);
  }
}

export async function moveMessage(req, res, next) {
  try {
    const data = await mailService.moveMessage(req, req.params.id, req.body || {});
    res.json({ data, requestId: req.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code || 'ERROR', message: err.message }, requestId: req.id });
    next(err);
  }
}

export async function attachment(req, res, next) {
  try {
    const item = await mailService.getAttachment(req, req.params.id, req.params.attachmentId);
    const filename = String(item.filename || 'attachment').replace(/[\r\n"]/g, '_');
    const contentType = item.contentType || 'application/octet-stream';
    const canPreview = contentType.startsWith('image/')
      || contentType.startsWith('text/')
      || contentType === 'application/pdf';
    const disposition = req.query.download === '1' || !canPreview ? 'attachment' : 'inline';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(item.content.length));
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(item.content);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}

export async function send(req, res, next) {
  try {
    const data = await mailService.sendMail(req, req.body || {});
    res.status(201).json({ data, requestId: req.id });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message },
        requestId: req.id,
      });
    }
    next(err);
  }
}
