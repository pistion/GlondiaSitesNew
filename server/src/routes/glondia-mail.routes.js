/**
 * glondia-mail.routes.js — GlondiaMail webmail API.
 *
 * POST /login
 * POST /logout
 * GET  /session
 * GET  /folders
 * GET  /messages
 * GET  /messages/:id
 * POST /send
 *
 * Mounted at /api/v1/glondia-mail behind requireFeature('GLONDIA_MAIL').
 * Does not expose IMAP/SMTP secrets. Does not return fake inbox mail.
 */
import express from 'express';
import * as glondiaMailController from '../controllers/glondia-mail.controller.js';

const router = express.Router();

// Session/login are public to the mail app; auth is mailbox-based (server-side).
router.post('/login', glondiaMailController.login);
router.post('/logout', glondiaMailController.logout);
router.get('/session', glondiaMailController.session);
router.get('/folders', glondiaMailController.folders);
router.get('/messages', glondiaMailController.messages);
router.get('/messages/:id/attachments/:attachmentId', glondiaMailController.attachment);
router.get('/messages/:id', glondiaMailController.message);
router.patch('/messages/:id', glondiaMailController.updateMessage);
router.post('/messages/:id/move', glondiaMailController.moveMessage);
router.post('/send', glondiaMailController.send);

export default router;
