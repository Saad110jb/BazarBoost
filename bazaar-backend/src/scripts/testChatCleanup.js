import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Store from '../models/Store.js';
import ChatSession from '../models/ChatSession.js';
import Message from '../models/Message.js';
import Order from '../models/Order.js';
import ShopperProfile from '../models/ShopperProfile.js';
import { dispatchNotification } from '../services/notificationService.js';

async function test() {
  try {
    await mongoose.connect('mongodb://localhost:27017/bazaarboost');
    console.log("Connected to MongoDB for testing chat deletion.");

    const shopperEmail = 'cleanshopper@bazaar.com';
    const vendorEmail = 'cleanvendor@bazaar.com';

    // Clean up any historical runs
    const prevShopper = await User.findOne({ email: shopperEmail });
    if (prevShopper) {
      await ChatSession.deleteMany({ shopperId: prevShopper._id });
      await Message.deleteMany({ shopperId: prevShopper._id });
      await Order.deleteMany({ shopperId: prevShopper._id });
      await User.deleteOne({ _id: prevShopper._id });
    }
    const prevVendor = await User.findOne({ email: vendorEmail });
    if (prevVendor) {
      await Store.deleteMany({ vendorId: prevVendor._id });
      await User.deleteOne({ _id: prevVendor._id });
    }

    // Seed test Shopper
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const shopper = await User.create({
      name: 'Clean Shopper',
      email: shopperEmail,
      password: hashedPassword,
      role: 'shopper'
    });
    console.log(`Seeded Shopper ID: ${shopper._id}`);

    // Seed test Vendor
    const vendor = await User.create({
      name: 'Clean Vendor',
      email: vendorEmail,
      password: hashedPassword,
      role: 'vendor'
    });
    console.log(`Seeded Vendor ID: ${vendor._id}`);

    // Seed Store under Vendor
    const store = await Store.create({
      vendorId: vendor._id,
      name: 'Cleanup Test Store',
      slug: 'cleanup-test-store',
      wallet: { balancePKR: 1000 }
    });
    console.log(`Seeded Store ID: ${store._id}`);

    // Seed active ChatSession (ChatRoom)
    const chatSession = await ChatSession.create({
      storeId: store._id,
      shopperId: shopper._id,
      status: 'active'
    });
    console.log(`Seeded ChatSession ID: ${chatSession._id}`);

    // Seed Messages inside room context
    const msg1 = await Message.create({
      shopperId: shopper._id,
      vendorId: vendor._id,
      storeId: store._id,
      senderId: shopper._id,
      text: 'Hello, is this product available?'
    });
    const msg2 = await Message.create({
      shopperId: shopper._id,
      vendorId: vendor._id,
      storeId: store._id,
      senderId: vendor._id,
      text: 'Yes, it is!'
    });
    console.log(`Seeded ${2} messages inside room.`);

    // Seed delivered Order
    const order = await Order.create({
      shopperId: shopper._id,
      storeId: store._id,
      items: [],
      totalAmount: 3000,
      paymentMethod: 'cod',
      status: 'delivered',
      city: 'Lahore',
      shippingAddress: 'Test Address Lahore, Pakistan'
    });
    console.log(`Seeded Order ID: ${order._id}`);

    // Double check setup exists in DB
    const initialSessionCount = await ChatSession.countDocuments({ _id: chatSession._id });
    const initialMsgCount = await Message.countDocuments({ storeId: store._id, shopperId: shopper._id });

    if (initialSessionCount === 1 && initialMsgCount === 2) {
      console.log("✅ Seed verified. ChatSession and Messages exist.");
    } else {
      throw new Error(`Invalid setup state. Sessions: ${initialSessionCount}, Messages: ${initialMsgCount}`);
    }

    // Capture compliance log stdout
    const originalLog = console.log;
    let complianceLogCaptured = false;
    console.log = (...args) => {
      originalLog(...args);
      if (args[0] && args[0].includes('[COMPLIANCE LOG]')) {
        complianceLogCaptured = true;
      }
    };

    // Trigger completion status change notification event
    console.log("Dispatching completion notification event...");
    await dispatchNotification('ORDER_STATUS_CHANGED', { order, statusText: 'completed' });

    // Wait 5000ms for setImmediate async handler execution and SMTP dispatch
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Restore original console.log
    console.log = originalLog;

    // Verify deletion outcomes
    const remainingSessionCount = await ChatSession.countDocuments({ _id: chatSession._id });
    const remainingMsgCount = await Message.countDocuments({ storeId: store._id, shopperId: shopper._id });

    console.log(`Verification: Sessions left: ${remainingSessionCount}, Messages left: ${remainingMsgCount}`);

    if (remainingSessionCount === 0 && remainingMsgCount === 0) {
      console.log("✅ Success: ChatSession and messages fully deleted post-fulfillment!");
    } else {
      throw new Error(`Failed to delete chat documents. Remaining sessions: ${remainingSessionCount}, messages: ${remainingMsgCount}`);
    }

    if (complianceLogCaptured) {
      console.log("✅ Success: Compliance log successfully printed.");
    } else {
      throw new Error("Compliance log was not triggered or captured.");
    }

    // Clean up seeded records
    await ShopperProfile.deleteMany({ userId: shopper._id }).catch(() => {});
    await User.deleteOne({ _id: shopper._id });
    await User.deleteOne({ _id: vendor._id });
    await Store.deleteOne({ _id: store._id });
    await Order.deleteOne({ _id: order._id });
    console.log("Cleaned up database seed records.");
    console.log("\n✨ Chat deletion tests completed successfully! ✨");

  } catch (err) {
    console.error("❌ Test failed:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

test();
