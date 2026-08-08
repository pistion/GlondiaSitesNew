/**
 * provider-spaceship.controller.js
 *
 * Thin HTTP wrappers around providerSpaceship.service.js.
 */

import * as spaceshipService from '../services/providerSpaceship.service.js';

function rawProviderAccountAllowed(req) {
  return req.user?.role === 'admin';
}

function assertRawProviderAccountAllowed(req) {
  if (rawProviderAccountAllowed(req)) return;
  const error = new Error('Raw provider account access is disabled. Use Glondia customer service routes.');
  error.status = 404;
  error.expose = true;
  throw error;
}

async function getSettings(req, res, next) {
  try {
    res.json(spaceshipService.getSpaceshipSettings());
  } catch (error) {
    next(error);
  }
}

async function checkAvailability(req, res, next) {
  try {
    res.json(await spaceshipService.checkSpaceshipAvailability(req.body?.domains || []));
  } catch (error) {
    next(error);
  }
}

async function listDomains(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.listSpaceshipDomains(req.query));
  } catch (error) {
    next(error);
  }
}

async function getDomain(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.getSpaceshipDomain(req.params.domain));
  } catch (error) {
    next(error);
  }
}

async function registerDomain(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.registerSpaceshipDomain(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

/** POST /domains — body carries hostname/domain for older clients. */
async function registerDomainFromBody(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    const domain = req.body?.hostname || req.body?.domain || req.body?.name;
    res.json(await spaceshipService.registerSpaceshipDomain(domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function renewDomain(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.renewSpaceshipDomain(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function updateNameservers(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.updateSpaceshipNameservers(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function updateAutoRenew(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.updateSpaceshipAutoRenew(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function saveContact(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.saveSpaceshipContact(req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function listContacts(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json({ items: [], total: 0, message: 'Spaceship contact listing is not exposed by this integration yet.' });
  } catch (error) {
    next(error);
  }
}

async function getOperation(req, res, next) {
  try {
    res.json(await spaceshipService.getSpaceshipOperation(req.params.operationId));
  } catch (error) {
    next(error);
  }
}

async function listDnsRecords(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.listSpaceshipDnsRecords(req.params.domain, req.query));
  } catch (error) {
    next(error);
  }
}

async function saveDnsRecords(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    res.json(await spaceshipService.saveSpaceshipDnsRecords(req.params.domain, req.body || {}));
  } catch (error) {
    next(error);
  }
}

/** Pull DNS from provider (alias of list). */
async function pullDnsRecords(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    const data = await spaceshipService.listSpaceshipDnsRecords(req.params.domain, req.query);
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : data?.records || []);
    res.json({ domain: req.params.domain, pulled: items.length, records: items, ...((data && typeof data === 'object' && !Array.isArray(data)) ? {} : {}) });
  } catch (error) {
    next(error);
  }
}

/** Push DNS to provider — body.records preferred; otherwise empty overwrite is rejected. */
async function pushDnsRecords(req, res, next) {
  try {
    assertRawProviderAccountAllowed(req);
    const body = req.body || {};
    if (!Array.isArray(body.records) && !Array.isArray(body.items)) {
      const error = new Error('Provide records to push (body.records). Use GET/PUT /dns/:domain/records for full DNS management.');
      error.status = 400;
      error.expose = true;
      throw error;
    }
    res.json(await spaceshipService.saveSpaceshipDnsRecords(req.params.domain, body));
  } catch (error) {
    next(error);
  }
}

export default {
  getSettings,
  checkAvailability,
  listDomains,
  getDomain,
  registerDomain,
  registerDomainFromBody,
  renewDomain,
  updateNameservers,
  updateAutoRenew,
  saveContact,
  listContacts,
  getOperation,
  listDnsRecords,
  saveDnsRecords,
  pullDnsRecords,
  pushDnsRecords,
};
