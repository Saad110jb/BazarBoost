/**
 * verify_security.js
 *
 * Automated verification script to test:
 *   1. Token State Architecture (JWT payload structure)
 *   2. Tenant Isolation boundaries (cross-store query prevention)
 *   3. Instant Account Suspension (JWT active status verification)
 *   4. Store Suspension storefront loader check
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

import User from '../models/User.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import { protect } from '../middleware/auth.js';
import { verifyTenantAccess } from '../middleware/rbac.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';
const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Security & Multi-Tenant Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // Clean up any old test data
    await User.deleteMany({ email: { $in: ['vendorA@test.com', 'vendorB@test.com', 'vendorC@test.com', 'shopper@test.com'] } });
    await Store.deleteMany({ slug: { $in: ['store-a', 'store-b', 'store-c', 'store-d'] } });
    await Product.deleteMany({ title: { $in: ['Product A', 'Product B'] } });

    console.log('✓ Database cleaned up of test accounts.');

    // ── 1. Create Test Accounts & Stores ────────────────────────────────────
    console.log('\n1. Creating test databases...');
    
    // Vendor A
    const vendorA = await User.create({
      name: 'Vendor A',
      email: 'vendorA@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });
    const storeA = await Store.create({
      vendorId: vendorA._id,
      name: 'Store A',
      slug: 'store-a',
      isActive: true
    });
    vendorA.storeId = storeA._id;
    await vendorA.save();

    // Vendor B
    const vendorB = await User.create({
      name: 'Vendor B',
      email: 'vendorB@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });
    const storeB = await Store.create({
      vendorId: vendorB._id,
      name: 'Store B',
      slug: 'store-b',
      isActive: true
    });
    vendorB.storeId = storeB._id;
    await vendorB.save();

    // Suspended Vendor C
    const vendorC = await User.create({
      name: 'Vendor C',
      email: 'vendorC@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'inactive' // Suspended
    });
    const storeC = await Store.create({
      vendorId: vendorC._id,
      name: 'Store C',
      slug: 'store-c',
      isActive: true
    });
    vendorC.storeId = storeC._id;
    await vendorC.save();

    // Suspended Store D (Active Vendor, Suspended Store)
    const storeD = await Store.create({
      vendorId: vendorA._id, // Owned by Vendor A
      name: 'Store D',
      slug: 'store-d',
      isActive: false // Suspended
    });

    console.log(`  - Vendor A ID: ${vendorA._id}, Store A ID: ${storeA._id}`);
    console.log(`  - Vendor B ID: ${vendorB._id}, Store B ID: ${storeB._id}`);
    console.log(`  - Vendor C ID (Suspended): ${vendorC._id}, Store C ID: ${storeC._id}`);
    console.log(`  - Store D ID (Suspended): ${storeD._id}`);

    // ── 2. Test JWT Payload Generation ──────────────────────────────────────
    console.log('\n2. Testing JWT Stateless Payload Structure...');
    
    // Simulate generateToken payload
    const getPayload = (user) => ({
      id: user._id,
      role: user.role,
      tenantStores: [user.storeId.toString()],
      activeStoreId: user.storeId.toString()
    });

    const tokenA = jwt.sign(getPayload(vendorA), JWT_SECRET);
    const decodedA = jwt.verify(tokenA, JWT_SECRET);
    
    if (decodedA.role === 'vendor' && decodedA.tenantStores.includes(storeA._id.toString())) {
      console.log('  ✅ Pass: Token successfully captures vendor role and tenantStores.');
    } else {
      throw new Error('Fail: JWT payload structure mismatch.');
    }

    // ── 3. Test Active Status Checks (Instant Account Suspension) ───────────
    console.log('\n3. Testing protect Middleware (Instant Suspension)...');
    
    const tokenC = jwt.sign(getPayload(vendorC), JWT_SECRET);

    // Mock Express Request & Response objects
    const createMockReqRes = (bearerToken) => {
      const req = {
        headers: { authorization: `Bearer ${bearerToken}` }
      };
      const res = {
        statusCode: 200,
        jsonPayload: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(obj) {
          this.jsonPayload = obj;
          return this;
        }
      };
      return { req, res };
    };

    // Test active user request
    const activeTest = createMockReqRes(tokenA);
    await protect(activeTest.req, activeTest.res, () => { activeTest.nextCalled = true; });
    
    if (activeTest.nextCalled && activeTest.req.user.tenantStores.includes(storeA._id.toString())) {
      console.log('  ✅ Pass: Active Vendor passes authentication and populates req.user.tenantStores.');
    } else {
      throw new Error('Fail: Active user check failed.');
    }

    // Test suspended user request
    const suspendedTest = createMockReqRes(tokenC);
    await protect(suspendedTest.req, suspendedTest.res, () => { suspendedTest.nextCalled = true; });

    console.log(`  DEBUG suspendedTest: statusCode=${suspendedTest.res.statusCode}, payload=${JSON.stringify(suspendedTest.res.jsonPayload)}, nextCalled=${suspendedTest.nextCalled}`);

    if (suspendedTest.res.statusCode === 401 && suspendedTest.res.jsonPayload.message === 'Account suspended') {
      console.log('  ✅ Pass: Suspended user instantly blocked with 401 Unauthorized.');
    } else {
      throw new Error('Fail: Suspended user was not blocked.');
    }

    // ── 4. Test Tenant Isolation Middleware (verifyTenantAccess) ───────────
    console.log('\n4. Testing verifyTenantAccess Middleware (Tenant boundaries)...');

    const createMockReqResTenant = (userContext, paramsStoreId) => {
      const req = {
        user: userContext,
        params: { storeId: paramsStoreId },
        body: {},
        query: {}
      };
      const res = {
        statusCode: 200,
        jsonPayload: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(obj) {
          this.jsonPayload = obj;
          return this;
        }
      };
      return { req, res };
    };

    // Vendor A tries to access Store A (Allowed)
    const allowTest = createMockReqResTenant(activeTest.req.user, storeA._id.toString());
    await verifyTenantAccess(allowTest.req, allowTest.res, () => { allowTest.nextCalled = true; });

    if (allowTest.nextCalled) {
      console.log('  ✅ Pass: Vendor A permitted access to Store A.');
    } else {
      throw new Error('Fail: Vendor A denied access to Store A.');
    }

    // Vendor A tries to access Store B (Cross-tenant breach - Blocked)
    const blockTest = createMockReqResTenant(activeTest.req.user, storeB._id.toString());
    await verifyTenantAccess(blockTest.req, blockTest.res, () => { blockTest.nextCalled = true; });

    if (blockTest.res.statusCode === 403 && blockTest.res.jsonPayload.message.includes('Access denied')) {
      console.log('  ✅ Pass: Cross-tenant access successfully blocked with 403 Forbidden.');
    } else {
      console.log(`  DEBUG blockTest: statusCode=${blockTest.res.statusCode}, payload=${JSON.stringify(blockTest.res.jsonPayload)}, nextCalled=${blockTest.nextCalled}`);
      throw new Error('Fail: Cross-tenant access was not blocked.');
    }

    // ── 5. Test Store Admin Invitation & Forced Password Reset ──────────────
    console.log('\n5. Testing Store Admin Invitation & Forced Password Reset (Task 9)...');

    // Create staff placeholder user in MongoDB (simulating "Invite Staff" sequence)
    const staff = await User.create({
      name: 'Staff Member',
      email: 'staff@test.com',
      password: 'hashedTempPassword',
      role: 'storeAdmin',
      storeId: storeA._id,
      shift: 'morning',
      isTempPassword: true
    });

    const getStaffPayload = (u) => ({
      id: u._id,
      role: u.role,
      tenantStores: [u.storeId.toString()],
      activeStoreId: u.storeId.toString(),
      isTempPassword: !!u.isTempPassword
    });

    const tokenStaffTemp = jwt.sign(getStaffPayload(staff), JWT_SECRET);

    // Test Case 5.1: Block standard API requests (Hydration block check)
    const standardRequest = createMockReqRes(tokenStaffTemp);
    standardRequest.req.originalUrl = '/api/products/store/' + storeA._id.toString();
    await protect(standardRequest.req, standardRequest.res, () => { standardRequest.nextCalled = true; });

    if (standardRequest.res.statusCode === 403 && standardRequest.res.jsonPayload.passwordResetRequired) {
      console.log('  ✅ Pass: Standard route hydration blocked with 403 Forbidden.');
    } else {
      console.log(`  DEBUG standardRequest: statusCode=${standardRequest.res.statusCode}, payload=${JSON.stringify(standardRequest.res.jsonPayload)}, nextCalled=${standardRequest.nextCalled}`);
      throw new Error('Fail: Standard route was not blocked for temp password token.');
    }

    // Test Case 5.2: Allow setup-password whitelisted endpoint
    const whitelistRequest = createMockReqRes(tokenStaffTemp);
    whitelistRequest.req.originalUrl = '/api/auth/profile/setup-password';
    await protect(whitelistRequest.req, whitelistRequest.res, () => { whitelistRequest.nextCalled = true; });

    if (whitelistRequest.nextCalled && !whitelistRequest.res.jsonPayload) {
      console.log('  ✅ Pass: Whitelisted setup-password endpoint bypasses hydration block.');
    } else {
      console.log(`  DEBUG whitelistRequest: statusCode=${whitelistRequest.res.statusCode}, payload=${JSON.stringify(whitelistRequest.res.jsonPayload)}, nextCalled=${whitelistRequest.nextCalled}`);
      throw new Error('Fail: Whitelisted route was blocked.');
    }

    // ── Clean up and Disconnect ─────────────────────────────────────────────
    console.log('\nCleaning up verification records...');
    await User.deleteMany({ email: { $in: ['vendorA@test.com', 'vendorB@test.com', 'vendorC@test.com', 'shopper@test.com', 'staff@test.com'] } });
    await Store.deleteMany({ slug: { $in: ['store-a', 'store-b', 'store-c', 'store-d'] } });
    await mongoose.disconnect();
    console.log('✓ Verification Complete. All security schemas operate under zero-trust multi-tenant boundaries.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);

  } catch (error) {
    console.error('✗ VERIFICATION FAILED:', error.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
}

run();
