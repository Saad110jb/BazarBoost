import express from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import WalletTopup from '../models/WalletTopup.js';
import ComplaintTicket from '../models/ComplaintTicket.js';
import { protect } from '../middleware/auth.js';
import { verifyTenantAccess } from '../middleware/rbac.js';
import { logActivity } from '../services/auditService.js';
import { pushNotification, dispatchNotification } from '../services/notificationService.js';
import { cancelOrderInternal } from '../services/orderService.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { performOCR } from '../services/ocrService.js';
import { resolveTakeRate } from '../services/takeRateService.js';

// Setup temp receipt uploader
const BASE_UPLOAD_DIR = './src/uploads';
const receiptsDir = path.join(BASE_UPLOAD_DIR, 'receipts');
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, receiptsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `receipt-${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const uploadTempReceipt = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|webp/i.test(path.extname(file.originalname || '')) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image receipts (JPG, PNG, WebP) are accepted.'));
    }
  }
});

const toPublicUrl = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  const uploadsIdx = normalized.indexOf('uploads/');
  return uploadsIdx !== -1 ? '/' + normalized.substring(uploadsIdx) : '/' + normalized;
};

const router = express.Router();

// Helper: round monetary value to exactly 2 decimal places
const toPKR = (value) => Math.round(parseFloat(value) * 100) / 100;

router.post('/', protect, async (req, res) => {
  const { 
    storeId, items, totalAmount, shippingAddress, city, deliveryType, 
    customNotes, couponCode, paymentMethod, referenceId, paymentReceiptUrl, ocrResult 
  } = req.body;
  
  if (!storeId || !items || !totalAmount || !shippingAddress || !city) {
    return res.status(400).json({ success: false, message: 'storeId, items, totalAmount, shippingAddress, and city are required' });
  }

  if (!mongoose.Types.ObjectId.isValid(storeId)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing Store ID context. Legacy cart items must be re-added.' });
  }

  try {
    // 1. Fetch store and charge platform commission
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // Checkout block rule for suspended/Red Zone store
    if (!store.isActive || store.debtZone === 'red') {
      return res.status(403).json({ success: false, message: 'This store is suspended due to outstanding commission debt. Checkout is disabled.' });
    }

    // Verify city serviceability
    const SERVICEABLE_CITIES = ['Karachi', 'Lahore', 'Islamabad', 'Faisalabad', 'Rawalpindi'];
    if (!SERVICEABLE_CITIES.map(c => c.toLowerCase()).includes(city.toLowerCase())) {
      return res.status(400).json({ success: false, message: `City '${city}' is not serviced. Serviceable hubs: ${SERVICEABLE_CITIES.join(', ')}` });
    }

    const origin = store.originCity || 'Lahore';
    const isInCity = origin.toLowerCase() === city.toLowerCase();
    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
    const shippingPremium = isInCity ? 60 : (250 + (totalQty * 50) + 20);
    const resolvedDeliveryType = isInCity ? 'in-city' : 'out-of-city';
    const deliverySLA = isInCity ? '24-48 Hours' : '3-5 operational business days';

    // Calculate subtotal and validate coupon code before charging platform commission
    const calculatedSubtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let marketingDiscount = 0;

    if (couponCode) {
      const coupon = await Coupon.findOne({ storeId, code: couponCode.toUpperCase() });
      if (!coupon || !coupon.isActive) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive coupon code' });
      }

      if (new Date() > new Date(coupon.expiresAt)) {
        return res.status(400).json({ success: false, message: 'This promotional code has expired.' });
      }

      // Check user historical limit (RULE 2)
      const previousUsageCount = await Order.countDocuments({
        shopperId: req.user._id,
        couponCode: couponCode.toUpperCase(),
        status: { $ne: 'cancelled' }
      });
      if (coupon.usageLimit !== null && previousUsageCount >= coupon.usageLimit) {
        return res.status(400).json({ success: false, message: 'You have already reached the maximum usage limit for this coupon code.' });
      }

      // Check min spend boundaries (RULE 3)
      if (calculatedSubtotal < coupon.minSpend) {
        return res.status(400).json({ success: false, message: `Minimum order value of Rs. ${coupon.minSpend} required to unlock this coupon.` });
      }

      // Apply Deduction Type Transforms
      if (coupon.discountType === 'fixed') {
        marketingDiscount = Math.min(coupon.discountValue, calculatedSubtotal);
      } else if (coupon.discountType === 'percentage') {
        marketingDiscount = (calculatedSubtotal * coupon.discountValue) / 100;
      }
    }

    const finalSubtotal = calculatedSubtotal - marketingDiscount;

    let loyaltyDiscount = 0;
    let loyaltyTier = 'Standard';

    // Fetch loyalty config and rolling calendar month cache
    const LoyaltyConfig = (await import('../models/LoyaltyConfig.js')).default;
    const LoyaltyLedgerCache = (await import('../models/LoyaltyLedgerCache.js')).default;

    const loyaltyConfig = await LoyaltyConfig.findOne() || {
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000,
      silverDiscount: 5,
      goldDiscount: 10
    };

    const getCurrentMonthKey = () => {
      const d = new Date();
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    };

    if (loyaltyConfig.isActive) {
      const monthKey = getCurrentMonthKey();
      const loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: req.user._id, monthKey });
      const currentSpend = loyaltyCache ? loyaltyCache.accumulatedSpend : 0;

      if (currentSpend >= loyaltyConfig.goldThreshold) {
        loyaltyTier = 'Gold';
        loyaltyDiscount = toPKR(finalSubtotal * (loyaltyConfig.goldDiscount / 100));
      } else if (currentSpend >= loyaltyConfig.silverThreshold) {
        loyaltyTier = 'Silver';
        loyaltyDiscount = toPKR(finalSubtotal * (loyaltyConfig.silverDiscount / 100));
      }
    }

    const finalDiscountedSubtotal = finalSubtotal - loyaltyDiscount;
    const finalTotalAmount = finalDiscountedSubtotal + shippingPremium;

    // RTO Fraud Protection Check for COD Payment Method
    let downPaymentAmount = 0;
    let isRtoRiskFlagged = false;
    const ShopperProfile = (await import('../models/ShopperProfile.js')).default;
    const shopperProfile = await ShopperProfile.findOne({ userId: req.user._id });

    const totalOrdersCount = await Order.countDocuments({ shopperId: req.user._id });
    const cancelledOrdersCount = await Order.countDocuments({ shopperId: req.user._id, status: 'cancelled' });
    const cancellationRate = totalOrdersCount > 0 ? (cancelledOrdersCount / totalOrdersCount) : 0;
    const isHighRisk = totalOrdersCount >= 3 && cancellationRate >= 0.3;

    const hasHighFraudRisk = (shopperProfile && shopperProfile.fraudRiskLevel === 'HIGH') || (shopperProfile && shopperProfile.codDisabled);

    if (paymentMethod === 'cod') {
      if (hasHighFraudRisk) {
        downPaymentAmount = toPKR(finalTotalAmount * 0.25); // 25% non-refundable downpayment
        isRtoRiskFlagged = true;
        const walletBalance = shopperProfile ? shopperProfile.balancePKR : 0;

        if (walletBalance < downPaymentAmount) {
          return res.status(400).json({
            success: false,
            message: `COD disabled — wallet down-payment required. A 25% non-refundable digital wallet down-payment of Rs. ${downPaymentAmount} is required before confirming this Cash-on-Delivery order. Your current wallet balance is Rs. ${walletBalance}. Please top up your shopper wallet.`,
            code: 'COD_DISABLED_WALLET_DOWNPAYMENT_REQUIRED',
            requiredDownPayment: downPaymentAmount
          });
        }

        // Deduct downpayment from shopper's wallet balance
        shopperProfile.balancePKR = toPKR(shopperProfile.balancePKR - downPaymentAmount);
        await shopperProfile.save();
        console.log(`[Fraud Guardrail Down-Payment] Deducted Rs. ${downPaymentAmount} (25%) from high-risk shopper ${req.user._id} wallet balance.`);
      } else if (isHighRisk) {
        downPaymentAmount = toPKR(finalTotalAmount * 0.15); // 15% partial downpayment
        isRtoRiskFlagged = true;
        const walletBalance = shopperProfile ? shopperProfile.balancePKR : 0;

        if (walletBalance < downPaymentAmount) {
          return res.status(400).json({
            success: false,
            message: `High RTO Risk Profile: A 15% partial digital wallet down-payment of Rs. ${downPaymentAmount} is required before confirming this Cash-on-Delivery order. Your current wallet balance is Rs. ${walletBalance}. Please top up your shopper wallet.`
          });
        }

        // Deduct downpayment from shopper's wallet balance
        if (shopperProfile) {
          shopperProfile.balancePKR = toPKR(shopperProfile.balancePKR - downPaymentAmount);
          await shopperProfile.save();
        }
        console.log(`[RTO Down-Payment] Deducted Rs. ${downPaymentAmount} from high-risk shopper ${req.user._id} wallet balance.`);
      }
    }

    // Resolve dynamic take rate commission
    const orderProductIds = items.map(item => item.productId);
    const orderProducts = await Product.find({ _id: { $in: orderProductIds } });
    const orderCategories = orderProducts.flatMap(p => p.aiTags || []);
    const resolvedTakeRatePercent = await resolveTakeRate(store, orderCategories);

    // Recalculate platform commission based on resolved dynamic take-rate
    const platformCommission = toPKR((calculatedSubtotal - marketingDiscount) * (resolvedTakeRatePercent / 100) - loyaltyDiscount);

    // Charge platform commission atomically from vendor wallet
    const walletBalance = store.wallet?.balancePKR || 0;
    let debitAmount = 0;
    let outstandingAmount = 0;

    if (walletBalance >= platformCommission) {
      debitAmount = platformCommission;
    } else {
      debitAmount = walletBalance;
      outstandingAmount = toPKR(platformCommission - walletBalance);
    }

    // Apply deductions to store profile
    store.wallet = store.wallet || {};
    store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) - debitAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + debitAmount);
    store.wallet.outstandingCommission = toPKR((store.wallet.outstandingCommission || 0) + outstandingAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    if (global.io) {
      global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
        storeId: store._id.toString(),
        balancePKR: store.wallet.balancePKR,
        wallet: store.wallet
      });
    }

    console.log(`[Platform Commission] Order submitted. Commission calculated on discounted subtotal: Rs. ${platformCommission}. Charged wallet: Rs. ${debitAmount}. Outstanding debt logged: Rs. ${outstandingAmount}`);

    // Increment coupon usage count on success
    if (couponCode) {
      const coupon = await Coupon.findOne({ storeId, code: couponCode.toUpperCase() });
      if (coupon) {
        coupon.usageCount += 1;
        await coupon.save();
        console.log(`[Coupon Validation] Dynamic code ${couponCode} usage count incremented. New usageCount: ${coupon.usageCount}`);
      }
    }

    // Add shipping premium fee (already computed at the top)

    // Deduct stock atomically for each checkout item, with rollback on failure
    const deductedProducts = [];
    try {
      for (const item of items) {
        // Atomic deduction check: stock must be >= item.quantity
        const updatedProduct = await Product.findOneAndUpdate(
          { _id: item.productId, stock: { $gte: item.quantity } },
          { $inc: { stock: -item.quantity, stockBalance: -item.quantity } },
          { new: true }
        );
        if (!updatedProduct) {
          throw new Error(`Insufficient stock for product: ${item.title || item.productId}`);
        }
        
        // Track for rollback in case of subsequent failures
        deductedProducts.push({ productId: item.productId, quantity: item.quantity });
        
        // Calculate low stock status and update product
        const isLowStock = updatedProduct.stock < 5;
        await Product.updateOne({ _id: updatedProduct._id }, { $set: { isLowStock } });
        
        // Emit Socket.io stock sync notification
        if (global.io) {
          console.log(`[Database Listener] Product ${updatedProduct._id} stock updated to ${updatedProduct.stock} (Low Stock: ${isLowStock}). Broadcasting to store:${updatedProduct.storeId}`);
          global.io.to(`store:${updatedProduct.storeId.toString()}`).emit('product_stock_alert', {
            productId: updatedProduct._id.toString(),
            stock: updatedProduct.stock,
            isLowStock
          });
        }
      }
    } catch (stockError) {
      // ROLLBACK: add the deducted quantities back to the database
      console.error(`[Stock Orchestration Fail] Rolling back inventory changes. Reason:`, stockError.message);
      for (const ded of deductedProducts) {
        await Product.findByIdAndUpdate(ded.productId, { $inc: { stock: ded.quantity, stockBalance: ded.quantity } });
        // Restore low stock stats
        const prod = await Product.findById(ded.productId);
        if (prod) {
          const isLowStock = prod.stock < 5;
          await Product.updateOne({ _id: prod._id }, { $set: { isLowStock } });
          if (global.io) {
            global.io.to(`store:${prod.storeId.toString()}`).emit('product_stock_alert', {
              productId: prod._id.toString(),
              stock: prod.stock,
              isLowStock
            });
          }
        }
      }
      return res.status(400).json({ success: false, message: stockError.message });
    }

    const order = await Order.create({
      shopperId: req.user._id,
      storeId,
      items,
      totalAmount: finalTotalAmount,
      shippingAddress,
      city,
      deliveryType: resolvedDeliveryType,
      deliverySLA,
      customNotes: customNotes || '',
      couponCode: couponCode || '',
      marketingDiscount,
      loyaltyDiscount,
      loyaltyTier,
      shippingPremium,
      platformCommission,
      commissionDebitedPKR: debitAmount,
      commissionOutstandingPKR: outstandingAmount,
      paymentMethod: paymentMethod || 'cod',
      referenceId: referenceId || '',
      paymentReceiptUrl: paymentReceiptUrl || '',
      ocrResult: ocrResult || {},
      downPaymentAmount,
      isRtoRiskFlagged,
      status: 'pending_approval' // Starts directly in pending approval for merchant pipeline
    });

    // Dynamically update shopper's accumulated spend balance for current calendar month
    if (loyaltyConfig.isActive) {
      const monthKey = getCurrentMonthKey();
      let loyaltyCache = await LoyaltyLedgerCache.findOne({ userId: req.user._id, monthKey });
      if (!loyaltyCache) {
        loyaltyCache = new LoyaltyLedgerCache({
          userId: req.user._id,
          monthKey,
          accumulatedSpend: 0,
          claimsCount: 0
        });
      }
      const originalSpend = loyaltyCache.accumulatedSpend;
      loyaltyCache.accumulatedSpend = toPKR(loyaltyCache.accumulatedSpend + finalSubtotal);
      if (loyaltyDiscount > 0) {
        loyaltyCache.claimsCount += 1;
      }
      loyaltyCache.lastUpdated = new Date();
      await loyaltyCache.save();

      // Check if shopper crossed spend ceiling thresholds for WS log tickers
      let newTier = 'Standard';
      if (loyaltyCache.accumulatedSpend >= loyaltyConfig.goldThreshold) newTier = 'Gold';
      else if (loyaltyCache.accumulatedSpend >= loyaltyConfig.silverThreshold) newTier = 'Silver';

      let oldTier = 'Standard';
      if (originalSpend >= loyaltyConfig.goldThreshold) oldTier = 'Gold';
      else if (originalSpend >= loyaltyConfig.silverThreshold) oldTier = 'Silver';

      if (newTier !== oldTier && newTier !== 'Standard') {
        const upgradeMsg = `[INFO] Customer #USR-${req.user._id.toString().slice(-6).toUpperCase()} surpassed current month spend ceiling of Rs. ${(newTier === 'Gold' ? loyaltyConfig.goldThreshold : loyaltyConfig.silverThreshold).toLocaleString()}. Upgraded to ${newTier} Tier (${newTier === 'Gold' ? loyaltyConfig.goldDiscount : loyaltyConfig.silverDiscount}% markdown active platform-wide for the remainder of [Current Month]).`;
        if (global.io) {
          global.io.emit('loyalty_log_event', { text: upgradeMsg, timestamp: new Date() });
        }
      }

      if (loyaltyDiscount > 0) {
        const rebateMsg = `[REBATE] Order #ORD-${order._id.toString().slice(-6).toUpperCase()} processed at a ${loyaltyTier} discount markdown. Rs. ${loyaltyDiscount.toLocaleString()} platform subsidy written to monthly escrow tracking accounts.`;
        if (global.io) {
          global.io.emit('loyalty_log_event', { text: rebateMsg, timestamp: new Date() });
        }
      }

      const syncMsg = `[LOGISTICS] Cross-store basket checkout validated successfully. Monthly spend metrics synchronized under tier guidelines.`;
      if (global.io) {
        global.io.emit('loyalty_log_event', { text: syncMsg, timestamp: new Date() });
      }
    }

    dispatchNotification('ORDER_CREATED', { order, shopper: req.user });

    try {
      const { broadcastVendorDashboardMetrics } = await import('../config/socketHandler.js');
      await broadcastVendorDashboardMetrics(order.storeId, 'UPDATE', null);
    } catch (err) {
      console.error('Error broadcasting vendor metrics upon order creation:', err);
    }

    res.status(201).json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all orders for a store
