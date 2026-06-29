/**
 * Wallet Route — Atomic Balance Management
 *
 * All balance mutations MUST go through this route to guarantee:
 *   1. Atomic $inc operations (no race conditions)
 *   2. Pre-deduction balance check (no overdraft)
 *   3. Decimal precision enforcement (Math.round to 2 dp before write)
 *   4. Receipt linkage (deposit only allowed after AdBid approval)
 *   5. Full audit trail (totalDepositedPKR / totalSpentPKR tracking)
 */

import express from 'express';
import Store from '../models/Store.js';
import AdBid from '../models/AdBid.js';
import WalletTopup from '../models/WalletTopup.js';
import Order from '../models/Order.js';
import VendorLoan from '../models/VendorLoan.js';
import { protect, authorize } from '../middleware/auth.js';
import { uploadReceipt } from '../middleware/upload.js';
import { performOCR } from '../services/ocrService.js';
import { pushNotification } from '../services/notificationService.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: round monetary value to exactly 2 decimal places before any DB write
// Prevents floating-point drift (e.g. 0.1 + 0.2 = 0.30000000000000004 in JS)
// ─────────────────────────────────────────────────────────────────────────────
const toPKR = (value) => Math.round(parseFloat(value) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get wallet balance for the authenticated vendor's store
// @route   GET /api/wallet/balance
// @access  Private (Vendor)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/balance', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized to access wallet balance' });
  }

  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('VIEW_BILLING')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to view financial/billing data' });
  }

  try {
    const storeId = req.user.activeStoreId || req.user.storeId;
    const store = await Store.findById(storeId).select('name slug wallet isActive suspensionReason penaltyPoints complaints debtZone amberCountdownStartedAt');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    
    // Check Amber Zone expiration
    await store.checkAmberExpiration();

    // ─── Live Commission Computation ─────────────────────────────────────────
    // Commission lifecycle:
    //   pending_approval / processing / dispatched / delivered → commission is "pending" (owed but not yet due)
    //   completed → commission is "due" and added to outstandingCommission
    //   cancelled → commission is voided (0 owed)
    const allOrders = await Order.find({ storeId, status: { $nin: ['cancelled'] } })
      .select('status totalAmount platformCommission shippingPremium createdAt')
      .lean();

    const COMMISSION_RATE = 0.05;
    const ACTIVE_STATUSES = ['pending_payment', 'pending_approval', 'processing', 'dispatched', 'delivered'];
    const COMPLETED_STATUS = 'completed';

    // Commission accrued on orders that are in-flight (not yet completed — tentative)
    const pendingCommission = toPKR(
      allOrders
        .filter(o => ACTIVE_STATUSES.includes(o.status))
        .reduce((s, o) => s + (o.platformCommission || toPKR((o.totalAmount - (o.shippingPremium || 0)) * COMMISSION_RATE)), 0)
    );

    // Commission locked-in from fully completed orders (definitively owed to platform)
    const completedCommission = toPKR(
      allOrders
        .filter(o => o.status === COMPLETED_STATUS)
        .reduce((s, o) => s + (o.platformCommission || toPKR((o.totalAmount - (o.shippingPremium || 0)) * COMMISSION_RATE)), 0)
    );

    // outstandingCommission in wallet = what's been charged but not yet settled/paid
    const outstandingCommission = store.wallet.outstandingCommission || 0;

    let alertMessage = null;
    if (store.debtZone === 'orange') {
      alertMessage = `[DEBT WARNING] Your store has outstanding commission debt of PKR ${outstandingCommission.toLocaleString()}. Standard active operations are maintained, but please settle this balance soon to avoid ad campaign suspension.`;
    } else if (store.debtZone === 'amber') {
      const elapsed = store.amberCountdownStartedAt ? (Date.now() - new Date(store.amberCountdownStartedAt).getTime()) : 0;
      const remainingMs = Math.max(0, (48 * 60 * 60 * 1000) - elapsed);
      const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);
      alertMessage = `[CRITICAL WARNING] Store is in Amber Zone! Outstanding commission debt of PKR ${outstandingCommission.toLocaleString()} exceeds PKR 10,000. Ad campaigns are temporarily paused. Settle outstanding debt within ${remainingHours} hours to prevent total storefront suspension.`;
    } else if (store.debtZone === 'red' || store.isActive === false) {
      alertMessage = `[SUSPENSION LOCKOUT] Store is Suspended! Outstanding commission debt exceeds PKR 25,000 (Red Zone). Standard operations are disabled and payouts/transfers are locked. Settle outstanding debt to restore access.`;
    }

    res.json({
      success: true,
      alertMessage,
      store: {
        _id: store._id,
        name: store.name,
        slug: store.slug,
        isActive: store.isActive,
        suspensionReason: store.suspensionReason,
        penaltyPoints: store.penaltyPoints,
        complaints: store.complaints || [],
        debtZone: store.debtZone,
        amberCountdownStartedAt: store.amberCountdownStartedAt
      },
      wallet: {
        balancePKR:           store.wallet.balancePKR,
        totalDepositedPKR:    store.wallet.totalDepositedPKR,
        totalSpentPKR:        store.wallet.totalSpentPKR,
        outstandingCommission,        // settled but unpaid (from completed orders)
        pendingCommission,            // tentative — accruing on in-flight orders
        completedCommission,          // locked-in from completed orders (subset of outstanding)
        totalOrdersCount: allOrders.length,
        lastUpdated: store.wallet.lastUpdated,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Credit wallet after admin approves an AdBid payment
//          Called internally by ads route on approval — NOT by vendors directly
// @route   POST /api/wallet/credit
// @access  Private (Admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/credit', protect, authorize('admin'), async (req, res) => {
  const { storeId, amountPKR, bidId } = req.body;

  if (!storeId || !amountPKR || !bidId) {
    return res.status(400).json({
      success: false,
      message: 'storeId, amountPKR, and bidId are all required for a credit operation',
    });
  }

  const creditAmount = toPKR(amountPKR);
  if (creditAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Credit amount must be greater than zero' });
  }

  try {
    // Verify the bid is in approved state before crediting — receipt linkage rule
    const bid = await AdBid.findById(bidId);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'AdBid not found' });
    }
    if (bid.paymentStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot credit wallet: AdBid paymentStatus is "${bid.paymentStatus}", must be "approved"`,
      });
    }

    // Atomic $inc — prevents race conditions if two admin requests arrive simultaneously
    const updatedStore = await Store.findByIdAndUpdate(
      storeId,
      {
        $inc: {
          'wallet.balancePKR':        creditAmount,
          'wallet.totalDepositedPKR': creditAmount,
        },
        $set: { 'wallet.lastUpdated': new Date() },
      },
      { new: true, runValidators: true }
    ).select('name wallet');

    if (!updatedStore) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    res.json({
      success: true,
      message: `PKR ${creditAmount} credited to store wallet`,
      wallet: updatedStore.wallet,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Debit wallet for a confirmed ad spend (system use)
//          Pre-checks that balance >= deduction amount before writing
// @route   POST /api/wallet/debit
// @access  Private (Admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/debit', protect, authorize('admin'), async (req, res) => {
  const { storeId, amountPKR, reason } = req.body;

  if (!storeId || !amountPKR) {
    return res.status(400).json({ success: false, message: 'storeId and amountPKR are required' });
  }

  const debitAmount = toPKR(amountPKR);
  if (debitAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Debit amount must be greater than zero' });
  }

  try {
    // PRE-CHECK: Read current balance before any write (no-overdraft rule)
    const store = await Store.findById(storeId).select('wallet');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const currentBalance = toPKR(store.wallet.balancePKR);
    if (currentBalance < debitAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Current: PKR ${currentBalance}, Requested debit: PKR ${debitAmount}`,
        currentBalance,
      });
    }

    // Atomic $inc debit — negative increment subtracts from balance
    // MongoDB schema min: 0 is a secondary guard; we pre-check above for cleaner error messages
    const updatedStore = await Store.findByIdAndUpdate(
      storeId,
      {
        $inc: {
          'wallet.balancePKR':    -debitAmount,  // negative increment = deduction
          'wallet.totalSpentPKR':  debitAmount,
        },
        $set: { 'wallet.lastUpdated': new Date() },
      },
      { new: true, runValidators: true }
    ).select('name wallet');

    res.json({
      success: true,
      message: `PKR ${debitAmount} debited from store wallet${reason ? ` for: ${reason}` : ''}`,
      wallet: updatedStore.wallet,
    });
  } catch (error) {
    // Catch schema-level min: 0 violation as a safety net
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Wallet balance cannot go below zero (overdraft prevention)',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Admin: Get wallet ledger summary for all vendor stores
// @route   GET /api/wallet/ledger
// @access  Private (Admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ledger', protect, authorize('admin'), async (req, res) => {
  try {
    const stores = await Store.find({})
      .select('name slug vendorId wallet isActive productVisibilityLimited createdAt')
      .populate('vendorId', 'name email')
      .sort({ 'wallet.balancePKR': -1 }); // highest balance first

    const activeStores = await Store.countDocuments({ isActive: true });
    const totalPlatformBalancePKR = toPKR(stores.reduce((s, st) => s + (st.wallet?.balancePKR || 0), 0));
    const totalDepositedPlatformPKR = toPKR(stores.reduce((s, st) => s + (st.wallet?.totalDepositedPKR || 0), 0));
    const totalSpentPlatformPKR = toPKR(stores.reduce((s, st) => s + (st.wallet?.totalSpentPKR || 0), 0));
    const totalCommissionDebt = toPKR(stores.reduce((s, st) => s + (st.wallet?.outstandingCommission || 0), 0));
    const activeSecuritySessions = global.io ? global.io.engine.clientsCount : 0;

    const summary = {
      totalStores: stores.length,
      totalActiveStores: activeStores,
      totalPlatformBalancePKR,
      totalDepositedPlatformPKR,
      totalSpentPlatformPKR,
      totalCommissionDebt,
      activeSecuritySessions,
    };

    // Calculate daily gross merchandise value (GMV) and commission earnings
    const orders = await Order.find({ status: { $ne: 'cancelled' } }).select('totalAmount platformCommission createdAt');
    const dailyStatsMap = {};
    orders.forEach(o => {
      const dateStr = new Date(o.createdAt).toISOString().split('T')[0];
      if (!dailyStatsMap[dateStr]) {
        dailyStatsMap[dateStr] = { date: dateStr, gmv: 0, commission: 0 };
      }
      dailyStatsMap[dateStr].gmv += o.totalAmount;
      dailyStatsMap[dateStr].commission += o.platformCommission || 0;
    });
    const dailyRevenueMatrix = Object.values(dailyStatsMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ success: true, summary, stores, dailyRevenueMatrix });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: Self-credit wallet for vendor testing
// @route   POST /api/wallet/sandbox-credit
// @access  Private (Vendor/Admin)
router.post('/sandbox-credit', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('MANAGE_ADS')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to manage ad budgeting' });
  }

  const { amountPKR } = req.body;
  const creditAmount = toPKR(amountPKR || 0);
  if (creditAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Credit amount must be greater than zero' });
  }
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId).select('vendorId');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const updatedStore = await Store.findByIdAndUpdate(
      storeId,
      {
        $inc: {
          'wallet.balancePKR':        creditAmount,
          'wallet.totalDepositedPKR': creditAmount,
        },
        $set: { 'wallet.lastUpdated': new Date() },
      },
      { new: true, runValidators: true }
    ).select('name wallet');

    // Create a sandbox transaction topup entry
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: creditAmount,
      referenceId: `SANDBOX-CR-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'topup',
      message: 'Sandbox testing deposit credit'
    });

    if (global.io) {
      global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
        storeId,
        balancePKR: updatedStore.wallet.balancePKR,
        wallet: updatedStore.wallet
      });
    }

    res.json({
      success: true,
      message: `Sandbox credit: PKR ${creditAmount} added`,
      wallet: updatedStore.wallet,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: Self-debit wallet for vendor testing
// @route   POST /api/wallet/sandbox-debit
// @access  Private (Vendor/Admin)
router.post('/sandbox-debit', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('MANAGE_ADS')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to manage ad budgeting' });
  }

  const { amountPKR, reason } = req.body;
  const debitAmount = toPKR(amountPKR || 0);
  if (debitAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Debit amount must be greater than zero' });
  }
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId).select('wallet vendorId');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    const currentBalance = toPKR(store.wallet.balancePKR);
    if (currentBalance < debitAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Current: PKR ${currentBalance}, Requested: PKR ${debitAmount}`,
        currentBalance,
      });
    }
    const updatedStore = await Store.findByIdAndUpdate(
      storeId,
      {
        $inc: {
          'wallet.balancePKR':    -debitAmount,
          'wallet.totalSpentPKR':  debitAmount,
        },
        $set: { 'wallet.lastUpdated': new Date() },
      },
      { new: true, runValidators: true }
    ).select('name wallet');

    // Create a sandbox transaction spend entry
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: debitAmount,
      referenceId: `SANDBOX-DR-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'commission_payment',
      message: reason || 'Sandbox testing spend debit'
    });

    if (global.io) {
      global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
        storeId,
        balancePKR: updatedStore.wallet.balancePKR,
        wallet: updatedStore.wallet
      });
    }

    res.json({
      success: true,
      message: `Sandbox debit: PKR ${debitAmount} spent for ${reason || 'testing'}`,
      wallet: updatedStore.wallet,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper to convert absolute or relative file path to public URL starting with /uploads
const toPublicUrl = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  const uploadsIdx = normalized.indexOf('uploads/');
  return uploadsIdx !== -1 ? '/' + normalized.substring(uploadsIdx) : '/' + normalized.replace(/^\.\//, '');
};

// Local Duplication Checker across AdBid and WalletTopup
const checkDuplication = async (referenceId, ocrRefNo) => {
  const query = [];
  if (referenceId) {
    query.push({ referenceId });
    query.push({ 'ocrResult.referenceNumber': referenceId });
  }
  if (ocrRefNo) {
    query.push({ referenceId: ocrRefNo });
    query.push({ 'ocrResult.referenceNumber': ocrRefNo });
  }
  if (query.length === 0) return false;

  const filter = {
    $or: query,
    paymentStatus: { $in: ['pending_approval', 'approved'] }
  };

  const dupBid = await AdBid.findOne(filter);
  if (dupBid) return true;

  const dupTopup = await WalletTopup.findOne(filter);
  if (dupTopup) return true;

  return false;
};

// @desc    Submit a manual wallet top-up request with receipt image
// @route   POST /api/wallet/topup
// @access  Private (Vendor)
router.post('/topup', protect, uploadReceipt.single('receipt'), async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized store staff can request top-ups' });
  }

  const { amountPKR, referenceId, type } = req.body;

  if (!amountPKR || parseFloat(amountPKR) <= 0) {
    return res.status(400).json({ success: false, message: 'Please specify a valid top-up amount' });
  }
  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'Please specify bank transaction reference ID' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload bank transfer receipt image' });
  }

  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const receiptPath = req.file.path.replace(/\\/g, '/');
    const paymentReceiptUrl = toPublicUrl(req.file.path);

    // 1. Run local OCR parsing
    console.log(`Running local OCR analysis on top-up: ${receiptPath}`);
    const ocrResult = await performOCR(req.file.path);

    // 2. Duplication Blocker Check
    const isDuplicate = await checkDuplication(referenceId, ocrResult.referenceNumber);

    // 3. Create wallet top-up request
    const topup = await WalletTopup.create({
      vendorId: store.vendorId,
      storeId: store._id,
      amountPKR: parseFloat(amountPKR),
      referenceId,
      paymentReceiptUrl,
      paymentStatus: 'pending_approval',
      isDuplicate,
      ocrResult,
      type: type || 'topup'
    });


    res.status(201).json({
      success: true,
      message: 'Wallet top-up request submitted. Verification is pending admin review.',
      topup
    });
  } catch (error) {
    console.error('Error submitting top-up:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all wallet top-up history for a vendor
// @route   GET /api/wallet/topups/my
// @access  Private (Vendor)
router.get('/topups/my', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const topups = await WalletTopup.find({ storeId })
      .sort({ createdAt: -1 });

    res.json({ success: true, count: topups.length, topups });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Unified Financial Verification Queue (Admin only)
// @route   GET /api/wallet/verification-queue
// @access  Private (Admin)
router.get('/verification-queue', protect, authorize('admin'), async (req, res) => {
  try {
    const bids = await AdBid.find({ paymentStatus: 'pending_approval' })
      .populate('slotId', 'name basePrice')
      .populate('vendorId', 'name email')
      .populate('productId', 'title price')
      .lean();

    const topups = await WalletTopup.find({ paymentStatus: 'pending_approval' })
      .populate('vendorId', 'name email')
      .populate('storeId', 'name slug')
      .lean();

    const unified = [
      ...bids.map(b => ({ ...b, type: 'ad_bid' })),
      ...topups.map(t => ({ ...t, type: 'wallet_topup', topupType: t.type || 'topup' }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: unified.length, queue: unified });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Approve/Reject top-up request (Admin only)
// @route   PUT /api/wallet/topups/:id/status
// @access  Private (Admin)
router.put('/topups/:id/status', protect, authorize('admin'), async (req, res) => {
  const { status, message } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  try {
    const topup = await WalletTopup.findById(req.params.id);
    if (!topup) {
      return res.status(404).json({ success: false, message: 'Top-up request not found' });
    }

    if (topup.paymentStatus !== 'pending_approval') {
      return res.status(400).json({ success: false, message: 'This top-up request has already been processed' });
    }

    topup.paymentStatus = status;
    if (message !== undefined) {
      topup.message = message;
    }

    if (status === 'approved') {
      const store = await Store.findById(topup.storeId);
      if (!store) {
        return res.status(404).json({ success: false, message: 'Associated store not found' });
      }

      const creditAmount = toPKR(topup.amountPKR);
      store.wallet = store.wallet || {};

      if (topup.type === 'commission_payment') {
        const outstanding = store.wallet.outstandingCommission || 0;
        let deductCommission = 0;
        let creditBalance = 0;
        if (outstanding >= creditAmount) {
          deductCommission = creditAmount;
        } else {
          deductCommission = outstanding;
          creditBalance = toPKR(creditAmount - outstanding);
        }

        store.wallet.outstandingCommission = toPKR(outstanding - deductCommission);
        store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) + creditBalance);
        store.wallet.totalDepositedPKR = toPKR((store.wallet.totalDepositedPKR || 0) + creditAmount);
      } else {
        store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) + creditAmount);
        store.wallet.totalDepositedPKR = toPKR((store.wallet.totalDepositedPKR || 0) + creditAmount);
      }

      store.wallet.lastUpdated = new Date();
      await store.save();

      // Try auto repayment of active loan if balance is now sufficient
      await triggerAutoRepayment(store._id);

      // Trigger socket event wallet_updated
      if (global.io) {
        global.io.to(`user:${topup.vendorId.toString()}`).emit('wallet_updated', {
          storeId: topup.storeId,
          balancePKR: store.wallet.balancePKR,
        });
      }

      // Send push notification
      try {
        const notifTitle = '💰 Wallet Top-up Approved!';
        const notifBody = `Your deposit of PKR ${topup.amountPKR} has been approved and credited to your store wallet.`;
        await pushNotification(topup.vendorId, 'general', notifTitle, notifBody, { topupId: topup._id.toString() });
      } catch (notifErr) {
        console.error('Push notification error:', notifErr.message);
      }
    } else if (status === 'rejected') {
      // Send push notification
      try {
        const notifTitle = '❌ Top-up Request Rejected';
        const notifBody = message || 'Your manual deposit request was rejected. Please check your transaction details and receipt.';
        await pushNotification(topup.vendorId, 'general', notifTitle, notifBody, { topupId: topup._id.toString() });
      } catch (notifErr) {
        console.error('Push notification error:', notifErr.message);
      }
    }

    await topup.save();

    res.json({ success: true, message: `Wallet top-up request ${status} successfully.`, topup });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Settle outstanding commission from store wallet balance directly
// @route   POST /api/wallet/pay-commission
// @access  Private (Vendor/Store Admin)
router.post('/pay-commission', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized to perform wallet actions' });
  }

  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('VIEW_BILLING')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to manage billing/financial data' });
  }

  const { amountPKR } = req.body;
  const payAmount = toPKR(amountPKR || 0);

  if (payAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });
  }

  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const currentBalance = toPKR(store.wallet?.balancePKR || 0);
    const outstanding = toPKR(store.wallet?.outstandingCommission || 0);

    if (currentBalance < payAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Current: PKR ${currentBalance}, Requested: PKR ${payAmount}`
      });
    }

    if (outstanding < payAmount) {
      return res.status(400).json({
        success: false,
        message: `Outstanding commission is PKR ${outstanding}, cannot pay PKR ${payAmount}`
      });
    }
    store.wallet.balancePKR = toPKR(currentBalance - payAmount);
    store.wallet.outstandingCommission = toPKR(outstanding - payAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + payAmount);
    store.wallet.lastUpdated = new Date();

    await store.save();

    // Create commission payout entry
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: payAmount,
      referenceId: `COMM-SETTLE-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'commission_payment',
      message: 'Settled outstanding commission from wallet balance'
    });

    if (global.io) {
      global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
        storeId,
        balancePKR: store.wallet.balancePKR,
        wallet: store.wallet
      });
    }

    res.json({
      success: true,
      message: `Successfully settled PKR ${payAmount} of outstanding commission from wallet balance.`,
      wallet: store.wallet
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get unified transaction ledger history for a vendor's store
// @route   GET /api/wallet/transactions
// @access  Private (Vendor/Store Admin)
router.get('/transactions', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('VIEW_BILLING')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to view financial/billing data' });
  }

  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // 1. Fetch Topups & Commission Settlements
    const topups = await WalletTopup.find({ storeId }).lean();

    // 2. Fetch Ad Bids
    const adBids = await AdBid.find({ vendorId: store.vendorId }).populate('slotId', 'name').lean();

    // 3. Fetch Orders (where platform commission was charged/outstanding)
    const orders = await Order.find({ storeId }).lean();

    // 4. Merge all into a unified timeline
    const transactions = [];

    // Map topups
    topups.forEach(t => {
      transactions.push({
        _id: t._id,
        type: t.type === 'commission_payment' ? 'commission_payout' : 'deposit',
        description: t.message || (t.type === 'commission_payment' 
          ? `Commission Payment (Ref: ${t.referenceId})` 
          : `Wallet Topup (Ref: ${t.referenceId})`),
        amountPKR: t.amountPKR,
        direction: t.type === 'commission_payment' ? 'debit' : 'credit',
        status: t.paymentStatus,
        createdAt: t.createdAt,
        referenceId: t.referenceId,
        receiptUrl: t.paymentReceiptUrl
      });
    });

    // Map ad bids
    adBids.forEach(b => {
      transactions.push({
        _id: b._id,
        type: 'ad_bid',
        description: `Ad Placement Bid: ${b.slotId?.name || 'Campaign Bid'}`,
        amountPKR: b.bidAmount,
        direction: 'debit',
        status: b.paymentStatus,
        createdAt: b.createdAt,
        referenceId: b.referenceId
      });
    });

    // Map orders — commission status reflects real order lifecycle
    //   cancelled  → skip (no commission owed)
    //   completed  → commission is 'approved' (definitively due to platform)
    //   all others → commission is 'pending' (tentative, accruing while in-flight)
    const COMMISSION_RATE = 0.05;
    orders.forEach(o => {
      if (o.status === 'cancelled') return; // void — no commission
      const comm = toPKR(o.platformCommission || ((o.totalAmount - (o.shippingPremium || 0)) * COMMISSION_RATE));
      const orderRef = o._id.toString().substring(18).toUpperCase();
      const statusMap = {
        completed:        'approved',    // locked-in — owed to platform
        delivered:        'pending',     // pending confirmation → nearly done
        dispatched:       'pending',     // in transit
        processing:       'pending',     // being packed/processed
        pending_approval: 'pending',     // awaiting vendor acceptance
        pending_payment:  'pending',     // awaiting payment
      };
      transactions.push({
        _id: `comm-${o._id}`,
        orderId: o._id,
        type: 'order_commission',
        description: `5% Platform Commission — Order #${orderRef}`,
        orderStatus: o.status,
        amountPKR: comm,
        direction: 'debit',
        status: statusMap[o.status] || 'pending',
        createdAt: o.createdAt,
        referenceId: `ORD-${orderRef}`,
        note: o.status === 'completed'
          ? 'Commission due — order delivered & confirmed'
          : `Commission accruing — order is "${o.status.replace('_', ' ')}"`
      });
    });

    // Sort descending
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// @desc    Admin: Toggle a store's product visibility limit
// @route   PUT /api/wallet/stores/:storeId/visibility
// @access  Private (Admin)
router.put('/stores/:storeId/visibility', protect, authorize('admin'), async (req, res) => {
  const { productVisibilityLimited } = req.body;
  try {
    const store = await Store.findByIdAndUpdate(
      req.params.storeId,
      { $set: { productVisibilityLimited: !!productVisibilityLimited } },
      { new: true }
    );
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    res.json({ success: true, message: `Store product visibility limit set to ${store.productVisibilityLimited}`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Override a store's suspension or reset its outstanding debt
// @route   PUT /api/wallet/stores/:storeId/override
// @access  Private (Admin only)
router.put('/stores/:storeId/override', protect, authorize('admin'), async (req, res) => {
  const { action } = req.body; // 'toggle_active' | 'clear_debt'
  try {
    const store = await Store.findById(req.params.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    if (action === 'toggle_active') {
      store.isActive = !store.isActive;
      if (store.isActive) {
        store.suspensionReason = '';
      } else {
        store.suspensionReason = 'Suspended administratively by SuperAdmin.';
      }
    } else if (action === 'clear_debt') {
      store.wallet = store.wallet || {};
      const clearedAmount = store.wallet.outstandingCommission || 0;
      store.wallet.outstandingCommission = 0;
      store.debtZone = 'active';
      store.amberCountdownStartedAt = null;
      store.isActive = true;
      store.suspensionReason = '';
      store.wallet.lastUpdated = new Date();

      // Create a ledger transaction record for this manual clearance
      await WalletTopup.create({
        vendorId: store.vendorId,
        storeId: store._id,
        amountPKR: clearedAmount,
        referenceId: `ADMIN-CLEAR-${Date.now()}`,
        paymentReceiptUrl: '/uploads/receipts/sandbox.png',
        paymentStatus: 'approved',
        type: 'commission_payment',
        message: `Outstanding commission debt of PKR ${clearedAmount} manually cleared by Admin.`
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action parameter. Must be toggle_active or clear_debt' });
    }

    await store.save();

    // Broadcast wallet update to vendor
    if (global.io) {
      global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
        storeId: store._id.toString(),
        balancePKR: store.wallet.balancePKR,
        wallet: store.wallet
      });
    }

    res.json({ success: true, message: `Store status updated successfully`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Get unified transaction ledger history for a specific store
// @route   GET /api/wallet/admin/transactions/:storeId
// @access  Private (Admin only)
router.get('/admin/transactions/:storeId', protect, authorize('admin'), async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // 1. Fetch Topups & Commission Settlements
    const topups = await WalletTopup.find({ storeId }).lean();

    // 2. Fetch Ad Bids
    const adBids = await AdBid.find({ vendorId: store.vendorId }).populate('slotId', 'name').lean();

    // 3. Fetch Orders (where platform commission was charged/outstanding)
    const orders = await Order.find({ storeId }).lean();

    // 4. Merge all into a unified timeline
    const transactions = [];

    // Map topups
    topups.forEach(t => {
      transactions.push({
        _id: t._id,
        type: t.type === 'commission_payment' ? 'commission_payout' : 'deposit',
        description: t.message || (t.type === 'commission_payment' 
          ? `Commission Payment (Ref: ${t.referenceId})` 
          : `Wallet Topup (Ref: ${t.referenceId})`),
        amountPKR: t.amountPKR,
        direction: t.type === 'commission_payment' ? 'debit' : 'credit',
        status: t.paymentStatus,
        createdAt: t.createdAt,
        referenceId: t.referenceId,
        receiptUrl: t.paymentReceiptUrl
      });
    });

    // Map ad bids
    adBids.forEach(b => {
      transactions.push({
        _id: b._id,
        type: 'ad_bid',
        description: `Ad Placement Bid: ${b.slotId?.name || 'Campaign Bid'}`,
        amountPKR: b.bidAmount,
        direction: 'debit',
        status: b.paymentStatus,
        createdAt: b.createdAt,
        referenceId: b.referenceId
      });
    });

    // Map orders
    const COMMISSION_RATE = 0.05;
    orders.forEach(o => {
      if (o.status === 'cancelled') return;
      const comm = toPKR(o.platformCommission || ((o.totalAmount - (o.shippingPremium || 0)) * COMMISSION_RATE));
      const orderRef = o._id.toString().substring(18).toUpperCase();
      const statusMap = {
        completed:        'approved',
        delivered:        'pending',
        dispatched:       'pending',
        processing:       'pending',
        pending_approval: 'pending',
        pending_payment:  'pending',
      };
      transactions.push({
        _id: `comm-${o._id}`,
        orderId: o._id,
        type: 'order_commission',
        description: `5% Platform Commission — Order #${orderRef}`,
        orderStatus: o.status,
        paymentMethod: o.paymentMethod || 'cod',
        amountPKR: comm,
        direction: 'debit',
        status: statusMap[o.status] || 'pending',
        createdAt: o.createdAt,
        referenceId: `ORD-${orderRef}`,
        note: o.status === 'completed'
          ? 'Commission due — order delivered & confirmed'
          : `Commission accruing — order is "${o.status.replace('_', ' ')}"`
      });
    });

    // Sort descending
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: Settle withdrawal request from store wallet
// @route   POST /api/wallet/withdraw
// @access  Private (Vendor/Store Admin)
router.post('/withdraw', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized to perform wallet actions' });
  }
  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('VIEW_BILLING')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to manage billing/financial data' });
  }
  const { amountPKR } = req.body;
  const withdrawAmount = toPKR(amountPKR || 0);
  if (withdrawAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Withdrawal amount must be greater than zero' });
  }
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    // Debt block check
    if (store.isActive === false || store.debtZone === 'red') {
      return res.status(403).json({ success: false, message: 'Wallet balance is locked. Withdrawals and local transfers are blocked during suspension.' });
    }
    const currentBalance = toPKR(store.wallet?.balancePKR || 0);
    if (currentBalance < withdrawAmount) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Current: PKR ${currentBalance}, Requested: PKR ${withdrawAmount}` });
    }
    store.wallet.balancePKR = toPKR(currentBalance - withdrawAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + withdrawAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    // Create a transaction log
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: withdrawAmount,
      referenceId: `WITHDRAW-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'commission_payment',
      message: `Simulated Sandbox Wallet Withdrawal`
    });

    res.json({ success: true, message: `Successfully withdrew PKR ${withdrawAmount} from store wallet.`, wallet: store.wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Sandbox: Settle local transfer request from store wallet
// @route   POST /api/wallet/transfer
// @access  Private (Vendor/Store Admin)
router.post('/transfer', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Not authorized to perform wallet actions' });
  }
  if (req.user.role === 'storeAdmin' && !req.user.permissionsArray.includes('VIEW_BILLING')) {
    return res.status(403).json({ success: false, message: 'Access denied: You do not have permissions to manage billing/financial data' });
  }
  const { amountPKR, targetStoreSlug } = req.body;
  const transferAmount = toPKR(amountPKR || 0);
  if (transferAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Transfer amount must be greater than zero' });
  }
  if (!targetStoreSlug) {
    return res.status(400).json({ success: false, message: 'Target store slug is required for transfer' });
  }
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    // Debt block check
    if (store.isActive === false || store.debtZone === 'red') {
      return res.status(403).json({ success: false, message: 'Wallet balance is locked. Withdrawals and local transfers are blocked during suspension.' });
    }
    const currentBalance = toPKR(store.wallet?.balancePKR || 0);
    if (currentBalance < transferAmount) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Current: PKR ${currentBalance}, Requested: PKR ${transferAmount}` });
    }
    const targetStore = await Store.findOne({ slug: targetStoreSlug });
    if (!targetStore) {
      return res.status(404).json({ success: false, message: `Target store "${targetStoreSlug}" not found` });
    }

    // Deduct from sender
    store.wallet.balancePKR = toPKR(currentBalance - transferAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + transferAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    // Add to target store
    targetStore.wallet = targetStore.wallet || {};
    targetStore.wallet.balancePKR = toPKR((targetStore.wallet.balancePKR || 0) + transferAmount);
    targetStore.wallet.totalDepositedPKR = toPKR((targetStore.wallet.totalDepositedPKR || 0) + transferAmount);
    targetStore.wallet.lastUpdated = new Date();
    await targetStore.save();

    // Create transaction logs
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: transferAmount,
      referenceId: `XFER-OUT-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'commission_payment',
      message: `Simulated Sandbox Wallet Transfer to store "${targetStore.name}"`
    });

    await WalletTopup.create({
      vendorId: targetStore.vendorId,
      storeId: targetStore._id,
      amountPKR: transferAmount,
      referenceId: `XFER-IN-${Date.now()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'topup',
      message: `Simulated Sandbox Wallet Transfer from store "${store.name}"`
    });

    res.json({ success: true, message: `Successfully transferred PKR ${transferAmount} to store "${targetStore.name}".`, wallet: store.wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper for loan auto repayment
const triggerAutoRepayment = async (storeId) => {
  try {
    const activeLoan = await VendorLoan.findOne({ storeId, status: 'approved' });
    if (!activeLoan) return;

    const store = await Store.findById(storeId);
    if (!store) return;

    const balance = store.wallet.balancePKR || 0;
    const repaymentAmount = activeLoan.repaymentAmount;

    if (balance >= repaymentAmount) {
      store.wallet.balancePKR = toPKR(balance - repaymentAmount);
      store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + repaymentAmount);
      store.wallet.lastUpdated = new Date();
      await store.save();

      activeLoan.status = 'repaid';
      activeLoan.repaidAt = new Date();
      await activeLoan.save();

      console.log(`[Auto-Repay Loan] Auto-repaid active loan of Rs. ${activeLoan.amount} for store ${storeId} from wallet balance.`);

      await WalletTopup.create({
        vendorId: store.vendorId,
        storeId,
        amountPKR: repaymentAmount,
        referenceId: `LOAN-AUTOREPAY-${Date.now().toString().substring(8)}`,
        paymentReceiptUrl: '/uploads/receipts/sandbox.png',
        paymentStatus: 'approved',
        type: 'withdrawal',
        message: `Auto-repaid Short-Term Inventory Loan of Rs. ${activeLoan.amount} (with interest: Rs. ${repaymentAmount})`
      });
    }
  } catch (err) {
    console.error('[Auto-Repay Error]', err.message);
  }
};

// @desc    Get BazaarBoost Credit Score and Loan Eligibility
// @route   GET /api/wallet/credit-score
// @access  Private (Vendor, Store Admin)
router.get('/credit-score', protect, async (req, res) => {
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // 1. Calculate Monthly GMV (orders completed or delivered in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completedOrders = await Order.find({
      storeId,
      status: { $in: ['completed', 'delivered'] },
      createdAt: { $gte: thirtyDaysAgo }
    });
    const monthlyGmv = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    // 2. Calculate Fulfillment Rate
    const nonCancelledOrdersCount = await Order.countDocuments({ storeId, status: { $ne: 'cancelled' } });
    const successfulOrdersCount = await Order.countDocuments({ storeId, status: { $in: ['completed', 'delivered'] } });
    const fulfillmentRate = nonCancelledOrdersCount > 0 ? (successfulOrdersCount / nonCancelledOrdersCount) : 0;

    // 3. Credit Score Calculation (300 to 850 scale)
    let score = (store.creditScoreOverride !== null && store.creditScoreOverride !== undefined)
      ? store.creditScoreOverride
      : 300 + Math.round(fulfillmentRate * 400);
    if (store.creditScoreOverride === null || store.creditScoreOverride === undefined) {
      if (monthlyGmv > 0) {
        score += Math.min(Math.round((monthlyGmv / 10000) * 150), 150);
      }
    }
    score = Math.max(300, Math.min(850, score));

    // 4. Check for active loans
    const activeLoan = await VendorLoan.findOne({ storeId, status: 'approved' });

    let loanAgeDays = null;
    let riskTier = score >= 700 ? 'Excellent Risk' : (score >= 600 ? 'Moderate Risk' : 'Critical Risk');
    let daysRemaining = null;

    if (activeLoan) {
      loanAgeDays = (Date.now() - new Date(activeLoan.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      daysRemaining = Math.max(0, 60 - Math.floor(loanAgeDays));
      
      if (loanAgeDays < 30) {
        riskTier = 'Excellent Risk';
      } else if (loanAgeDays >= 30 && loanAgeDays < 45) {
        riskTier = 'Moderate Risk';
      } else if (loanAgeDays >= 45 && loanAgeDays < 60) {
        riskTier = 'Critical Risk';
      } else {
        riskTier = 'Default/Suspended';
        
        // Auto-suspend store if Day 60+ reached
        if (store.isActive) {
          store.isActive = false;
          store.suspensionReason = 'Suspended automatically: Inventory loan default (over 60 days unpaid).';
          await store.save();
          
          if (global.io) {
            global.io.emit('on_platform_financial_update', {
              time: new Date().toLocaleTimeString(),
              type: 'RISKALERT',
              text: `[RISKALERT] Store '${store.name}' failed to repay loan inside maturity window (60+ days). Active storefront suspended.`
            });
          }
        }
      }
    }

    // 5. Eligible loan limit (50% of monthly GMV up to 50k PKR)
    let maxLoanAmount = score >= 650 ? Math.min(Math.round(monthlyGmv * 0.5), 50000) : 0;
    if (store.isLoanFrozen) {
      maxLoanAmount = 0;
    }

    // 5.5 Eligibility check
    const eligible = score >= 650 && !activeLoan && !store.isLoanFrozen;

    // 6. Calculate in-flight upcoming payouts (not completed yet)
    const pendingOrders = await Order.find({
      storeId,
      status: { $in: ['pending_payment', 'pending_approval', 'processing', 'dispatched', 'delivered'] }
    });
    const upcomingPayouts = pendingOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    res.json({
      success: true,
      creditScore: score,
      monthlyGmv,
      fulfillmentRate,
      eligible,
      maxLoanAmount,
      interestRate: 0.05,
      upcomingPayouts,
      activeLoan,
      loanAgeDays,
      riskTier,
      daysRemaining
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Apply for short-term inventory loan
// @route   POST /api/wallet/apply-loan
// @access  Private (Vendor, Store Admin)
router.post('/apply-loan', protect, async (req, res) => {
  const { amount } = req.body;
  const loanAmount = toPKR(amount || 0);

  if (loanAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Loan amount must be greater than zero' });
  }

  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // Check active loan
    const activeLoan = await VendorLoan.findOne({ storeId, status: 'approved' });
    if (activeLoan) {
      return res.status(400).json({ success: false, message: 'You already have an active loan. Please repay it first.' });
    }

    // Calculate Credit Score & Eligibility
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completedOrders = await Order.find({
      storeId,
      status: { $in: ['completed', 'delivered'] },
      createdAt: { $gte: thirtyDaysAgo }
    });
    const monthlyGmv = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const nonCancelledOrdersCount = await Order.countDocuments({ storeId, status: { $ne: 'cancelled' } });
    const successfulOrdersCount = await Order.countDocuments({ storeId, status: { $in: ['completed', 'delivered'] } });
    const fulfillmentRate = nonCancelledOrdersCount > 0 ? (successfulOrdersCount / nonCancelledOrdersCount) : 0;

    let score = (store.creditScoreOverride !== null && store.creditScoreOverride !== undefined)
      ? store.creditScoreOverride
      : 300 + Math.round(fulfillmentRate * 400);
    if (store.creditScoreOverride === null || store.creditScoreOverride === undefined) {
      if (monthlyGmv > 0) {
        score += Math.min(Math.round((monthlyGmv / 10000) * 150), 150);
      }
    }
    score = Math.max(300, Math.min(850, score));

    if (store.isLoanFrozen) {
      return res.status(400).json({ success: false, message: 'Loan eligibility is frozen. Please contact Superadmin administration.' });
    }

    if (score < 650) {
      return res.status(400).json({ success: false, message: `Loan denied. Your BazaarBoost credit score is ${score}, which is below the 650 requirement.` });
    }

    const maxLoanAmount = Math.min(Math.round(monthlyGmv * 0.5), 50000);
    if (loanAmount > maxLoanAmount) {
      return res.status(400).json({ success: false, message: `Loan amount exceeds your eligible limit of Rs. ${maxLoanAmount}` });
    }

    const interestRate = 0.05;
    const repaymentAmount = toPKR(loanAmount * (1 + interestRate));

    // Create loan record
    const loan = await VendorLoan.create({
      storeId,
      vendorId: store.vendorId,
      amount: loanAmount,
      interestRate,
      repaymentAmount,
      status: 'approved',
      payoutHoldAmount: repaymentAmount
    });

    // Credit amount to store wallet balance
    store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) + loanAmount);
    store.wallet.totalDepositedPKR = toPKR((store.wallet.totalDepositedPKR || 0) + loanAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    // Log ledger topup transaction
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: loanAmount,
      referenceId: `LOAN-DISB-${loan._id.toString().substring(18).toUpperCase()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'topup',
      message: `Short-Term Inventory Loan disbursed: Rs. ${loanAmount} (5% flat interest applied)`
    });

    res.json({ success: true, message: `Inventory loan of PKR ${loanAmount} approved and credited to your wallet balance.`, loan, wallet: store.wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Repay active loan manually
// @route   POST /api/wallet/repay-loan
// @access  Private (Vendor, Store Admin)
router.post('/repay-loan', protect, async (req, res) => {
  try {
    const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const activeLoan = await VendorLoan.findOne({ storeId, status: 'approved' });
    if (!activeLoan) {
      return res.status(404).json({ success: false, message: 'No active loan found for this store' });
    }

    const balance = store.wallet.balancePKR || 0;
    const repaymentAmount = activeLoan.repaymentAmount;

    if (balance < repaymentAmount) {
      return res.status(400).json({ success: false, message: `Insufficient balance to repay loan. Balance: Rs. ${balance}, Repayment Due: Rs. ${repaymentAmount}` });
    }

    // Deduct repayment amount from store wallet balance
    store.wallet.balancePKR = toPKR(balance - repaymentAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + repaymentAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    // Update loan status
    activeLoan.status = 'repaid';
    activeLoan.repaidAt = new Date();
    await activeLoan.save();

    // Log transaction
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId,
      amountPKR: repaymentAmount,
      referenceId: `LOAN-REPAY-${activeLoan._id.toString().substring(18).toUpperCase()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'withdrawal',
      message: `Repaid Short-Term Inventory Loan of Rs. ${activeLoan.amount} (with interest: Rs. ${repaymentAmount})`
    });

    res.json({ success: true, message: `Inventory loan of PKR ${activeLoan.amount} successfully repaid.`, loan: activeLoan, wallet: store.wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Get all active/repaid/defaulted vendor loans with store risk metrics
// @route   GET /api/wallet/admin/loans
// @access  Private (Admin only)
router.get('/admin/loans', protect, authorize('admin'), async (req, res) => {
  try {
    const loans = await VendorLoan.find({})
      .populate({
        path: 'storeId',
        select: 'name slug wallet isLoanFrozen creditScoreOverride originCity isActive'
      })
      .sort({ createdAt: -1 });

    const enrichedLoans = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const loan of loans) {
      if (!loan.storeId) {
        enrichedLoans.push({
          ...loan.toObject(),
          storeName: 'Unknown Store',
          creditScore: 300,
          monthlyGmv: 0,
          fulfillmentRate: 0,
        });
        continue;
      }

      // Calculate GMV & fulfillment rate
      const completedOrders = await Order.find({
        storeId: loan.storeId._id,
        status: { $in: ['completed', 'delivered'] },
        createdAt: { $gte: thirtyDaysAgo }
      });
      const monthlyGmv = completedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

      const nonCancelledOrdersCount = await Order.countDocuments({ storeId: loan.storeId._id, status: { $ne: 'cancelled' } });
      const successfulOrdersCount = await Order.countDocuments({ storeId: loan.storeId._id, status: { $in: ['completed', 'delivered'] } });
      const fulfillmentRate = nonCancelledOrdersCount > 0 ? (successfulOrdersCount / nonCancelledOrdersCount) : 0;

      // Credit Score Calculation
      let score = (loan.storeId.creditScoreOverride !== null && loan.storeId.creditScoreOverride !== undefined)
        ? loan.storeId.creditScoreOverride
        : 300 + Math.round(fulfillmentRate * 400);
      if (loan.storeId.creditScoreOverride === null || loan.storeId.creditScoreOverride === undefined) {
        if (monthlyGmv > 0) {
          score += Math.min(Math.round((monthlyGmv / 10000) * 150), 150);
        }
      }
      score = Math.max(300, Math.min(850, score));

      enrichedLoans.push({
        ...loan.toObject(),
        storeName: loan.storeId.name,
        storeSlug: loan.storeId.slug,
        walletBalance: loan.storeId.wallet.balancePKR,
        isLoanFrozen: loan.storeId.isLoanFrozen,
        creditScoreOverride: loan.storeId.creditScoreOverride,
        creditScore: score,
        monthlyGmv,
        fulfillmentRate
      });
    }

    res.json({ success: true, count: enrichedLoans.length, loans: enrichedLoans });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Manually trigger a wallet deduction to settle a loan
// @route   POST /api/wallet/admin/loans/:loanId/deduct
// @access  Private (Admin only)
router.post('/admin/loans/:loanId/deduct', protect, authorize('admin'), async (req, res) => {
  try {
    const loan = await VendorLoan.findById(req.params.loanId);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    if (loan.status === 'repaid') {
      return res.status(400).json({ success: false, message: 'This loan has already been repaid' });
    }

    const store = await Store.findById(loan.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const balance = store.wallet.balancePKR || 0;
    const repaymentAmount = loan.repaymentAmount;

    if (balance < repaymentAmount) {
      return res.status(400).json({ success: false, message: `Insufficient balance to repay loan. Balance: Rs. ${balance}, Repayment Due: Rs. ${repaymentAmount}` });
    }

    // Deduct repayment amount from store wallet balance
    store.wallet.balancePKR = toPKR(balance - repaymentAmount);
    store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + repaymentAmount);
    store.wallet.lastUpdated = new Date();
    await store.save();

    // Update loan status
    loan.status = 'repaid';
    loan.repaidAt = new Date();
    await loan.save();

    // Log transaction
    await WalletTopup.create({
      vendorId: store.vendorId,
      storeId: store._id,
      amountPKR: repaymentAmount,
      referenceId: `LOAN-MANREPAY-${loan._id.toString().substring(18).toUpperCase()}`,
      paymentReceiptUrl: '/uploads/receipts/sandbox.png',
      paymentStatus: 'approved',
      type: 'withdrawal',
      message: `Superadmin Admin Manual Repayment of Short-Term Inventory Loan of Rs. ${loan.amount}`
    });

    res.json({ success: true, message: `Successfully deducted Rs. ${repaymentAmount} to settle active loan.`, loan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Toggle / Freeze a store's loan eligibility
// @route   POST /api/wallet/admin/stores/:storeId/freeze-loan
// @access  Private (Admin only)
router.post('/admin/stores/:storeId/freeze-loan', protect, authorize('admin'), async (req, res) => {
  const { isLoanFrozen } = req.body;
  try {
    const store = await Store.findByIdAndUpdate(
      req.params.storeId,
      { $set: { isLoanFrozen: !!isLoanFrozen } },
      { new: true }
    );
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    res.json({ success: true, message: `Store loan eligibility has been ${store.isLoanFrozen ? 'FROZEN' : 'UNFROZEN'}`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Override a store's credit score tier limits
// @route   POST /api/wallet/admin/stores/:storeId/override-credit-score
// @access  Private (Admin only)
router.post('/admin/stores/:storeId/override-credit-score', protect, authorize('admin'), async (req, res) => {
  const { creditScoreOverride } = req.body; // number, or null to clear override
  try {
    const updateVal = creditScoreOverride === null ? null : parseInt(creditScoreOverride, 10);
    const store = await Store.findByIdAndUpdate(
      req.params.storeId,
      { $set: { creditScoreOverride: updateVal } },
      { new: true }
    );
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    res.json({ success: true, message: `Store credit score override set to ${store.creditScoreOverride === null ? 'System Calculated' : store.creditScoreOverride}`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
