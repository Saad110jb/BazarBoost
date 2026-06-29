/**
 * ═══════════════════════════════════════════════════════════════
 *  GLOBAL TEARDOWN — Post-Test Database Sandbox Purge Engine
 * ═══════════════════════════════════════════════════════════════
 * Executed automatically by Jest after ALL test suites complete.
 *
 * This script:
 *  1. Connects to the sandbox DB (same URI as the tests)
 *  2. Sweeps all collections for TEST-prefixed documents
 *  3. Reports deletion counts per collection
 *  4. Closes the connection cleanly
 *
 * Collections targeted:
 *   - users
 *   - stores
 *   - orders
 *   - loyaltyledgercaches
 *   - broadcastjobs
 *   - chatsessions
 *   - messages
 *   - vendorloans
 *   - adminsessions
 *   - notifications
 *   - complaintickets  (dispute_claims equivalent)
 * ═══════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import dotenv   from 'dotenv';
import path     from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Safety guard
if (process.env.NODE_ENV !== 'test') {
  throw new Error('[SAFETY ABORT] Global teardown refused: NODE_ENV is not "test".');
}

const SANDBOX_URI =
  process.env.TEST_MONGO_URI ||
  process.env.MONGO_URI?.replace(/\/[^/]+(\?|$)/, '/bazarboost_test_sandbox$1') ||
  'mongodb://localhost:27017/bazarboost_test_sandbox';

export default async function globalTeardown() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('[TEARDOWN] Test session completed. Executing full sandbox purge routine...');
  console.log('══════════════════════════════════════════════════════════');

  let conn;
  try {
    conn = await mongoose.createConnection(SANDBOX_URI, {
      dbName: 'bazarboost_test_sandbox',
    }).asPromise();

    const db = conn.db;

    // ── Sweep pattern: all TEST-prefixed document markers ────
    const TEST_PATTERNS = [
      /^TEST-LOYALTY-/,
      /^TEST-ROOM-/,
      /^TEST-LOAN-/,
      /^TEST-BROADCAST-/,
    ];

    const nameRegex = TEST_PATTERNS.map(p => p.source).join('|');
    const nameFilter = { $regex: nameRegex };

    // Per-collection targeted purge operations
    const results = await Promise.allSettled([
      // Users (all test roles)
      db.collection('users').deleteMany({ name: nameFilter }),

      // Stores
      db.collection('stores').deleteMany({ name: nameFilter }),

      // Orders — join via storeId is complex; sweep by shopperId/storeId
      // We use a broader approach: delete any order created during test session
      // identified by the TEST-prefix items title
      db.collection('orders').deleteMany({
        'items.title': { $regex: nameRegex }
      }),

      // Loyalty ledger caches — orphaned after user purge
      db.collection('loyaltyledgercaches').deleteMany({}),
      // (All ledger caches in sandbox DB are test artifacts)

      // Broadcast jobs with TEST- prefix in subject
      db.collection('broadcastjobs').deleteMany({
        subject: nameFilter
      }),

      // Chat sessions — any sessions in sandbox are test data
      db.collection('chatsessions').deleteMany({}),

      // Messages — any messages in sandbox are test data
      db.collection('messages').deleteMany({}),

      // Vendor loans — any loans in sandbox are test data
      db.collection('vendorloans').deleteMany({}),

      // Admin sessions — test admin sessions
      db.collection('adminsessions').deleteMany({}),

      // Notifications — test notifications
      db.collection('notifications').deleteMany({}),

      // Complaint tickets (dispute_claims)
      db.collection('complaintickets').deleteMany({}),

      // Purge ledger entries from test runs
      db.collection('purgeledgers').deleteMany({}),
    ]);

    // ── Report deletion counts ────────────────────────────────
    const collectionNames = [
      'users', 'stores', 'orders', 'loyaltyledgercaches', 'broadcastjobs',
      'chatsessions', 'messages', 'vendorloans', 'adminsessions',
      'notifications', 'complaintickets', 'purgeledgers',
    ];

    let totalDeleted = 0;
    results.forEach((result, idx) => {
      const collName = collectionNames[idx];
      if (result.status === 'fulfilled') {
        const count = result.value?.deletedCount || 0;
        totalDeleted += count;
        if (count > 0) {
          console.log(`  [PURGE] Collection "${collName}": ${count} document(s) removed`);
        }
      } else {
        console.warn(`  [PURGE-WARN] Collection "${collName}" purge failed:`, result.reason?.message);
      }
    });

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`[PURGE-COMPLETE] Deleted ${totalDeleted} cached test items from database layers. Memory lines cleared cleanly.`);
    console.log('══════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('[PURGE-ERROR] Global teardown encountered an error:', err.message);
  } finally {
    if (conn) {
      await conn.close();
      console.log('[TEARDOWN] Sandbox MongoDB connection closed cleanly.');
    }
  }
}
