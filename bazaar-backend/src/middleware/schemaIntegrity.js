/**
 * Schema Integrity Middleware
 *
 * Enforces application-layer constraints that supplement Mongoose schema validators.
 * Each function below corresponds to a rule documented in schema_integrity_rules.md.
 */

import AdSlot from '../models/AdSlot.js';
import Store from '../models/Store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Rule: bidAmount >= AdSlot.basePrice
//
// Prevents vendors from submitting bids below the minimum for a slot.
// Schema enforces min: 0 but not the per-slot floor — this fills that gap.
// ─────────────────────────────────────────────────────────────────────────────
export const validateBidAmount = async (req, res, next) => {
  const { slotId, bidAmount } = req.body;

  if (!slotId || bidAmount === undefined) {
    return next(); // Let the route handler catch missing fields
  }

  try {
    const slot = await AdSlot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ success: false, message: 'Ad slot not found' });
    }

    const parsedBid = parseFloat(bidAmount);
    if (isNaN(parsedBid) || parsedBid < slot.basePrice) {
      return res.status(400).json({
        success: false,
        message: `Bid amount (PKR ${parsedBid}) is below the minimum base price for this slot (PKR ${slot.basePrice})`,
        minimumBid: slot.basePrice,
      });
    }

    // Attach validated slot to request for downstream route use (avoids second DB hit)
    req.adSlot = slot;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule: slug must be globally unique and tenant-safe
//
// Validates that a store slug does not already exist before creation.
// This is a belt-and-suspenders guard on top of the DB unique index.
// ─────────────────────────────────────────────────────────────────────────────
export const validateUniqueSlug = async (req, res, next) => {
  const { slug } = req.body;
  if (!slug) return next();

  const normalized = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/(^-|-$)+/g, '');

  try {
    const existing = await Store.findOne({ slug: normalized });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Store slug "${normalized}" is already taken. Please choose a unique store name.`,
        conflictingSlug: normalized,
      });
    }

    req.normalizedSlug = normalized; // pass sanitized value to route
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule: wallet deduction pre-check (no-overdraft)
//
// Middleware version of the overdraft guard — used before any route that
// charges a vendor's wallet (e.g., automatic ad fee deduction).
// ─────────────────────────────────────────────────────────────────────────────
export const validateWalletBalance = async (req, res, next) => {
  const { amountPKR } = req.body;
  const vendor = req.user;

  if (!vendor?.storeId || !amountPKR) return next();

  try {
    const store = await Store.findById(vendor.storeId).select('wallet');
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    const debit  = Math.round(parseFloat(amountPKR) * 100) / 100;
    const balance = Math.round(store.wallet.balancePKR * 100) / 100;

    if (balance < debit) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Available: PKR ${balance}, Required: PKR ${debit}`,
        currentBalance: balance,
        requiredAmount: debit,
      });
    }

    req.walletStore = store; // pass to route to avoid re-fetching
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule: senderId must belong to the conversation participants
//
// Prevents a user from injecting messages into a conversation they are not part of.
// ─────────────────────────────────────────────────────────────────────────────
export const validateMessageSender = (req, res, next) => {
  const { shopperId, vendorId, senderId } = req.body;
  const userId = req.user?._id?.toString();

  if (!shopperId || !vendorId || !senderId) return next();

  if (
    senderId !== userId ||
    (userId !== shopperId.toString() && userId !== vendorId.toString())
  ) {
    return res.status(403).json({
      success: false,
      message: 'Message rejected: senderId must match your user ID and you must be a participant in this conversation',
    });
  }

  next();
};
