/**
 * dbSetup.js
 * ─────────────────────────────────────────────────────────────
 * Manages MongoDB connection for the E2E test suite.
 *
 * Strategy: Instead of an in-memory server (which requires a
 * native binary download), we connect to the REAL MongoDB
 * instance but target a dedicated sandbox database declared in
 * the TEST_MONGO_URI env variable.
 *
 * Safety guardrail: throws immediately if NODE_ENV !== 'test'.
 * ─────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';
import dotenv   from 'dotenv';
import path     from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load .env.test first; fall back to .env
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Safety Guardrail ────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    '[SAFETY ABORT] NODE_ENV is not "test". ' +
    'Target database is not set to sandbox testing configuration. ' +
    'Refusing to run test suite against non-test environment.'
  );
}

const SANDBOX_URI =
  process.env.TEST_MONGO_URI ||
  process.env.MONGO_URI?.replace(/\/[^/]+(\?|$)/, '/bazarboost_test_sandbox$1') ||
  'mongodb://localhost:27017/bazarboost_test_sandbox';

/**
 * Connects to the isolated sandbox database.
 * Called in beforeAll().
 */
export async function connectTestDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(SANDBOX_URI, {
      dbName: 'bazarboost_test_sandbox',
    });
    console.log(
      `[TEST-DB] Connected to sandbox database: ${SANDBOX_URI.replace(/\/\/[^@]+@/, '//<credentials>@')}`
    );
  }
}

/**
 * Closes the Mongoose connection pool.
 * Called in afterAll().
 */
export async function disconnectTestDB() {
  await mongoose.connection.close();
  console.log('[TEST-DB] Mongoose connection pool severed cleanly.');
}
