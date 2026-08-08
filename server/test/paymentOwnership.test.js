import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'file:./prisma/dev.db';
const { assertCheckoutOrderOwner } = await import('../src/services/payments-provider.service.js');

test('checkout ownership accepts only the purchasing user', () => {
  const order = { id: 'order-1', userId: 'user-a' };
  assert.equal(assertCheckoutOrderOwner(order, { id: 'user-a' }), order);
  assert.throws(
    () => assertCheckoutOrderOwner(order, { id: 'user-b' }),
    (error) => error.status === 404,
  );
});

test('checkout ownership rejects anonymous and local fallback identities', () => {
  const order = { id: 'order-1', userId: 'user-a' };
  assert.throws(() => assertCheckoutOrderOwner(order, {}), (error) => error.status === 404);
  assert.throws(() => assertCheckoutOrderOwner(order, { id: 'local-user' }), (error) => error.status === 404);
});
