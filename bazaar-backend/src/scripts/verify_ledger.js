/**
 * verify_ledger.js
 *
 * Automated verification script to test:
 *   1. Daily GMV and commission aggregation correctly reflects order totals.
 *   2. Toggling visibility sets productVisibilityLimited successfully.
 *   3. Public product list filters out products from restricted stores.
 */

import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';


// Load env variables
dotenv.config();

import User from '../models/User.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import AdminSession from '../models/AdminSession.js';
import walletRoutes from '../routes/wallet.js';
import productRoutes from '../routes/products.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';
const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Ledger, Commission & Visibility Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let server;
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // 1. Clean up old test data
    await User.deleteMany({ email: { $in: ['ledger-vendor@test.com', 'ledger-admin@test.com'] } });
    await AdminSession.deleteMany({});
    await Store.deleteMany({ slug: { $in: ['test-store-ledger'] } });
    await Product.deleteMany({ title: { $in: ['Ledger Test Product'] } });
    await Order.deleteMany({ customNotes: 'Ledger Aggregation Verification Note' });

    console.log('✓ Database cleaned up of ledger test data.');

    // 2. Create test records
    const vendor = await User.create({
      name: 'Ledger Vendor',
      email: 'ledger-vendor@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const store = await Store.create({
      vendorId: vendor._id,
      name: 'Ledger Store',
      slug: 'test-store-ledger',
      wallet: { balancePKR: 1000, totalDepositedPKR: 1000, totalSpentPKR: 0, outstandingCommission: 0 },
      isActive: true,
      productVisibilityLimited: false
    });

    vendor.storeId = store._id;
    vendor.tenantStores = [store._id.toString()];
    await vendor.save();

    const admin = await User.create({
      name: 'Ledger Admin',
      email: 'ledger-admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active'
    });

    const product = await Product.create({
      storeId: store._id,
      vendorId: vendor._id,
      title: 'Ledger Test Product',
      description: 'Product for testing visibility limits.',
      price: 500,
      stock: 10
    });

    // Create a couple of orders for this store to test GMV & commission aggregation
    const order1 = await Order.create({
      shopperId: new mongoose.Types.ObjectId(),
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, price: 500, quantity: 1 }],
      totalAmount: 500,
      shippingAddress: '123 Test Street',
      city: 'Karachi',
      deliveryType: 'in-city',
      paymentMethod: 'cod',
      platformCommission: 25,
      customNotes: 'Ledger Aggregation Verification Note',
      status: 'completed',
      createdAt: new Date('2026-06-01T10:00:00.000Z') // Set specific past date
    });

    const order2 = await Order.create({
      shopperId: new mongoose.Types.ObjectId(),
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, price: 500, quantity: 2 }],
      totalAmount: 1000,
      shippingAddress: '456 Test Ave',
      city: 'Karachi',
      deliveryType: 'in-city',
      paymentMethod: 'cod',
      platformCommission: 50,
      customNotes: 'Ledger Aggregation Verification Note',
      status: 'completed',
      createdAt: new Date('2026-06-02T12:00:00.000Z') // Set specific past date
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

    const tokenAdmin = generateToken(admin);
    const tokenVendor = generateToken(vendor);

    // Create session in database for admin auth check
    await AdminSession.create({
      adminId: admin._id,
      ipAddress: '127.0.0.1',
      token: tokenAdmin
    });


    // 3. Start a temporary Express server
    const app = express();
    app.use(express.json());
    app.use('/api/wallet', walletRoutes);
    app.use('/api/products', productRoutes);

    server = app.listen(0);
    const port = server.address().port;
    console.log(`✓ Test server listening on http://localhost:${port}`);

    // Helper fetch wrapper
    const apiCall = async (url, method, token, body = null, filePath = null) => {
      const headers = {
        'Authorization': `Bearer ${token}`,
        'x-forwarded-for': '127.0.0.1'
      };
      
      let options = { method, headers };
      
      if (filePath) {
        const formData = new FormData();
        Object.entries(body).forEach(([k, v]) => formData.append(k, v));
        
        const fileContent = fs.readFileSync(filePath);
        const fileBlob = new Blob([fileContent], { type: 'image/png' });
        formData.append('receipt', fileBlob, 'receipt.png');
        
        options.body = formData;
      } else if (body) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`http://localhost:${port}${url}`, options);
      const data = await response.json();
      return { status: response.status, data };
    };


    // ── 4. Verify Daily GMV and Commission Aggregation ───────────────────────────
    console.log('\n4. Testing GET /api/wallet/ledger dailyRevenueMatrix...');
    let res = await apiCall('/api/wallet/ledger', 'GET', tokenAdmin);

    if (res.status === 200 && res.data.success) {
      const matrix = res.data.dailyRevenueMatrix;
      console.log('  Daily Revenue Matrix received:', JSON.stringify(matrix));

      // Assert matrix aggregates correctly
      const day1 = matrix.find(d => d.date === '2026-06-01');
      const day2 = matrix.find(d => d.date === '2026-06-02');

      if (!day1 || !day2) {
        throw new Error('Fail: Daily aggregation matrix is missing expected dates.');
      }
      if (day1.gmv !== 500 || day1.commission !== 25) {
        throw new Error(`Fail: Day 1 metrics mismatch. Expected GMV 500, Commission 25. Got: GMV ${day1.gmv}, Comm ${day1.commission}`);
      }
      if (day2.gmv !== 1000 || day2.commission !== 50) {
        throw new Error(`Fail: Day 2 metrics mismatch. Expected GMV 1000, Commission 50. Got: GMV ${day2.gmv}, Comm ${day2.commission}`);
      }
      console.log('  ✅ Pass: Daily GMV and commission aggregation correctly reflects order totals.');
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: GET /api/wallet/ledger failed.');
    }

    // ── 5. Verify Public Product visibility when Store is Active and Visible ─────
    console.log('\n5. Verifying product is visible when store is active and unrestricted...');
    res = await apiCall('/api/products', 'GET', null);
    if (res.status === 200 && res.data.success) {
      const prod = res.data.products.find(p => p._id.toString() === product._id.toString());
      if (prod) {
        console.log('  ✅ Pass: Product is visible when store is unrestricted.');
      } else {
        throw new Error('Fail: Product not found in public listings when store is unrestricted.');
      }
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: GET /api/products failed.');
    }

    // ── 6. Verify Toggling visibility Sets productVisibilityLimited Successfully ──
    console.log('\n6. Toggling productVisibilityLimited on the store via PUT endpoint...');
    res = await apiCall(`/api/wallet/stores/${store._id}/visibility`, 'PUT', tokenAdmin, {
      productVisibilityLimited: true
    });

    if (res.status === 200 && res.data.success && res.data.store.productVisibilityLimited === true) {
      console.log('  ✅ Pass: Store productVisibilityLimited updated to true successfully.');
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: Store product visibility toggle PUT failed.');
    }

    // ── 7. Verify Product is Hidden when productVisibilityLimited is True ─────────
    console.log('\n7. Verifying product is filtered out of public listings when visibility is limited...');
    res = await apiCall('/api/products', 'GET', null);
    if (res.status === 200 && res.data.success) {
      const prod = res.data.products.find(p => p._id.toString() === product._id.toString());
      if (!prod) {
        console.log('  ✅ Pass: Product is hidden from public list when store visibility is limited.');
      } else {
        throw new Error('Fail: Product is still visible in public listings when store visibility is limited!');
      }
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: GET /api/products failed.');
    }

    // ── 8. Verify Restore Visibility toggles it back and Product becomes visible again ──
    console.log('\n8. Restoring store visibility to verify product becomes visible again...');
    res = await apiCall(`/api/wallet/stores/${store._id}/visibility`, 'PUT', tokenAdmin, {
      productVisibilityLimited: false
    });

    if (res.status === 200 && res.data.success && res.data.store.productVisibilityLimited === false) {
      console.log('  ✓ Store visibility limit restored to false.');
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: Store product visibility toggle back failed.');
    }

    res = await apiCall('/api/products', 'GET', null);
    if (res.status === 200 && res.data.success) {
      const prod = res.data.products.find(p => p._id.toString() === product._id.toString());
      if (prod) {
        console.log('  ✅ Pass: Product is visible again after restoring visibility.');
      } else {
        throw new Error('Fail: Product failed to appear again after restoring visibility.');
      }
    }
    // ── 9. Verify direct wallet-to-commission payment settlement ─────────────
    console.log('\n9. Testing direct wallet balance to commission settlement...');
    await Store.findByIdAndUpdate(store._id, {
      $set: { 'wallet.outstandingCommission': 200, 'wallet.balancePKR': 1000 }
    });

    res = await apiCall('/api/wallet/pay-commission', 'POST', tokenVendor, {
      amountPKR: 150
    });

    if (res.status === 200 && res.data.success) {
      const updatedStore = await Store.findById(store._id);
      if (updatedStore.wallet.balancePKR === 850 && updatedStore.wallet.outstandingCommission === 50) {
        console.log('  ✅ Pass: Direct wallet-to-commission payment deducted balance and cleared debt correctly.');
      } else {
        throw new Error(`Fail: Balance or Outstanding Commission mismatch. Balance: ${updatedStore.wallet.balancePKR}, Debt: ${updatedStore.wallet.outstandingCommission}`);
      }
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: POST /api/wallet/pay-commission request failed.');
    }

    // ── 10. Verify manual bank receipt uploader for commission payment ─────────
    console.log('\n10. Testing manual bank transfer receipt for outstanding commission settlement...');
    
    // Create temporary receipts directory
    const tempDir = './src/uploads/stores/' + store._id + '/receipts';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const receiptPath = path.join(tempDir, 'mock-receipt.png');
    const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    fs.writeFileSync(receiptPath, Buffer.from(validPngBase64, 'base64'));

    // Submit commission payment receipt of Rs. 200 (Debt is Rs. 50, so Rs. 150 should spill over into wallet balance)
    res = await apiCall('/api/wallet/topup', 'POST', tokenVendor, {
      amountPKR: '200',
      referenceId: 'TXN_COMM_123',
      type: 'commission_payment'
    }, receiptPath);

    if (res.status === 201 && res.data.success && res.data.topup.type === 'commission_payment') {
      const topupId = res.data.topup._id;
      console.log('  ✓ Commission payment request submitted successfully.');

      // Admin approves the request
      let approveRes = await apiCall(`/api/wallet/topups/${topupId}/status`, 'PUT', tokenAdmin, {
        status: 'approved'
      });

      if (approveRes.status === 200 && approveRes.data.success && approveRes.data.topup.paymentStatus === 'approved') {
        const finalStore = await Store.findById(store._id);
        // Debt was 50, payment was 200. Outstanding should be 0. Balance should be 850 + 150 = 1000. Deposited should be 1000 + 200 = 1200.
        if (finalStore.wallet.outstandingCommission === 0 && finalStore.wallet.balancePKR === 1000 && finalStore.wallet.totalDepositedPKR === 1200) {
          console.log('  ✅ Pass: Commission payment approved. Debt fully cleared and surplus PKR 150 credited to wallet balance.');
        } else {
          throw new Error(`Fail: Mismatch in final wallet values. Debt: ${finalStore.wallet.outstandingCommission}, Balance: ${finalStore.wallet.balancePKR}, Deposited: ${finalStore.wallet.totalDepositedPKR}`);
        }
      } else {
        console.error('DEBUG:', approveRes.status, approveRes.data);
        throw new Error('Fail: Approving commission top-up failed.');
      }
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: Submitting commission top-up request failed.');
    }

    // Clean up temporary receipt file
    if (fs.existsSync(receiptPath)) {
      fs.unlinkSync(receiptPath);
    }

    // Clean up database of created records
    await User.deleteMany({ email: { $in: ['ledger-vendor@test.com', 'ledger-admin@test.com'] } });
    await AdminSession.deleteMany({});
    await Store.deleteMany({ _id: store._id });
    await Product.deleteMany({ _id: product._id });
    await Order.deleteMany({ customNotes: 'Ledger Aggregation Verification Note' });
    console.log('\n✓ Cleaned up database of test data.');

    console.log('\n✓ Verification Complete. All ledger aggregation and visibility toggle rules validated!');
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('✗ VERIFICATION FAILED:', error.message);
    if (server) server.close();
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
