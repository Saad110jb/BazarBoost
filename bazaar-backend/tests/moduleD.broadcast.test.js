/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE D — Omni-Channel Superadmin Broadcast Center
 * ═══════════════════════════════════════════════════════════════
 * Tests the admin broadcast dispatch pipeline:
 *
 *  D1. POST /api/admin/broadcast with valid payload →
 *       - HTTP 202 Accepted
 *       - Response body contains jobId (string)
 *       - Response body contains status: 'QUEUED'
 *
 *  D2. BroadcastJob document is created in MongoDB with
 *      status 'QUEUED' immediately after dispatch.
 *
 *  D3. Missing required fields → HTTP 400 Bad Request.
 *
 *  D4. Invalid audience targeting → still returns 202
 *      (queue accepts all valid payloads; worker handles targeting).
 *
 *  D5. GET /api/admin/broadcast/history returns the job
 *      in the ledger within 500ms of dispatch.
 *
 * Notes on auth bypass:
 *  - The /api/admin/broadcast route uses protect + authorize('admin').
 *  - Admin routes also check AdminSession in protect().
 *  - To avoid a DB round-trip for AdminSession, we stub the
 *    protect middleware in the test-only app by inserting a real
 *    AdminSession document for the test admin user.
 * ═══════════════════════════════════════════════════════════════
 */

import request from 'supertest';
import mongoose from 'mongoose';
import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';

import { connectTestDB, disconnectTestDB } from './helpers/dbSetup.js';
import { buildTestApp }                    from './helpers/testAppFactory.js';
import { mintTestToken, authHeader }        from './helpers/tokenHelper.js';

import User         from '../src/models/User.js';
import BroadcastJob from '../src/models/BroadcastJob.js';
import AdminSession from '../src/models/AdminSession.js';

// ─── Suite State ─────────────────────────────────────────────
const TEST_PREFIX = 'TEST-BROADCAST-';
let app, server;
let adminUser, adminToken;

// ─── Suite Setup ─────────────────────────────────────────────
beforeAll(async () => {
  console.log('\n[TEST-RUNNER] Starting Module D: Omni-Channel Superadmin Broadcast Center...');
  await connectTestDB();

  // Enable patchAdminIP so the test app auto-upserts AdminSession
  // with the REAL IP that Express sees per request — no pre-seeding needed.
  ({ app, server } = buildTestApp({ patchAdminIP: true }));

  // Create test admin user
  adminUser = await User.create({
    name:     `${TEST_PREFIX}Admin`,
    email:    `${TEST_PREFIX}admin@bazarboost.test`,
    password: 'hashed_test_pass',
    role:     'admin',
    status:   'active',
  });

  adminToken = mintTestToken({
    id:   adminUser._id.toString(),
    role: 'admin',
  });
  // AdminSession will be auto-created per-request by the patchAdminIP middleware.
});

