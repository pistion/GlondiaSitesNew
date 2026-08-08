import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-sufficient-entropy';
process.env.JWT_ISSUER = 'glondia-sites';
process.env.JWT_AUDIENCE = 'glondia-dashboard';

const { signAccessToken, verifyAccessToken } = await import('../src/services/authService.js');

test('access JWT has a unique session id and restricted identity claims', () => {
  const token = signAccessToken({ id: 'user-1', email: 'owner@example.com', role: 'owner', name: 'Owner' });
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.iss, 'glondia-sites');
  assert.equal(payload.aud, 'glondia-dashboard');
  assert.equal(typeof payload.jti, 'string');
  assert.ok(payload.jti.length > 20);
  assert.ok(payload.exp > payload.iat);
});

test('access JWT verification rejects tokens for another audience', () => {
  const token = jwt.sign(
    { sub: 'user-1' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'glondia-sites', audience: 'another-app', expiresIn: '5m' },
  );
  assert.throws(() => verifyAccessToken(token), /audience/i);
});
