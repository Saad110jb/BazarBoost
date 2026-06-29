/**
 * verify_ads_lifecycle.js
 *
 * Automated verification script to test:
 *   1. Exceeding the slot campaign limit blocks subsequent vendor bids.
 *   2. Terminating a campaign sets status to 'terminated' and hides the ad.
 *   3. Querying active ads auto-expires past bookings and removes them.
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
import AdSlot from '../models/AdSlot.js';
import AdBid from '../models/AdBid.js';
import Product from '../models/Product.js';
import AdminSession from '../models/AdminSession.js';
import adsRoutes from '../routes/ads.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';
const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

async function run() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BazaarBoost — Ad Placement & Lifecycle Overrides Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let server;
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // 1. Clean up old test data
    await User.deleteMany({ email: { $in: ['ads-vendor@test.com', 'ads-admin@test.com'] } });
    await AdminSession.deleteMany({});
    await Store.deleteMany({ slug: 'test-store-ads-lifecycle' });
    await AdSlot.deleteMany({ location: 'lifecycle-test-slot' });
    
    // Find homepage-hero slot to clean up any active bids on it to avoid test interference
    const heroSlot = await AdSlot.findOne({ location: 'homepage-hero' });
    if (heroSlot) {
      await AdBid.deleteMany({ slotId: heroSlot._id });
    }
    await AdBid.deleteMany({ referenceId: { $in: ['TXN_ADS_1', 'TXN_ADS_2', 'TXN_ADS_3', 'TXN_ADS_EXPIRED'] } });

    console.log('✓ Database cleaned up of ad test data.');

    // 2. Create test records
    const vendor = await User.create({
      name: 'Ads Vendor',
      email: 'ads-vendor@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const store = await Store.create({
      vendorId: vendor._id,
      name: 'Ads Test Store',
      slug: 'test-store-ads-lifecycle',
      wallet: { balancePKR: 10000, totalDepositedPKR: 10000, totalSpentPKR: 0 },
      isActive: true
    });

    vendor.storeId = store._id;
    vendor.tenantStores = [store._id.toString()];
    await vendor.save();

    const admin = await User.create({
      name: 'Ads admin',
      email: 'ads-admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active'
    });

    const product = await Product.create({
      storeId: store._id,
      vendorId: vendor._id,
      title: 'Ads Test Product',
      description: 'Product for testing ad placement campaigns.',
      price: 250,
      stock: 50
    });

    // Find or create a special test ad slot with limit = 2
    let adSlot = await AdSlot.findOne({ location: 'homepage-hero' });
    if (adSlot) {
      adSlot.name = 'Lifecycle Test Banner Placement';
      adSlot.basePrice = 100;
      adSlot.durationDays = 7;
      adSlot.maxSimultaneousCampaigns = 2;
      adSlot.isActive = true;
      await adSlot.save();
    } else {
      adSlot = await AdSlot.create({
        name: 'Lifecycle Test Banner Placement',
        location: 'homepage-hero',
        basePrice: 100,
        durationDays: 7,
        maxSimultaneousCampaigns: 2,
        isActive: true
      });
    }

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

    const tokenVendor = generateToken(vendor);
    const tokenAdmin = generateToken(admin);

    // Create session in database for admin authentication
    await AdminSession.create({
      adminId: admin._id,
      ipAddress: '127.0.0.1',
      token: tokenAdmin
    });

    // Mock dummy receipt image file for uploads
    const tempDir = './src/uploads/stores/' + store._id + '/receipts';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const receiptPath = path.join(tempDir, 'mock-receipt.png');
    const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    fs.writeFileSync(receiptPath, Buffer.from(validPngBase64, 'base64'));

    // 3. Start a temporary Express server
    const app = express();
    app.use(express.json());
    app.use('/api/ads', adsRoutes);

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
        // multipart/form-data uploader simulation
        const formData = new FormData();
        Object.entries(body).forEach(([k, v]) => formData.append(k, v));
        
        // Append actual Blob file
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

    // ── 4. Verify Limit Boundaries ─────────────────────────────────────────────
    console.log('\n4. Testing ad placement limit boundaries (maxSimultaneousCampaigns = 2)...');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    // Submit bid 1
    let res = await apiCall('/api/ads/bid', 'POST', tokenVendor, {
      slotId: adSlot._id.toString(),
      productId: product._id.toString(),
      bidAmount: '120',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      referenceId: 'TXN_ADS_1',
      textHeader: 'Bid 1 Header',
      bannerGraphic: 'https://example.com/banner1.jpg'
    }, receiptPath);

    if (res.status !== 201 || !res.data.success) {
      throw new Error(`Fail: Could not submit bid 1. Code: ${res.status}`);
    }
    const bid1 = res.data.adBid;
    console.log('  ✓ Bid 1 submitted successfully.');

    // Approve bid 1 to make it an active campaign
    res = await apiCall(`/api/ads/bids/${bid1._id}/status`, 'PUT', tokenAdmin, { status: 'approved' });
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not approve bid 1. Code: ${res.status}`);
    }
    console.log('  ✓ Bid 1 approved. Campaign 1 is now active.');

    const startDate2 = new Date(startDate.getTime() + 60000); // 1 minute later
    const endDate2 = new Date(endDate.getTime() + 60000);

    // Submit bid 2
    res = await apiCall('/api/ads/bid', 'POST', tokenVendor, {
      slotId: adSlot._id.toString(),
      productId: product._id.toString(),
      bidAmount: '130',
      startDate: startDate2.toISOString(),
      endDate: endDate2.toISOString(),
      referenceId: 'TXN_ADS_2',
      textHeader: 'Bid 2 Header',
      bannerGraphic: 'https://example.com/banner2.jpg'
    }, receiptPath);

    if (res.status !== 201 || !res.data.success) {
      throw new Error(`Fail: Could not submit bid 2. Code: ${res.status}`);
    }
    const bid2 = res.data.adBid;
    console.log('  ✓ Bid 2 submitted successfully.');

    // Approve bid 2 to make it active too
    res = await apiCall(`/api/ads/bids/${bid2._id}/status`, 'PUT', tokenAdmin, { status: 'approved' });
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not approve bid 2. Code: ${res.status}`);
    }
    console.log('  ✓ Bid 2 approved. Campaign 2 is now active.');

    const startDate3 = new Date(startDate.getTime() + 120000); // 2 minutes later
    const endDate3 = new Date(endDate.getTime() + 120000);

    // Submit bid 3 - should fail during submission because the limit of 2 active approved overlapping ads is reached
    res = await apiCall('/api/ads/bid', 'POST', tokenVendor, {
      slotId: adSlot._id.toString(),
      productId: product._id.toString(),
      bidAmount: '140',
      startDate: startDate3.toISOString(),
      endDate: endDate3.toISOString(),
      referenceId: 'TXN_ADS_3',
      textHeader: 'Bid 3 Header',
      bannerGraphic: 'https://example.com/banner3.jpg'
    }, receiptPath);

    if (res.status === 400 && !res.data.success) {
      console.log('  ✅ Pass: Bid 3 was correctly rejected. Message:', res.data.message);
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: Bid 3 was not blocked by campaign limit boundary.');
    }


    // ── 5. Verify Administrative Termination ──────────────────────────────────
    console.log('\n5. Testing administrative campaign termination overrides...');

    // Terminate campaign 1
    res = await apiCall(`/api/ads/bids/${bid1._id}/terminate`, 'PUT', tokenAdmin);
    if (res.status === 200 && res.data.success) {
      console.log('  ✓ Termination request successful.');
    } else {
      console.error('DEBUG:', res.status, res.data);
      throw new Error('Fail: Could not terminate campaign 1.');
    }

    // Verify campaign status in database
    const dbBid1 = await AdBid.findById(bid1._id);
    if (dbBid1.paymentStatus === 'terminated') {
      console.log('  ✅ Pass: Campaign status set to "terminated" in database.');
    } else {
      throw new Error(`Fail: Campaign status is "${dbBid1.paymentStatus}" instead of "terminated".`);
    }

    // Query active ads as shopper, terminated ad should not be in the list
    res = await apiCall('/api/ads/active', 'GET');
    if (res.status === 200 && res.data.success) {
      const activeHeroAds = res.data.ads['homepage-hero'] || [];
      const hasTerminated = activeHeroAds.some(ad => ad._id.toString() === bid1._id.toString());
      if (!hasTerminated) {
        console.log('  ✅ Pass: Terminated campaign pulled from shopper active rotation list.');
      } else {
        throw new Error('Fail: Terminated campaign is still visible in active rotation.');
      }
    } else {
      throw new Error('Fail: Failed to query active ads.');
    }


    // ── 6. Verify Temporal Auto-Expiration ────────────────────────────────────
    console.log('\n6. Testing dynamic temporal auto-expiration...');

    // Create a past campaign directly in database (approved, ended yesterday)
    const pastStart = new Date();
    pastStart.setDate(pastStart.getDate() - 5);
    const pastEnd = new Date();
    pastEnd.setDate(pastEnd.getDate() - 1);

    const expiredBid = await AdBid.create({
      slotId: adSlot._id,
      vendorId: vendor._id,
      productId: product._id,
      bidAmount: 110,
      referenceId: 'TXN_ADS_EXPIRED',
      paymentStatus: 'approved',
      startDate: pastStart,
      endDate: pastEnd,
      paymentReceiptUrl: '/uploads/stores/mock/receipts/expired.png'
    });
    console.log('  ✓ Past approved campaign created directly in database.');

    // Query active ads as shopper (triggers auto-expiration on the backend)
    res = await apiCall('/api/ads/active', 'GET');
    if (res.status !== 200 || !res.data.success) {
      throw new Error('Fail: Failed to fetch active ads.');
    }

    // Verify status in DB is now expired
    const dbExpiredBid = await AdBid.findById(expiredBid._id);
    if (dbExpiredBid.paymentStatus === 'expired') {
      console.log('  ✅ Pass: Outdated campaign automatically marked as "expired" in DB.');
    } else {
      throw new Error(`Fail: Outdated campaign has status "${dbExpiredBid.paymentStatus}" instead of "expired".`);
    }

    // Verify it is not in the active rotation
    const activeHeroAds = res.data.ads['homepage-hero'] || [];
    const hasExpired = activeHeroAds.some(ad => ad._id.toString() === expiredBid._id.toString());
    if (!hasExpired) {
      console.log('  ✅ Pass: Expired campaign was successfully excluded from active shopper view.');
    } else {
      throw new Error('Fail: Expired campaign is still showing in shopper active rotation.');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' 🎉 All Ad Lifecycle & Placements Verification Tests Passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ VERIFICATION TEST FAILED:', error.message);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

run();