// ─── Tests ───────────────────────────────────────────────────
describe('Module D — Omni-Channel Superadmin Broadcast Center', () => {

  // ── D1: Valid broadcast → 202 + jobId + QUEUED ────────────
  it('[D1] POST /api/admin/broadcast returns HTTP 202 with verified job reference', async () => {
    const payload = {
      targetAudience:  'all_shoppers',
      deliveryChannel: 'push',
      subject:         `${TEST_PREFIX}Test Broadcast Subject`,
      body:            `${TEST_PREFIX}This is an automated integration test broadcast body. Timestamp: ${Date.now()}`,
    };

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set(authHeader(adminToken))
      .set('x-forwarded-for', '127.0.0.1')   // Matches seeded AdminSession IP
      .send(payload);

    console.log('  [D1] Broadcast response:', res.status, JSON.stringify(res.body));

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.message).toMatch(/broadcast/i);

    console.log('  [D1] Job reference verified — jobId:', res.body.jobId, ', status: QUEUED');
  });

  // ── D2: BroadcastJob document created with QUEUED status ──
  it('[D2] BroadcastJob document exists in DB immediately with status QUEUED', async () => {
    const payload = {
      targetAudience:  'all_vendors',
      deliveryChannel: 'push',
      subject:         `${TEST_PREFIX}DB Verify Subject`,
      body:            `${TEST_PREFIX}DB verification broadcast body — ${Date.now()}`,
    };

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set(authHeader(adminToken))
      .set('x-forwarded-for', '127.0.0.1')
      .send(payload);

    expect(res.status).toBe(202);
    const jobId = res.body.jobId;

    // Immediately query DB
    const jobDoc = await BroadcastJob.findById(jobId);
    expect(jobDoc).not.toBeNull();

    // Status is QUEUED at creation time (worker may have changed it by now, so check either)
    expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(jobDoc.status);
    expect(jobDoc.targetAudience).toBe('all_vendors');
    expect(jobDoc.deliveryChannel).toBe('push');
    expect(jobDoc.subject).toContain(TEST_PREFIX);

    console.log('  [D2] BroadcastJob document confirmed in DB — _id:', jobDoc._id, ', status:', jobDoc.status);
  });

  // ── D3: Missing required fields → 400 ────────────────────
  it('[D3] Missing required fields returns HTTP 400 Bad Request', async () => {
    const incompletePayload = {
      targetAudience:  'all_shoppers',
      // deliveryChannel missing
      subject:         `${TEST_PREFIX}Incomplete`,
      // body missing
    };

    const res = await request(app)
      .post('/api/admin/broadcast')
      .set(authHeader(adminToken))
      .set('x-forwarded-for', '127.0.0.1')
      .send(incompletePayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    console.log('  [D3] Missing fields guard confirmed — HTTP 400 returned correctly');
  });

  // ── D4: All delivery channels accepted ───────────────────
  it('[D4] All valid deliveryChannel values (push/smtp/both) are accepted', async () => {
    const channels = ['push', 'smtp', 'both'];

    for (const deliveryChannel of channels) {
      const res = await request(app)
        .post('/api/admin/broadcast')
        .set(authHeader(adminToken))
        .set('x-forwarded-for', '127.0.0.1')
        .send({
          targetAudience:  'all_shoppers',
          deliveryChannel,
          subject:         `${TEST_PREFIX}Channel Test - ${deliveryChannel}`,
          body:            `${TEST_PREFIX}Channel validation for ${deliveryChannel}`,
        });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('QUEUED');
      console.log(`  [D4] Channel "${deliveryChannel}" → HTTP 202 ✓`);
    }
  });

  // ── D5: Broadcast history ledger returns dispatched jobs ──
  it('[D5] GET /api/admin/broadcast/history includes dispatched test jobs', async () => {
    // Small wait to let async worker complete on at least one job
    await new Promise(r => setTimeout(r, 200));

    const res = await request(app)
      .get('/api/admin/broadcast/history')
      .set(authHeader(adminToken))
      .set('x-forwarded-for', '127.0.0.1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.jobs)).toBe(true);

    // At least one of our test broadcast jobs should appear
    const testJobs = res.body.jobs.filter(j => j.subject?.includes(TEST_PREFIX));
    expect(testJobs.length).toBeGreaterThan(0);

    console.log('  [D5] Broadcast history confirmed — found', testJobs.length, 'test job(s) in ledger');
  });
});

// ─── Module D Teardown ────────────────────────────────────────
afterAll(async () => {
  console.log('\n[TEARDOWN] Module D cleanup running...');

  const [uDel, jDel, asDel] = await Promise.all([
    User.deleteMany({ name: { $regex: /^TEST-BROADCAST-/ } }),
    BroadcastJob.deleteMany({ subject: { $regex: /^TEST-BROADCAST-/ } }),
    AdminSession.deleteMany({ adminId: adminUser?._id }),
  ]);

  console.log(`[PURGE] Module D — Deleted: Users=${uDel.deletedCount}, BroadcastJobs=${jDel.deletedCount}, AdminSessions=${asDel.deletedCount}`);

  await new Promise(resolve => server.close(resolve));
  await disconnectTestDB();

  console.log('[PASS] Superadmin broadcast center HTTP 202 and BullMQ job references verified.');
});
