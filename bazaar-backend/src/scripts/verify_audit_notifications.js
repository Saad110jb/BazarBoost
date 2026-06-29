/**
 * verify_audit_notifications.js
 * Smoke-test script to verify the Global Audit Trail & Push Notification system.
 * Run with: node src/scripts/verify_audit_notifications.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
dotenv.config();

// ── Mock global.io for socket emission testing ─────────────────────────────
const emitted = { audit: [], notification: [], breach: [] };
global.io = {
  to: (room) => ({
    emit: (event, payload) => {
      if (event === 'audit_log_entry')        emitted.audit.push({ room, payload });
      if (event === 'push_notification')      emitted.notification.push({ room, payload });
      if (event === 'security_breach_alert')  emitted.breach.push({ room, payload });
    }
  })
};

// ── Connect to DB ──────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';

const pass = (msg) => console.log(`  ✅ PASS: ${msg}`);
const fail = (msg) => { console.error(`  ❌ FAIL: ${msg}`); process.exit(1); };

async function run() {
  console.log('\n🔍 BazaarBoost Audit & Notification Verification\n' + '─'.repeat(50));

  await mongoose.connect(MONGO_URI);
  console.log('✔ MongoDB connected\n');

  // Dynamic imports after DB connection
  const { logActivity } = await import('../services/auditService.js');
  const { pushNotification } = await import('../services/notificationService.js');
  const AuditLog = (await import('../models/AuditLog.js')).default;
  const Notification = (await import('../models/Notification.js')).default;
  const User = (await import('../models/User.js')).default;

  // ── 1. Fetch a real user for test context ───────────────────────────────
  console.log('Test 1: AuditLog - platform scope write + Socket.IO emit');
  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) fail('No admin user found. Seed the database first.');

  const testLog = await logActivity(
    null,
    adminUser._id,
    adminUser.name,
    'TEST_AUDIT_RUN',
    'Verification script executed platform-scope audit log',
    { scope: 'platform', ipAddress: '127.0.0.1', targetModel: 'Verification' }
  );

  if (!testLog?._id) fail('logActivity did not create a DB record');
  pass('AuditLog DB record created');

  if (emitted.audit.length === 0) fail('audit_log_entry was NOT emitted on admin:audit room');
  if (emitted.audit[0].room !== 'admin:audit') fail('audit_log_entry was emitted to wrong room');
  pass('audit_log_entry emitted to admin:audit');

  if (emitted.audit[0].payload.scope !== 'platform') fail('Scope field not set to platform');
  pass('AuditLog scope is "platform"');

  // ── 2. Push Notification ────────────────────────────────────────────────
  console.log('\nTest 2: pushNotification - DB record + Socket.IO emit');
  const shopper = await User.findOne({ role: 'shopper' });
  if (!shopper) fail('No shopper user found. Register a test shopper first.');

  const notif = await pushNotification(
    shopper._id,
    'order_update',
    '📦 Order Being Packed',
    `Your order from Verification Store is being packed!`,
    { orderId: 'test-order-id', storeName: 'Verification Store' }
  );

  if (!notif?._id) fail('pushNotification did not create a DB record');
  pass('Notification DB record created');

  if (emitted.notification.length === 0) fail('push_notification was NOT emitted');
  const expectedRoom = `user:${shopper._id.toString()}`;
  if (emitted.notification[0].room !== expectedRoom) fail(`Expected room ${expectedRoom}, got ${emitted.notification[0].room}`);
  pass(`push_notification emitted to ${expectedRoom}`);

  // ── 3. Verify Notification TTL index is registered in schema ─────────────
  console.log('\nTest 3: Notification TTL index (schema registration)');
  const schemaPaths = Notification.schema.indexes();
  const ttlDef = schemaPaths.find(([fields, opts]) => fields.createdAt === 1 && opts.expireAfterSeconds);
  if (!ttlDef) fail('TTL index definition missing in Notification schema');
  pass(`TTL index registered: expireAfterSeconds=${ttlDef[1].expireAfterSeconds} (${ttlDef[1].expireAfterSeconds / 86400} days)`);

  // ── 4. AuditLog optional storeId ────────────────────────────────────────
  console.log('\nTest 4: AuditLog storeId is now optional');
  const globalLog = await AuditLog.findById(testLog._id);
  if (globalLog.storeId !== null && globalLog.storeId !== undefined) {
    fail(`Expected storeId=null for platform log, got: ${globalLog.storeId}`);
  }
  pass('storeId is null for platform-scope logs');

  // ── 5. AuditLog has new fields ──────────────────────────────────────────
  console.log('\nTest 5: AuditLog schema has scope/ipAddress/targetModel fields');
  if (globalLog.scope !== 'platform') fail(`Expected scope=platform, got: ${globalLog.scope}`);
  pass('scope field persisted correctly');
  if (globalLog.ipAddress !== '127.0.0.1') fail('ipAddress not persisted');
  pass('ipAddress field persisted correctly');

  // ── Cleanup test records ─────────────────────────────────────────────────
  await AuditLog.deleteOne({ _id: testLog._id });
  await Notification.deleteOne({ _id: notif._id });

  console.log('\n' + '─'.repeat(50));
  console.log('✅ All verification tests passed!\n');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Verification failed with error:', err.message);
  process.exit(1);
});
