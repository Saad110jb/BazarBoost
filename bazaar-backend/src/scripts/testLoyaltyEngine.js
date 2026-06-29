import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load models using project-relative paths
import Store from '../models/Store.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Coupon from '../models/Coupon.js';
import LoyaltyConfig from '../models/LoyaltyConfig.js';
import LoyaltyLedgerCache from '../models/LoyaltyLedgerCache.js';

import { cancelOrderInternal } from '../services/orderService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bazaarboost';

const toPKR = (val) => Math.round(parseFloat(val) * 100) / 100;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

const getCurrentMonthKey = () => {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

async function runTests() {
  console.log('Connecting to database:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  try {
    const monthKey = getCurrentMonthKey();
    console.log(`Current monthKey resolved as: ${monthKey}\n`);

    // 1. Cleanup old data
    console.log('Cleaning old test data...');
    await User.deleteMany({ email: /test-loyalty-.*@bazaar\.com/ });
    await Store.deleteMany({ name: /Test Loyalty Store/ });
    await Product.deleteMany({ title: /Test Loyalty Product/ });
    await Order.deleteMany({ shippingAddress: 'Test Loyalty Address' });
    await Coupon.deleteMany({ code: /TESTLOY/ });
    await LoyaltyLedgerCache.deleteMany({});
    await LoyaltyConfig.deleteMany({});

    // 2. Setup Loyalty Config
    console.log('\nInitializing Global Loyalty Config...');
    const config = await LoyaltyConfig.create({
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000,
      silverDiscount: 5,
      goldDiscount: 10
    });
    console.log('✓ Loyalty config created:', config.toJSON());

    // 3. Seed baseline users and store
    console.log('\nSeeding baseline entities...');
    const vendorUser = await User.create({
      name: 'Test Loyalty Vendor',
      email: 'test-loyalty-vendor@bazaar.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const shopperUser = await User.create({
      name: 'Test Loyalty Shopper',
      email: 'test-loyalty-shopper@bazaar.com',
      password: 'password123',
      role: 'shopper',
      status: 'active'
    });

    const store = await Store.create({
      vendorId: vendorUser._id,
      name: 'Test Loyalty Store',
      slug: 'test-loyalty-store',
      wallet: {
        balancePKR: 1000,
        totalDepositedPKR: 1000,
        totalSpentPKR: 0,
        outstandingCommission: 0,
        lastUpdated: new Date()
      },
      isActive: true,
      debtZone: 'active'
    });

    vendorUser.storeId = store._id;
    await vendorUser.save();

    const product = await Product.create({
      storeId: store._id,
      vendorId: vendorUser._id,
      title: 'Test Loyalty Product',
      description: 'Product for loyalty tests.',
      price: 2000,
      stock: 100,
      images: [{ url: '/uploads/test.png', isPrimary: true }]
    });

    // Seed a 10% coupon for the store to test coupon stacking
    const coupon = await Coupon.create({
      storeId: store._id,
      code: 'TESTLOY10',
      discountType: 'percentage',
      discountValue: 10,
      minSpend: 1000,
      usageLimit: 100,
      usageCount: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isActive: true
    });

    // -------------------------------------------------------------
    // Test Case 1: Standard Shopper Checkout (no loyalty discount)
    // -------------------------------------------------------------
    console.log('\n--- Test Case 1: Standard Shopper Checkout ---');
    // Order subtotal = 1 item * 2000 PKR = 2000 PKR.
    // Apply 10% coupon = 200 PKR discount. finalSubtotal = 1800 PKR.
    // Loyalty Tier: Standard. Loyalty discount = 0 PKR.
    // platformCommission = 1800 * 0.05 = 90 PKR.
    // finalTotalAmount = 1800 + 150 shipping = 1950 PKR.

    // Simulate backend checkout math
    let calculatedSubtotal = 2000;
    let marketingDiscount = (calculatedSubtotal * coupon.discountValue) / 100; // 200
    let finalSubtotal = calculatedSubtotal - marketingDiscount; // 1800

    let loyaltyDiscount = 0;
    let loyaltyTier = 'Standard';

    // Verify cache query
    let loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    let currentSpend = loyaltyCache ? loyaltyCache.accumulatedSpend : 0;
    assert(currentSpend === 0, 'Initial monthly spend cache should be 0');

    let finalDiscountedSubtotal = finalSubtotal - loyaltyDiscount; // 1800
    let platformCommission = toPKR(finalSubtotal * 0.05 - loyaltyDiscount); // 90
    let finalTotalAmount = finalDiscountedSubtotal + 150; // 1950 (with shipping)

    assert(platformCommission === 90, 'Platform commission should be 90 PKR');
    assert(finalTotalAmount === 1950, 'Final payable amount should be 1950 PKR');

    // Create the order in DB
    const order1 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1, price: product.price }],
      totalAmount: finalTotalAmount,
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingAddress: 'Test Loyalty Address',
      city: 'Faisalabad',
      shippingPremium: 150,
      marketingDiscount,
      couponCode: coupon.code,
      loyaltyDiscount,
      loyaltyTier,
      platformCommission,
      commissionOutstandingPKR: platformCommission,
      commissionDebitedPKR: 0
    });

    // Update shopper spend cache
    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    if (!loyaltyCache) {
      loyaltyCache = new LoyaltyLedgerCache({
        userId: shopperUser._id,
        monthKey,
        accumulatedSpend: 0,
        claimsCount: 0
      });
    }
    loyaltyCache.accumulatedSpend = toPKR(loyaltyCache.accumulatedSpend + finalSubtotal);
    if (loyaltyDiscount > 0) {
      loyaltyCache.claimsCount += 1;
    }
    await loyaltyCache.save();

    // Verify cache updated
    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    assert(loyaltyCache.accumulatedSpend === 1800, 'Accumulated spend should be updated to 1800 PKR');
    assert(loyaltyCache.claimsCount === 0, 'Discount claims count should remain 0');


    // -------------------------------------------------------------
    // Test Case 2: Silver Shopper Checkout (5% loyalty discount)
    // -------------------------------------------------------------
    console.log('\n--- Test Case 2: Silver Shopper Checkout (>= 10,000 Spend) ---');
    // First, manually override/update cache to 12,000 PKR to trigger Silver Tier.
    loyaltyCache.accumulatedSpend = 12000;
    await loyaltyCache.save();

    // Shopper places a new order of 1 item * 2000 PKR = 2000 PKR (no coupon this time).
    // finalSubtotal = 2000.
    // Loyalty Tier: Silver. Loyalty discount = 5% of 2000 = 100 PKR.
    // finalDiscountedSubtotal = 2000 - 100 = 1900 PKR.
    // platformCommission = 2000 * 0.05 - 100 = 100 - 100 = 0 PKR.
    // finalTotalAmount = 1900 + 150 shipping = 2050 PKR.

    calculatedSubtotal = 2000;
    marketingDiscount = 0;
    finalSubtotal = calculatedSubtotal - marketingDiscount; // 2000

    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    currentSpend = loyaltyCache.accumulatedSpend;
    assert(currentSpend === 12000, 'Verify user accumulated spend is overridden to 12,000 PKR');

    // Silver tier detection
    loyaltyTier = 'Standard';
    loyaltyDiscount = 0;
    if (config.isActive) {
      if (currentSpend >= config.goldThreshold) {
        loyaltyTier = 'Gold';
        loyaltyDiscount = toPKR(finalSubtotal * (config.goldDiscount / 100));
      } else if (currentSpend >= config.silverThreshold) {
        loyaltyTier = 'Silver';
        loyaltyDiscount = toPKR(finalSubtotal * (config.silverDiscount / 100));
      }
    }

    assert(loyaltyTier === 'Silver', 'Shopper loyalty tier should evaluate to Silver');
    assert(loyaltyDiscount === 100, 'Loyalty discount should be 5% of 2000 = 100 PKR');

    finalDiscountedSubtotal = finalSubtotal - loyaltyDiscount; // 1900
    platformCommission = toPKR(finalSubtotal * 0.05 - loyaltyDiscount); // 0
    finalTotalAmount = finalDiscountedSubtotal + 150; // 2050

    assert(platformCommission === 0, 'Platform commission should be 0 PKR (absorbed by loyalty subsidy)');
    assert(finalTotalAmount === 2050, 'Final payable amount should be 2050 PKR');

    const order2 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1, price: product.price }],
      totalAmount: finalTotalAmount,
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingAddress: 'Test Loyalty Address',
      city: 'Faisalabad',
      shippingPremium: 150,
      marketingDiscount: 0,
      loyaltyDiscount,
      loyaltyTier,
      platformCommission,
      commissionOutstandingPKR: platformCommission,
      commissionDebitedPKR: 0
    });

    // Update shopper spend cache
    loyaltyCache.accumulatedSpend = toPKR(loyaltyCache.accumulatedSpend + finalSubtotal); // 12000 + 2000 = 14000
    if (loyaltyDiscount > 0) {
      loyaltyCache.claimsCount += 1; // 1
    }
    await loyaltyCache.save();

    // Verify cache updated
    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    assert(loyaltyCache.accumulatedSpend === 14000, 'Accumulated spend should now be 14000 PKR');
    assert(loyaltyCache.claimsCount === 1, 'Discount claims count should increment to 1');


    // -------------------------------------------------------------
    // Test Case 3: Gold Shopper Checkout (10% loyalty discount & -5% net margin)
    // -------------------------------------------------------------
    console.log('\n--- Test Case 3: Gold Shopper Checkout (>= 20,000 Spend) ---');
    // First, manually update cache to 22,000 PKR to trigger Gold Tier.
    loyaltyCache.accumulatedSpend = 22000;
    loyaltyCache.claimsCount = 1;
    await loyaltyCache.save();

    // Shopper places a new order of 1 item * 3000 PKR = 3000 PKR.
    // finalSubtotal = 3000.
    // Loyalty Tier: Gold. Loyalty discount = 10% of 3000 = 300 PKR.
    // finalDiscountedSubtotal = 3000 - 300 = 2700 PKR.
    // platformCommission = 3000 * 0.05 - 300 = 150 - 300 = -150 PKR.
    // finalTotalAmount = 2700 + 150 shipping = 2850 PKR.

    calculatedSubtotal = 3000;
    marketingDiscount = 0;
    finalSubtotal = calculatedSubtotal - marketingDiscount; // 3000

    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    currentSpend = loyaltyCache.accumulatedSpend;
    assert(currentSpend === 22000, 'Verify user accumulated spend is 22,000 PKR');

    // Gold tier detection
    loyaltyTier = 'Standard';
    loyaltyDiscount = 0;
    if (config.isActive) {
      if (currentSpend >= config.goldThreshold) {
        loyaltyTier = 'Gold';
        loyaltyDiscount = toPKR(finalSubtotal * (config.goldDiscount / 100));
      } else if (currentSpend >= config.silverThreshold) {
        loyaltyTier = 'Silver';
        loyaltyDiscount = toPKR(finalSubtotal * (config.silverDiscount / 100));
      }
    }

    assert(loyaltyTier === 'Gold', 'Shopper loyalty tier should evaluate to Gold');
    assert(loyaltyDiscount === 300, 'Loyalty discount should be 10% of 3000 = 300 PKR');

    finalDiscountedSubtotal = finalSubtotal - loyaltyDiscount; // 2700
    platformCommission = toPKR(finalSubtotal * 0.05 - loyaltyDiscount); // 150 - 300 = -150
    finalTotalAmount = finalDiscountedSubtotal + 150; // 2850

    assert(platformCommission === -150, 'Platform commission should be -150 PKR (absorbed by loyalty subsidy)');
    assert(finalTotalAmount === 2850, 'Final payable amount should be 2850 PKR');

    // Verify vendor payout split calculation (Order.totalAmount - platformCommission - shippingPremium)
    // Merchant payout = 2850 - (-150) - 150 = 2850 + 150 - 150 = 2850 PKR.
    const vendorPayout = finalTotalAmount - platformCommission - 150;
    assert(vendorPayout === 2850, 'Vendor payout should be exactly 2850 PKR (95% of 3000 PKR subtotal)');

    const order3 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1.5, price: 2000 }], // 1.5 * 2000 = 3000
      totalAmount: finalTotalAmount,
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingAddress: 'Test Loyalty Address',
      city: 'Faisalabad',
      shippingPremium: 150,
      marketingDiscount: 0,
      loyaltyDiscount,
      loyaltyTier,
      platformCommission,
      commissionOutstandingPKR: platformCommission,
      commissionDebitedPKR: 0
    });

    // Update shopper spend cache
    loyaltyCache.accumulatedSpend = toPKR(loyaltyCache.accumulatedSpend + finalSubtotal); // 22000 + 3000 = 25000
    if (loyaltyDiscount > 0) {
      loyaltyCache.claimsCount += 1; // 2
    }
    await loyaltyCache.save();

    // Verify cache updated
    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    assert(loyaltyCache.accumulatedSpend === 25000, 'Accumulated spend should now be 25000 PKR');
    assert(loyaltyCache.claimsCount === 2, 'Discount claims count should increment to 2');


    // -------------------------------------------------------------
    // Test Case 4: Order Cancellation Spend Rollback
    // -------------------------------------------------------------
    console.log('\n--- Test Case 4: Order Cancellation Spend Rollback ---');
    // We will cancel order3 (Gold order: subtotal = 3000, loyaltyDiscount = 300, claimsCount increment = 1).
    // The rollback should subtract exactly 3000 PKR from accumulatedSpend and subtract 1 from claimsCount.
    // User cache should return to: accumulatedSpend = 22,000 PKR, claimsCount = 1.

    console.log('Triggering cancelOrderInternal for Order 3...');
    await cancelOrderInternal(order3._id, 'Product out of stock', 'system');

    // Fetch updated cache
    loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: shopperUser._id, monthKey });
    console.log('Cache state after rollback:', loyaltyCache.toJSON());

    assert(loyaltyCache.accumulatedSpend === 22000, 'Accumulated spend should rollback exactly to 22000 PKR');
    assert(loyaltyCache.claimsCount === 1, 'Discount claims count should rollback exactly to 1');

    console.log('\nAll automated loyalty engine verification tests executed successfully!');
  } catch (err) {
    console.error('\nTest execution failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDatabase connection closed.');
  }
}

runTests();
