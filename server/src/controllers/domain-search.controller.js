/**
 * DomainSearchController
 * Public domain search and pricing.
 *
 * When FEATURE_DOMAINS is on and Spaceship is configured, availability is live.
 * When the provider is not configured, responses are explicit — never fake "available".
 */

import {
  checkSpaceshipAvailability,
  getSpaceshipSettings,
  cleanDomainName,
} from '../services/providerSpaceship.service.js';

const FALLBACK_PRICING = [
  { tld: '.com', price: 14.99, renewal: 16.99 },
  { tld: '.net', price: 11.99, renewal: 13.99 },
  { tld: '.org', price: 12.49, renewal: 14.49 },
  { tld: '.app', price: 16.99, renewal: 18.99 },
];

function notConfiguredPayload(message) {
  return {
    configured: false,
    provider: 'spaceship',
    message: message || 'Domain provider is not configured yet.',
    results: [],
  };
}

function providerErrorStatus(error) {
  const status = Number(error?.status || 502);
  if (status === 401 || status === 403) return 502;
  return status >= 400 && status < 600 ? status : 502;
}

const DomainSearchController = {
  searchAvailability: async (req, res) => {
    const raw = String(req.query.query || req.query.q || '').trim();
    if (!raw) {
      return res.error('VALIDATION_ERROR', 'A search query is required.', 400);
    }

    const settings = getSpaceshipSettings();
    if (!settings.configured) {
      return res.ok(notConfiguredPayload('Domain provider is not configured yet.'));
    }

    try {
      const base = raw.toLowerCase().replace(/[^a-z0-9-.]/g, '');
      const candidates = [];
      // If user typed a full domain, check it; also expand common TLDs from the label.
      try {
        if (base.includes('.')) candidates.push(cleanDomainName(base));
      } catch {
        /* ignore invalid full domain */
      }
      const label = base.split('.')[0].replace(/[^a-z0-9-]/g, '');
      if (label) {
        for (const row of FALLBACK_PRICING) {
          try {
            candidates.push(cleanDomainName(`${label}${row.tld}`));
          } catch {
            /* skip */
          }
        }
      }
      const unique = [...new Set(candidates)].slice(0, 20);
      if (!unique.length) {
        return res.error('VALIDATION_ERROR', 'Enter a valid domain name or label to search.', 400);
      }

      const availability = await checkSpaceshipAvailability(unique);
      const results = (availability.domains || []).map((item) => ({
        name: item.domain,
        available: Boolean(item.available),
        status: item.status,
        price: item.pricing?.amount != null ? Number(item.pricing.amount) / 100 : null,
        currency: item.pricing?.currency || 'USD',
      }));

      return res.ok({
        configured: true,
        provider: 'spaceship',
        results,
      });
    } catch (error) {
      return res.error(
        'PROVIDER_ERROR',
        error.message || 'Domain search failed.',
        providerErrorStatus(error),
        { configured: true, providerStatus: error.providerStatus || null }
      );
    }
  },

  getPricing: async (req, res) => {
    const settings = getSpaceshipSettings();
    if (!settings.configured) {
      return res.ok({
        configured: false,
        message: 'Domain provider is not configured yet.',
        pricing: [],
      });
    }
    // Public list prices are estimate/catalog only; live premium pricing comes from availability.
    return res.ok({
      configured: true,
      pricing: FALLBACK_PRICING,
      note: 'Final price is confirmed at checkout from the registrar.',
    });
  },

  getSuggestions: async (req, res) => {
    const settings = getSpaceshipSettings();
    if (!settings.configured) {
      return res.ok({
        configured: false,
        message: 'Domain provider is not configured yet.',
        suggestions: [],
      });
    }

    const query = String(req.query.query || req.query.q || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!query) {
      return res.ok({ configured: true, suggestions: [] });
    }

    const candidates = [`${query}-shop.com`, `get-${query}.com`, `${query}.app`, `${query}.store`];
    try {
      const availability = await checkSpaceshipAvailability(candidates);
      const suggestions = (availability.domains || [])
        .filter((item) => item.available)
        .map((item) => ({
          name: item.domain,
          available: true,
          price: item.pricing?.amount != null ? Number(item.pricing.amount) / 100 : null,
        }));
      return res.ok({ configured: true, suggestions });
    } catch (error) {
      return res.error(
        'PROVIDER_ERROR',
        error.message || 'Could not load suggestions.',
        providerErrorStatus(error),
        { configured: true, providerStatus: error.providerStatus || null }
      );
    }
  },
};

export default DomainSearchController;