// @route   GET /api/orders/store/:storeId
// @access  Private (Vendor or Store Admin)
router.get('/store/:storeId', protect, verifyTenantAccess, async (req, res) => {
  try {
    const orders = await Order.find({ storeId: req.params.storeId })
      .populate('shopperId', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update order status with Kanban gates & financial split
// @route   PUT /api/orders/:id/status
// @access  Private (Vendor or Store Admin)
router.put('/:id/status', protect, async (req, res) => {
  const { status, driverName, driverContact, courierName, trackingId } = req.body;
  
  const validStatuses = ['pending_payment', 'pending_approval', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid target status' });
  }

  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Tenant authorization check
    if (req.user.role !== 'admin' && !req.user.tenantStores.includes(order.storeId.toString()) && req.user.activeStoreId !== order.storeId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized store context' });
    }

    const currentStatus = order.status;

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 1: Pending Approval ──► Processing/Packing
    // ─────────────────────────────────────────────────────────────────────────
    if (currentStatus === 'pending_approval' && status === 'processing') {
      // Compute 5% platform commission
      order.platformCommission = toPKR((order.totalAmount - (order.shippingPremium || 0)) * 0.05);

      // Validation based on Delivery Type
      if (order.deliveryType === 'in-city') {
        if (!driverName || !driverContact) {
          return res.status(400).json({
            success: false,
            message: 'Validation failed: In-City delivery requires driver name and driver contact number.'
          });
        }
        order.driverName = driverName;
        order.driverContact = driverContact;
      } else if (order.deliveryType === 'out-of-city') {
        if (!order.city) {
          return res.status(400).json({ success: false, message: 'Validation failed: Out-of-City delivery requires a valid regional city destination.' });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 2: Processing/Packing ──► Dispatched/Shipped
    // ─────────────────────────────────────────────────────────────────────────
    else if (currentStatus === 'processing' && status === 'dispatched') {
      if (order.deliveryType === 'in-city') {
        if (!order.driverName) {
          return res.status(400).json({ success: false, message: 'Validation failed: Driver details must be assigned before dispatching In-City delivery.' });
        }
      } else if (order.deliveryType === 'out-of-city') {
        if (!courierName || !trackingId) {
          return res.status(400).json({
            success: false,
            message: 'Validation failed: Out-of-City delivery requires courier name (e.g. TCS, Leopards, Trax) and a tracking ID.'
          });
        }
        // Validate tracking ID is alphanumeric
        const alphanumericRegex = /^[a-zA-Z0-9]+$/;
        if (!alphanumericRegex.test(trackingId)) {
          return res.status(400).json({ success: false, message: 'Validation failed: Tracking ID must be a unique alphanumeric string.' });
        }
        order.courierName = courierName;
        order.trackingId = trackingId;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 3: Dispatched/Shipped ──► Delivered
    // ─────────────────────────────────────────────────────────────────────────
    else if (currentStatus === 'dispatched' && status === 'delivered') {
      console.log(`COD order ${order._id} cash collection confirmed.`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 4: Delivered ──► Completed (Auto Commission Deduction)
    // ─────────────────────────────────────────────────────────────────────────
    else if (currentStatus === 'delivered' && status === 'completed') {
      const commissionDue = toPKR(order.platformCommission || ((order.totalAmount - (order.shippingPremium || 0)) * 0.05));
      const storeDoc = await Store.findById(order.storeId);
      if (storeDoc) {
        const currentBalance = toPKR(storeDoc.wallet?.balancePKR || 0);
        let deductFromBalance = 0;
        let addToOutstanding = 0;

        if (currentBalance >= commissionDue) {
          deductFromBalance = commissionDue;
        } else {
          deductFromBalance = currentBalance;
          addToOutstanding = toPKR(commissionDue - currentBalance);
        }

        storeDoc.wallet = storeDoc.wallet || {};
        
        // Check if store is suspended / in Red Zone BEFORE updating outstanding commission
        const isRedZone = storeDoc.isActive === false || storeDoc.debtZone === 'red';

        storeDoc.wallet.balancePKR = toPKR(currentBalance - deductFromBalance);
        storeDoc.wallet.outstandingCommission = toPKR((storeDoc.wallet.outstandingCommission || 0) + addToOutstanding);
        storeDoc.wallet.totalSpentPKR = toPKR((storeDoc.wallet.totalSpentPKR || 0) + deductFromBalance);

        if (isRedZone) {
          // in-flight collections bypass the vendor to pay down debt
          const outstanding = storeDoc.wallet.outstandingCommission || 0;
          const bypassAmount = Math.min(order.totalAmount, outstanding);
          if (bypassAmount > 0) {
            storeDoc.wallet.outstandingCommission = toPKR(outstanding - bypassAmount);
            console.log(`[Bypass Collection] Store ${storeDoc.name} is in Red Zone. In-flight collection of Rs. ${bypassAmount} from Order ${order._id} bypassed vendor to pay down outstanding commission.`);
            
            // Create a ledger transaction record for this bypass payment
            try {
              await WalletTopup.create({
                vendorId: storeDoc.vendorId,
                storeId: storeDoc._id,
                amountPKR: bypassAmount,
                referenceId: `BYPASS-ORD-${order._id.toString().substring(18).toUpperCase()}`,
                paymentReceiptUrl: '/uploads/receipts/sandbox.png',
                paymentStatus: 'approved',
                type: 'commission_payment',
                message: `In-flight collection bypassed vendor to pay down commission debt (Order #${order._id.toString().substring(18).toUpperCase()})`
              });
            } catch (txErr) {
              console.error('[Bypass Collection Transaction Error]', txErr.message);
            }
          }
        }

        storeDoc.wallet.lastUpdated = new Date();
        await storeDoc.save();

        console.log(`[Commission Auto-Deduct] Order ${order._id} completed. Commission: PKR ${commissionDue}. Deducted from balance: PKR ${deductFromBalance}. Added to outstanding: PKR ${addToOutstanding}.`);

        // Record a transaction for the auto-deduction if any balance was used
        if (deductFromBalance > 0) {
          try {
            await WalletTopup.create({
              vendorId: storeDoc.vendorId,
              storeId: storeDoc._id,
              amountPKR: deductFromBalance,
              referenceId: `COMM-AUTO-${order._id.toString().substring(18).toUpperCase()}`,
              paymentReceiptUrl: '/uploads/receipts/sandbox.png',
              paymentStatus: 'approved',
              type: 'commission_payment',
              message: `Auto-deducted 5% commission for Order #${order._id.toString().substring(18).toUpperCase()} from wallet balance`
            });
          } catch (txErr) {
            console.error('[Commission Auto-Deduct Transaction Error]', txErr.message);
          }
        }

        // Notify the vendor
        try {
          if (global.io) {
            global.io.to(`user:${storeDoc.vendorId.toString()}`).emit('commission_due', {
              orderId: order._id.toString(),
              commissionDue,
              totalOutstanding: toPKR(storeDoc.wallet.outstandingCommission || 0)
            });
          }
        } catch (notifErr) {
          console.error('[Commission Notify Error]', notifErr.message);
        }
      }
    }

    // Log status transitions in the activity tracker
    await logActivity(
      order.storeId,
      req.user._id,
      req.user.name,
      'ORDER_STATUS_UPDATE',
      `Changed order #${order._id.toString().slice(-8).toUpperCase()} status from '${currentStatus}' to '${status}'.`
    );

    // Update state and save
    order.status = status;
    await order.save();

    if ((status === 'completed' || status === 'delivered') && !order.isPayoutProcessed) {
      try {
        const { processFulfillmentPayout } = await import('../services/orderService.js');
        await processFulfillmentPayout(order._id);
      } catch (payoutErr) {
        console.error('[Payout Sweep Error]', payoutErr.message);
      }
    }

    // Emit WebSocket update for this specific order to sync customer timeline in real-time
    if (global.io) {
      console.log(`[Order Socket] Broadcasting order_status_update for order:${order._id}`);
      global.io.to(`order:${order._id.toString()}`).emit('order_status_update', {
        orderId: order._id.toString(),
        status: order.status,
        driverName: order.driverName,
        driverContact: order.driverContact,
        courierName: order.courierName,
        trackingId: order.trackingId
      });

      // Broadcast wallet and commission updates to the vendor's user channel
      try {
        const storeDoc = await Store.findById(order.storeId);
        if (storeDoc && storeDoc.vendorId) {
          global.io.to(`user:${storeDoc.vendorId.toString()}`).emit('wallet_updated', {
            storeId: storeDoc._id.toString(),
            balancePKR: storeDoc.wallet?.balancePKR || 0,
            wallet: storeDoc.wallet
          });
          global.io.to(`user:${storeDoc.vendorId.toString()}`).emit('commission_due', {
            orderId: order._id.toString(),
            commissionDue: order.platformCommission,
            totalOutstanding: storeDoc.wallet?.outstandingCommission || 0
          });
        }
      } catch (err) {
        console.error('[Order Status Wallet Socket Notify Error]', err.message);
      }
    }

    // Dispatch order status changed event (push notification + transaction email)
    dispatchNotification('ORDER_STATUS_CHANGED', { order, statusText: status });

    try {
      const { broadcastVendorDashboardMetrics } = await import('../config/socketHandler.js');
      await broadcastVendorDashboardMetrics(order.storeId, 'UPDATE', null);
    } catch (err) {
      console.error('Error broadcasting vendor metrics upon order status change:', err);
    }

    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Upload payment receipt image (for Shoppers checking out via Manual Bank Transfer)
// @route   POST /api/orders/upload-receipt
// @access  Private (Shopper)
router.post('/upload-receipt', protect, uploadTempReceipt.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload a payment transfer receipt image.' });
  }

  try {
    const receiptPath = req.file.path.replace(/\\/g, '/');
    const paymentReceiptUrl = toPublicUrl(req.file.path);

    // Run local OCR verification for receipt validation & fraud check
    console.log(`Running local OCR analysis on shopper receipt: ${receiptPath}`);
    const ocrResult = await performOCR(req.file.path);

    res.status(200).json({
      success: true,
      message: 'Receipt uploaded successfully. OCR analysis completed.',
      paymentReceiptUrl,
      ocrResult
    });
  } catch (error) {
    console.error('Error uploading receipt:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all orders for the logged-in shopper
// @route   GET /api/orders
// @access  Private (Shopper)
router.get('/', protect, async (req, res) => {
  try {
    const orders = await Order.find({ shopperId: req.user._id })
      .populate('storeId', 'name slug logo')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Vendor Dashboard Stats — real aggregated data
// @route   GET /api/orders/dashboard-stats
// @access  Private (Vendor / Store Admin)
// IMPORTANT: This route MUST appear before GET /:id to prevent Express
// from treating the string "dashboard-stats" as a MongoDB ObjectId.
router.get('/dashboard-stats', protect, async (req, res) => {
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'No active store context found' });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);

    // 1. All non-cancelled orders for this store
    const orders = await Order.find({
      storeId: storeObjectId,
      status: { $ne: 'cancelled' }
    }).lean();

    // 2. Total revenue
    const totalRevenue = toPKR(orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0));

    // 3. Monthly sales breakdown (last 6 months)
    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlySales = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = monthNames[d.getMonth()];
      const monthOrders = orders.filter(o => {
        const created = new Date(o.createdAt);
        return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth();
      });
      monthlySales.push({
        month: label,
        sales: toPKR(monthOrders.reduce((s, o) => s + (o.totalAmount || 0), 0)),
        orders: monthOrders.length
      });
    }

    // 4. Category breakdown via Product lookup (orderItems have no category field)
    const CATEGORY_COLORS = {
      'Electronics': '#3b82f6',
      'Clothing': '#ec4899',
      'Home & Kitchen': '#f59e0b',
      'Food': '#10b981',
      'Beauty': '#a855f7',
      'Sports': '#f97316',
      'Books': '#06b6d4',
      'Uncategorized': '#6b7280'
    };

    const categoryAgg = await Order.aggregate([
      { $match: { storeId: storeObjectId, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$productInfo.category', 'Uncategorized'] },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 6 }
    ]);

    const totalCatValue = categoryAgg.reduce((s, c) => s + c.totalRevenue, 0) || 1;
    const categoryData = categoryAgg.map(c => ({
      name: c._id,
      value: Math.round((c.totalRevenue / totalCatValue) * 100),
      color: CATEGORY_COLORS[c._id] || '#6b7280'
    }));

    const vendorId = req.user.role === 'storeAdmin'
      ? (await Store.findById(storeId).select('vendorId').lean())?.vendorId
      : req.user._id;

    // 5. Active product count for this store
    const activeProductsCount = await Product.countDocuments({
      vendorId,
      status: 'ACTIVE',
      stockBalance: { $gt: 0 } // Exclude completely exhausted inventory profiles dynamically
    });

    // 6. Ad impressions + conversions from approved bids
    const AdBid = (await import('../models/AdBid.js')).default;

    const adBids = await AdBid.find({
      vendorId,
      paymentStatus: 'approved'
    }).populate('slotId', 'name').lean();

    const totalImpressions = adBids.reduce((s, b) => s + (b.impressions || 0), 0);
    const totalConversions = adBids.reduce((s, b) => s + (b.conversions || 0), 0);

    const adSlotMap = {};
    adBids.forEach(b => {
      const slotName = b.slotId?.name || 'Unknown Slot';
      if (!adSlotMap[slotName]) {
        adSlotMap[slotName] = { slot: slotName, impressions: 0, clicks: 0, conversions: 0 };
      }
      adSlotMap[slotName].impressions += b.impressions || 0;
      adSlotMap[slotName].clicks += Math.round((b.impressions || 0) * 0.09);
      adSlotMap[slotName].conversions += b.conversions || 0;
    });
    const adPerformanceData = Object.values(adSlotMap);

    // 7. Open negotiations
    const Message = (await import('../models/Message.js')).default;
    const openNegotiations = await Message.distinct('shopperId', { storeId: storeObjectId });

    res.json({
      success: true,
      stats: {
        totalRevenue,
        productCount: activeProductsCount,
        totalImpressions,
        totalConversions,
        openNegotiations: openNegotiations.length,
        orderCount: orders.length
      },
      monthlySales,
      categoryData: categoryData.length > 0 ? categoryData : [
        { name: 'No Sales Yet', value: 100, color: '#374151' }
      ],
      adPerformanceData
    });
  } catch (error) {
    console.error('[Dashboard Stats Error]', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get order details by ID
// @route   GET /api/orders/:id
// @access  Private (Shopper, Vendor, storeAdmin, or Admin)
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('shopperId', 'name email')
      .populate('storeId', 'name slug bankDetails logo theme vendorId');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Tenant authorization bounds checking
    const isShopper = order.shopperId._id.toString() === req.user._id.toString();
    const isVendor = req.user.role === 'vendor' && req.user.tenantStores.includes(order.storeId._id.toString());
    const isStoreAdmin = req.user.role === 'storeAdmin' && req.user.activeStoreId === order.storeId._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isShopper && !isVendor && !isStoreAdmin && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized order context' });
    }

    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Cancel order (Shopper instant/request/dispute or Vendor cancellation)
// @route   POST /api/orders/:id/cancel
// @access  Private (Shopper or Vendor)
router.post('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Authorization context
    const isShopper = order.shopperId.toString() === req.user._id.toString();
    const isVendor = req.user.role === 'vendor' && (req.user.tenantStores.includes(order.storeId.toString()) || req.user.activeStoreId === order.storeId.toString());
    const isStoreAdmin = req.user.role === 'storeAdmin' && req.user.activeStoreId === order.storeId.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isShopper && !isVendor && !isStoreAdmin && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized order cancellation context' });
    }

    if (order.status === 'cancelled') {
      return res.json({ success: true, message: 'Order is already cancelled.', order });
    }

    const { reason = 'Not specified' } = req.body;

    // Shopper cancellation rules
    if (isShopper && !isAdmin && !isVendor && !isStoreAdmin) {
      // 1. Grace Window: instant cancel within 1 hour when pending approval or pending payment
      const timeElapsed = Date.now() - new Date(order.createdAt).getTime();
      const oneHour = 60 * 60 * 1000;
      const isPending = ['pending_payment', 'pending_approval'].includes(order.status);

      if (isPending && timeElapsed <= oneHour) {
        await cancelOrderInternal(order, `Customer Cancel (Grace Window): ${reason}`, 'shopper', req.user);
        return res.json({ success: true, message: 'Order cancelled instantly during grace window.', order });
      }

      // 2. Processing Window: request cancel, pings vendor
      if (order.status === 'processing') {
        order.cancellationRequested = true;
        order.cancellationReason = reason;
        order.cancellationRequestedAt = new Date();
        await order.save();

        // Notify vendor store operators
        const storeDoc = await Store.findById(order.storeId);
        if (storeDoc) {
          const operatorTitle = '⚠️ Cancellation Requested';
          const operatorBody = `Customer has requested cancellation for Order #${order._id.toString().slice(-8).toUpperCase()}. Reason: ${reason}`;
          await pushNotification(storeDoc.vendorId, 'order_update', operatorTitle, operatorBody, { orderId: order._id.toString() });
        }

        return res.json({ success: true, message: 'Cancellation request submitted to vendor for review.', order });
      }

      // 3. Dispatched Gate: locked, generates triage ticket
      if (['dispatched', 'delivered', 'completed'].includes(order.status)) {
        const ticket = await ComplaintTicket.create({
          shopperId: order.shopperId,
          storeId: order.storeId,
          orderId: order._id,
          category: 'other',
          description: `Customer attempted to cancel order #${order._id.toString().slice(-8).toUpperCase()} after dispatch. Cancellation locked.`,
          status: 'open'
        });

        // Log audit log
        await logActivity(
          order.storeId,
          req.user._id,
          req.user.name,
          'ORDER_CANCEL_LOCKED',
          `Customer attempted to cancel order #${order._id.toString().slice(-8).toUpperCase()} (Status: ${order.status}). Cancellation locked, ComplaintTicket #${ticket._id.toString().slice(-8).toUpperCase()} generated.`
        );

        return res.status(400).json({
          success: false,
          code: 'LOCKED',
          message: 'Cancellation locked. Package is already in transit. A dispute ticket has been generated for the StoreAdmin.',
          ticket
        });
      }
    }

    // Vendor / Admin cancellation rules (must be prior to dispatch)
    if (isVendor || isStoreAdmin || isAdmin) {
      if (['dispatched', 'delivered', 'completed'].includes(order.status)) {
        return res.status(400).json({ success: false, message: 'Fulfillment is already in transit. Vendor cannot cancel dispatched/completed orders.' });
      }

      // Approves cancellation request or initiates merchant-side cancel
      await cancelOrderInternal(order, reason, 'vendor', req.user);
      return res.json({ success: true, message: 'Order cancelled successfully by merchant/admin.', order });
    }

    return res.status(400).json({ success: false, message: 'Invalid cancellation request context.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Reject order cancellation request
// @route   POST /api/orders/:id/reject-cancel
// @access  Private (Vendor or Store Admin)
router.post('/:id/reject-cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Tenant check
    const isVendor = req.user.role === 'vendor' && (req.user.tenantStores.includes(order.storeId.toString()) || req.user.activeStoreId === order.storeId.toString());
    const isStoreAdmin = req.user.role === 'storeAdmin' && req.user.activeStoreId === order.storeId.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isVendor && !isStoreAdmin && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Unauthorized merchant context' });
    }

    if (!order.cancellationRequested) {
      return res.status(400).json({ success: false, message: 'No active cancellation request exists for this order.' });
    }

    order.cancellationRequested = false;
    await order.save();

    // Push notification to shopper client
    const shopperTitle = '❌ Cancellation Request Denied';
    const shopperBody = `The merchant has rejected your cancellation request for Order #${order._id.toString().slice(-8).toUpperCase()} and is proceeding with fulfillment.`;
    await pushNotification(order.shopperId, 'order_update', shopperTitle, shopperBody, { orderId: order._id.toString() });

    // Log merchant action
    await logActivity(
      order.storeId,
      req.user._id,
      req.user.name,
      'ORDER_CANCEL_REJECT',
      `Merchant rejected customer cancellation request for order #${order._id.toString().slice(-8).toUpperCase()}.`
    );

    res.json({ success: true, message: 'Cancellation request successfully rejected. Shopper has been notified.', order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Check shopper RTO Risk and wallet balance
// @route   GET /api/orders/rto-check
// @access  Private (Shopper)
router.get('/rto-check', protect, async (req, res) => {
  try {
    const shopperId = req.user._id;
    const totalOrdersCount = await Order.countDocuments({ shopperId });
    const cancelledOrdersCount = await Order.countDocuments({ shopperId, status: 'cancelled' });
    const cancellationRate = totalOrdersCount > 0 ? (cancelledOrdersCount / totalOrdersCount) : 0;
    const isHighRisk = totalOrdersCount >= 3 && cancellationRate >= 0.3;

    const ShopperProfile = (await import('../models/ShopperProfile.js')).default;
    const shopperProfile = await ShopperProfile.findOne({ userId: shopperId });
    const walletBalance = shopperProfile ? shopperProfile.balancePKR : 0;

    res.json({
      success: true,
      isHighRisk,
      cancellationRate,
      totalOrders: totalOrdersCount,
      cancelledOrders: cancelledOrdersCount,
      walletBalance
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
