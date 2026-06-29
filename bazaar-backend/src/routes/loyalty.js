import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/auth.js';
import { verifyTenantAccess, requirePermission } from '../middleware/rbac.js';
import LoyaltyConfig from '../models/LoyaltyConfig.js';
import LoyaltyLedgerCache from '../models/LoyaltyLedgerCache.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

const router = express.Router();

const toPKR = (val) => Math.round(parseFloat(val) * 100) / 100;

// Helper: Get current month key in format YYYY-MM
const getCurrentMonthKey = () => {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// @desc    Get global loyalty config
// @route   GET /api/loyalty/config
// @access  Public
router.get('/config', async (req, res) => {
  try {
    let config = await LoyaltyConfig.findOne();
    if (!config) {
      config = await LoyaltyConfig.create({
        isActive: true,
        silverThreshold: 10000,
        goldThreshold: 20000,
        silverDiscount: 5,
        goldDiscount: 10
      });
    }
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update global loyalty config
// @route   PUT /api/loyalty/config
// @access  Private (Admin only)
router.put('/config', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
  }

  const { isActive, silverThreshold, goldThreshold, silverDiscount, goldDiscount } = req.body;

  try {
    let config = await LoyaltyConfig.findOne();
    if (!config) {
      config = new LoyaltyConfig();
    }

    if (isActive !== undefined) config.isActive = isActive;
    if (silverThreshold !== undefined) config.silverThreshold = parseFloat(silverThreshold);
    if (goldThreshold !== undefined) config.goldThreshold = parseFloat(goldThreshold);
    if (silverDiscount !== undefined) config.silverDiscount = parseFloat(silverDiscount);
    if (goldDiscount !== undefined) config.goldDiscount = parseFloat(goldDiscount);
    config.lastUpdated = new Date();

    await config.save();

    // Broadcast update notification to all WebSocket clients
    if (global.io) {
      global.io.emit('loyalty_config_updated', config);
    }

    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get dynamic loyalty status of the logged-in customer
// @route   GET /api/loyalty/status
// @access  Private (Shopper)
router.get('/status', protect, async (req, res) => {
  const monthKey = getCurrentMonthKey();
  const userId = req.user._id;

  try {
    const config = await LoyaltyConfig.findOne() || {
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000,
      silverDiscount: 5,
      goldDiscount: 10
    };

    let cache = await LoyaltyLedgerCache.findOne({ userId, monthKey });
    if (!cache) {
      cache = {
        userId,
        monthKey,
        accumulatedSpend: 0,
        claimsCount: 0
      };
    }

    // Determine current tier
    let tier = 'Standard';
    let discountPercent = 0;
    
    if (config.isActive) {
      if (cache.accumulatedSpend >= config.goldThreshold) {
        tier = 'Gold';
        discountPercent = config.goldDiscount;
      } else if (cache.accumulatedSpend >= config.silverThreshold) {
        tier = 'Silver';
        discountPercent = config.silverDiscount;
      }
    }

    res.json({
      success: true,
      monthKey,
      accumulatedSpend: cache.accumulatedSpend,
      claimsCount: cache.claimsCount,
      tier,
      discountPercent,
      config
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get platform monthly loyalty analytics (Superadmin panel)
// @route   GET /api/loyalty/analytics
// @access  Private (Admin only)
router.get('/analytics', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
  }

  const monthKey = getCurrentMonthKey();

  try {
    const config = await LoyaltyConfig.findOne() || {
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000,
      silverDiscount: 5,
      goldDiscount: 10
    };

    // HUD 1: Total Loyalist Pool (users with Silver or Gold status)
    const loyalists = await LoyaltyLedgerCache.find({
      monthKey,
      accumulatedSpend: { $gte: config.silverThreshold }
    }).lean();

    const silverPool = loyalists.filter(l => l.accumulatedSpend < config.goldThreshold).length;
    const goldPool = loyalists.filter(l => l.accumulatedSpend >= config.goldThreshold).length;
    const totalLoyalistPool = loyalists.length;

    // Fetch monthly order rollup stats
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const monthlyOrders = await Order.find({
      createdAt: { $gte: startOfMonth },
      status: { $ne: 'cancelled' }
    }).select('platformCommission loyaltyDiscount totalAmount').lean();

    // HUD 2: Total Revenue Subsidized (escrow monthly discount marks sum)
    const totalRevenueSubsidized = toPKR(monthlyOrders.reduce((sum, o) => sum + (o.loyaltyDiscount || 0), 0));

    // HUD 3: Live Shopping Velocity Index (real-time order transactions rate)
    // Counts non-cancelled checkout counts completed in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const liveVelocityIndex = await Order.countDocuments({
      createdAt: { $gte: oneHourAgo },
      status: { $ne: 'cancelled' }
    });

    // HUD 4: Platform Net Profit Split Yield (Final net yield)
    // sum(platformCommission) - sum(loyaltyDiscount)
    const totalCommission = monthlyOrders.reduce((sum, o) => sum + (o.platformCommission || 0), 0);
    const platformNetProfitSplitYield = toPKR(totalCommission - totalRevenueSubsidized);

    res.json({
      success: true,
      monthKey,
      hud: {
        totalLoyalistPool,
        silverPool,
        goldPool,
        totalRevenueSubsidized,
        liveVelocityIndex: liveVelocityIndex || 3, // fallback mockup if zero orders
        platformNetProfitSplitYield
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get global spend leaderboard for audit
// @route   GET /api/loyalty/leaderboard
// @access  Private (Admin only)
router.get('/leaderboard', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
  }

  const monthKey = getCurrentMonthKey();

  try {
    const config = await LoyaltyConfig.findOne() || {
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000,
      silverDiscount: 5,
      goldDiscount: 10
    };

    const caches = await LoyaltyLedgerCache.find({ monthKey })
      .populate('userId', 'name email role')
      .sort({ accumulatedSpend: -1 })
      .lean();

    const rows = caches.map(c => {
      let tier = 'Standard';
      if (config.isActive) {
        if (c.accumulatedSpend >= config.goldThreshold) tier = 'Gold';
        else if (c.accumulatedSpend >= config.silverThreshold) tier = 'Silver';
      }
      return {
        _id: c._id,
        userId: c.userId?._id || 'unknown',
        name: c.userId?.name || 'Shopper',
        email: c.userId?.email || 'N/A',
        accumulatedSpend: c.accumulatedSpend,
        monthKey: c.monthKey,
        claimsCount: c.claimsCount,
        tier
      };
    });

    res.json({ success: true, monthKey, leaderboard: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Manual spend override for validation overrides
// @route   POST /api/loyalty/override
// @access  Private (Admin only)
router.post('/override', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied: Admin only' });
  }

  const { userId, accumulatedSpend } = req.body;
  const monthKey = getCurrentMonthKey();

  if (!userId || accumulatedSpend === undefined) {
    return res.status(400).json({ success: false, message: 'userId and accumulatedSpend are required' });
  }

  try {
    const shopper = await User.findById(userId);
    if (!shopper) {
      return res.status(404).json({ success: false, message: 'Shopper not found' });
    }

    const config = await LoyaltyConfig.findOne() || {
      isActive: true,
      silverThreshold: 10000,
      goldThreshold: 20000
    };

    const parsedSpend = parseFloat(accumulatedSpend);

    let cache = await LoyaltyLedgerCache.findOne({ userId, monthKey });
    if (!cache) {
      cache = new LoyaltyLedgerCache({
        userId,
        monthKey,
        accumulatedSpend: parsedSpend
      });
    } else {
      cache.accumulatedSpend = parsedSpend;
    }
    await cache.save();

    // Determine target tier for WebSocket updates
    let tier = 'Standard';
    if (config.isActive) {
      if (cache.accumulatedSpend >= config.goldThreshold) tier = 'Gold';
      else if (cache.accumulatedSpend >= config.silverThreshold) tier = 'Silver';
    }

    const logMsg = `[INFO] Customer #${shopper._id.toString().slice(-6).toUpperCase()} spend overridden to Rs. ${parsedSpend.toLocaleString()}. Assigned Loyalty Tier: ${tier}.`;

    // Notify shopper and update ticker log stream via WebSockets
    if (global.io) {
      global.io.to(`user:${userId.toString()}`).emit('loyalty_status_updated', {
        accumulatedSpend: parsedSpend,
        tier
      });
      global.io.emit('loyalty_log_event', { text: logMsg, timestamp: new Date() });
    }

    res.json({ success: true, message: 'Spend override successful', cache });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
