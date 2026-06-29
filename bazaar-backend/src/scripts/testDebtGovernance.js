import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from '../models/Store.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import AdBid from '../models/AdBid.js';
import Order from '../models/Order.js';
import WalletTopup from '../models/WalletTopup.js';
import AdSlot from '../models/AdSlot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bazarboost';

async function runTests() {
  console.log('Connecting to database:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  let testVendor = null;
  let testShopper = null;
  let testStore = null;
  let testProduct = null;
  let testSlot = null;
  let testAd = null;
  let testOrder = null;

  try {
    // 1. Clean old test runs
    await User.deleteMany({ email: /test-debt-.*@bazaar\.com/ });
    await Store.deleteMany({ name: /Test Debt Store/ });
    await Product.deleteMany({ title: /Test Debt Product/ });
    await AdSlot.deleteMany({ name: /Test Slot/ });
    await AdBid.deleteMany({ referenceId: /TEST-DEBT-BID/ });
    await Order.deleteMany({ shippingAddress: 'Test Debt Address' });
    await WalletTopup.deleteMany({ referenceId: /BYPASS-ORD-/ });

    // 2. Seed Baseline Data
    console.log('[1/9] Seeding baseline vendor and store...');
    testVendor = await User.create({
      name: 'Test Vendor',
      email: 'test-debt-vendor@bazaar.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    testShopper = await User.create({
      name: 'Test Shopper',
      email: 'test-debt-shopper@bazaar.com',
      password: 'password123',
      role: 'shopper',
      status: 'active'
    });

    testStore = await Store.create({
      vendorId: testVendor._id,
      name: 'Test Debt Store',
      slug: 'test-debt-store',
      wallet: {
        balancePKR: 0,
        totalDepositedPKR: 0,
        totalSpentPKR: 0,
        outstandingCommission: 0,
        lastUpdated: new Date()
      },
      isActive: true,
      debtZone: 'active'
    });

    testProduct = await Product.create({
      storeId: testStore._id,
      vendorId: testVendor._id,
      title: 'Test Debt Product',
      description: 'Test product for debt matrix verification rules.',
      price: 1000,
      stock: 50,
      images: [{ url: '/uploads/stores/test-debt-product.png', isPrimary: true }]
    });

    testSlot = await AdSlot.create({
      name: 'Test Slot',
      location: 'homepage-hero',
      basePrice: 100,
      durationDays: 7,
      maxSimultaneousCampaigns: 5,
      isActive: true
    });

    testAd = await AdBid.create({
      slotId: testSlot._id,
      vendorId: testVendor._id,
      productId: testProduct._id,
      bidAmount: 1000,
      paymentReceiptUrl: '/uploads/receipts/test.png',
      referenceId: 'TEST-DEBT-BID-1',
      paymentStatus: 'approved',
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // active since yesterday
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000)   // expires tomorrow
    });

    console.log('Baseline seeding successful.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Orange Zone (Soft Debt Alert & Penalty Modifier)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[2/9] Transitioning store to Orange Zone (Rs. 5,000 outstanding)...');
    testStore.wallet.outstandingCommission = 5000;
    await testStore.save();

    console.log('Saved store. Verify state transition properties:');
    console.log('  isActive:', testStore.isActive);
    console.log('  debtZone:', testStore.debtZone);
    if (testStore.debtZone !== 'orange') throw new Error('Store should be in Orange zone!');
    if (!testStore.isActive) throw new Error('Store should remain active in Orange zone!');

    console.log('\n[3/9] Testing Ad Bidding Penalty Modifier (Orange Zone)...');
    // Call active ads filtering logic mock
    const activeAds = await AdBid.find({
      paymentStatus: 'approved',
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() }
    })
      .populate('slotId', 'location name')
      .populate({
        path: 'productId',
        populate: { path: 'storeId', select: 'name slug isActive debtZone' }
      });

    // Run active ads sorting logic from route
    let activePlain = activeAds.map(ad => ad.toObject());
    activePlain = activePlain.filter(ad => {
      const store = ad.productId?.storeId;
      if (!store) return false;
      if (store.isActive === false || store.debtZone === 'red') return false;
      if (store.debtZone === 'amber') return false;
      return true;
    });

    activePlain = activePlain.map(ad => {
      const store = ad.productId?.storeId;
      let effectiveBid = ad.bidAmount || 0;
      if (store && store.debtZone === 'orange') {
        effectiveBid = (ad.bidAmount || 0) * 0.5; // Modifier
      }
      return { ...ad, effectiveBid };
    });

    console.log('Active ads count after Orange filter:', activePlain.length);
    console.log('Ad campaign bidAmount:', activePlain[0].bidAmount);
    console.log('Ad campaign effectiveBid:', activePlain[0].effectiveBid);
    if (activePlain.length !== 1) throw new Error('Ad bid should be visible in Orange Zone!');
    if (activePlain[0].effectiveBid !== 500) throw new Error('Penalty modifier of 50% was not applied!');
    console.log('Orange Zone tests PASSED.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Amber Zone (Ad Freeze & Countdown)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[4/9] Transitioning store to Amber Zone (Rs. 15,000 outstanding)...');
    testStore.wallet.outstandingCommission = 15000;
    await testStore.save();

    console.log('Saved store. Verify state transition properties:');
    console.log('  isActive:', testStore.isActive);
    console.log('  debtZone:', testStore.debtZone);
    console.log('  amberCountdownStartedAt:', testStore.amberCountdownStartedAt);
    if (testStore.debtZone !== 'amber') throw new Error('Store should be in Amber zone!');
    if (!testStore.isActive) throw new Error('Store should remain active in Amber zone!');
    if (!testStore.amberCountdownStartedAt) throw new Error('Amber countdown clock was not initialized!');

    console.log('\n[5/9] Testing Ad Freeze (Amber Zone)...');
    let amberPlain = activeAds.map(ad => ad.toObject());
    // Refetch store in memory mock to simulate database updates
    const refreshedStore = await Store.findById(testStore._id);
    amberPlain.forEach(ad => {
      if (ad.productId?.storeId) {
        ad.productId.storeId = refreshedStore.toObject();
      }
    });

    // Run active ads filters
    amberPlain = amberPlain.filter(ad => {
      const store = ad.productId?.storeId;
      if (!store) return false;
      if (store.isActive === false || store.debtZone === 'red') return false;
      if (store.debtZone === 'amber') return false; // Paused
      return true;
    });

    console.log('Active ads count after Amber filter:', amberPlain.length);
    if (amberPlain.length !== 0) throw new Error('Ad campaign should be paused/frozen in Amber Zone!');
    console.log('Amber Zone tests PASSED.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Red Zone (Total Fleet Suspension)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[6/9] Transitioning store to Red Zone (Rs. 30,000 outstanding)...');
    testStore.wallet.outstandingCommission = 30000;
    await testStore.save();

    console.log('Saved store. Verify state transition properties:');
    console.log('  isActive:', testStore.isActive);
    console.log('  debtZone:', testStore.debtZone);
    console.log('  suspensionReason:', testStore.suspensionReason);
    if (testStore.debtZone !== 'red') throw new Error('Store should be in Red zone!');
    if (testStore.isActive !== false) throw new Error('Store should be suspended (isActive: false) in Red zone!');

    console.log('\n[7/9] Testing Red Zone Checkout Blocking...');
    // Create checkout mock check
    const checkoutBlocked = (!testStore.isActive || testStore.debtZone === 'red');
    console.log('Is checkout blocked for suspended store:', checkoutBlocked);
    if (!checkoutBlocked) throw new Error('Checkout should be blocked in Red Zone!');
    console.log('Red Zone Checkout Block test PASSED.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: In-flight Collection Debt Bypass
    // ─────────────────────────────────────────────────────────────────────────
    console.log('[8/9] Testing In-flight collections debt bypass...');
    // Seed an order
    testOrder = await Order.create({
      shopperId: testShopper._id,
      storeId: testStore._id,
      items: [{ productId: testProduct._id, quantity: 1, title: testProduct.title, price: testProduct.price }],
      totalAmount: 10000,
      shippingAddress: 'Test Debt Address',
      city: 'Faisalabad',
      deliveryType: 'in-city',
      status: 'delivered',
      platformCommission: 500,
      paymentMethod: 'cod'
    });

    // Simulate completion transition with debt bypass logic:
    const currentStatus = testOrder.status;
    const targetStatus = 'completed';

    if (currentStatus === 'delivered' && targetStatus === 'completed') {
      const commissionDue = 500;
      const storeDoc = await Store.findById(testOrder.storeId);
      if (storeDoc) {
        const currentBalance = storeDoc.wallet?.balancePKR || 0;
        let deductFromBalance = 0;
        let addToOutstanding = 0;

        if (currentBalance >= commissionDue) {
          deductFromBalance = commissionDue;
        } else {
          deductFromBalance = currentBalance;
          addToOutstanding = commissionDue - currentBalance;
        }

        storeDoc.wallet = storeDoc.wallet || {};
        
        // Red Zone check BEFORE updating
        const isRedZone = storeDoc.isActive === false || storeDoc.debtZone === 'red';

        storeDoc.wallet.balancePKR = storeDoc.wallet.balancePKR - deductFromBalance;
        storeDoc.wallet.outstandingCommission = (storeDoc.wallet.outstandingCommission || 0) + addToOutstanding;
        storeDoc.wallet.totalSpentPKR = (storeDoc.wallet.totalSpentPKR || 0) + deductFromBalance;

        if (isRedZone) {
          const outstanding = storeDoc.wallet.outstandingCommission || 0;
          const bypassAmount = Math.min(testOrder.totalAmount, outstanding);
          if (bypassAmount > 0) {
            storeDoc.wallet.outstandingCommission = outstanding - bypassAmount;
            console.log(`  [TEST SIMULATION] Bypassing Rs. ${bypassAmount} to pay down debt.`);
            
            // Create topup ledger
            await WalletTopup.create({
              vendorId: storeDoc.vendorId,
              storeId: storeDoc._id,
              amountPKR: bypassAmount,
              referenceId: `BYPASS-ORD-${testOrder._id.toString().substring(18).toUpperCase()}`,
              paymentReceiptUrl: '/uploads/receipts/sandbox.png',
              paymentStatus: 'approved',
              type: 'commission_payment',
              message: 'In-flight collection bypassed vendor to pay down debt'
            });
          }
        }
        await storeDoc.save();
      }
    }

    // Reload store
    const afterBypassStore = await Store.findById(testStore._id);
    console.log('Store outstanding commission after bypass completion:');
    console.log('  outstandingCommission:', afterBypassStore.wallet.outstandingCommission);
    console.log('  debtZone:', afterBypassStore.debtZone);
    console.log('  isActive:', afterBypassStore.isActive);

    if (afterBypassStore.wallet.outstandingCommission !== 20500) {
      throw new Error(`Expected outstanding commission to be Rs. 20,500, but got Rs. ${afterBypassStore.wallet.outstandingCommission}`);
    }
    if (afterBypassStore.debtZone !== 'amber') {
      throw new Error('Store should have transitioned back to Amber Zone!');
    }
    if (afterBypassStore.isActive !== true) {
      throw new Error('Store should have been reactivated (isActive: true) after dropping below Rs. 25,000!');
    }
    console.log('In-flight Collection Bypass tests PASSED.\n');

    console.log('ALL GOVERNANCE LIFECYCLE TESTS PASSED SUCCESSFULLY! 🎉');

  } catch (err) {
    console.error('❌ Test failed with error:', err.message);
    process.exit(1);
  } finally {
    // 9. Clean up test records
    console.log('\nCleaning up database seeded test records...');
    if (testVendor) await User.findByIdAndDelete(testVendor._id);
    if (testShopper) await User.findByIdAndDelete(testShopper._id);
    if (testStore) await Store.findByIdAndDelete(testStore._id);
    if (testProduct) await Product.findByIdAndDelete(testProduct._id);
    if (testSlot) await AdSlot.findByIdAndDelete(testSlot._id);
    if (testAd) await AdBid.findByIdAndDelete(testAd._id);
    if (testOrder) await Order.findByIdAndDelete(testOrder._id);
    await WalletTopup.deleteMany({ referenceId: /BYPASS-ORD-/ });
    console.log('Cleanup completed. Closing database connection.');
    await mongoose.disconnect();
  }
}

runTests();
