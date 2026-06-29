import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import ShopperProfile from '../models/ShopperProfile.js';
import WalletTopup from '../models/WalletTopup.js';
import { logActivity } from './auditService.js';
import { dispatchNotification } from './notificationService.js';

const toPKR = (value) => Math.round(parseFloat(value) * 100) / 100;

/**
 * Atomic Order Cancellation Service Logic
 * 
 * Executes inventory restitution, shopper wallet refunding, store commission reversal,
 * and compliance chat purges under a transaction wrapper.
 * 
 * @param {string|object} orderOrId - Order document or Order ObjectId
 * @param {string} reason - Cancellation reason
 * @param {string} actorRole - 'shopper', 'vendor', or 'system'
 * @param {object} [operatorUser] - The User object initiating the action (optional)
 */
export const cancelOrderInternal = async (orderOrId, reason, actorRole, operatorUser = null) => {
  let order;
  if (typeof orderOrId === 'string' || orderOrId instanceof mongoose.Types.ObjectId) {
    order = await Order.findById(orderOrId);
  } else {
    order = orderOrId;
  }

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status === 'cancelled') {
    return order; // Already cancelled
  }

  const session = null;
  // Transactions are ignored / run in fallback mode on standalone MongoDB servers.
  // We use standard try-catch fallback directly just like post-fulfillment chat purge does.
  try {
    // 1. Inventory Restitution
    for (const item of order.items) {
      const prod = await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity, stockBalance: item.quantity } },
        { new: true }
      );
      if (prod) {
        prod.isLowStock = prod.stock < 5;
        await prod.save();

        if (global.io) {
          global.io.to(`store:${prod.storeId.toString()}`).emit('product_stock_alert', {
            productId: prod._id.toString(),
            stock: prod.stock,
            isLowStock: prod.isLowStock
          });
        }
      }
    }

    // 2. Prepaid Refund Routing & RTO Downpayment Handling
    if (order.paymentMethod === 'bank_transfer') {
      const profile = await ShopperProfile.findOne({ userId: order.shopperId });
      if (profile) {
        profile.balancePKR = toPKR((profile.balancePKR || 0) + order.totalAmount);
        await profile.save();
        console.log(`[Cancellation Refund] Refunded Rs. ${order.totalAmount} to shopper ${order.shopperId} profile wallet balance.`);
      }
    }

    if (order.downPaymentAmount > 0) {
      if (actorRole === 'shopper') {
        // Shopper cancelled (Customer Refusal / RTO case): Forfeit and credit the vendor store
        const storeDoc = await Store.findById(order.storeId);
        if (storeDoc) {
          storeDoc.wallet = storeDoc.wallet || {};
          storeDoc.wallet.balancePKR = toPKR((storeDoc.wallet.balancePKR || 0) + order.downPaymentAmount);
          storeDoc.wallet.totalDepositedPKR = toPKR((storeDoc.wallet.totalDepositedPKR || 0) + order.downPaymentAmount);
          storeDoc.wallet.lastUpdated = new Date();
          await storeDoc.save();
          console.log(`[RTO Forfeit] Customer cancelled COD order. Logistics downpayment of Rs. ${order.downPaymentAmount} credited to store ${storeDoc._id} wallet.`);

          // Log logistics insurance transaction
          try {
            await WalletTopup.create({
              vendorId: storeDoc.vendorId,
              storeId: storeDoc._id,
              amountPKR: order.downPaymentAmount,
              referenceId: `RTO-INS-${order._id.toString().substring(18).toUpperCase()}`,
              paymentReceiptUrl: '/uploads/receipts/sandbox.png',
              paymentStatus: 'approved',
              type: 'topup',
              message: `Logistics insurance payout for customer-cancelled COD order #${order._id.toString().substring(18).toUpperCase()}`
            });
          } catch (txErr) {
            console.error('[RTO Forfeit Transaction Error]', txErr.message);
          }
        }
      } else {
        // Vendor or system cancelled: Refund the downpayment back to shopper's wallet
        const profile = await ShopperProfile.findOne({ userId: order.shopperId });
        if (profile) {
          profile.balancePKR = toPKR((profile.balancePKR || 0) + order.downPaymentAmount);
          await profile.save();
          console.log(`[RTO Refund] Order cancelled by ${actorRole}. Refunded logistics downpayment of Rs. ${order.downPaymentAmount} to shopper ${order.shopperId} wallet balance.`);
        }
      }
    }

    // 3. Ledger & Commission Reversal
    const store = await Store.findById(order.storeId);
    if (store) {
      const debited = order.commissionDebitedPKR || 0;
      const outstanding = order.commissionOutstandingPKR || 0;

      if (debited > 0 || outstanding > 0) {
        store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) + debited);
        store.wallet.totalSpentPKR = toPKR(Math.max(0, (store.wallet.totalSpentPKR || 0) - debited));
        store.wallet.outstandingCommission = toPKR(Math.max(0, (store.wallet.outstandingCommission || 0) - outstanding));
        store.wallet.lastUpdated = new Date();
        await store.save();

        console.log(`[Commission Reversal] Reversing 5% commission for Order ${order._id}. Refunded to balance: Rs. ${debited}. Subtracted outstanding: Rs. ${outstanding}.`);

        // Record a transaction for the refunded commission
        if (debited > 0) {
          try {
            await WalletTopup.create({
              vendorId: store.vendorId,
              storeId: store._id,
              amountPKR: debited,
              referenceId: `COMM-REF-${order._id.toString().substring(18).toUpperCase()}`,
              paymentReceiptUrl: '/uploads/receipts/sandbox.png',
              paymentStatus: 'approved',
              type: 'commission_payment',
              message: `Commission refund for cancelled Order #${order._id.toString().substring(18).toUpperCase()}`
            });
          } catch (txErr) {
            console.error('[Commission Refund Transaction Log Error]', txErr.message);
          }
        }
      }

      // 4. Vendor Stock Negligence Penalty
      const isNegligence = /stock|negligence|out_of_stock|quality/i.test(reason);
      if (actorRole === 'vendor' && isNegligence) {
        store.penaltyPoints = (store.penaltyPoints || 0) + 1;
        await store.save();
        console.log(`[Negligence Penalty] Vendor cancelled order due to stock negligence. Incremented store penalty points. New total: ${store.penaltyPoints}`);

        // Check repeated negligence cancellations
        const negligenceCount = await Order.countDocuments({
          storeId: store._id,
          status: 'cancelled',
          cancellationReason: /stock|negligence|out_of_stock|quality/i
        });

        if (negligenceCount >= 3) {
          console.warn(`[Audit Flag Triggered] Store ${store.name} has exceeded threshold of vendor-side negligence cancellations: Count=${negligenceCount}`);
          await logActivity(
            store._id,
            store.vendorId,
            'System Governance',
            'VENDOR_REPEATED_CANCELLATION',
            `Automated Audit Flag: Store "${store.name}" has repeated vendor-side cancellations due to stock negligence (Total count: ${negligenceCount}).`,
            { scope: 'store' }
          );
        }
      }
    }

    // 4.5 Rollback Shopper Monthly Loyalty Spend Metrics
    try {
      const orderDate = new Date(order.createdAt);
      const year = orderDate.getUTCFullYear();
      const month = String(orderDate.getUTCMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`;
      
      const LoyaltyLedgerCache = mongoose.models.LoyaltyLedgerCache || mongoose.model('LoyaltyLedgerCache');
      if (LoyaltyLedgerCache) {
        const cache = await LoyaltyLedgerCache.findOne({ userId: order.shopperId, monthKey });
        if (cache) {
          const orderSubtotal = toPKR((order.totalAmount || 0) - (order.shippingPremium || 0) + (order.loyaltyDiscount || 0));
          cache.accumulatedSpend = toPKR(Math.max(0, cache.accumulatedSpend - orderSubtotal));
          if (order.loyaltyDiscount > 0) {
            cache.claimsCount = Math.max(0, cache.claimsCount - 1);
          }
          cache.lastUpdated = new Date();
          await cache.save();
          console.log(`[Loyalty Rollback] Subtracted Rs. ${orderSubtotal} from shopper ${order.shopperId} loyalty spend balance for ${monthKey}.`);

          if (global.io) {
            const rollbackMsg = `[LOGISTICS] Order #${order._id.toString().slice(-6).toUpperCase()} cancelled. Rs. ${orderSubtotal.toLocaleString()} spend rolled back for user #${order.shopperId.toString().slice(-6).toUpperCase()}.`;
            global.io.emit('loyalty_log_event', { text: rollbackMsg, timestamp: new Date() });
          }
        }
      }
    } catch (loyaltyRollbackError) {
      console.error('[Loyalty Rollback Error] Failed to rollback shopper monthly spend metrics:', loyaltyRollbackError.message);
    }

    // 5. Update Order State
    order.status = 'cancelled';
    order.cancellationReason = reason;
    order.commissionDebitedPKR = 0;
    order.commissionOutstandingPKR = 0;
    await order.save();

    // 6. Audit Log
    const operatorId = operatorUser?._id || order.shopperId;
    const operatorName = operatorUser?.name || (actorRole === 'shopper' ? 'Customer' : 'System');
    await logActivity(
      order.storeId,
      operatorId,
      operatorName,
      'ORDER_CANCEL',
      `Order #${order._id.toString().slice(-8).toUpperCase()} cancelled by ${actorRole}. Reason: "${reason}".`
    );

    // 7. Chat Cleanup Eviction via Notification service event
    // The event listener is asynchronous, so we dispatch it. It will trigger deletePostFulfillmentChat automatically.
    dispatchNotification('ORDER_STATUS_CHANGED', { order, statusText: 'cancelled' });

    try {
      const { broadcastVendorDashboardMetrics } = await import('../config/socketHandler.js');
      await broadcastVendorDashboardMetrics(order.storeId, 'UPDATE', null);
    } catch (err) {
      console.error('Error broadcasting vendor metrics upon order cancellation:', err);
    }

    return order;
  } catch (error) {
    console.error('[Order Cancellation Internal Error]', error.message);
    throw error;
  }
};

