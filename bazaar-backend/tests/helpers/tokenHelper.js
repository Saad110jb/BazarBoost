/**
 * tokenHelper.js
 * ─────────────────────────────────────────────────────────────
 * Mints short-lived JWTs for test identities so that
 * protect() middleware accepts them without hitting the DB
 * for AdminSession checks (which only apply to 'admin' role).
 * ─────────────────────────────────────────────────────────────
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

/**
 * Mint a signed JWT that matches the payload shape expected by auth.js
 * @param {object} overrides  — Partial user payload
 * @returns {string}          — Bearer-ready token string
 */
export function mintTestToken(overrides = {}) {
  const payload = {
    id:            overrides.id            || overrides._id?.toString() || 'test_user_id',
    role:          overrides.role          || 'shopper',
    tenantStores:  overrides.tenantStores  || [],
    activeStoreId: overrides.activeStoreId || null,
    ...overrides,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Returns the Authorization header object for supertest.
 * @param {string} token
 */
export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
