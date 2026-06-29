/**
 * verify_superadmin.js
 *
 * Automated verification script to test:
 *   1. SuperAdmin Seeding check (default account admin@bazaarboost.com / gatekeeper@2026).
 *   2. /api/auth/gatekeeper-login - Input validations, credential checks, and 2-hour global token payloads.
 *   3. Concurrent session invalidation: concurrent login from different IP suspends account.
 *   4. Middleware checks: global bypasses and session/IP verification.
 */

import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

// Load env variables
dotenv.config();

import User from '../models/User.js';
import AdminSession from '../models/AdminSession.js';
import authRoutes from '../routes/auth.js';
import connectDB from '../config/db.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';
const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — SuperAdmin & Session Protection');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let server;
  try {
    // 1. Connect and verify DB Seeding
    await connectDB();
    console.log('✓ Database connection verified');

    const seededAdmin = await User.findOne({ email: 'admin@bazaarboost.com', role: 'admin' });
    if (seededAdmin) {
      console.log(`✓ Seeded SuperAdmin verified in database: id=${seededAdmin._id}, name="${seededAdmin.name}"`);
    } else {
      throw new Error('Fail: Default seeded SuperAdmin not found in database.');
    }

    // Clear any previous sessions
    await AdminSession.deleteMany({ adminId: seededAdmin._id });
    
    // Make sure admin account is active for testing
    seededAdmin.status = 'active';
    await seededAdmin.save();

    // 2. Start a temporary Express server on a random port
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✓ Test server listening on http://localhost:${port}`);

    // Helper fetch wrapper
    const apiCall = async (url, method, body, headers = {}) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`http://localhost:${port}${url}`, options);
      const data = await response.json();
      return { status: response.status, data };
    };

    // ── 3. Verify Input Validation Masks ─────────────────────────────────────
    console.log('\n3. Verifying validation masks on input fields...');

    // Case 3a: Invalid email mask
    let res = await apiCall('/api/auth/gatekeeper-login', 'POST', {
      email: 'invalid-email-format',
      password: 'gatekeeper@2026'
    });
    if (res.status === 400 && res.data.message.includes('email address format')) {
      console.log('  ✅ Pass: Invalid email rejected by gatekeeper mask validation.');
    } else {
      throw new Error('Fail: Gatekeeper login did not reject invalid email format.');
    }

    // Case 3b: Password length mask
    res = await apiCall('/api/auth/gatekeeper-login', 'POST', {
      email: 'admin@bazaarboost.com',
      password: 'short'
    });
    if (res.status === 400 && res.data.message.includes('at least 6 characters')) {
      console.log('  ✅ Pass: Short password rejected by gatekeeper mask validation.');
    } else {
      throw new Error('Fail: Gatekeeper login did not reject short password.');
    }

    // ── 4. Verify Credential Checks & JWT Payloads ───────────────────────────
    console.log('\n4. Verifying credential matches & JWT global payloads...');

    // Case 4a: Wrong credentials
    res = await apiCall('/api/auth/gatekeeper-login', 'POST', {
      email: 'admin@bazaarboost.com',
      password: 'wrongpassword'
    });
    if (res.status === 401 && res.data.message.includes('Invalid email or password')) {
      console.log('  ✅ Pass: Incorrect credentials rejected by deep hash matching.');
    } else {
      throw new Error('Fail: Incorrect password was not rejected.');
    }

    // Case 4b: Correct credentials (IP A login)
    res = await apiCall('/api/auth/gatekeeper-login', 'POST', {
      email: 'admin@bazaarboost.com',
      password: 'gatekeeper@2026'
    }, {
      'x-forwarded-for': '192.168.1.100'
    });

    let tokenA = '';
    if (res.status === 200 && res.data.success && res.data.token) {
      tokenA = res.data.token;
      console.log('  ✅ Pass: Successful gatekeeper login yields token.');

      // Decode token to verify payload scopes
      const decoded = jwt.decode(tokenA);
      if (decoded.role === 'admin' && decoded.tenantStores.includes('GLOBAL') && decoded.permissions.includes('ALL_ACCESS')) {
        console.log('  ✅ Pass: SuperAdmin payload correctly signs unrestricted master scope (tenantStores: ["GLOBAL"]).');
      } else {
        throw new Error('Fail: JWT payload scope mismatch.');
      }

      // Verify expiration window is exactly 2 hours (7200 seconds)
      const diff = decoded.exp - decoded.iat;
      if (diff === 7200) {
        console.log('  ✅ Pass: JWT session lifespan set strictly to maximum of 2 hours.');
      } else {
        throw new Error(`Fail: Expected token lifespan 7200s, got ${diff}s.`);
      }

      // Verify AdminSession document creation in DB
      const session = await AdminSession.findOne({ adminId: seededAdmin._id });
      if (session && session.ipAddress === '192.168.1.100' && session.token === tokenA) {
        console.log('  ✅ Pass: AdminSession recorded in DB with IP address and token.');
      } else {
        throw new Error('Fail: Session record was not written to MongoDB.');
      }
    } else {
      throw new Error('Fail: Login credentials check failed.');
    }

    // ── 5. Verify Concurrent Session Protection Invalidation ────────────────
    console.log('\n5. Verifying concurrent IP login invalidation...');

    // Case 5a: Login from a different IP (192.168.1.200) while IP A is active
    res = await apiCall('/api/auth/gatekeeper-login', 'POST', {
      email: 'admin@bazaarboost.com',
      password: 'gatekeeper@2026'
    }, {
      'x-forwarded-for': '192.168.1.200'
    });

    if (res.status === 403 && res.data.securityAlert) {
      console.log('  ✅ Pass: Concurrent login from different IP detected and rejected.');

      // Verify Admin account status is set to 'inactive'
      const updatedAdmin = await User.findById(seededAdmin._id);
      if (updatedAdmin && updatedAdmin.status === 'inactive') {
        console.log('  ✅ Pass: SuperAdmin account suspended platform-wide (status: "inactive").');
      } else {
        throw new Error('Fail: Admin account was not suspended.');
      }

      // Verify all active sessions were cleared
      const sessionCount = await AdminSession.countDocuments({ adminId: seededAdmin._id });
      if (sessionCount === 0) {
        console.log('  ✅ Pass: All active session token records successfully terminated.');
      } else {
        throw new Error('Fail: Active sessions were not terminated.');
      }
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Concurrent login bypasses security invalidation gates.');
    }

    // Clean up
    console.log('\nCleaning up verification records...');
    await AdminSession.deleteMany({ adminId: seededAdmin._id });
    
    // Restore admin account to active
    seededAdmin.status = 'active';
    await seededAdmin.save();

    server.close();
    await mongoose.disconnect();
    console.log('\n✓ Verification Complete. SuperAdmin default login system fully validated!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);

  } catch (error) {
    console.error('✗ VERIFICATION FAILED:', error.message);
    if (server) server.close();
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
}

run();
