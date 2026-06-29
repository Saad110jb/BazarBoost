import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Store from '../models/Store.js';
import VendorLoan from '../models/VendorLoan.js';
import { runRepaymentSweepCron } from '../services/cronService.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';

async function run() {
  console.log('\n==================================================');
  console.log(' BazaarBoost — Risk Lifecycle Matrix Test');
  console.log('==================================================\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // 1. Clean up old test data
    await User.deleteMany({ email: /test-matrix/ });
    await Store.deleteMany({ slug: /test-matrix/ });
    await VendorLoan.deleteMany({});
    console.log('✓ Cleaned up test data.');

    // 2. Seed Vendor and Store
    const vendorUser = await User.create({
      name: 'Test Matrix Vendor',
      email: 'test-matrix-vendor@test.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const store = await Store.create({
      vendorId: vendorUser._id,
      name: 'Test Matrix Store',
      slug: 'test-matrix-store',
      originCity: 'Lahore',
      wallet: { balancePKR: 0, totalDepositedPKR: 0, totalSpentPKR: 0, outstandingCommission: 0 },
      isActive: true
    });
    console.log(`✓ Seeded store. Active: ${store.isActive}`);

    // 3. Create 4 loans with different ages (days ago)
    const now = Date.now();
    const createPastDate = (daysAgo) => new Date(now - daysAgo * 24 * 60 * 60 * 1000);

    // Loan 1: Excellent Risk (Day 10)
    const loan1 = await VendorLoan.create({
      storeId: store._id,
      vendorId: vendorUser._id,
      amount: 1000,
      interestRate: 0.05,
      repaymentAmount: 1050,
      status: 'approved',
      payoutHoldAmount: 1050,
      createdAt: createPastDate(10)
    });

    // Loan 2: Moderate Risk (Day 35) - should trigger Halfway Checkpoint
    const loan2 = await VendorLoan.create({
      storeId: store._id,
      vendorId: vendorUser._id,
      amount: 2000,
      interestRate: 0.05,
      repaymentAmount: 2100,
      status: 'approved',
      payoutHoldAmount: 2100,
      createdAt: createPastDate(35)
    });

    // Loan 3: Critical Risk (Day 50) - should trigger Late Escalation
    const loan3 = await VendorLoan.create({
      storeId: store._id,
      vendorId: vendorUser._id,
      amount: 3000,
      interestRate: 0.05,
      repaymentAmount: 3150,
      status: 'approved',
      payoutHoldAmount: 3150,
      createdAt: createPastDate(50)
    });

    // Loan 4: Default/Freeze (Day 65) - should trigger System Default Suspension
    const loan4 = await VendorLoan.create({
      storeId: store._id,
      vendorId: vendorUser._id,
      amount: 4000,
      interestRate: 0.05,
      repaymentAmount: 4200,
      status: 'approved',
      payoutHoldAmount: 4200,
      createdAt: createPastDate(65)
    });
    console.log('✓ Seeded 4 loans at Day 10, Day 35, Day 50, and Day 65.');

    // 4. Run daily sweep cron
    console.log('\n--- Running Cron Risk Sweeper ---');
    await runRepaymentSweepCron();

    // 5. Assertions
    const uLoan1 = await VendorLoan.findById(loan1._id);
    const uLoan2 = await VendorLoan.findById(loan2._id);
    const uLoan3 = await VendorLoan.findById(loan3._id);
    const uLoan4 = await VendorLoan.findById(loan4._id);
    const uStore = await Store.findById(store._id);

    console.log('\n--- Sweep Assessment Results ---');
    console.log(`  Loan 1 (Day 10) status: ${uLoan1.status} (Expected: approved)`);
    console.log(`  Loan 2 (Day 35) status: ${uLoan2.status} (Expected: approved)`);
    console.log(`  Loan 3 (Day 50) status: ${uLoan3.status} (Expected: approved)`);
    console.log(`  Loan 4 (Day 65) status: ${uLoan4.status} (Expected: defaulted)`);
    console.log(`  Store isActive state:   ${uStore.isActive} (Expected: false)`);
    console.log(`  Store suspension reason: "${uStore.suspensionReason}"`);

    if (uLoan1.status !== 'approved') throw new Error('Expected Loan 1 to remain approved');
    if (uLoan2.status !== 'approved') throw new Error('Expected Loan 2 to remain approved');
    if (uLoan3.status !== 'approved') throw new Error('Expected Loan 3 to remain approved');
    if (uLoan4.status !== 'defaulted') throw new Error('Expected Loan 4 status to flip to defaulted');
    if (uStore.isActive !== false) throw new Error('Expected store account to be suspended');
    if (!uStore.suspensionReason.includes('Inventory loan default')) throw new Error('Expected store default suspension reason');

    console.log('\n==================================================');
    console.log(' ✓ ALL OPERATIONAL RISK LIFECYCLE TESTS PASSED');
    console.log('==================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('✗ TEST FAILURE:', err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
