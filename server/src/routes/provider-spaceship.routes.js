/**
 * provider-spaceship.routes.js
 *
 * Spaceship domain registrar routes.
 * Mounted as:
 *   app.use('/api/registrar', requireFeature('DOMAINS'), spaceshipRoutes)  // generic client path
 *   app.use('/api/spaceship', requireFeature('DOMAINS'), spaceshipRoutes)  // provider-specific alias
 */

import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import { providerApiGuard } from '../glondia-engines/01-HOSTING-DEPLOY-ENGINE/services/providerApiGuard.service.js';
import spaceshipController from '../controllers/provider-spaceship.controller.js';

const router = express.Router();

router.get('/settings', spaceshipController.getSettings);
router.post('/availability', providerApiGuard, spaceshipController.checkAvailability);
// Back-compat alias used by older clients.
router.post('/available', providerApiGuard, spaceshipController.checkAvailability);

router.get('/domains', authMiddleware, spaceshipController.listDomains);
router.get('/domains/:domain', authMiddleware, spaceshipController.getDomain);
router.post('/domains/:domain/register', authMiddleware, spaceshipController.registerDomain);
// Back-compat: POST /domains with body.hostname | body.domain
router.post('/domains', authMiddleware, spaceshipController.registerDomainFromBody);
router.post('/domains/:domain/renew', authMiddleware, spaceshipController.renewDomain);
router.put('/domains/:domain/nameservers', authMiddleware, spaceshipController.updateNameservers);
router.put('/domains/:domain/auto-renew', authMiddleware, spaceshipController.updateAutoRenew);
// Back-compat alias (no hyphen).
router.put('/domains/:domain/autorenew', authMiddleware, spaceshipController.updateAutoRenew);

router.put('/contacts', authMiddleware, spaceshipController.saveContact);
// Back-compat: older clients POST contacts.
router.post('/contacts', authMiddleware, spaceshipController.saveContact);
router.get('/contacts', authMiddleware, spaceshipController.listContacts);

router.get('/async-operations/:operationId', authMiddleware, spaceshipController.getOperation);
// Back-compat alias.
router.get('/operations/:operationId', authMiddleware, spaceshipController.getOperation);

router.get('/dns/:domain/records', authMiddleware, spaceshipController.listDnsRecords);
router.put('/dns/:domain/records', authMiddleware, spaceshipController.saveDnsRecords);
// Back-compat pull/push helpers used by the dashboard DNS tools.
router.post('/domains/:domain/dns/pull', authMiddleware, spaceshipController.pullDnsRecords);
router.post('/domains/:domain/dns/push', authMiddleware, spaceshipController.pushDnsRecords);

export default router;
