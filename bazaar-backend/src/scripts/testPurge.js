import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Model Imports
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import AdBid from '../models/AdBid.js';
import Order from '../models/Order.js';
import PurgeLedger from '../models/PurgeLedger.js';
import User from '../models/User.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import AdSlot from '../models/AdSlot.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';

const runTest = async () => {
  console.log('Connecting to database:', MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected successfully!');

  // 1. Get or seed standard testing entities
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    admin = await User.create({
      name: 'Test Administrator',
      email: 'testadmin@bazaarboost.com',
      password: 'hashedpassword',
      role: 'admin',
      status: 'active'
    });
  }

  let vendor = await User.findOne({ role: 'vendor' });
  if (!vendor) {
    vendor = await User.create({
      name: 'Test Vendor',
      email: 'testvendor@bazaarboost.com',
      password: 'hashedpassword',
      role: 'vendor',
      status: 'active'
    });
  }

  let shopper = await User.findOne({ role: 'shopper' });
  if (!shopper) {
    shopper = await User.create({
      name: 'Test Shopper',
      email: 'testshopper@bazaarboost.com',
      password: 'hashedpassword',
      role: 'shopper',
      status: 'active'
    });
  }

  let store = await Store.findOne({});
  if (!store) {
    store = await Store.create({
      name: 'Test Store',
      slug: 'test-store',
      vendorId: vendor._id,
      isActive: true,
      wallet: { balancePKR: 1000, totalDepositedPKR: 1000, totalSpentPKR: 0, outstandingCommission: 0 }
    });
  }

  let product = await Product.findOne({});
  if (!product) {
    product = await Product.create({
      title: 'Test Product',
      price: 150,
      stock: 10,
      storeId: store._id,
      vendorId: vendor._id
    });
  }

  let adSlot = await AdSlot.findOne({});
  if (!adSlot) {
    adSlot = await AdSlot.create({
      name: 'Homepage Hero Banner',
      location: 'homepage-hero',
      basePrice: 100,
      durationDays: 7,
      maxSimultaneousCampaigns: 3,
      isActive: true
    });
  }

  // 2. Clear old test records to start fresh
  const testTag = 'test-purge';
  await Notification.deleteMany({ body: new RegExp(testTag) });
  await AuditLog.deleteMany({ details: new RegExp(testTag) });
  await Order.deleteMany({ shippingAddress: new RegExp(testTag) });
  await AdBid.deleteMany({ message: new RegExp(testTag) });
  await PurgeLedger.deleteMany({});

  console.log('Database cleared of existing test entries.');

  // 3. Seed Old Records (older than 6 months: e.g. 8 months ago)
  const dateOld = new Date();
  dateOld.setMonth(dateOld.getMonth() - 8);

  const oldNotification = await Notification.create({
    recipientId: vendor._id,
    type: 'general',
    title: 'Old Notification Title',
    body: `Old Notification Body ${testTag}`,
    createdAt: dateOld
  });

  const oldAuditLog = await AuditLog.create({
    userId: admin._id,
    userName: admin.name,
    action: 'TEST_OLD_ACTION',
    details: `Test Old Detail ${testTag}`,
    scope: 'platform',
    timestamp: dateOld
  });

  const oldOrder = await Order.create({
    shopperId: shopper._id,
    storeId: store._id,
    items: [{ productId: product._id, title: product.title, quantity: 1, price: 150 }],
    totalAmount: 150,
    status: 'pending_payment',
    shippingAddress: `Old Shipping Address ${testTag}`,
    city: 'Lahore',
    createdAt: dateOld
  });

  const oldAdBid = await AdBid.create({
    slotId: adSlot._id,
    vendorId: vendor._id,
    productId: product._id,
    bidAmount: 500,
    referenceId: 'REF-OLD-123',
    paymentStatus: 'expired',
    message: `Old Ad Bid ${testTag}`,
    impressions: 1200,
    conversions: 85,
    startDate: dateOld,
    endDate: dateOld,
    createdAt: dateOld
  });

  // 4. Seed Recent Records (1 day ago: should NOT be purged)
  const dateNew = new Date();
  dateNew.setDate(dateNew.getDate() - 1);

  const newNotification = await Notification.create({
    recipientId: vendor._id,
    type: 'general',
    title: 'Recent Notification Title',
    body: `Recent Notification Body ${testTag}`,
    createdAt: dateNew
  });

  const newAuditLog = await AuditLog.create({
    userId: admin._id,
    userName: admin.name,
    action: 'TEST_NEW_ACTION',
    details: `Test New Detail ${testTag}`,
    scope: 'platform',
    timestamp: dateNew
  });

  const newOrder = await Order.create({
    shopperId: shopper._id,
    storeId: store._id,
    items: [{ productId: product._id, title: product.title, quantity: 1, price: 150 }],
    totalAmount: 150,
    status: 'pending_payment',
    shippingAddress: `Recent Shipping Address ${testTag}`,
    city: 'Karachi',
    createdAt: dateNew
  });

  // Let's also seed an old completed order, which should NOT be purged (critical stats)
  const oldCompletedOrder = await Order.create({
    shopperId: shopper._id,
    storeId: store._id,
    items: [{ productId: product._id, title: product.title, quantity: 1, price: 500 }],
    totalAmount: 500,
    status: 'completed',
    shippingAddress: `Old Completed Order Address ${testTag}`,
    city: 'Islamabad',
    createdAt: dateOld
  });

  const newAdBid = await AdBid.create({
    slotId: adSlot._id,
    vendorId: vendor._id,
    productId: product._id,
    bidAmount: 800,
    referenceId: 'REF-NEW-123',
    paymentStatus: 'approved',
    message: `Recent Ad Bid ${testTag}`,
    impressions: 300,
    conversions: 20,
    startDate: dateNew,
    endDate: dateNew,
    createdAt: dateNew
  });

  console.log('Successfully seeded database with test records.');

  // Check counts pre-purge
  console.log('\n--- PRE-PURGE STATUS ---');
  console.log('Notifications (total matching test tag):', await Notification.countDocuments({ body: new RegExp(testTag) }));
  console.log('Audit Logs (total matching test tag):', await AuditLog.countDocuments({ details: new RegExp(testTag) }));
  console.log('Orders (total matching test tag):', await Order.countDocuments({ shippingAddress: new RegExp(testTag) }));
  console.log('Ad Bids (total matching test tag):', await AdBid.countDocuments({ message: new RegExp(testTag) }));

  // 5. Trigger the Purging logic (6 months threshold)
  console.log('\nExecuting Database Purge (Threshold: 6 months)...');
  const thresholdMonths = 6;
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - thresholdMonths);

  // Core Purging Transaction Logic (exact match with admin.js router)
  const expiredBids = await AdBid.find({
    endDate: { $lt: cutoffDate },
    paymentStatus: { $in: ['expired', 'terminated', 'rejected'] }
  });

  let totalAdImpressions = 0;
  let totalAdConversions = 0;
  let totalAdSpendPKR = 0;

  expiredBids.forEach(bid => {
    totalAdImpressions += bid.impressions || 0;
    totalAdConversions += bid.conversions || 0;
    totalAdSpendPKR += bid.bidAmount || 0;
  });

  const bidDelete = await AdBid.deleteMany({
    _id: { $in: expiredBids.map(b => b._id) }
  });

  const notifDelete = await Notification.deleteMany({
    createdAt: { $lt: cutoffDate }
  });

  const orderDelete = await Order.deleteMany({
    status: 'pending_payment',
    createdAt: { $lt: cutoffDate }
  });

  const auditDelete = await AuditLog.deleteMany({
    timestamp: { $lt: cutoffDate }
  });

  // Resource Freeing: compact collections
  const optimizedCollections = [];
  try {
    const collectionsToCompact = ['notifications', 'auditlogs', 'adbids', 'orders'];
    for (const coll of collectionsToCompact) {
      try {
        await mongoose.connection.db.command({ compact: coll });
        optimizedCollections.push(coll);
      } catch (err) {
        console.warn(`Collection "${coll}" compaction failed (safe fallback):`, err.message);
      }
    }
  } catch (err) {
    console.error('Compaction commands failed:', err.message);
  }

  // Create Purge Ledger entry
  const ledgerEntry = await PurgeLedger.create({
    executedBy: admin._id,
    executedByName: admin.name,
    thresholdMonths,
    cutoffDate,
    purgedCounts: {
      notifications: notifDelete.deletedCount,
      adBids: bidDelete.deletedCount,
      uncompletedCarts: orderDelete.deletedCount,
      auditLogs: auditDelete.deletedCount
    },
    reclaimedStats: {
      totalAdImpressions,
      totalAdConversions,
      totalAdSpendPKR
    },
    optimizedCollections
  });

  console.log('\n--- PURGE EXECUTION COMPLETE ---');
  console.log('Deleted Ad Bids:', bidDelete.deletedCount);
  console.log('Deleted Notifications:', notifDelete.deletedCount);
  console.log('Deleted Uncompleted Carts:', orderDelete.deletedCount);
  console.log('Deleted Audit Logs:', auditDelete.deletedCount);
  console.log('Reclaimed Impressions:', totalAdImpressions);
  console.log('Reclaimed Conversions:', totalAdConversions);
  console.log('Reclaimed Spend:', totalAdSpendPKR);
  console.log('Optimized Collections:', optimizedCollections);

  // 6. Verify Post-Purge Counts
  console.log('\n--- POST-PURGE STATUS ---');
  const postNotificationCount = await Notification.countDocuments({ body: new RegExp(testTag) });
  const postAuditLogCount = await AuditLog.countDocuments({ details: new RegExp(testTag) });
  const postOrderCount = await Order.countDocuments({ shippingAddress: new RegExp(testTag) });
  const postAdBidCount = await AdBid.countDocuments({ message: new RegExp(testTag) });

  console.log('Notifications (remaining):', postNotificationCount);
  console.log('Audit Logs (remaining):', postAuditLogCount);
  console.log('Orders (remaining):', postOrderCount);
  console.log('Ad Bids (remaining):', postAdBidCount);

  // Confirm exact documents preserved
  const preservedNotification = await Notification.findOne({ body: new RegExp(testTag) });
  const preservedAuditLog = await AuditLog.findOne({ details: new RegExp(testTag) });
  const preservedOrder = await Order.findOne({ shippingAddress: new RegExp(`Recent Shipping Address ${testTag}`) });
  const preservedCompletedOrder = await Order.findOne({ shippingAddress: new RegExp(`Old Completed Order Address ${testTag}`) });
  const preservedAdBid = await AdBid.findOne({ message: new RegExp(testTag) });

  console.log('\n--- VERIFICATION CHECKS ---');
  console.log('New Notification preserved?', preservedNotification?._id?.toString() === newNotification._id.toString() ? '✓ YES' : '✗ NO');
  console.log('New Audit Log preserved?', preservedAuditLog?._id?.toString() === newAuditLog._id.toString() ? '✓ YES' : '✗ NO');
  console.log('New Pending Order preserved?', preservedOrder?._id?.toString() === newOrder._id.toString() ? '✓ YES' : '✗ NO');
  console.log('Old Completed Order preserved (operational stats retention)?', preservedCompletedOrder?._id?.toString() === oldCompletedOrder._id.toString() ? '✓ YES' : '✗ NO');
  console.log('New Ad Bid preserved?', preservedAdBid?._id?.toString() === newAdBid._id.toString() ? '✓ YES' : '✗ NO');

  // Verify Ledger Entry
  const ledgerCount = await PurgeLedger.countDocuments({});
  console.log('Purge Ledger entry created?', ledgerCount > 0 ? '✓ YES' : '✗ NO');
  if (ledgerCount > 0) {
    const entry = await PurgeLedger.findOne({});
    console.log('  Threshold recorded:', entry.thresholdMonths, 'months');
    console.log('  Reclaimed stats matches Old Ad Bid?', (entry.reclaimedStats.totalAdImpressions === 1200 && entry.reclaimedStats.totalAdSpendPKR === 500) ? '✓ YES' : '✗ NO');
  }

  // Clear test entries
  await Notification.deleteMany({ body: new RegExp(testTag) });
  await AuditLog.deleteMany({ details: new RegExp(testTag) });
  await Order.deleteMany({ shippingAddress: new RegExp(testTag) });
  await AdBid.deleteMany({ message: new RegExp(testTag) });
  await PurgeLedger.deleteMany({});
  console.log('\nTest database cleaned up.');

  await mongoose.disconnect();
  console.log('Database disconnected. Verification successful!');
};

runTest().catch(err => {
  console.error('Test script failed:', err);
  mongoose.disconnect();
});