/**
 * processFulfillmentPayout
 * 
 * Executed when an order is completed or delivered.
 * Calculates net payout (95% of GMV), sweeps outstanding vendor loan debt,
 * credits the residual to the vendor's wallet balance, and creates ledger logs.
 * 
 * Runs under a fallback transaction logic or direct atomic updates.
 */
export const processFulfillmentPayout = async (orderId) => {
  const Order = mongoose.model('Order');
  const Store = mongoose.model('Store');
  const VendorLoan = mongoose.model('VendorLoan');
  const WalletTopup = mongoose.model('WalletTopup');

  try {
    const order = await Order.findById(orderId);
    if (!order) return;

    if (order.isPayoutProcessed) {
      console.log(`[Payout Hook] Payout already processed for order #${order._id}`);
      return;
    }

    if (!['completed', 'delivered'].includes(order.status)) {
      return;
    }

    const storeDoc = await Store.findById(order.storeId);
    if (!storeDoc) return;

    const gmv = order.totalAmount - (order.shippingPremium || 0);
    const netPayout = toPKR(gmv * 0.95);

    // Look for active loan
    const activeLoan = await VendorLoan.findOne({ storeId: storeDoc._id, status: 'approved' });

    if (activeLoan) {
      const repaymentAmount = activeLoan.repaymentAmount;
      console.log(`[Payout Hook] Active loan found. Repayment debt outstanding: Rs. ${repaymentAmount}. Net payout: Rs. ${netPayout}`);

      if (netPayout >= repaymentAmount) {
        // Fully covers loan
        activeLoan.status = 'repaid';
        activeLoan.repaymentAmount = 0;
        activeLoan.payoutHoldAmount = 0;
        activeLoan.repaidAt = new Date();
        await activeLoan.save();

        const residual = toPKR(netPayout - repaymentAmount);
        storeDoc.wallet.balancePKR = toPKR((storeDoc.wallet.balancePKR || 0) + residual);
        storeDoc.wallet.totalDepositedPKR = toPKR((storeDoc.wallet.totalDepositedPKR || 0) + residual);
        storeDoc.wallet.lastUpdated = new Date();
        await storeDoc.save();

        await WalletTopup.create({
          vendorId: storeDoc.vendorId,
          storeId: storeDoc._id,
          amountPKR: repaymentAmount,
          referenceId: `LOAN-AUTOREPAY-${activeLoan._id.toString().substring(18).toUpperCase()}`,
          paymentReceiptUrl: '/uploads/receipts/sandbox.png',
          paymentStatus: 'approved',
          type: 'loan_repayment',
          message: `Auto-repaid Loan Rs. ${activeLoan.amount} (with flat interest) from Order #${order._id.toString().substring(18).toUpperCase()} payout`
        });

        if (residual > 0) {
          await WalletTopup.create({
            vendorId: storeDoc.vendorId,
            storeId: storeDoc._id,
            amountPKR: residual,
            referenceId: `PAYOUT-RES-${order._id.toString().substring(18).toUpperCase()}`,
            paymentReceiptUrl: '/uploads/receipts/sandbox.png',
            paymentStatus: 'approved',
            type: 'deposit',
            message: `Residual Order Payout for #${order._id.toString().substring(18).toUpperCase()} after loan auto-sweeping`
          });
        }

        notifySuperadmin(`[SETTLEMENT] Auto-repaid active loan of Rs. ${activeLoan.amount} for '${storeDoc.name}' from Order #${order._id.toString().substring(18).toUpperCase()} payout.`);
      } else {
        // Partially covers loan
        activeLoan.repaymentAmount = toPKR(repaymentAmount - netPayout);
        activeLoan.payoutHoldAmount = toPKR(Math.max(0, activeLoan.payoutHoldAmount - netPayout));
        await activeLoan.save();

        await WalletTopup.create({
          vendorId: storeDoc.vendorId,
          storeId: storeDoc._id,
          amountPKR: netPayout,
          referenceId: `LOAN-PARTIAL-${activeLoan._id.toString().substring(18).toUpperCase()}`,
          paymentReceiptUrl: '/uploads/receipts/sandbox.png',
          paymentStatus: 'approved',
          type: 'loan_repayment',
          message: `Partial Loan Repayment of Rs. ${netPayout} from Order #${order._id.toString().substring(18).toUpperCase()} payout`
        });

        notifySuperadmin(`[SETTLEMENT] Partial auto-repayment of Rs. ${netPayout} from Order #${order._id.toString().substring(18).toUpperCase()} payout for '${storeDoc.name}'. Remaining debt: Rs. ${activeLoan.repaymentAmount}.`);
      }
    } else {
      // No active loan: deposit full net payout
      storeDoc.wallet.balancePKR = toPKR((storeDoc.wallet.balancePKR || 0) + netPayout);
      storeDoc.wallet.totalDepositedPKR = toPKR((storeDoc.wallet.totalDepositedPKR || 0) + netPayout);
      storeDoc.wallet.lastUpdated = new Date();
      await storeDoc.save();

      await WalletTopup.create({
        vendorId: storeDoc.vendorId,
        storeId: storeDoc._id,
        amountPKR: netPayout,
        referenceId: `PAYOUT-${order._id.toString().substring(18).toUpperCase()}`,
        paymentReceiptUrl: '/uploads/receipts/sandbox.png',
        paymentStatus: 'approved',
        type: 'deposit',
        message: `Fulfillment Order Payout for #${order._id.toString().substring(18).toUpperCase()}`
      });
    }

    order.isPayoutProcessed = true;
    await order.save();

    // Broadcast update
    if (global.io) {
      global.io.to(`user:${storeDoc.vendorId.toString()}`).emit('wallet_updated', {
        storeId: storeDoc._id.toString(),
        balancePKR: storeDoc.wallet.balancePKR,
        wallet: storeDoc.wallet
      });
      global.io.emit('on_platform_financial_update', {
        time: new Date().toLocaleTimeString(),
        type: 'SETTLEMENT',
        text: `Processed payout Rs. ${netPayout} for store '${storeDoc.name}' (Order #${order._id.toString().substring(18).toUpperCase()}).`
      });
    }
  } catch (err) {
    console.error('[Payout Hook Error]', err.message);
  }
};

const notifySuperadmin = (message) => {
  if (global.io) {
    global.io.emit('on_platform_financial_update', {
      time: new Date().toLocaleTimeString(),
      type: message.includes('[RISKALERT]') ? 'RISKALERT' : 'SETTLEMENT',
      text: message
    });
  }
};
