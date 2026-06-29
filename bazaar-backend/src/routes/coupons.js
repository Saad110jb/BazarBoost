import express from 'express';
import Coupon from '../models/Coupon.js';
import { protect } from '../middleware/auth.js';
import { verifyTenantAccess, requirePermission } from '../middleware/rbac.js';
import { logActivity } from '../services/auditService.js';
import { dispatchNotification } from '../services/notificationService.js';

const router = express.Router();

// Helper: round monetary values to 2 decimals
const toPKR = (val) => Math.round(parseFloat(val) * 100) / 100;

// @desc    Create a store coupon (Vendor / Store Admin with MANAGE_COUPONS)
// @route   POST /api/coupons
// @access  Private
router.post('/', protect, verifyTenantAccess, requirePermission('MANAGE_COUPONS'), async (req, res) => {
  const { code, discountType, discountValue, minSpend, usageLimit, expiresAt } = req.body;
  const storeId = req.user.activeStoreId || req.user.storeId;

  if (!code || !discountType || discountValue === undefined || !expiresAt) {
    return res.status(400).json({ success: false, message: 'code, discountType, discountValue, and expiresAt are required' });
  }

  try {
    const existing = await Coupon.findOne({ storeId, code: code.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A coupon with this code already exists for this store' });
    }

    const coupon = await Coupon.create({
      storeId,
      code: code.toUpperCase(),
      discountType,
      discountValue: parseFloat(discountValue),
      minSpend: minSpend ? parseFloat(minSpend) : 0,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      expiresAt: new Date(expiresAt),
      isActive: true
    });

    await logActivity(
      storeId,
      req.user._id,
      req.user.name,
      'COUPON_CREATE',
      `Generated promo code '${coupon.code}' (${coupon.discountType === 'percentage' ? coupon.discountValue + '%' : 'Rs. ' + coupon.discountValue} discount, spending cap Rs. ${coupon.minSpend}).`
    );

    // Broadcast marketing event coupon alert (emails to shoppers + socket push)
    dispatchNotification('MARKETING_EVENT', { campaign: coupon });

    res.status(201).json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all store coupons
// @route   GET /api/coupons/store/:storeId
// @access  Private
router.get('/store/:storeId', protect, verifyTenantAccess, async (req, res) => {
  try {
    const coupons = await Coupon.find({ storeId: req.params.storeId }).sort({ createdAt: -1 });
    res.json({ success: true, count: coupons.length, coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get active public coupons for a store
// @route   GET /api/coupons/public/store/:storeId
// @access  Public
router.get('/public/store/:storeId', async (req, res) => {
  try {
    const coupons = await Coupon.find({ 
      storeId: req.params.storeId, 
      isActive: true, 
      expiresAt: { $gt: new Date() } 
    }).sort({ createdAt: -1 });
    res.json({ success: true, count: coupons.length, coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Validate coupon code for customer checkout
// @route   POST /api/coupons/validate
// @access  Private (Shopper)
router.post('/validate', protect, async (req, res) => {
  const { storeId, code, cartAmount } = req.body;
  const userId = req.user._id;

  if (!storeId || !code || cartAmount === undefined) {
    return res.status(400).json({ success: false, message: 'storeId, code, and cartAmount are required' });
  }

  try {
    let couponResult;
    
    // Wrapped verification work block to run optionally in transaction session
    const work = async (session) => {
      // RULE 1: Tenant Matching & Expiration Check
      const coupon = await Coupon.findOne({ storeId, code: code.toUpperCase() }).session(session);
      if (!coupon || !coupon.isActive) {
        throw new Error('Invalid or inactive coupon code');
      }

      if (new Date() > new Date(coupon.expiresAt)) {
        throw new Error('This promotional code has expired.');
      }

      // RULE 2: Usage Capacity Check
      // Get historical orders for this user that are not cancelled
      const Order = mongoose.model('Order');
      const previousUsageCount = await Order.countDocuments({
        shopperId: userId,
        couponCode: code.toUpperCase(),
        status: { $ne: 'cancelled' }
      }).session(session);

      if (coupon.usageLimit !== null && previousUsageCount >= coupon.usageLimit) {
        throw new Error('You have already reached the maximum usage limit for this coupon code.');
      }

      // RULE 3: Basket Minimum Spend Check
      if (parseFloat(cartAmount) < coupon.minSpend) {
        throw new Error(`Minimum order value of Rs. ${coupon.minSpend} required to unlock this coupon.`);
      }

      return coupon;
    };

    // Run transaction with replica set compatibility fallback
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      couponResult = await work(session);
      await session.commitTransaction();
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }

    const coupon = couponResult;
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = Math.min(coupon.discountValue, parseFloat(cartAmount));
    } else if (coupon.discountType === 'percentage') {
      discountAmount = (parseFloat(cartAmount) * coupon.discountValue) / 100;
    }

    res.json({
      success: true,
      discountAmount: toPKR(discountAmount),
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minSpend: coupon.minSpend
      }
    });

  } catch (error) {
    // Return friendly validation message directly if matching specific business rules
    const validationErrors = [
      'Invalid or inactive coupon code',
      'This promotional code has expired.',
      'You have already reached the maximum usage limit for this coupon code.',
    ];
    
    if (validationErrors.includes(error.message) || error.message.startsWith('Minimum order value of Rs.')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    
    // Standalone local MongoDB deployment support fallback
    if (error.message.includes('replica set') || error.message.includes('transaction')) {
      try {
        const coupon = await Coupon.findOne({ storeId, code: code.toUpperCase() });
        if (!coupon || !coupon.isActive) {
          return res.status(400).json({ success: false, message: 'Invalid or inactive coupon code' });
        }
        if (new Date() > new Date(coupon.expiresAt)) {
          return res.status(400).json({ success: false, message: 'This promotional code has expired.' });
        }
        const Order = mongoose.model('Order');
        const previousUsageCount = await Order.countDocuments({
          shopperId: userId,
          couponCode: code.toUpperCase(),
          status: { $ne: 'cancelled' }
        });
        if (coupon.usageLimit !== null && previousUsageCount >= coupon.usageLimit) {
          return res.status(400).json({ success: false, message: 'You have already reached the maximum usage limit for this coupon code.' });
        }
        if (parseFloat(cartAmount) < coupon.minSpend) {
          return res.status(400).json({ success: false, message: `Minimum order value of Rs. ${coupon.minSpend} required to unlock this coupon.` });
        }

        let discountAmount = 0;
        if (coupon.discountType === 'fixed') {
          discountAmount = Math.min(coupon.discountValue, parseFloat(cartAmount));
        } else if (coupon.discountType === 'percentage') {
          discountAmount = (parseFloat(cartAmount) * coupon.discountValue) / 100;
        }

        return res.json({
          success: true,
          discountAmount: toPKR(discountAmount),
          coupon: {
            code: coupon.code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            minSpend: coupon.minSpend
          }
        });
      } catch (fallbackError) {
        return res.status(500).json({ success: false, message: fallbackError.message });
      }
    }

    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
