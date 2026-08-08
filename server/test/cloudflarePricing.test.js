import test from 'node:test';
import assert from 'node:assert/strict';

import { priceCloudflarePlan } from '../src/services/providerCloudflare.service.js';
import { calculateCloudflareAddonPrice } from '../src/services/customerDomainService.js';
import { buildSpaceshipNameserverChange } from '../src/services/providerSpaceship.service.js';

test('Cloudflare plans keep provider cost separate and apply 30 percent markup', () => {
  const result = priceCloudflarePlan({
    id: 'pro',
    name: 'Pro',
    price: 25,
    currency: 'USD',
    frequency: 'monthly',
  });

  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.providerPrice, 25);
  assert.equal(result.markupPercent, 30);
  assert.equal(result.markupAmount, 7.5);
  assert.equal(result.customerPrice, 32.5);
  assert.equal(result.pricingSource, 'cloudflare_api');
});

test('Cloudflare price calculations round currency amounts to cents', () => {
  const result = priceCloudflarePlan({ price: 4.99 }, 30);
  assert.equal(result.markupAmount, 1.5);
  assert.equal(result.customerPrice, 6.49);
});

test('Cloudflare free services remain provider-verified zero-cost records', () => {
  assert.deepEqual(calculateCloudflareAddonPrice({
    rate_plan: { id: 'free', providerPrice: 0, currency: 'USD' },
  }), {
    providerAmountCents: 0,
    markupPercent: 30,
    markupAmountCents: 0,
    amountCents: 0,
  });
});

test('Spaceship nameserver change uses an exact custom-provider payload', () => {
  assert.deepEqual(buildSpaceshipNameserverChange('Example.com', {
    provider: 'custom',
    hosts: [' ada.ns.cloudflare.com ', 'bob.ns.cloudflare.com'],
  }), {
    domain: 'example.com',
    payload: {
      provider: 'custom',
      hosts: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
    },
  });
});
