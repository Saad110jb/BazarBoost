/**
 * verify_order_tracking.js
 *
 * Automated verification script to test:
 *   1. GET /api/orders/:id - Single order retrieval, populated fields, and tenant isolation boundaries.
 *   2. PUT /api/orders/:id/status - Kanban state transitions, fulfillment details validation (In-City vs. Out-of-City), and Socket.IO emission.
 */

import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load env variables
dotenv.config();

import User from '../models/User.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import AdminSession from '../models/AdminSession.js';
import orderRoutes from '../routes/orders.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';
const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Order Tracking & Sockets Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let server;
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // 1. Clean up old test data
    await User.deleteMany({ email: { $in: ['test-shopper@test.com', 'test-vendorA@test.com', 'test-vendorB@test.com', 'test-admin@test.com'] } });
    await AdminSession.deleteMany({});
    await Store.deleteMany({ slug: { $in: ['test-store-a', 'test-store-b'] } });
    await Product.deleteMany({ title: { $in: ['Test Product 1', 'Test Product 2'] } });
    await Order.deleteMany({ city: 'Test City' });

    console.log('✓ Database cleaned up of test data.');

    // 2. Create Test Accounts, Stores, and Products
    console.log('\nCreating mock data...');

    // Shopper
    const shopper = await User.create({
      name: 'Test Shopper',
      email: 'test-shopper@test.com',
      password: 'password123',
      role: 'shopper',
      status: 'active'
    });

    // Vendor A
    const vendorA = await User.create({
      name: 'Test Vendor A',
      email: 'test-vendorA@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });
    const storeA = await Store.create({
      vendorId: vendorA._id,
      name: 'Test Store A',
      slug: 'test-store-a',
      isActive: true,
      originCity: 'Lahore',
      theme: { primaryColor: '#7c3aed' },
      bankDetails: { bankName: 'Test Bank', accountNumber: '12345678' }
    });
    vendorA.storeId = storeA._id;
    vendorA.tenantStores = [storeA._id.toString()];
    await vendorA.save();

    // Vendor B
    const vendorB = await User.create({
      name: 'Test Vendor B',
      email: 'test-vendorB@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });
    const storeB = await Store.create({
      vendorId: vendorB._id,
      name: 'Test Store B',
      slug: 'test-store-b',
      isActive: true,
      originCity: 'Karachi',
      theme: { primaryColor: '#3b82f6' }
    });
    vendorB.storeId = storeB._id;
    vendorB.tenantStores = [storeB._id.toString()];
    await vendorB.save();

    // Super Admin
    const superAdmin = await User.create({
      name: 'Test Super Admin',
      email: 'test-admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active'
    });

    // Products
    const productA = await Product.create({
      storeId: storeA._id,
      vendorId: vendorA._id,
      title: 'Test Product 1',
      description: 'Test description',
      price: 1200,
      stock: 20
    });

    // Generate JWT tokens
    const generateToken = (user) => {
      const payload = {
        id: user._id,
        role: user.role,
        tenantStores: user.role === 'vendor' ? [user.storeId.toString()] : [],
        activeStoreId: user.role === 'vendor' ? user.storeId.toString() : undefined
      };
      return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    };

    const tokenShopper = generateToken(shopper);
    const tokenVendorA = generateToken(vendorA);
    const tokenVendorB = generateToken(vendorB);
    const tokenAdmin = generateToken(superAdmin);

    // Create session in database for admin authentication
    await AdminSession.create({
      adminId: superAdmin._id,
      ipAddress: '127.0.0.1',
      token: tokenAdmin
    });

    // Create Test Orders
    // 1. In-city order (Store A)
    const orderInCity = await Order.create({
      shopperId: shopper._id,
      storeId: storeA._id,
      items: [{ productId: productA._id, title: productA.title, quantity: 2, price: productA.price }],
      totalAmount: 2460, // 2400 + 60 shipping
      shippingAddress: 'House 1, Street 2, Colony X',
      city: 'Lahore',
      deliveryType: 'in-city',
      deliverySLA: '24-48 Hours',
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingPremium: 60
    });

    // 2. Out-of-city order (Store A)
    const orderOutOfCity = await Order.create({
      shopperId: shopper._id,
      storeId: storeA._id,
      items: [{ productId: productA._id, title: productA.title, quantity: 1, price: productA.price }],
      totalAmount: 1520, // 1200 + 320 shipping (250 base + 50 qty*1 + 20 tracking)
      shippingAddress: 'House 3, Sector Y',
      city: 'Karachi',
      deliveryType: 'out-of-city',
      deliverySLA: '3-5 operational business days',
      status: 'processing',
      paymentMethod: 'bank_transfer',
      referenceId: 'TXN12345ABC',
      shippingPremium: 320
    });

    console.log(`  - Shopper ID: ${shopper._id}`);
    console.log(`  - Vendor A ID: ${vendorA._id}, Store A ID: ${storeA._id}`);
    console.log(`  - Vendor B ID: ${vendorB._id}, Store B ID: ${storeB._id}`);
    console.log(`  - In-City Order ID: ${orderInCity._id}`);
    console.log(`  - Out-of-City Order ID: ${orderOutOfCity._id}`);

    // Mock global.io
    const ioEmits = [];
    global.io = {
      to: (room) => {
        return {
          emit: (event, data) => {
            ioEmits.push({ room, event, data });
            console.log(`  [Mock Socket] Broadcast emitted: event="${event}" room="${room}" data=`, data);
          }
        };
      }
    };

    // 3. Start a temporary Express server on a random free port
    console.log('\nStarting temporary Express test server...');
    const app = express();
    app.use(express.json());
    
    // Register order routes
    app.use('/api/orders', orderRoutes);

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✓ Test server listening on http://localhost:${port}`);

    // Helper fetch wrapper
    const apiCall = async (url, method, token, body = null) => {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-forwarded-for': '127.0.0.1'
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`http://localhost:${port}${url}`, options);
      const data = await response.json();
      return { status: response.status, data };
    };

    // ── 4. Verify Single Order Retrieval (GET /api/orders/:id) ──────────────
    console.log('\n4. Verifying GET /api/orders/:id (Tenant Bounds)...');

    // Shopper retrieving own order (Allowed)
    let res = await apiCall(`/api/orders/${orderInCity._id}`, 'GET', tokenShopper);
    if (res.status === 200 && res.data.success && res.data.order.shopperId.name === 'Test Shopper' && res.data.order.storeId.name === 'Test Store A') {
      console.log('  ✅ Pass: Authorized Shopper retrieves own order with populated details.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Shopper failed to retrieve own order.');
    }

    // Vendor A retrieving order from Store A (Allowed)
    res = await apiCall(`/api/orders/${orderInCity._id}`, 'GET', tokenVendorA);
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ Pass: Vendor A retrieves order belonging to Store A.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Vendor A denied access to Store A order.');
    }

    // Super Admin retrieving order (Allowed)
    res = await apiCall(`/api/orders/${orderInCity._id}`, 'GET', tokenAdmin);
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ Pass: Super Admin retrieves order.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Super Admin denied access to order.');
    }

    // Vendor B retrieving order from Store A (Cross-tenant breach - Blocked)
    res = await apiCall(`/api/orders/${orderInCity._id}`, 'GET', tokenVendorB);
    if (res.status === 403 && !res.data.success) {
      console.log('  ✅ Pass: Cross-tenant access successfully blocked with 403 Forbidden.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Cross-tenant access was not blocked.');
    }

    // Attempting to retrieve non-existent order
    res = await apiCall(`/api/orders/${new mongoose.Types.ObjectId()}`, 'GET', tokenShopper);
    if (res.status === 404 && !res.data.success) {
      console.log('  ✅ Pass: Querying non-existent ID correctly returns 404 Not Found.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Non-existent order did not return 404.');
    }

    // Shopper retrieving all own orders (Allowed)
    res = await apiCall(`/api/orders`, 'GET', tokenShopper);
    if (res.status === 200 && res.data.success && res.data.count === 2) {
      console.log('  ✅ Pass: Authorized Shopper retrieves all own orders list.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Shopper failed to retrieve own orders list.');
    }

    // ── 5. Verify Status Transitions (PUT /api/orders/:id/status) ───────────
    console.log('\n5. Verifying PUT /api/orders/:id/status (Kanban & Sockets)...');

    // Case 5a: In-City transition to 'processing' without driver details (Fails validation)
    res = await apiCall(`/api/orders/${orderInCity._id}/status`, 'PUT', tokenVendorA, {
      status: 'processing'
    });
    if (res.status === 400 && res.data.message.includes('driver name and driver contact')) {
      console.log('  ✅ Pass: In-City processing transition rejected without driver details.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: In-City processing did not enforce driver details.');
    }

    // Case 5b: In-City transition to 'processing' with driver details (Succeeds)
    ioEmits.length = 0; // Clear emit log
    res = await apiCall(`/api/orders/${orderInCity._id}/status`, 'PUT', tokenVendorA, {
      status: 'processing',
      driverName: 'Ali Khan',
      driverContact: '03001234567'
    });
    if (res.status === 200 && res.data.success && res.data.order.status === 'processing' && res.data.order.driverName === 'Ali Khan') {
      console.log('  ✅ Pass: In-City processing transition succeeds with driver details.');
      
      // Verify socket broadcast
      const hasSocketBroadcast = ioEmits.some(emit => 
        emit.room === `order:${orderInCity._id}` && 
        emit.event === 'order_status_update' && 
        emit.data.status === 'processing' &&
        emit.data.driverName === 'Ali Khan'
      );
      if (hasSocketBroadcast) {
        console.log('  ✅ Pass: Real-time Socket broadcast emitted on status update.');
      } else {
        throw new Error('Fail: Socket broadcast was not emitted.');
      }
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: In-City processing transition failed.');
    }

    // Case 5c: Out-of-City transition to 'dispatched' without courier details (Fails validation)
    res = await apiCall(`/api/orders/${orderOutOfCity._id}/status`, 'PUT', tokenVendorA, {
      status: 'dispatched'
    });
    if (res.status === 400 && res.data.message.includes('courier name (e.g. TCS, Leopards, Trax) and a tracking ID')) {
      console.log('  ✅ Pass: Out-of-City dispatch rejected without courier/tracking details.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Out-of-City dispatch did not enforce courier details.');
    }

    // Case 5d: Out-of-City transition with non-alphanumeric tracking ID (Fails validation)
    res = await apiCall(`/api/orders/${orderOutOfCity._id}/status`, 'PUT', tokenVendorA, {
      status: 'dispatched',
      courierName: 'TCS',
      trackingId: 'TRACK-1234-SP'
    });
    if (res.status === 400 && res.data.message.includes('alphanumeric string')) {
      console.log('  ✅ Pass: Out-of-City dispatch rejected with non-alphanumeric tracking ID.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Out-of-City dispatch did not reject non-alphanumeric tracking ID.');
    }

    // Case 5e: Out-of-City transition with valid details (Succeeds)
    res = await apiCall(`/api/orders/${orderOutOfCity._id}/status`, 'PUT', tokenVendorA, {
      status: 'dispatched',
      courierName: 'TCS',
      trackingId: 'TCS78945612'
    });
    if (res.status === 200 && res.data.success && res.data.order.status === 'dispatched' && res.data.order.trackingId === 'TCS78945612') {
      console.log('  ✅ Pass: Out-of-City dispatch succeeds with valid courier & alphanumeric tracking ID.');
    } else {
      console.error(`  DEBUG: status=${res.status}, data=`, res.data);
      throw new Error('Fail: Out-of-City dispatch transition failed.');
    }

    // ── Clean up and Disconnect ─────────────────────────────────────────────
    console.log('\nCleaning up verification records...');
    await User.deleteMany({ email: { $in: ['test-shopper@test.com', 'test-vendorA@test.com', 'test-vendorB@test.com', 'test-admin@test.com'] } });
    await Store.deleteMany({ slug: { $in: ['test-store-a', 'test-store-b'] } });
    await Product.deleteMany({ title: { $in: ['Test Product 1', 'Test Product 2'] } });
    await Order.deleteMany({ city: 'Test City' });

    server.close();
    await mongoose.disconnect();
    console.log('\n✓ Verification Complete. All Order Tracking and Socket endpoints operate successfully!');
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
