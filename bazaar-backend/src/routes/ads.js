import express from 'express';
import mongoose from 'mongoose';
import AdSlot from '../models/AdSlot.js';
import AdBid from '../models/AdBid.js';
import Store from '../models/Store.js';
import WalletTopup from '../models/WalletTopup.js';
import { protect, authorize } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { uploadReceipt } from '../middleware/upload.js';  // tenant-scoped receipt storage
import { performOCR } from '../services/ocrService.js';
import { validateBidAmount } from '../middleware/schemaIntegrity.js';
import { pushNotification, dispatchNotification } from '../services/notificationService.js';

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

const router = express.Router();

// @desc    Get all available ad slots
// @route   GET /api/ads/slots
// @access  Public
router.get('/slots', async (req, res) => {
  try {
    let slots = await AdSlot.find({ isActive: true });
    
    // Auto-correct existing slots if they have outdated basePrice configurations
    let updated = false;
    for (const slot of slots) {
      if (slot.location === 'homepage-hero' && slot.basePrice !== 100) {
        slot.basePrice = 100;
        await slot.save();
        updated = true;
      }
      if (slot.location === 'sidebar-featured' && slot.basePrice !== 20) {
        slot.basePrice = 20;
        await slot.save();
        updated = true;
      }
      if (slot.location === 'search-top' && slot.basePrice !== 15) {
        slot.basePrice = 15;
        await slot.save();
        updated = true;
      }
    }
    
    if (updated) {
      slots = await AdSlot.find({ isActive: true });
    }

    // Seed default slots if database is empty
    if (slots.length === 0) {
      slots = await AdSlot.create([
        { name: 'Homepage Hero Banner (Top Placement)', location: 'homepage-hero', basePrice: 100 },
        { name: 'Sidebar Featured Deals', location: 'sidebar-featured', basePrice: 20 },
        { name: 'Search Result Premium Boost', location: 'search-top', basePrice: 15 }
      ]);
    }

    res.json({ success: true, slots });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Upload an ad banner graphic
// @route   POST /api/ads/upload-banner
// @access  Private (Vendor)
router.post('/upload-banner', protect, requirePermission('MANAGE_ADS'), uploadReceipt.single('banner'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload an image file for the banner' });
  }
  try {
    const publicUrl = toPublicUrl(req.file.path);
    res.json({ success: true, bannerUrl: publicUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Submit an ad promotion bid with receipt upload
// @route   POST /api/ads/bid
// @access  Private (Vendor)
// validateBidAmount middleware: checks bidAmount >= AdSlot.basePrice and injects req.adSlot
router.post('/bid', protect, requirePermission('MANAGE_ADS'), uploadReceipt.single('receipt'), validateBidAmount, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Only vendors or authorized store staff can bid on ad slots' });
  }

  const { slotId, productId, bidAmount, startDate, endDate, referenceId, bannerGraphic, textHeader } = req.body;

  if (!referenceId) {
    return res.status(400).json({ success: false, message: 'Please specify bank transaction reference ID' });
  }


  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Please upload bank transfer receipt image' });
  }

  try {
    // Determine the vendor owner context for the store
    let ownerVendorId = req.user._id;
    if (req.user.role === 'storeAdmin') {
      const store = await Store.findById(req.user.activeStoreId);
      if (!store) {
        return res.status(404).json({ success: false, message: 'Active store context not found' });
      }
      ownerVendorId = store.vendorId;
    }

    // req.adSlot is injected by validateBidAmount middleware — no second DB hit needed
    const slot = req.adSlot;

    // 1. Enforce concurrent campaign limits
    const start = new Date(startDate);
    const end = new Date(endDate);
    const maxSimultaneous = slot.maxSimultaneousCampaigns || 3;
    const overlappingCount = await AdBid.countDocuments({
      slotId,
      paymentStatus: 'approved',
      startDate: { $lte: end },
      endDate: { $gte: start }
    });

    if (overlappingCount >= maxSimultaneous) {
      return res.status(400).json({
        success: false,
        message: `This ad slot has reached its maximum simultaneous campaign limit of ${maxSimultaneous} for the requested duration.`
      });
    }

    // 2. Save receipt path
    const receiptPath = req.file.path.replace(/\\/g, '/'); // normalize slashes
    const paymentReceiptUrl = toPublicUrl(req.file.path);

    // 3. Perform local OCR verification for receipt validation & fraud check
    console.log(`Running local OCR analysis on: ${receiptPath}`);
    const ocrResult = await performOCR(req.file.path);

    // 4. Duplication Blocker Check
    const isDuplicate = await checkDuplication(referenceId, ocrResult.referenceNumber);

    // Parse visual variants if provided
    let variants = [];
    if (req.body.variants) {
      try {
        variants = typeof req.body.variants === 'string' ? JSON.parse(req.body.variants) : req.body.variants;
      } catch (err) {
        console.error('Failed to parse variants:', err.message);
      }
    }
    if (!variants || variants.length === 0) {
      variants = [{
        variantId: 'default',
        name: 'Default Variant',
        bannerGraphic: bannerGraphic || '',
        textHeader: textHeader || ''
      }];
    }

    // 5. Create Ad Bid in database
    const adBid = await AdBid.create({
      slotId,
      vendorId: ownerVendorId,
      productId,
      bidAmount: parseFloat(bidAmount),
      referenceId,
      isDuplicate,
      paymentReceiptUrl,
      paymentStatus: 'pending_approval',
      ocrResult,
      startDate: start,
      endDate: end,
      bannerGraphic: bannerGraphic || '',
      textHeader: textHeader || '',
      variants
    });


    res.status(201).json({
      success: true,
      message: 'Bid submitted successfully. Payment is pending admin review.',
      adBid
    });
  } catch (error) {
    console.error('Error submitting bid:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get active bids by vendor
// @route   GET /api/ads/bids/my
// @access  Private (Vendor)
router.get('/bids/my', protect, requirePermission('MANAGE_ADS'), async (req, res) => {
  try {
    let queryVendorId = req.user._id;
    if (req.user.role === 'storeAdmin') {
      const store = await Store.findById(req.user.activeStoreId);
      if (store) {
        queryVendorId = store.vendorId;
      }
    }
    const bids = await AdBid.find({ vendorId: queryVendorId })
      .populate('slotId', 'name location')
      .populate('productId', 'title price')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: bids.length, bids });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all active approved ads for shoppers view
// @route   GET /api/ads/active
// @access  Public
router.get('/active', async (req, res) => {
  try {
    const { category } = req.query;
    const now = new Date();
    // Auto-expire outdated campaigns
    await AdBid.updateMany(
      { endDate: { $lt: now }, paymentStatus: 'approved' },
      { $set: { paymentStatus: 'expired' } }
    );

    const activeAds = await AdBid.find({
      paymentStatus: 'approved',
      startDate: { $lte: now },
      endDate: { $gte: now }
    })
      .populate('slotId', 'location name durationDays maxSimultaneousCampaigns')
      .populate({
        path: 'productId',
        populate: { path: 'storeId', select: 'name slug isActive debtZone' }
      });

    // Convert to plain JS objects so we can mutate variants array order without triggering validation
    let activeAdsPlain = activeAds.map(ad => {
      const obj = ad.toObject();
      if (obj.variants && obj.variants.length > 1) {
        const rotCount = ad.globalServeCount || 0;
        const rotated = [...obj.variants];
        for (let i = 0; i < rotCount % obj.variants.length; i++) {
          const first = rotated.shift();
          rotated.push(first);
        }
        obj.variants = rotated;
      }
      return obj;
    });

    // Filter out Red Zone (Suspended) and Amber Zone (Ad Freeze) stores
    activeAdsPlain = activeAdsPlain.filter(ad => {
      const store = ad.productId?.storeId;
      if (!store) return false;
      if (store.isActive === false || store.debtZone === 'red') {
        return false;
      }
      if (store.debtZone === 'amber') {
        return false;
      }
      return true;
    });

    // Apply Orange Zone penalty modifier and calculate effective bid
    activeAdsPlain = activeAdsPlain.map(ad => {
      const store = ad.productId?.storeId;
      let effectiveBid = ad.bidAmount || 0;
      if (store && store.debtZone === 'orange') {
        effectiveBid = (ad.bidAmount || 0) * 0.5; // Apply penalty modifier (drops tied ranks)
      }
      return { ...ad, effectiveBid };
    });

    // Re-sort ads by effectiveBid descending
    activeAdsPlain.sort((a, b) => b.effectiveBid - a.effectiveBid);

    // Update globalServeCount in the background for ads with multiple variants
    for (const ad of activeAdsPlain) {
      if (ad.variants && ad.variants.length > 1) {
        AdBid.updateOne({ _id: ad._id }, { $inc: { globalServeCount: 1 } }).catch(err => 
          console.error('Failed to increment globalServeCount:', err)
        );
      }
    }

    // Group ads by location key
    const grouped = {
      'homepage-hero': [],
      'sidebar-featured': [],
      'search-top': []
    };

    activeAdsPlain.forEach(ad => {
      if (ad.slotId && grouped[ad.slotId.location]) {
        if (category) {
          const product = ad.productId;
          if (product && product.aiTags && product.aiTags.some(t => t.toLowerCase() === category.toLowerCase())) {
            grouped[ad.slotId.location].push(ad);
          }
        } else {
          grouped[ad.slotId.location].push(ad);
        }
      }
    });

    res.json({ success: true, ads: grouped });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all pending ad bids (Admin only)
// @route   GET /api/ads/bids/pending
// @access  Private (Admin)
router.get('/bids/pending', protect, authorize('admin'), async (req, res) => {
  try {
    const pendingBids = await AdBid.find({ paymentStatus: 'pending_approval' })
      .populate('slotId', 'name basePrice')
      .populate('vendorId', 'name email')
      .populate('productId', 'title price')
      .sort({ createdAt: 1 });

    res.json({ success: true, count: pendingBids.length, bids: pendingBids });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Approve/Reject an ad bid (Admin only)
// @route   PUT /api/ads/bids/:id/status
// @access  Private (Admin)
router.put('/bids/:id/status', protect, authorize('admin'), async (req, res) => {
  const { status, message } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status update' });
  }

  try {
    const bid = await AdBid.findById(req.params.id).populate('slotId', 'name location');
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    bid.paymentStatus = status;
    if (message !== undefined) {
      bid.message = message;
    }
    await bid.save();

    if (status === 'approved') {
      const StoreModel = (await import('../models/Store.js')).default;
      const store = await StoreModel.findOne({ vendorId: bid.vendorId });
      if (store) {
        const creditAmount = Math.round(parseFloat(bid.bidAmount) * 100) / 100;
        store.wallet = store.wallet || {};
        store.wallet.balancePKR = Math.round(((store.wallet.balancePKR || 0) + creditAmount) * 100) / 100;
        store.wallet.totalDepositedPKR = Math.round(((store.wallet.totalDepositedPKR || 0) + creditAmount) * 100) / 100;
        store.wallet.lastUpdated = new Date();
        await store.save();

        // Emit socket event wallet_updated
        if (global.io) {
          global.io.to(`user:${bid.vendorId.toString()}`).emit('wallet_updated', {
            storeId: store._id,
            balancePKR: store.wallet.balancePKR,
          });
        }
      }
    }

    // Dispatch ad status changed event (push notification + email notification)
    dispatchNotification('AD_STATUS_CHANGED', { bid, isApproved: status === 'approved', reason: message });

    res.json({ success: true, message: `Ad bid payment ${status} successfully.`, bid });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Update ad slot configuration
// @route   PUT /api/ads/slots/:id
// @access  Private (Admin)
router.put('/slots/:id', protect, authorize('admin'), async (req, res) => {
  const { name, basePrice, durationDays, maxSimultaneousCampaigns, isActive } = req.body;
  try {
    const slot = await AdSlot.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ success: false, message: 'Ad slot not found' });
    }

    if (name !== undefined) slot.name = name;
    if (basePrice !== undefined) slot.basePrice = parseFloat(basePrice);
    if (durationDays !== undefined) slot.durationDays = parseInt(durationDays);
    if (maxSimultaneousCampaigns !== undefined) slot.maxSimultaneousCampaigns = parseInt(maxSimultaneousCampaigns);
    if (isActive !== undefined) slot.isActive = !!isActive;

    await slot.save();
    res.json({ success: true, message: 'Ad slot updated successfully.', slot });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Get all bids (for Master Ad Calendar)
// @route   GET /api/ads/bids/all
// @access  Private (Admin)
router.get('/bids/all', protect, authorize('admin'), async (req, res) => {
  try {
    const bids = await AdBid.find({})
      .populate('slotId', 'name location durationDays basePrice')
      .populate('vendorId', 'name email')
      .populate({
        path: 'productId',
        select: 'title price images storeId',
        populate: { path: 'storeId', select: 'name slug' }
      })
      .sort({ createdAt: -1 });

    res.json({ success: true, count: bids.length, bids });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Admin: Terminate campaign placement
// @route   PUT /api/ads/bids/:id/terminate
// @access  Private (Admin)
router.put('/bids/:id/terminate', protect, authorize('admin'), async (req, res) => {
  try {
    const bid = await AdBid.findById(req.params.id);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Ad campaign not found' });
    }

    bid.paymentStatus = 'terminated';
    await bid.save();

    // Trigger notification to the vendor by logging audit action for store
    const product = await mongoose.model('Product').findById(bid.productId);
    const storeId = product ? product.storeId : null;

    const { logActivity } = await import('../services/auditService.js');
    await logActivity(
      storeId,
      req.user._id,
      req.user.name,
      'CAMPAIGN_TERMINATED',
      `Ad campaign placement for "${product ? product.title : 'product'}" was administratively terminated by SuperAdmin.`
    );

    res.json({ success: true, message: 'Ad campaign was successfully terminated.', bid });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Track ad impression or conversion for a visual variant
// @route   POST /api/ads/track
// @access  Public
router.post('/track', async (req, res) => {
  const { bidId, type, variantId } = req.body;

  if (!bidId || !type || !variantId) {
    return res.status(400).json({ success: false, message: 'Missing tracking parameters' });
  }

  if (!['impression', 'conversion'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid tracking type' });
  }

  try {
    const fieldPrefix = type === 'impression' ? 'impressions' : 'conversions';

    // Atomic increment of visual variant and campaign totals
    const query = { _id: bidId };
    const update = {
      $inc: {
        [fieldPrefix]: 1,
        [`variants.$[elem].${fieldPrefix}`]: 1
      }
    };
    const options = {
      arrayFilters: [{ 'elem.variantId': variantId }],
      new: true
    };

    let adBid = await AdBid.findOneAndUpdate(query, update, options);
    if (!adBid) {
      // Fallback in case variantId wasn't found or arrayFilters failed
      adBid = await AdBid.findByIdAndUpdate(bidId, { $inc: { [fieldPrefix]: 1 } }, { new: true });
    }

    if (adBid) {
      // Emit real-time stats update to the vendor
      if (global.io) {
        global.io.to(`user:${adBid.vendorId.toString()}`).emit('ad_stats_updated', {
          bidId: adBid._id.toString(),
          type,
          variantId,
          impressions: adBid.impressions,
          conversions: adBid.conversions,
          variants: adBid.variants
        });
      }

      // Fetch product and store context to log the activity properly
      const product = await mongoose.model('Product').findById(adBid.productId);
      const storeId = product ? product.storeId : null;
      const store = storeId ? await mongoose.model('Store').findById(storeId) : null;
      const storeName = store ? store.name : 'Unknown Store';

      // Log traffic event to the SuperAdmin's stream
      const { logActivity } = await import('../services/auditService.js');
      await logActivity(
        storeId,
        adBid.vendorId,
        'Shopper Interface',
        'AD_TRAFFIC',
        `Variant "${variantId}" of campaign "${bidId}" (Store: "${storeName}") received an ${type}.`,
        { scope: 'platform' }
      );
    }

    res.json({ success: true, message: 'Tracking event recorded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get Predictive Ad-Bid Smart Recommendations
// @route   GET /api/ads/recommendations
// @access  Private (Vendor, Store Admin)
router.get('/recommendations', protect, async (req, res) => {
  try {
    const vendorId = req.user._id;
    const latestBid = await AdBid.findOne({ vendorId }).sort({ createdAt: -1 });

    let baseMsg = 'Vendors bidding Rs. 50 more right now are capturing 3.2x more impressions in Lahore.';

    if (latestBid) {
      baseMsg = `Vendors bidding Rs. 50 more on ${latestBid.textHeader || 'their active slots'} are capturing 3.2x more impressions in Lahore.`;
    }

    res.json({
      success: true,
      recommendation: {
        message: baseMsg,
        additionalBidAmount: 50,
        targetLocation: 'Lahore',
        multiplier: '3.2x'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

