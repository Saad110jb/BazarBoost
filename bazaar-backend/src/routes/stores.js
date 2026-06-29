import express from 'express';
import Store from '../models/Store.js';
import User from '../models/User.js';
import { protect, authorize } from '../middleware/auth.js';
import { pushNotification, dispatchNotification } from '../services/notificationService.js';

const router = express.Router();

// @desc    Get all stores (Admin only)
// @route   GET /api/stores
// @access  Private (Admin)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const stores = await Store.find({})
      .populate('vendorId', 'name email status')
      .sort({ createdAt: -1 });
    res.json({ success: true, count: stores.length, stores });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Toggle store suspension status with reason (Admin only)
// @route   PUT /api/stores/:id/status
// @access  Private (Admin)
router.put('/:id/status', protect, authorize('admin'), async (req, res) => {
  const { isActive, reason } = req.body;
  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    
    const targetStatus = isActive !== undefined ? !!isActive : !store.isActive;
    store.isActive = targetStatus;
    
    if (!targetStatus) {
      store.suspensionReason = reason || 'Suspended by SuperAdmin for policy violations.';
      
      // Update vendor status to inactive on suspension
      await User.findByIdAndUpdate(store.vendorId, { status: 'inactive' });
      
      // Dispatch store status changed event (push notification + email notification)
      dispatchNotification('STORE_STATUS_CHANGED', { store, isActive: targetStatus, reason: store.suspensionReason });
    } else {
      store.suspensionReason = '';
      
      // Update vendor status to active on activation
      await User.findByIdAndUpdate(store.vendorId, { status: 'active' });
      
      // Dispatch store status changed event (push notification + email notification)
      dispatchNotification('STORE_STATUS_CHANGED', { store, isActive: targetStatus });
    }
    
    await store.save();
    await store.populate('vendorId', 'name email status');
    res.json({ success: true, message: `Store status updated to ${store.isActive ? 'Active' : 'Suspended'}`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Update or Release Store Slug (Admin only)
// @route   PUT /api/stores/:id/slug
// @access  Private (Admin)
router.put('/:id/slug', protect, authorize('admin'), async (req, res) => {
  const { slug, release } = req.body;
  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }
    
    if (release) {
      store.slug = `released-${store._id.toString()}`;
    } else if (slug) {
      const formattedSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      if (!formattedSlug) {
        return res.status(400).json({ success: false, message: 'Invalid slug format' });
      }
      
      const existing = await Store.findOne({ slug: formattedSlug, _id: { $ne: store._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Slug is already in use by another store' });
      }
      
      store.slug = formattedSlug;
    } else {
      return res.status(400).json({ success: false, message: 'Either slug or release flag is required' });
    }
    
    await store.save();
    await store.populate('vendorId', 'name email status');
    res.json({ success: true, message: 'Store slug updated successfully', store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Add complaint/penalty points to a store (Admin only)
// @route   POST /api/stores/:id/complaints
// @access  Private (Admin)
router.post('/:id/complaints', protect, authorize('admin'), async (req, res) => {
  const { title, details, points } = req.body;
  if (!title || !details) {
    return res.status(400).json({ success: false, message: 'Complaint title and details are required' });
  }

  const penaltyPointsValue = parseInt(points) || 0;
  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    store.complaints = store.complaints || [];
    store.complaints.push({
      title,
      details,
      points: penaltyPointsValue,
      status: 'pending'
    });

    store.penaltyPoints = (store.penaltyPoints || 0) + penaltyPointsValue;

    // Check suspension threshold
    if (store.penaltyPoints >= 50 && store.isActive !== false) {
      store.isActive = false;
      store.suspensionReason = `Suspended automatically due to excessive penalty points (${store.penaltyPoints}/50).`;
      
      // Update vendor status to inactive on auto-suspension
      await User.findByIdAndUpdate(store.vendorId, { status: 'inactive' });

      // Notify vendor of automatic suspension
      try {
        const notifTitle = '🚨 Store Suspended (Excessive Penalties)';
        const notifBody = `Your store "${store.name}" has been suspended because it reached ${store.penaltyPoints} penalty points. Please appeal or resolve complaints.`;
        await pushNotification(store.vendorId, 'general', notifTitle, notifBody, { storeId: store._id.toString() });
      } catch (err) {
        console.error('Failed to send penalty suspension notification:', err.message);
      }
    } else {
      // General complaint notification
      try {
        const notifTitle = '⚠ New Vendor Penalty Filed';
        const notifBody = `A complaint has been filed against your store. Points added: ${penaltyPointsValue}. Total points: ${store.penaltyPoints}/50.`;
        await pushNotification(store.vendorId, 'general', notifTitle, notifBody, { storeId: store._id.toString() });
      } catch (err) {
        console.error('Failed to send complaint notification:', err.message);
      }
    }

    await store.save();
    await store.populate('vendorId', 'name email status');
    res.status(201).json({ success: true, message: 'Complaint filed successfully', store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Vendor appeals a complaint (Vendor/StoreAdmin)
// @route   POST /api/stores/:id/complaints/:complaintId/appeal
// @access  Private (Vendor/StoreAdmin)
router.post('/:id/complaints/:complaintId/appeal', protect, async (req, res) => {
  const { appealMessage } = req.body;
  if (!appealMessage) {
    return res.status(400).json({ success: false, message: 'Appeal message is required' });
  }

  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    // Verify vendor ownership
    const isOwner = store.vendorId.toString() === req.user._id.toString();
    const isStaff = req.user.role === 'storeAdmin' && req.user.activeStoreId === store._id.toString();
    if (!isOwner && !isStaff) {
      return res.status(403).json({ success: false, message: 'Not authorized to appeal for this store' });
    }

    const complaint = store.complaints.id(req.params.complaintId);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    complaint.status = 'appealed';
    complaint.appealMessage = appealMessage;

    await store.save();
    await store.populate('vendorId', 'name email status');
    res.json({ success: true, message: 'Appeal submitted successfully', store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Resolve or dismiss a complaint (Admin only)
// @route   PUT /api/stores/:id/complaints/:complaintId/resolve
// @access  Private (Admin)
router.put('/:id/complaints/:complaintId/resolve', protect, authorize('admin'), async (req, res) => {
  const { action } = req.body; // 'resolved' or 'dismissed'
  if (!['resolved', 'dismissed'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action, must be resolved or dismissed' });
  }

  try {
    const store = await Store.findById(req.params.id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const complaint = store.complaints.id(req.params.complaintId);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    if (complaint.status === 'dismissed' || complaint.status === 'resolved') {
      return res.status(400).json({ success: false, message: 'This complaint has already been resolved/dismissed' });
    }

    const originalPoints = complaint.points || 0;
    complaint.status = action;

    if (action === 'dismissed') {
      // Dismissed: remove penalty points
      store.penaltyPoints = Math.max(0, (store.penaltyPoints || 0) - originalPoints);

      // Notify vendor
      try {
        const notifTitle = '✅ Complaint Dismissed';
        const notifBody = `The complaint "${complaint.title}" against your store has been dismissed. ${originalPoints} penalty points removed. Total points: ${store.penaltyPoints}/50.`;
        await pushNotification(store.vendorId, 'general', notifTitle, notifBody, { storeId: store._id.toString() });
      } catch (err) {
        console.error('Failed to send dismissal notification:', err.message);
      }
    } else {
      // Resolved: points remain but status is marked resolved
      try {
        const notifTitle = '✅ Complaint Resolved';
        const notifBody = `The complaint "${complaint.title}" against your store has been marked as resolved.`;
        await pushNotification(store.vendorId, 'general', notifTitle, notifBody, { storeId: store._id.toString() });
      } catch (err) {
        console.error('Failed to send resolution notification:', err.message);
      }
    }

    // If points drop below 50, and it was suspended, let's keep it suspended but let the admin reactivate
    await store.save();
    await store.populate('vendorId', 'name email status');
    res.json({ success: true, message: `Complaint marked as ${action}`, store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
