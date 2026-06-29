import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { verifyTenantAccess } from '../middleware/rbac.js';
import { uploadComplaintEvidence } from '../middleware/upload.js';
import { logActivity } from '../services/auditService.js';
import { pushNotification } from '../services/notificationService.js';
import ComplaintTicket from '../models/ComplaintTicket.js';
import Store from '../models/Store.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import User from '../models/User.js';
import Message from '../models/Message.js';

const router = express.Router();

// Helper to convert absolute or relative file path to public URL starting with /uploads
const toPublicUrl = (filePath) => {
  const normalized = filePath.replace(/\\/g, '/');
  const uploadsIdx = normalized.indexOf('uploads/');
  return uploadsIdx !== -1 ? '/' + normalized.substring(uploadsIdx) : '/' + normalized.replace(/^\.\//, '');
};

// @desc    File a new customer complaint/dispute ticket
// @route   POST /api/complaints
// @access  Private (Shopper/All authenticated users)
router.post('/', protect, uploadComplaintEvidence.single('evidence'), async (req, res) => {
  const { category, description, associatedId } = req.body;

  if (!category || !description || !associatedId) {
    return res.status(400).json({ success: false, message: 'Category, description, and order/product ID are required' });
  }

  try {
    let storeId = null;
    let orderId = null;
    let productId = null;
    let targetName = '';

    // 1. Resolve store context based on Order or Product ID
    const order = await Order.findById(associatedId);
    if (order) {
      storeId = order.storeId;
      orderId = order._id;
      targetName = `Order #${order._id.toString().slice(-8).toUpperCase()}`;
    } else {
      const product = await Product.findById(associatedId);
      if (product) {
        storeId = product.storeId;
        productId = product._id;
        targetName = `Product: ${product.title}`;
      }
    }

    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Invalid Associated ID. Must correspond to a valid Order or Product.' });
    }

    // 2. Resolve evidence image if uploaded
    const evidenceUrl = req.file ? toPublicUrl(req.file.path) : '';

    // 3. Create the dispute ticket
    const ticket = await ComplaintTicket.create({
      shopperId: req.user._id,
      storeId,
      orderId,
      productId,
      category,
      description,
      evidenceUrl,
      status: 'open',
      escalationLog: [{
        actorId: req.user._id,
        actorRole: req.user.role,
        action: 'TICKET_CREATED',
        message: `Dispute filed by customer against ${targetName}.`
      }]
    });

    // 4. Send live notification to the vendor
    const store = await Store.findById(storeId);
    if (store) {
      await pushNotification(
        store.vendorId,
        'general',
        '🚨 Customer Dispute Filed',
        `Dispute filed regarding ${targetName}. Category: ${category}.`,
        { ticketId: ticket._id.toString() }
      );
    }

    // 5. Log activity
    await logActivity(
      storeId,
      req.user._id,
      req.user.name,
      'DISPUTE_FILED',
      `Customer filed dispute ticket ${ticket._id} against store ${storeId}. Target: ${targetName}`,
      { scope: 'store', targetModel: 'ComplaintTicket' }
    );

    res.status(201).json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all tickets filed by shopper
// @route   GET /api/complaints/my
// @access  Private (Shopper)
router.get('/my', protect, async (req, res) => {
  try {
    const tickets = await ComplaintTicket.find({ shopperId: req.user._id })
      .populate('storeId', 'name slug')
      .populate('orderId', 'totalAmount status createdAt')
      .populate('productId', 'title price')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get tickets filed against vendor's store
// @route   GET /api/complaints/vendor
// @access  Private (Vendor/StoreAdmin)
router.get('/vendor', protect, async (req, res) => {
  if (req.user.role !== 'vendor' && req.user.role !== 'storeAdmin') {
    return res.status(403).json({ success: false, message: 'Access denied: Only merchants can access vendor portal disputes' });
  }
  try {
    const storeId = req.user.activeStoreId || req.user.storeId;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Active store context is missing' });
    }

    const tickets = await ComplaintTicket.find({ storeId })
      .populate('shopperId', 'name email')
      .populate('orderId', 'totalAmount status items')
      .populate('productId', 'title price')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get tickets for StoreAdmin triage or SuperAdmin supreme court docket
// @route   GET /api/complaints/admin
// @access  Private (StoreAdmin/SuperAdmin)
router.get('/admin', protect, async (req, res) => {
  try {
    let tickets = [];
    if (req.user.role === 'admin') {
      // SuperAdmin supreme docket: fetches all escalated disputes
      tickets = await ComplaintTicket.find({ status: 'escalated' })
        .populate('shopperId', 'name email status')
        .populate('storeId', 'name slug wallet isActive suspensionReason')
        .populate('orderId', 'totalAmount status items')
        .populate('productId', 'title price isDeleted')
        .sort({ updatedAt: -1 });
    } else if (req.user.role === 'storeAdmin') {
      // StoreAdmin triage: scoped to their store context
      const storeId = req.user.activeStoreId;
      if (!storeId) {
        return res.status(400).json({ success: false, message: 'Store context not found for StoreAdmin' });
      }

      tickets = await ComplaintTicket.find({ storeId })
        .populate('shopperId', 'name email')
        .populate('orderId', 'totalAmount status items')
        .populate('productId', 'title price isDeleted')
        .sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get chat transcript logs between shopper and vendor associated with a ticket
// @route   GET /api/complaints/:id/chat
// @access  Private (StoreAdmin/SuperAdmin/Vendor/Shopper)
router.get('/:id/chat', protect, async (req, res) => {
  try {
    const ticket = await ComplaintTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Dispute ticket not found' });
    }

    const store = await Store.findById(ticket.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store context not found' });
    }

    // Retrieve chat logs sorted chronologically
    const chatHistory = await Message.find({
      shopperId: ticket.shopperId,
      vendorId: store.vendorId
    }).sort({ createdAt: 1 });

    res.json({ success: true, chatHistory });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Vendor submit dispute response & execute self-remediation
// @route   POST /api/complaints/:id/respond
// @access  Private (Vendor/StoreAdmin)
router.post('/:id/respond', protect, async (req, res) => {
  const { message, remedyType } = req.body;

  if (!message || !remedyType) {
    return res.status(400).json({ success: false, message: 'Response message and remedy type are required' });
  }

  try {
    const ticket = await ComplaintTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Dispute ticket not found' });
    }

    const storeId = req.user.activeStoreId || req.user.storeId;
    if (ticket.storeId.toString() !== storeId?.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized: This ticket does not belong to your store.' });
    }

    let couponCode = '';

    // Execute Self-Remediation depending on selected action
    if (remedyType === 'coupon') {
      // Programmatically spawn a custom compensation Coupon
      couponCode = `COMP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days validity

      await Coupon.create({
        storeId: ticket.storeId,
        code: couponCode,
        discountType: 'percentage',
        discountValue: 15, // 15% discount compensation
        minSpend: 0,
        usageLimit: 1,
        expiresAt,
        isActive: true
      });
    } else if (remedyType === 'soft_delete') {
      // Soft-delete associated broken product variant
      if (ticket.productId) {
        await Product.findByIdAndUpdate(ticket.productId, { isDeleted: true });
        await logActivity(
          ticket.storeId,
          req.user._id,
          req.user.name,
          'PRODUCT_SOFT_DELETE',
          `Product soft-deleted automatically via dispute remedy for ticket ${ticket._id}`,
          { scope: 'store', targetModel: 'Product' }
        );
      }
    } else if (remedyType === 'refund') {
      // Simulate order refund and store wallet adjustment
      if (ticket.orderId) {
        await Order.findByIdAndUpdate(ticket.orderId, { status: 'cancelled' });
        await logActivity(
          ticket.storeId,
          req.user._id,
          req.user.name,
          'ORDER_REFUNDED',
          `Order #${ticket.orderId} marked cancelled and refunded via dispute remedy for ticket ${ticket._id}`,
          { scope: 'store', targetModel: 'Order' }
        );
      }
    }

    // Update ticket vendor response
    ticket.vendorResponse = {
      message,
      remedyType,
      couponCode,
      timestamp: new Date()
    };
    ticket.status = 'resolved';

    ticket.escalationLog.push({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'VENDOR_RESPONSE_REMEDY',
      message: `Vendor counter-responded offering remedy: "${remedyType}".`
    });

    await ticket.save();

    // Notify customer
    await pushNotification(
      ticket.shopperId,
      'general',
      '✉ Dispute Resolved',
      `Merchant has responded to your dispute and offered compensation. Coupon code (if offered): ${couponCode || 'N/A'}.`,
      { ticketId: ticket._id.toString() }
    );

    res.json({ success: true, message: 'Response submitted and remedy executed successfully.', ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Escalate dispute to SuperAdmin Supreme Court
// @route   POST /api/complaints/:id/escalate
// @access  Private (Vendor/StoreAdmin)
router.post('/:id/escalate', protect, async (req, res) => {
  const { message } = req.body;
  try {
    const ticket = await ComplaintTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Dispute ticket not found' });
    }

    // Verify escalation permission (either platform admin, vendor owning the store, or store admin)
    const isPlatformAdmin = req.user.role === 'admin';
    const isStoreAdmin = req.user.role === 'storeAdmin' && req.user.activeStoreId?.toString() === ticket.storeId.toString();
    const isVendor = req.user.role === 'vendor' && req.user.storeId?.toString() === ticket.storeId.toString();

    if (!isPlatformAdmin && !isStoreAdmin && !isVendor) {
      return res.status(403).json({ success: false, message: 'Not authorized to escalate this dispute' });
    }

    ticket.status = 'escalated';
    ticket.escalationLog.push({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: 'TICKET_ESCALATED',
      message: message || 'Dispute escalated to SuperAdmin Supreme Court.'
    });

    await ticket.save();

    // Alert SuperAdmins
    const superAdmins = await User.find({ role: 'admin' });
    for (const sa of superAdmins) {
      await pushNotification(
        sa._id,
        'general',
        '⚖ Dispute Escalated to supreme docket',
        `Dispute ticket ${ticket._id} has been escalated for governance audit.`,
        { ticketId: ticket._id.toString() }
      );
    }

    // Notify Shopper
    await pushNotification(
      ticket.shopperId,
      'general',
      '⚖ Dispute Escalated',
      'Your dispute ticket has been escalated to platform governance court.',
      { ticketId: ticket._id.toString() }
    );

    res.json({ success: true, message: 'Dispute ticket escalated successfully.', ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    StoreAdmin triage resolution ruling
// @route   POST /api/complaints/:id/triage
// @access  Private (StoreAdmin)
router.post('/:id/triage', protect, authorize('storeAdmin'), verifyTenantAccess, async (req, res) => {
  const { action, message } = req.body;

  if (!action || !message) {
    return res.status(400).json({ success: false, message: 'Triage action and description message are required' });
  }

  try {
    const ticket = await ComplaintTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Dispute ticket not found' });
    }

    if (ticket.storeId.toString() !== req.user.activeStoreId?.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized: StoreAdmin tenant boundary mismatch' });
    }

    if (action === 'resolve') {
      ticket.status = 'resolved';
      ticket.adminDecision = {
        message,
        actionTaken: 'LOCAL_TRIAGE_RESOLVED',
        timestamp: new Date()
      };
      ticket.escalationLog.push({
        actorId: req.user._id,
        actorRole: req.user.role,
        action: 'STOREADMIN_RESOLVE',
        message: `StoreAdmin resolved dispute locally: ${message}`
      });
    } else if (action === 'soft_delete') {
      ticket.status = 'resolved';
      ticket.adminDecision = {
        message,
        actionTaken: 'FORCE_PRODUCT_SOFT_DELETE',
        timestamp: new Date()
      };
      ticket.escalationLog.push({
        actorId: req.user._id,
        actorRole: req.user.role,
        action: 'STOREADMIN_FORCE_PRODUCT_DELETE',
        message: `StoreAdmin forced product deletion and resolved ticket: ${message}`
      });

      if (ticket.productId) {
        await Product.findByIdAndUpdate(ticket.productId, { isDeleted: true });
        await logActivity(
          ticket.storeId,
          req.user._id,
          req.user.name,
          'PRODUCT_SOFT_DELETE',
          `Product soft-deleted by force triage ruling. Ticket: ${ticket._id}`,
          { scope: 'store', targetModel: 'Product' }
        );
      }
    } else if (action === 'escalate') {
      ticket.status = 'escalated';
      ticket.escalationLog.push({
        actorId: req.user._id,
        actorRole: req.user.role,
        action: 'STOREADMIN_ESCALATE',
        message: `StoreAdmin escalated dispute: ${message}`
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid triage action' });
    }

    await ticket.save();

    // Notify shopper and vendor
    await pushNotification(
      ticket.shopperId,
      'general',
      `⚖ Dispute Status Update`,
      `Your dispute has been updated: ${ticket.status}. Action: ${action}`,
      { ticketId: ticket._id.toString() }
    );

    const store = await Store.findById(ticket.storeId);
    if (store) {
      await pushNotification(
        store.vendorId,
        'general',
        `⚖ Dispute Triage Action`,
        `StoreAdmin has applied a triage ruling: ${action}. Message: ${message}`,
        { ticketId: ticket._id.toString() }
      );
    }

    res.json({ success: true, message: `Dispute triaged successfully: ${action}`, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    SuperAdmin absolute Supreme Court overrides
// @route   POST /api/complaints/:id/governance
// @access  Private (SuperAdmin only)
router.post('/:id/governance', protect, authorize('admin'), async (req, res) => {
  const { action, message } = req.body;

  if (!action || !message) {
    return res.status(400).json({ success: false, message: 'Governance override action and description message are required' });
  }

  try {
    const ticket = await ComplaintTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Dispute ticket not found' });
    }

    ticket.adminDecision = {
      message,
      actionTaken: action.toUpperCase(),
      timestamp: new Date()
    };
    ticket.status = 'resolved';

    ticket.escalationLog.push({
      actorId: req.user._id,
      actorRole: req.user.role,
      action: `SUPERADMIN_OVERRIDE_${action.toUpperCase()}`,
      message: `SuperAdmin Supreme Court issued override: ${message}`
    });

    await ticket.save();

    // Execute absolute overrides
    if (action === 'suspend_fleet') {
      // Suspend storefront fleet across the entire platform
      const store = await Store.findById(ticket.storeId);
      if (store) {
        store.isActive = false;
        store.suspensionReason = `Storefront Fleet Suspension issued via Supreme Court dispute resolution. Message: ${message}`;
        await store.save();

        // Suspend vendor status
        await User.findByIdAndUpdate(store.vendorId, { status: 'inactive' });

        await logActivity(
          ticket.storeId,
          req.user._id,
          req.user.name,
          'STORE_SUSPEND',
          `Store suspended via supreme override for ticket ${ticket._id}`,
          { scope: 'platform', targetModel: 'Store' }
        );
      }
    } else if (action === 'block_profile') {
      // Permanently block user profile
      const store = await Store.findById(ticket.storeId);
      if (store) {
        // Block vendor
        await User.findByIdAndUpdate(store.vendorId, { status: 'suspended' });
        await logActivity(
          null,
          req.user._id,
          req.user.name,
          'USER_PROFILE_BLOCKED',
          `Vendor user ${store.vendorId} blocked permanently via supreme override. Ticket: ${ticket._id}`,
          { scope: 'platform', targetModel: 'User' }
        );
      }
      // Block shopper if indicated
      if (req.body.targetShopperBlock) {
        await User.findByIdAndUpdate(ticket.shopperId, { status: 'suspended' });
        await logActivity(
          null,
          req.user._id,
          req.user.name,
          'USER_PROFILE_BLOCKED',
          `Shopper user ${ticket.shopperId} blocked permanently via supreme override. Ticket: ${ticket._id}`,
          { scope: 'platform', targetModel: 'User' }
        );
      }
    }

    // Notify shopper and vendor
    await pushNotification(
      ticket.shopperId,
      'general',
      '⚖ Supreme Court Verdict',
      `SuperAdmin has issued an override ruling: ${message}`,
      { ticketId: ticket._id.toString() }
    );

    const storeObj = await Store.findById(ticket.storeId);
    if (storeObj) {
      await pushNotification(
        storeObj.vendorId,
        'general',
        '⚖ Supreme Court Verdict',
        `SuperAdmin has resolved your dispute: ${message}`,
        { ticketId: ticket._id.toString() }
      );
    }

    res.json({ success: true, message: `Supreme Court governance override executed: ${action}`, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
