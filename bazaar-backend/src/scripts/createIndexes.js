/**
 * BazaarBoost — Index Creation & Schema Verification Script
 *
 * Runs once against an existing MongoDB instance to:
 *  1. Create all explicit indexes defined in schema_integrity_rules.md §4
 *  2. Verify unique constraint indexes are present
 *  3. Report the final index state for all collections
 *
 * Usage:
 *   node src/scripts/createIndexes.js
 *
 * Safe to run repeatedly — MongoDB's createIndex() is idempotent.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';

// ─────────────────────────────────────────────────────────────────────────────
// Index definitions — mirrors §4.3 of schema_integrity_rules.md
// Format: { collection, key, options }
// ─────────────────────────────────────────────────────────────────────────────
const INDEX_PLAN = [
  // ── users ──────────────────────────────────────────────────────────────────
  {
    collection: 'users',
    key:        { email: 1 },
    options:    { unique: true, name: 'email_unique' },
    comment:    'Auth identity anchor — prevents duplicate logins',
  },
  {
    collection: 'users',
    key:        { role: 1 },
    options:    { name: 'role_btree' },
    comment:    'Admin panel: list all vendors/shoppers — prevents full scan',
  },

  // ── stores ─────────────────────────────────────────────────────────────────
  {
    collection: 'stores',
    key:        { slug: 1 },
    options:    { unique: true, name: 'slug_unique' },
    comment:    'Tenant routing key — duplicate slug = wrong store returned',
  },
  {
    collection: 'stores',
    key:        { vendorId: 1 },
    options:    { name: 'vendorId_btree' },
    comment:    'Called on every authenticated vendor request — must be O(log n)',
  },

  // ── products ───────────────────────────────────────────────────────────────
  {
    collection: 'products',
    key:        { storeId: 1, createdAt: -1 },
    options:    { name: 'storeId_createdAt_compound' },
    comment:    'Storefront: paginate products newest-first within a store',
  },
  {
    collection: 'products',
    key:        { vendorId: 1 },
    options:    { name: 'vendorId_btree' },
    comment:    'Vendor dashboard product list query',
  },
  {
    collection: 'products',
    key:        { aiTags: 1, price: 1 },
    options:    { name: 'aiTags_price_multikey' },
    comment:    'Marketplace: tag filter + price range sort (multikey on array field)',
  },

  // ── adslots ────────────────────────────────────────────────────────────────
  {
    collection: 'adslots',
    key:        { location: 1 },
    options:    { unique: true, name: 'location_unique' },
    comment:    'One physical slot per location — enum guard + DB unique',
  },

  // ── adbids ─────────────────────────────────────────────────────────────────
  {
    collection: 'adbids',
    key:        { vendorId: 1 },
    options:    { name: 'vendorId_btree' },
    comment:    'Vendor bid history page',
  },
  {
    collection: 'adbids',
    key:        { paymentStatus: 1, startDate: 1, endDate: 1 },
    options:    { name: 'status_dates_compound' },
    comment:    'Admin approval queue + active ad window lookup — high frequency',
  },
  {
    collection: 'adbids',
    key:        { vendorId: 1, slotId: 1, startDate: 1 },
    options:    { unique: true, name: 'vendor_slot_date_dedup' },
    comment:    'Prevents duplicate bids per slot per campaign start date',
  },

  // ── orders ─────────────────────────────────────────────────────────────────
  {
    collection: 'orders',
    key:        { shopperId: 1 },
    options:    { name: 'shopperId_btree' },
    comment:    'Shopper order history',
  },
  {
    collection: 'orders',
    key:        { storeId: 1, status: 1 },
    options:    { name: 'storeId_status_compound' },
    comment:    'Vendor order management filtered by state',
  },

  // ── messages ───────────────────────────────────────────────────────────────
  {
    collection: 'messages',
    key:        { shopperId: 1, vendorId: 1, createdAt: 1 },
    options:    { name: 'room_chronological_compound' },
    comment:    'Room-scoped chat history in chronological order',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Index Creation & Verification Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.connect(MONGO_URI);
  console.log(`✓ Connected to MongoDB: ${MONGO_URI}\n`);

  const db = mongoose.connection.db;

  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (const def of INDEX_PLAN) {
    const { collection, key, options, comment } = def;
    const col = db.collection(collection);

    try {
      await col.createIndex(key, options);
      const keyStr = JSON.stringify(key);
      console.log(`  ✅ [${collection}] ${options.name}`);
      console.log(`     Key: ${keyStr}`);
      console.log(`     ${comment}`);
      if (options.unique) console.log(`     ⚠  UNIQUE constraint enforced`);
      console.log();
      created++;
    } catch (err) {
      // Error code 85 = IndexOptionsConflict (index exists with different options)
      // Error code 86 = IndexKeySpecsConflict
      if (err.code === 85 || err.code === 86) {
        console.log(`  ⚡ [${collection}] ${options.name} — already exists, skipped`);
        skipped++;
      } else {
        console.error(`  ✗  [${collection}] ${options.name} — FAILED: ${err.message}`);
        failed++;
      }
    }
  }

  // ── Final index report ──────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Summary: ${created} created  |  ${skipped} already existed  |  ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Per-collection index listing ───────────────────────────────────────
  const collections = [...new Set(INDEX_PLAN.map(d => d.collection))];
  console.log(' Current indexes per collection:\n');

  for (const colName of collections) {
    const col = db.collection(colName);
    const indexes = await col.indexes();
    console.log(`  [${colName}]`);
    indexes.forEach(idx => {
      const unique  = idx.unique ? ' UNIQUE' : '';
      const keyStr  = JSON.stringify(idx.key);
      console.log(`    • ${(idx.name || '').padEnd(36)} ${keyStr}${unique}`);
    });
    console.log();
  }

  await mongoose.disconnect();
  console.log('✓ Disconnected. Index migration complete.\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error during index creation:', err.message);
  process.exit(1);
});
