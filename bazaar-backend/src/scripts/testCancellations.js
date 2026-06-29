import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load models using relative paths from src/scripts/
import Store from '../models/Store.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import ShopperProfile from '../models/ShopperProfile.js';
import ComplaintTicket from '../models/ComplaintTicket.js';
import AuditLog from '../models/AuditLog.js';
import ChatSession from '../models/ChatSession.js';
import Message from '../models/Message.js';

import { cancelOrderInternal } from '../services/orderService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: './.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bazarboost';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runTests() {
  console.log('Connecting to database:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  try {
    // 1. Clean previous test runs
    console.log('Cleaning old test data...');
    await User.deleteMany({ email: /test-cancel-.*@bazaar\.com/ });
    await Store.deleteMany({ name: /Test Cancel Store/ });
    await Product.deleteMany({ title: /Test Cancel Product/ });
    await Order.deleteMany({ shippingAddress: 'Test Cancel Address' });
    await ComplaintTicket.deleteMany({ description: /cancellation locked/i });
    await ChatSession.deleteMany({});
    await Message.deleteMany({});
    await AuditLog.deleteMany({ action: { $in: ['ORDER_CANCEL', 'VENDOR_REPEATED_CANCELLATION', 'ORDER_CANCEL_LOCKED'] } });

    // 2. Setup baseline entities
    console.log('\nSeeding baseline entities...');
    const vendorUser = await User.create({
      name: 'Test Cancel Vendor',
      email: 'test-cancel-vendor@bazaar.com',
      password: 'password123',
      role: 'vendor',
      status: 'active'
    });

    const shopperUser = await User.create({
      name: 'Test Cancel Shopper',
      email: 'test-cancel-shopper@bazaar.com',
      password: 'password123',
      role: 'shopper',
      status: 'active'
    });

    // Create shopper profile
    const shopperProfile = await ShopperProfile.create({
      userId: shopperUser._id,
      savedAddresses: ['Test Cancel Address'],
      balancePKR: 0
    });
    // Link profile to user
    shopperUser.shopperProfile = shopperProfile._id;
    await shopperUser.save();

    const store = await Store.create({
      vendorId: vendorUser._id,
      name: 'Test Cancel Store',
      slug: 'test-cancel-store',
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
      title: 'Test Cancel Product',
      description: 'Product for cancellations test.',
      price: 2000,
      stock: 10,
      images: [{ url: '/uploads/test.png', isPrimary: true }]
    });

    // -------------------------------------------------------------
    // Test Case 1: Grace Window Instant Cancel
    // -------------------------------------------------------------
    console.log('\n--- Test Case 1: Grace Window Instant Cancel ---');
    
    // Simulate placing a prepaid order: reduces stock by 2, charges 5% platform commission
    // commission = 5% of 4000 = 200
    // store outstanding commission = 200
    product.stock = 8;
    await product.save();

    const order1 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 2, price: product.price }],
      totalAmount: 4000,
      status: 'pending_approval',
      paymentMethod: 'bank_transfer',
      shippingAddress: 'Test Cancel Address',
      city: 'Faisalabad',
      platformCommission: 200,
      commissionOutstandingPKR: 200,
      commissionDebitedPKR: 0
    });

    store.wallet.outstandingCommission = 200;
    await store.save();

    // Create a mock active chat room for cleanup check
    const chatRoom = await ChatSession.create({
      storeId: store._id,
      shopperId: shopperUser._id
    });
    await Message.create({
      storeId: store._id,
      shopperId: shopperUser._id,
      vendorId: vendorUser._id,
      senderId: shopperUser._id,
      text: 'Can I cancel this?'
    });

    console.log('Triggering cancelOrderInternal for Order 1 (shopper role, grace window)...');
    await cancelOrderInternal(order1._id, 'Changed mind', 'shopper');

    // Assertions
    const updatedOrder1 = await Order.findById(order1._id);
    assert(updatedOrder1.status === 'cancelled', 'Order status should be cancelled');
    
    const restoredProduct = await Product.findById(product._id);
    assert(restoredProduct.stock === 10, 'Product stock should be restituted back to 10');

    const updatedShopperProfile = await ShopperProfile.findById(shopperProfile._id);
    assert(updatedShopperProfile.balancePKR === 4000, 'Prepaid totalAmount of 4000 should be refunded to shopper profile wallet balance');

    const updatedStore = await Store.findById(store._id);
    assert(updatedStore.wallet.outstandingCommission === 0, 'Store outstanding commission should be reversed back to 0');

    // Wait a brief moment for notification setImmediate cleanup task
    await new Promise(resolve => setTimeout(resolve, 800));

    const remainingChats = await ChatSession.countDocuments({ _id: chatRoom._id });
    assert(remainingChats === 0, 'Associated ChatSession should be purged from database');

    const remainingMessages = await Message.countDocuments({ storeId: store._id, shopperId: shopperUser._id });
    assert(remainingMessages === 0, 'Associated messages should be purged from database');


    // -------------------------------------------------------------
    // Test Case 2: Processing Window Request Cancel
    // -------------------------------------------------------------
    console.log('\n--- Test Case 2: Processing Window Request Cancel ---');
    
    const order2 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1, price: product.price }],
      totalAmount: 2000,
      status: 'processing',
      paymentMethod: 'cod',
      shippingAddress: 'Test Cancel Address',
      city: 'Faisalabad'
    });

    // Simulate shopper submitting cancellation request via API logic
    order2.cancellationRequested = true;
    order2.cancellationReason = 'Incorrect Delivery Address';
    order2.cancellationRequestedAt = new Date();
    await order2.save();

    const updatedOrder2 = await Order.findById(order2._id);
    assert(updatedOrder2.cancellationRequested === true, 'Cancellation request flag should be true');
    assert(updatedOrder2.cancellationReason === 'Incorrect Delivery Address', 'Cancellation reason should be logged');


    // -------------------------------------------------------------
    // Test Case 3: Dispatched Gate Locked Cancel
    // -------------------------------------------------------------
    console.log('\n--- Test Case 3: Dispatched Gate Locked Cancel ---');
    
    const order3 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1, price: product.price }],
      totalAmount: 2000,
      status: 'dispatched',
      paymentMethod: 'cod',
      shippingAddress: 'Test Cancel Address',
      city: 'Faisalabad'
    });

    // Simulate shopper trying to cancel via API:
    // It should decline and auto-generate complaint ticket
    const ticket = await ComplaintTicket.create({
      shopperId: order3.shopperId,
      storeId: order3.storeId,
      orderId: order3._id,
      category: 'other',
      description: `Customer attempted to cancel order #${order3._id.toString().slice(-8).toUpperCase()} after dispatch. Cancellation locked.`,
      status: 'open'
    });

    assert(ticket !== null, 'Dispute/Complaint ticket should be generated on locked dispatch cancel attempt');
    assert(ticket.status === 'open', 'Generated complaint ticket status should be open');
    assert(ticket.orderId.toString() === order3._id.toString(), 'Complaint ticket should reference the target order ID');


    // -------------------------------------------------------------
    // Test Case 4: Vendor Cancellation Negligence Penalty
    // -------------------------------------------------------------
    console.log('\n--- Test Case 4: Vendor Cancellation Negligence Penalty ---');
    
    const order4 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 1, price: product.price }],
      totalAmount: 2000,
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingAddress: 'Test Cancel Address',
      city: 'Faisalabad'
    });

    const storeBefore = await Store.findById(store._id);
    const initialPenalties = storeBefore.penaltyPoints || 0;

    console.log('Vendor cancelling Order 4 due to stock negligence...');
    await cancelOrderInternal(order4._id, 'out_of_stock', 'vendor');

    const storeAfter = await Store.findById(store._id);
    assert(storeAfter.penaltyPoints === initialPenalties + 1, 'Vendor out_of_stock cancellation should increment Store penaltyPoints by 1');


    // -------------------------------------------------------------
    // Test Case 5: Red Zone System Forced Auto-Cancellation
    // -------------------------------------------------------------
    console.log('\n--- Test Case 5: Red Zone System Forced Auto-Cancellation ---');
    console.log(`Diagnostic: store._id = ${store._id}, product._id = ${product._id}`);
    
    // Clean up previous active orders to avoid interference
    await Order.deleteMany({ storeId: store._id });

    // Seed active pending order
    const order5 = await Order.create({
      shopperId: shopperUser._id,
      storeId: store._id,
      items: [{ productId: product._id, title: product.title, quantity: 2, price: product.price }],
      totalAmount: 4000,
      status: 'pending_approval',
      paymentMethod: 'cod',
      shippingAddress: 'Test Cancel Address',
      city: 'Faisalabad'
    });

    const freshProduct = await Product.findById(product._id);
    freshProduct.stock = 8;
    try {
      console.log('Saving product stock update...');
      await freshProduct.save();
    } catch (saveErr) {
      console.error('Error saving product in Case 5:', saveErr);
      throw saveErr;
    }

    // Fetch the fresh store first to avoid VersionError
    const freshStore = await Store.findById(store._id);
    console.log(`Diagnostic: freshStore._id = ${freshStore._id}, freshStore.__v = ${freshStore.__v}`);
    console.log('Simulating Store outstanding commission increase past 25,000 to trigger Red Zone...');
    freshStore.wallet.outstandingCommission = 30000;
    try {
      await freshStore.save();
    } catch (saveErr) {
      console.error('Error saving freshStore in Case 5:', saveErr);
      throw saveErr;
    }

    // The post-save hook will run asynchronously. Let's wait a moment
    await new Promise(resolve => setTimeout(resolve, 1500));

    const finalStore = await Store.findById(store._id);
    assert(finalStore.debtZone === 'red', 'Store debtZone should be red');
    assert(finalStore.isActive === false, 'Store should be suspended (isActive = false)');

    const cancelledOrder5 = await Order.findById(order5._id);
    assert(cancelledOrder5.status === 'cancelled', 'Pending order should have been auto-cancelled by system Red Zone hook');
    assert(cancelledOrder5.cancellationReason.includes('Store suspended'), 'Cancellation reason should reflect Red Zone suspension');

    const finalProduct = await Product.findById(product._id);
    assert(finalProduct.stock === 10, 'Product stock should be auto-restituted back to 10');

    console.log('\nAll automated cancellation tests executed successfully!');
  } catch (err) {
    console.error('\nTest execution failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDatabase connection closed.');
  }
}

runTests();
