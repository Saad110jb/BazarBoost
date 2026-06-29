/**
 * verify_multivariant_ads.js
 *
 * Automated verification script to test:
 *   1. Submitting a campaign with multiple visual variants saves them correctly in MongoDB.
 *   2. Sequential balancing and global rotation works as expected in active ads retrieval.
 *   3. Tracking impressions and conversions increments the specific variant sub-document and updates the campaign total atomically.
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
  console.log(' BazaarBoost — Multi-Variant Ad Tracking Engine Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let server;
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // 1. Clean up old test data
    await User.deleteMany({ email: { $in: ['mads-vendor@test.com', 'mads-admin@test.com'] } });
    await AdminSession.deleteMany({});
    await Store.deleteMany({ slug: 'test-store-multivariant-ads' });
    await AdSlot.deleteMany({ location: 'multivariant-test-slot' });
    await AdBid.deleteMany({ referenceId: { $in: ['TXN_MADS_1'] } });

    console.log('✓ Database cleaned up of test data.');

    // 2. Create test records
    const vendor = await User.create({
      name: 'Mads Vendor',
      email: 'mads-vendor@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const store = await Store.create({
      vendorId: vendor._id,
      name: 'Multivariant Ads Test Store',
      slug: 'test-store-multivariant-ads',
      wallet: { balancePKR: 10000, totalDepositedPKR: 10000, totalSpentPKR: 0 },
      isActive: true
    });

    vendor.storeId = store._id;
    vendor.tenantStores = [store._id.toString()];
    await vendor.save();

    const admin = await User.create({
      name: 'Mads admin',
      email: 'mads-admin@test.com',
      password: 'password123',
      role: 'admin',
      status: 'active'
    });

    const product = await Product.create({
      storeId: store._id,
      vendorId: vendor._id,
      title: 'Multivariant Test Product',
      description: 'Product for testing multivariant ad placement campaigns.',
      price: 250,
      stock: 50,
      aiTags: ['testCategory']
    });

    let adSlot = await AdSlot.findOne({ location: 'homepage-hero' });
    if (adSlot) {
      adSlot.name = 'Multivariant Test Placement';
      adSlot.basePrice = 100;
      adSlot.durationDays = 7;
      adSlot.maxSimultaneousCampaigns = 5;
      adSlot.isActive = true;
      await adSlot.save();
    } else {
      adSlot = await AdSlot.create({
        name: 'Multivariant Test Placement',
        location: 'homepage-hero',
        basePrice: 100,
        durationDays: 7,
        maxSimultaneousCampaigns: 5,
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

    await AdminSession.create({
      adminId: admin._id,
      ipAddress: '127.0.0.1',
      token: tokenAdmin
    });

    // Mock receipt image file for upload
    const tempDir = './src/uploads/stores/' + store._id + '/receipts';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const receiptPath = path.join(tempDir, 'mock-receipt.png');
    const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    fs.writeFileSync(receiptPath, Buffer.from(validPngBase64, 'base64'));

    // Start Express server
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

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Submit ad campaign with multiple variants
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[TEST 1] Submitting bid with 3 visual variants...');
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const variantsPayload = [
      { variantId: 'variant_red', name: 'Red Banner', textHeader: 'Sizzling Red Offer!', bannerGraphic: 'https://example.com/red.jpg' },
      { variantId: 'variant_blue', name: 'Blue Banner', textHeader: 'Cool Blue Deals!', bannerGraphic: 'https://example.com/blue.jpg' },
      { variantId: 'variant_green', name: 'Green Banner', textHeader: 'Go Green Sale!', bannerGraphic: 'https://example.com/green.jpg' }
    ];

    let res = await apiCall('/api/ads/bid', 'POST', tokenVendor, {
      slotId: adSlot._id.toString(),
      productId: product._id.toString(),
      bidAmount: '150',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      referenceId: 'TXN_MADS_1',
      variants: JSON.stringify(variantsPayload)
    }, receiptPath);

    if (res.status !== 201 || !res.data.success) {
      throw new Error(`Fail: Could not submit bid. Status: ${res.status}, Message: ${res.data.message}`);
    }

    const createdBid = res.data.adBid;
    if (!createdBid.variants || createdBid.variants.length !== 3) {
      throw new Error(`Fail: Expected 3 visual variants, found: ${createdBid.variants?.length}`);
    }
    console.log('  ✓ Bid created with 3 nested variants saved correctly in MongoDB.');

    // Approve the campaign
    res = await apiCall(`/api/ads/bids/${createdBid._id}/status`, 'PUT', tokenAdmin, { status: 'approved' });
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not approve ad campaign. Status: ${res.status}`);
    }
    console.log('  ✓ Ad campaign approved.');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Verify active ad rotation (globalServeCount based round-robin)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[TEST 2] Verifying sequential global rotation of variants...');

    // Wait briefly to make sure dates are fully within start/end range
    res = await apiCall('/api/ads/active', 'GET', null);
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not fetch active ads. Status: ${res.status}`);
    }

    const activeList = res.data.ads['homepage-hero'];
    const activeAd = activeList.find(ad => ad._id === createdBid._id);
    if (!activeAd) {
      throw new Error('Fail: Campaign not found in active homepage-hero ads.');
    }

    // Call 1: check order is red, blue, green
    console.log(`  Rotation 1: First variant served is "${activeAd.variants[0].variantId}"`);
    if (activeAd.variants[0].variantId !== 'variant_red') {
      throw new Error(`Fail: First serving expected variant_red, got: ${activeAd.variants[0].variantId}`);
    }

    // Call 2: check order rotations
    // We wait 150ms to let background globalServeCount update trigger
    await new Promise(resolve => setTimeout(resolve, 150));

    res = await apiCall('/api/ads/active', 'GET', null);
    const activeAdRotated = res.data.ads['homepage-hero'].find(ad => ad._id === createdBid._id);
    console.log(`  Rotation 2: First variant served is "${activeAdRotated.variants[0].variantId}"`);
    if (activeAdRotated.variants[0].variantId !== 'variant_blue') {
      throw new Error(`Fail: Second serving expected variant_blue, got: ${activeAdRotated.variants[0].variantId}`);
    }

    // Call 3: check rotation again
    await new Promise(resolve => setTimeout(resolve, 150));

    res = await apiCall('/api/ads/active', 'GET', null);
    const activeAdRotated2 = res.data.ads['homepage-hero'].find(ad => ad._id === createdBid._id);
    console.log(`  Rotation 3: First variant served is "${activeAdRotated2.variants[0].variantId}"`);
    if (activeAdRotated2.variants[0].variantId !== 'variant_green') {
      throw new Error(`Fail: Third serving expected variant_green, got: ${activeAdRotated2.variants[0].variantId}`);
    }

    console.log('  ✓ Sequential round-robin rotation of variants works perfectly.');

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Tracking atomic impression and conversion updates
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n[TEST 3] Verifying atomic variant and campaign totals tracking...');

    // Record 1 impression for variant_blue
    res = await apiCall('/api/ads/track', 'POST', null, {
      bidId: createdBid._id,
      type: 'impression',
      variantId: 'variant_blue'
    });
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not dispatch impression tracking. Status: ${res.status}`);
    }
    console.log('  ✓ Dispatched 1 impression to "variant_blue".');

    // Record 1 conversion for variant_blue
    res = await apiCall('/api/ads/track', 'POST', null, {
      bidId: createdBid._id,
      type: 'conversion',
      variantId: 'variant_blue'
    });
    if (res.status !== 200 || !res.data.success) {
      throw new Error(`Fail: Could not dispatch conversion tracking. Status: ${res.status}`);
    }
    console.log('  ✓ Dispatched 1 conversion to "variant_blue".');

    // Fetch final campaign state from database to verify totals and individual sub-doc metrics
    const finalAd = await AdBid.findById(createdBid._id);
    console.log(`  Campaign Totals: Impressions = ${finalAd.impressions}, Conversions = ${finalAd.conversions}`);
    if (finalAd.impressions !== 1 || finalAd.conversions !== 1) {
      throw new Error(`Fail: Campaign totals incorrect. Expected (1, 1), got (${finalAd.impressions}, ${finalAd.conversions})`);
    }

    const blueVariant = finalAd.variants.find(v => v.variantId === 'variant_blue');
    const redVariant = finalAd.variants.find(v => v.variantId === 'variant_red');

    console.log(`  Variant "blue": Impressions = ${blueVariant.impressions}, Conversions = ${blueVariant.conversions}`);
    console.log(`  Variant "red": Impressions = ${redVariant.impressions}, Conversions = ${redVariant.conversions}`);

    if (blueVariant.impressions !== 1 || blueVariant.conversions !== 1) {
      throw new Error('Fail: Variant blue metrics did not increment.');
    }
    if (redVariant.impressions !== 0 || redVariant.conversions !== 0) {
      throw new Error('Fail: Variant red metrics mutated unexpectedly.');
    }

    console.log('  ✓ Atomic tracking is verified successfully for variant sub-documents and campaign totals.');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' 🎉 ALL TEST SUITE ASSERTIONS PASSED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.disconnect();
  }
}

run();
