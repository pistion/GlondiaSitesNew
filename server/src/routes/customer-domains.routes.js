import express from 'express';
import authMiddleware from '../middleware/authMiddleware.js';
import * as customerDomains from '../services/customerDomainService.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/provider-access', async (req, res, next) => {
  try {
    res.ok(await customerDomains.getCustomerDomainProviderAccess(req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/sync/domains', async (req, res, next) => {
  try {
    res.ok(await customerDomains.syncCustomerSpaceshipDomains(req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/sync/protection', async (req, res, next) => {
  try {
    res.ok(await customerDomains.syncCustomerCloudflareDomains(req.user));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.ok(await customerDomains.listCustomerDomains(req.user));
  } catch (error) {
    next(error);
  }
});

router.get('/:domainId', async (req, res, next) => {
  try {
    res.ok(await customerDomains.getCustomerDomain(req.user, req.params.domainId));
  } catch (error) {
    next(error);
  }
});

router.get('/:domainId/dns-records', async (req, res, next) => {
  try {
    res.ok(await customerDomains.listCustomerDomainDnsRecords(req.user, req.params.domainId));
  } catch (error) {
    next(error);
  }
});

router.get('/:domainId/settings', async (req, res, next) => {
  try {
    res.ok(await customerDomains.getCustomerDomainSettings(req.user, req.params.domainId));
  } catch (error) {
    next(error);
  }
});

router.post('/:domainId/addons/:addonId/activate', async (req, res, next) => {
  try {
    res.status(202).ok(await customerDomains.requestCustomerCloudflareAddon(
      req.user,
      req.params.domainId,
      req.params.addonId,
    ));
  } catch (error) {
    next(error);
  }
});

export default router;
