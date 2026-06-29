import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import ChatSession from '../models/ChatSession.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Store from '../models/Store.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get all chat rooms/conversations list for user
// @route   GET /api/negotiation/chats
// @access  Private (Shopper, Vendor, or Store Admin)
router.get('/chats', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    let chats = [];

    if (req.user.role === 'vendor' || req.user.role === 'storeAdmin') {
      const activeStoreId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
      if (!activeStoreId) {
        return res.json({ success: true, count: 0, chats: [] });
      }

      // Find all unique shoppers who have messaged this store context
      chats = await Message.aggregate([
        { $match: { storeId: new mongoose.Types.ObjectId(activeStoreId) } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$shopperId',
            lastMessage: { $first: '$text' },
            lastMessageTime: { $first: '$createdAt' },
            productId: { $first: '$productId' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'shopper'
          }
        },
        { $unwind: '$shopper' },
        {
          $project: {
            id: '$_id',
            name: '$shopper.name',
            email: '$shopper.email',
            lastMessage: 1,
            lastMessageTime: 1,
            productId: 1
          }
        }
      ]);
    } else {
      // Find all unique vendors/stores this shopper has contacted
      chats = await Message.aggregate([
        { $match: { shopperId: userId } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$vendorId',
            lastMessage: { $first: '$text' },
            lastMessageTime: { $first: '$createdAt' },
            productId: { $first: '$productId' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'vendor'
          }
        },
        { $unwind: '$vendor' },
        {
          $lookup: {
            from: 'stores',
            localField: 'vendor.storeId',
            foreignField: '_id',
            as: 'store'
          }
        },
        { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            id: '$_id',
            name: '$vendor.name',
            storeName: '$store.name',
            storeSlug: '$store.slug',
            storeId: '$store._id',
            lastMessage: 1,
            lastMessageTime: 1,
            productId: 1
          }
        }
      ]);
    }

    res.json({ success: true, count: chats.length, chats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get detailed messages between shopper and vendor
// @route   GET /api/negotiation/chat/:partnerId
// @access  Private (Shopper or Vendor)
router.get('/chat/:partnerId', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const partnerId = req.params.partnerId;

    // Resolve active store context
    const isOperator = req.user.role === 'vendor' || req.user.role === 'storeAdmin';
    const storeId = isOperator ? (req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId) : null;

    let query = {};
    if (isOperator && storeId) {
      // If store staff, find all messages in the room context (storeId + shopperId)
      query = { storeId, shopperId: partnerId };
    } else {
      // Shopper view
      query = {
        $or: [
          { shopperId: userId, vendorId: partnerId },
          { shopperId: partnerId, vendorId: userId }
        ]
      };
    }

    // Retrieve messages in chronological order
    const messages = await Message.find(query)
      .populate('productId', 'title price images')
      .populate('senderId', 'name role')
      .sort({ createdAt: 1 });

    res.json({ success: true, count: messages.length, messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all chat sessions for a store context
// @route   GET /api/negotiation/sessions/:storeId
// @access  Private (Vendor or Store Admin)
router.get('/sessions/:storeId', protect, async (req, res) => {
  try {
    const storeId = req.params.storeId;
    
    // Check permission/access
    if (req.user.role !== 'admin' && !req.user.tenantStores.includes(storeId) && req.user.activeStoreId !== storeId) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized store context' });
    }

    const sessions = await ChatSession.find({ storeId })
      .populate('shopperId', 'name email')
      .populate('assignedOperatorId', 'name role')
      .sort({ lastActivity: -1 });

    res.json({ success: true, count: sessions.length, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Accept or Reject a negotiated price offer
// @route   PUT /api/negotiation/offer/:id
// @access  Private (Shopper or Vendor)
router.put('/offer/:id', protect, async (req, res) => {
  const { action } = req.body; // 'accepted' or 'rejected'

  if (!['accepted', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action. Choose accepted or rejected.' });
  }

  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message offer not found' });
    }

    // Security check: Only the recipient of the offer can accept/reject it
    if (message.senderId.toString() === req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You cannot respond to your own offer' });
    }

    if (message.storeId) {
      const store = await Store.findById(message.storeId);
      if (store && !store.isActive) {
        return res.status(403).json({ success: false, message: 'This store is suspended. Negotiations are frozen.' });
      }
    }

    message.offerStatus = action;
    await message.save();

    res.json({
      success: true,
      message: `Offer has been successfully ${action}.`,
      negotiatedMessage: message
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get Shift-End Analytics Report Summary
// @route   GET /api/negotiation/shift-summary/:storeId
// @access  Private (Store Admin or Vendor)
router.get('/shift-summary/:storeId', protect, async (req, res) => {
  const storeId = req.params.storeId;
  const userId = req.user._id;

  // Authorization Check
  if (req.user.role !== 'admin' && !req.user.tenantStores.includes(storeId) && req.user.activeStoreId !== storeId) {
    return res.status(403).json({ success: false, message: 'Access denied: Unauthorized store context' });
  }

  try {
    const shiftStartTime = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours work shift boundary

    // 1. Fulfillment & Revenue metrics
    const orders = await Order.find({
      storeId,
      createdAt: { $gte: shiftStartTime }
    });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const platformCommission = orders.reduce((sum, o) => sum + (o.platformCommission || 0), 0);
    const netEarnings = Math.round((totalRevenue - platformCommission) * 100) / 100;

    // 2. Marketing & Promotions logs
    const couponUsage = {};
    orders.forEach(o => {
      if (o.couponCode && o.marketingDiscount > 0) {
        const code = o.couponCode.toUpperCase();
        if (!couponUsage[code]) {
          couponUsage[code] = { code, count: 0, totalDiscount: 0 };
        }
        couponUsage[code].count += 1;
        couponUsage[code].totalDiscount += o.marketingDiscount;
      }
    });
    const couponsRedeemed = Object.values(couponUsage);

    // 3. Customer Engagement Metrics (WebSocket Latency Response Deltas)
    // Retrieve all messages during the shift to calculate deltas
    const messages = await Message.find({
      storeId,
      createdAt: { $gte: shiftStartTime }
    }).sort({ createdAt: 1 });

    // Group messages chronologically by shopper chat thread
    const chats = {};
    messages.forEach(m => {
      const shopperStr = m.shopperId.toString();
      if (!chats[shopperStr]) {
        chats[shopperStr] = [];
      }
      chats[shopperStr].push(m);
    });

    let totalLatencyMs = 0;
    let responseCount = 0;

    Object.values(chats).forEach((chatMsgs) => {
      let firstUnansweredCustomerTime = null;
      
      for (const msg of chatMsgs) {
        const isCustomer = msg.senderId.toString() === msg.shopperId.toString();
        if (isCustomer) {
          // Track when the shopper sent the message (only if we aren't already waiting for a response)
          if (!firstUnansweredCustomerTime) {
            firstUnansweredCustomerTime = new Date(msg.createdAt).getTime();
          }
        } else {
          // This is a reply from the merchant/operator
          if (firstUnansweredCustomerTime && msg.senderId.toString() === userId.toString()) {
            const responseTime = new Date(msg.createdAt).getTime();
            const latency = responseTime - firstUnansweredCustomerTime;
            totalLatencyMs += latency;
            responseCount += 1;
            firstUnansweredCustomerTime = null; // Reset once answered
          }
        }
      }
    });

    const averageLatencySeconds = responseCount > 0 
      ? Math.round((totalLatencyMs / responseCount) / 1000) 
      : 0;

    res.json({
      success: true,
      summary: {
        shiftStartTime,
        totalOrders,
        totalRevenue,
        platformCommission,
        netEarnings,
        couponsRedeemed,
        averageLatencySeconds,
        responseCount
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get AI Recommended Acceptance Floor Price for a product
// @route   GET /api/negotiation/floor-price/:productId
// @access  Private (Vendor, Store Admin)
router.get('/floor-price/:productId', protect, async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // 1. Gather successful chats for target product
    let messages = await Message.find({
      productId,
      offerStatus: 'accepted',
      priceOffer: { $gt: 0 }
    });

    let source = 'product';
    let samples = [];

    // Map to { x: originalProductPrice, y: acceptedPrice }
    for (const msg of messages) {
      samples.push({ x: product.price, y: msg.priceOffer });
    }

    // 2. If fewer than 5 samples, generalize store-wide
    if (samples.length < 5) {
      messages = await Message.find({
        storeId: product.storeId,
        offerStatus: 'accepted',
        priceOffer: { $gt: 0 }
      }).populate('productId');

      samples = [];
      source = 'store';
      for (const msg of messages) {
        if (msg.productId && typeof msg.productId.price === 'number') {
          samples.push({ x: msg.productId.price, y: msg.priceOffer });
        }
      }
    }

    // 3. If still fewer than 5 samples, generalize platform-wide
    if (samples.length < 5) {
      messages = await Message.find({
        offerStatus: 'accepted',
        priceOffer: { $gt: 0 }
      }).populate('productId');

      samples = [];
      source = 'platform';
      for (const msg of messages) {
        if (msg.productId && typeof msg.productId.price === 'number') {
          samples.push({ x: msg.productId.price, y: msg.priceOffer });
        }
      }
    }

    const N = samples.length;
    let m = 0.85; // default fallback slope (85% of original price)
    let c = 0;    // default fallback intercept
    let regressionUsed = false;

    if (N >= 5) {
      let sumX = 0, sumY = 0;
      for (const s of samples) {
        sumX += s.x;
        sumY += s.y;
      }
      const meanX = sumX / N;
      const meanY = sumY / N;

      let num = 0;
      let den = 0;
      for (const s of samples) {
        num += (s.x - meanX) * (s.y - meanY);
        den += Math.pow(s.x - meanX, 2);
      }

      if (den > 0) {
        m = num / den;
        c = meanY - m * meanX;
        regressionUsed = true;
      } else {
        // All x values are identical, use mean ratio
        const ratio = meanY / meanX;
        m = (ratio >= 0.5 && ratio <= 1.0) ? ratio : 0.85;
        c = 0;
      }
    } else {
      source = 'default';
    }

    // Calculate floor price
    let recommendedFloorPrice = m * product.price + c;

    // Bound recommended price to prevent sacrificing profit margins too much (e.g. min 75%, max 95% of original price)
    const minFloor = product.price * 0.75;
    const maxFloor = product.price * 0.95;
    recommendedFloorPrice = Math.max(minFloor, Math.min(maxFloor, recommendedFloorPrice));

    // Round to 2 decimal places
    recommendedFloorPrice = Math.round(recommendedFloorPrice * 100) / 100;

    res.json({
      success: true,
      productId: product._id,
      productPrice: product.price,
      recommendedFloorPrice,
      model: {
        slope: m,
        intercept: c,
        samplesUsed: N,
        source,
        regressionUsed
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Resolve or initialize a chat session between shopper and vendor
// @route   POST /api/negotiation/resolve-session
// @access  Private (Shopper, Vendor, or Store Admin)
router.post('/resolve-session', protect, async (req, res) => {
  try {
    const { customerId, vendorId, productId } = req.body;

    if (!customerId || !vendorId) {
      return res.status(400).json({ success: false, message: 'customerId and vendorId are required fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(customerId) || !mongoose.Types.ObjectId.isValid(vendorId)) {
      return res.status(400).json({ success: false, message: 'Invalid customerId or vendorId format' });
    }

    // Resolve storeId from vendorId
    let store = await Store.findOne({ vendorId: new mongoose.Types.ObjectId(vendorId) });
    
    // Fallback: Check if store exists via logged-in user details if user is vendor
    if (!store && req.user && (req.user.role === 'vendor' || req.user.role === 'storeAdmin')) {
      const activeStoreId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
      if (activeStoreId) {
        store = await Store.findById(activeStoreId);
      }
    }

    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for this vendor context' });
    }

    const storeId = store._id;

    // Check if a historical session already exists
    let session = await ChatSession.findOne({ storeId, shopperId: customerId });
    let messages = [];

    if (session) {
      // If found: fetch the historic conversation history log
      messages = await Message.find({ storeId, shopperId: customerId })
        .populate('productId', 'title price images slug')
        .populate('senderId', 'name role')
        .sort({ createdAt: 1 });
    } else {
      // If not found: atomically generate a single persistent thread entry document in the DB
      session = await ChatSession.create({
        storeId,
        shopperId: customerId,
        status: 'unassigned',
        lastActivity: new Date()
      });
    }

    res.json({
      success: true,
      roomId: session._id.toString(),
      messages,
      session
    });
  } catch (error) {
    console.error('resolve-session endpoint error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
