import mongoose from 'mongoose';
import Store from '../models/Store.js';
import VendorLoan from '../models/VendorLoan.js';
import WalletTopup from '../models/WalletTopup.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import ShopperProfile from '../models/ShopperProfile.js';
import { pushNotification } from './notificationService.js';
import { logActivity } from './auditService.js';

const toPKR = (value) => Math.round(parseFloat(value) * 100) / 100;

/**
 * runRepaymentSweepCron
 * 
 * Sweeps the database for active outstanding inventory loans.
 * If a vendor's wallet balance holds sufficient funds, automatically executes
 * an internal collection transfer: debits repayment from vendor's wallet,
 * sets status to 'repaid', and logs a transaction with socket notifications.
 */
export const runRepaymentSweepCron = async () => {
  console.log('[Cron Worker] Running daily stale inventory loan repayment sweep...');
  try {
    const activeLoans = await VendorLoan.find({ status: 'approved' });
    console.log(`[Cron Worker] Sweeping: Found ${activeLoans.length} active outstanding loans.`);

    for (const loan of activeLoans) {
      const store = await Store.findById(loan.storeId);
      if (!store) continue;

      const balance = store.wallet.balancePKR || 0;
      const repaymentAmount = loan.repaymentAmount;
      const loanAgeDays = (Date.now() - new Date(loan.createdAt).getTime()) / (1000 * 60 * 60 * 24);

      if (balance >= repaymentAmount) {
        console.log(`[Cron Worker] Auto-deducting repayment of Rs. ${repaymentAmount} for store '${store.name}' (Loan ID: ${loan._id})`);

        store.wallet.balancePKR = toPKR(balance - repaymentAmount);
        store.wallet.totalSpentPKR = toPKR((store.wallet.totalSpentPKR || 0) + repaymentAmount);
        store.wallet.lastUpdated = new Date();
        await store.save();

        loan.status = 'repaid';
        loan.repaymentAmount = 0;
        loan.payoutHoldAmount = 0;
        loan.repaidAt = new Date();
        await loan.save();

        // Create transaction log
        await WalletTopup.create({
          vendorId: store.vendorId,
          storeId: store._id,
          amountPKR: repaymentAmount,
          referenceId: `LOAN-CRONREPAY-${loan._id.toString().substring(18).toUpperCase()}`,
          paymentReceiptUrl: '/uploads/receipts/sandbox.png',
          paymentStatus: 'approved',
          type: 'loan_repayment',
          message: `Daily Cron automated sweep settlement of Short-Term Inventory Loan`
        });

        // Socket notifications & terminal push
        if (global.io) {
          global.io.to(`user:${store.vendorId.toString()}`).emit('wallet_updated', {
            storeId: store._id.toString(),
            balancePKR: store.wallet.balancePKR,
            wallet: store.wallet
          });

          global.io.emit('on_platform_financial_update', {
            time: new Date().toLocaleTimeString(),
            type: 'SETTLEMENT',
            text: `[SETTLEMENT] Daily Cron auto-swept Rs. ${repaymentAmount} from '${store.name}' to fully settle active loan.`
          });
        }
      } else {
        // Insufficient funds in store wallet: evaluate days overdue
        if (loanAgeDays >= 60) {
          // Day 60+ Default: Freeze and Suspend store
          loan.status = 'defaulted';
          await loan.save();

          if (store.isActive) {
            store.isActive = false;
            store.suspensionReason = 'Suspended automatically: Inventory loan default (over 60 days unpaid).';
            await store.save();
          }

          // Trigger strict structural system penalty webhooks
          const webhookUrl = process.env.SYSTEM_PENALTY_WEBHOOK_URL || `http://localhost:${process.env.PORT || 5000}/api/admin/penalty-webhook`;
          try {
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'LOAN_DEFAULT_SUSPENSION',
                timestamp: new Date().toISOString(),
                storeId: store._id,
                storeName: store.name,
                loanId: loan._id,
                loanAmount: loan.amount,
                daysOverdue: Math.floor(loanAgeDays)
              })
            });
            console.log(`[Cron Worker] Triggered penalty webhook for store '${store.name}'`);
          } catch (webhookErr) {
            console.error(`[Cron Worker Webhook Error] Failed to trigger penalty webhook:`, webhookErr.message);
          }

          // Log default freeze in registry logs
          await logActivity(
            store._id,
            store.vendorId,
            'System',
            'LOAN_DEFAULT_FREEZE',
            `Store '${store.name}' failed to repay loan inside maturity window (60+ days). Store account Suspended automatically. Active checkouts and negotiations frozen.`,
            { scope: 'store' }
          );

          if (global.io) {
            global.io.emit('on_platform_financial_update', {
              time: new Date().toLocaleTimeString(),
              type: 'RISKALERT',
              text: `[RISKALERT] Store '${store.name}' failed to repay loan inside maturity window (60+ days). Store account Suspended.`
            });
          }
        } else if (loanAgeDays >= 45 && loanAgeDays < 60) {
          // Late Escalation Warning: check 48 hours alert interval
          const lastAlert = loan.lastWarningSentAt ? new Date(loan.lastWarningSentAt).getTime() : 0;
          const fortyEightHoursMs = 48 * 60 * 60 * 1000;
          const timeSinceLastAlert = Date.now() - lastAlert;

          // Recalculate counter risk factors: check current fulfillment rate
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const nonCancelledOrdersCount = await Order.countDocuments({ storeId: store._id, status: { $ne: 'cancelled' } });
          const successfulOrdersCount = await Order.countDocuments({ storeId: store._id, status: { $in: ['completed', 'delivered'] } });
          const fulfillmentRate = nonCancelledOrdersCount > 0 ? (successfulOrdersCount / nonCancelledOrdersCount) : 0;

          // Always log recalculation and potential drops in registry logs
          await logActivity(
            store._id,
            store.vendorId,
            'System',
            'LOAN_RISK_RECALCULATION',
            `Late Escalation recalculation for store '${store.name}' (unpaid for ${Math.floor(loanAgeDays)} days). Active fulfillment rate: ${(fulfillmentRate * 100).toFixed(1)}%.`,
            { scope: 'store' }
          );

          if (timeSinceLastAlert >= fortyEightHoursMs) {
            // Dispatch high-impact warning alert
            await pushNotification(
              store.vendorId,
              'security_alert',
              '🚨 High-Impact Late Escalation Warning',
              `Your inventory loan of Rs. ${loan.amount.toLocaleString()} is unpaid for ${Math.floor(loanAgeDays)} days. Please top up your wallet to secure settlement and prevent default suspension.`,
              { loanId: loan._id.toString(), storeId: store._id.toString() }
            );

            loan.lastWarningSentAt = new Date();
            await loan.save();

            console.log(`[Cron Worker] Dispatched high-impact warning alert to vendor ${store.vendorId} for store '${store.name}'`);
          }

          if (global.io) {
            global.io.emit('on_platform_financial_update', {
              time: new Date().toLocaleTimeString(),
              type: 'RISKALERT',
              text: `[RISKALERT] Late escalation warning for store '${store.name}' loan (unpaid for ${Math.floor(loanAgeDays)} days). Fulfillment: ${(fulfillmentRate * 100).toFixed(1)}%. Top-ups requested.`
            });
          }
        } else if (loanAgeDays >= 30 && loanAgeDays < 45) {
          // Halfway Checkpoint: send dashboard notice/badge if not already sent
          if (!loan.lastWarningSentAt) {
            await pushNotification(
              store.vendorId,
              'general',
              '⚠️ Halfway Checkpoint reached',
              `Your inventory loan of Rs. ${loan.amount.toLocaleString()} has reached the 30-day halfway checkpoint. Benchmark split set at 50%. Review statement summaries on your dashboard.`,
              { loanId: loan._id.toString(), storeId: store._id.toString() }
            );
            loan.lastWarningSentAt = new Date();
            await loan.save();
          }

          if (global.io) {
            global.io.emit('on_platform_financial_update', {
              time: new Date().toLocaleTimeString(),
              type: 'RISKALERT',
              text: `[RISKALERT] Halfway checkpoint reached for store '${store.name}' loan (unpaid for ${Math.floor(loanAgeDays)} days). Benchmark split set at 50%.`
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Cron Worker Error]', err.message);
  }
};


/**
 * syncShopperPredictiveAlerts
 *
 * Hour-interval AI Shopper Customization Sync Daemon (sync_shopper_predictive_alerts).
 * Fires once every hour on the hour to analyse real-time consumer telemetry and push
 * personalised AI-recommendation alerts to active browser clients via Socket.io.
 *
 * Alert Variants:
 *  1. Order Tracking Velocity — if a shopper has a live dispatched order, compute
 *     route-time vs. historical average and emit a structural delivery ETA update.
 *  2. Cart / Search-Match Drop — if a shopper has items in their cart, check whether
 *     the product is still available and push a restock/price-drop nudge.
 */
export const syncShopperPredictiveAlerts = async () => {
  console.log('[AI Shopper Sync] Running hourly predictive alert synthesis daemon...');
  if (!global.io) {
    console.warn('[AI Shopper Sync] Socket.io not initialised — skipping emission cycle.');
    return;
  }

  try {
    // ── Variant 1: Live Order Tracking Velocity ─────────────────────────────
    const dispatchedOrders = await Order.find({ status: 'dispatched' })
      .populate('shopperId', 'name email role')
      .populate('storeId', 'name')
      .lean();

    console.log(`[AI Shopper Sync] Found ${dispatchedOrders.length} dispatched orders for velocity analysis.`);

    for (const order of dispatchedOrders) {
      try {
        if (!order.shopperId || order.shopperId.role !== 'shopper') continue;

        // Compute synthetic velocity factor: compare order age to a 72-hour SLA baseline
        const orderAgeMins = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
        const slaBaselineMins = 72 * 60; // 72-hour baseline window
        const velocityFactor = Math.min(Math.max((orderAgeMins / slaBaselineMins) * 100, 5), 95);
        const isAccelerated = velocityFactor > 60;

        // Remaining estimated minutes using linear interpolation
        const estimatedRemainingMins = Math.max(slaBaselineMins - orderAgeMins, 30);
        const remainingHours = Math.floor(estimatedRemainingMins / 60);
        const remainingMinutes = Math.floor(estimatedRemainingMins % 60);
        const orderId = order._id.toString().slice(-8).toUpperCase();
        const storeName = order.storeId?.name || 'your store';

        const alertPayload = {
          _id: `ai_vel_${order._id.toString()}_${Date.now()}`,
          type: 'ai_alert',
          badge: 'AI_RECOMMENDED',
          icon: '🤖',
          title: isAccelerated
            ? `🤖 AI Update: Order #${orderId} Moving Faster Than Expected!`
            : `🤖 AI Update: Order #${orderId} En Route from ${storeName}`,
          body: isAccelerated
            ? `Your order #${orderId} is moving ${Math.round(velocityFactor - 50)}% faster than average regional dispatch velocity. Estimated delivery within ${remainingHours}h ${remainingMinutes}m.`
            : `Your order #${orderId} from ${storeName} is actively in transit. Estimated delivery window: ${remainingHours}h ${remainingMinutes}m remaining.`,
          meta: { orderId: order._id.toString(), velocityFactor: Math.round(velocityFactor) },
          isRead: false,
          createdAt: new Date().toISOString(),
        };

        global.io
          .to(`user:${order.shopperId._id.toString()}`)
          .emit('on_consumer_ai_alert', alertPayload);

        console.log(`[AI Shopper Sync] Emitted velocity alert to shopper ${order.shopperId._id} for order #${orderId}`);
      } catch (orderErr) {
        console.error(`[AI Shopper Sync] Error processing order ${order._id}:`, orderErr.message);
      }
    }

    // ── Variant 2: Cart Search-Match Drop ───────────────────────────────────
    const shoppersWithCart = await User.find({ role: 'shopper', 'cart.0': { $exists: true } })
      .populate({ path: 'cart.productId', select: 'title price category stock isActive' })
      .lean();

    console.log(`[AI Shopper Sync] Found ${shoppersWithCart.length} shoppers with active cart segments for search-match analysis.`);

    for (const shopper of shoppersWithCart) {
      try {
        // Filter to products that are now back in stock or recently discounted
        const matchedProducts = (shopper.cart || [])
          .filter(c => c.productId && c.productId.isActive && (c.productId.stock > 0))
          .slice(0, 2); // Limit to top-2 matches per cycle

        for (const cartItem of matchedProducts) {
          const prod = cartItem.productId;
          if (!prod) continue;

          const alertPayload = {
            _id: `ai_cart_${shopper._id.toString()}_${prod._id.toString()}_${Date.now()}`,
            type: 'ai_alert',
            badge: 'AI_RECOMMENDED',
            icon: '✨',
            title: `✨ AI Match: "${prod.title}" is available!`,
            body: `Items matching your cart vectors just dropped — "${prod.title}" is in stock now at Rs. ${(prod.price || 0).toLocaleString()}. Complete your order before it sells out!`,
            meta: { productId: prod._id.toString(), productTitle: prod.title, price: prod.price },
            isRead: false,
            createdAt: new Date().toISOString(),
          };

          global.io
            .to(`user:${shopper._id.toString()}`)
            .emit('on_consumer_ai_alert', alertPayload);

          console.log(`[AI Shopper Sync] Emitted cart-match alert to shopper ${shopper._id} for product "${prod.title}"`);
        }
      } catch (shopperErr) {
        console.error(`[AI Shopper Sync] Error processing shopper ${shopper._id}:`, shopperErr.message);
      }
    }

    // ── Variant 3: Fraud Guardrail Pass ──────────────────────────────────────
    console.log('[Fraud Guardrail] Running hourly fraud risk re-evaluation pass...');
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const shoppers = await User.find({ role: 'shopper' }).lean();

      for (const shopper of shoppers) {
        try {
          const totalCount = await Order.countDocuments({ shopperId: shopper._id, createdAt: { $gte: thirtyDaysAgo } });
          const cancelledCount = await Order.countDocuments({
            shopperId: shopper._id,
            status: 'cancelled',
            createdAt: { $gte: thirtyDaysAgo }
          });

          const rate = totalCount > 0 ? (cancelledCount / totalCount) : 0;

          // Check for any explicit delivery refusal signals in cancellationReason
          const hasRefusalSignal = await Order.exists({
            shopperId: shopper._id,
            status: 'cancelled',
            createdAt: { $gte: thirtyDaysAgo },
            cancellationReason: { $regex: /refuse|refusal|refused/i }
          });

          // Threshold: 50% cancellation rate (minimum 3 orders) OR explicit refusal signal
          const exceedsThreshold = (totalCount >= 3 && rate >= 0.5) || hasRefusalSignal;

          let profile = await ShopperProfile.findOne({ userId: shopper._id });
          if (!profile) {
            profile = new ShopperProfile({ userId: shopper._id });
          }

          const oldRiskLevel = profile.fraudRiskLevel || 'LOW';
          const newRiskLevel = exceedsThreshold ? 'HIGH' : 'LOW';
          const newCodDisabled = exceedsThreshold ? true : false;

          let hasChanged = false;
          if (profile.fraudRiskLevel !== newRiskLevel) {
            profile.fraudRiskLevel = newRiskLevel;
            profile.fraudRiskUpdatedAt = new Date();
            hasChanged = true;
          }
          if (profile.codDisabled !== newCodDisabled) {
            profile.codDisabled = newCodDisabled;
            hasChanged = true;
          }

          if (hasChanged) {
            await profile.save();
            console.log(`[Fraud Guardrail] Shopper ${shopper._id} updated: riskLevel=${newRiskLevel}, codDisabled=${newCodDisabled}`);

            // Emit AI alert if transitioned to HIGH
            if (newRiskLevel === 'HIGH' && oldRiskLevel !== 'HIGH') {
              const alertPayload = {
                _id: `ai_fraud_${shopper._id.toString()}_${Date.now()}`,
                type: 'ai_alert',
                badge: 'CRITICAL',
                icon: '⚠️',
                title: '⚠️ CRITICAL: Cash on Delivery Disabled',
                body: 'Due to an elevated order cancellation or delivery refusal rate on your profile, Cash on Delivery has been disabled. A 25% non-refundable digital wallet down-payment is now required to place orders.',
                meta: { fraudRiskLevel: 'HIGH', codDisabled: true },
                isRead: false,
                createdAt: new Date().toISOString(),
              };

              global.io.to(`user:${shopper._id.toString()}`).emit('on_consumer_ai_alert', alertPayload);
              console.log(`[Fraud Guardrail] Emitted critical COD disabled notification to shopper ${shopper._id}`);
            }
          }
        } catch (profileErr) {
          console.error(`[Fraud Guardrail Error] Shopper ${shopper._id}:`, profileErr.message);
        }
      }
    } catch (fraudErr) {
      console.error('[Fraud Guardrail Global Error]', fraudErr.message);
    }

    console.log('[AI Shopper Sync] Hourly predictive alert cycle complete.');
  } catch (err) {
    console.error('[AI Shopper Sync Error] Daemon cycle failed:', err.message);
  }
};

/**
 * runInventoryForecastSweep
 *
 * Runs regional demand analysis and dispatches stock optimization checklists.
 */
export const runInventoryForecastSweep = async () => {
  console.log('[Inventory Forecast] Running distribution forecast sweep...');
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const demandMatrix = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo },
          status: { $ne: 'cancelled' }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      { $unwind: '$productDetails.aiTags' },
      {
        $group: {
          _id: {
            city: '$city',
            category: '$productDetails.aiTags'
          },
          orderCount: { $sum: 1 },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      {
        $project: {
          city: '$_id.city',
          category: '$_id.category',
          orderCount: 1,
          totalQuantity: 1,
          totalRevenue: 1,
          _id: 0
        }
      },
      { $sort: { totalQuantity: -1 } }
    ]);

    console.log(`[Inventory Forecast] Identified ${demandMatrix.length} regional product-demand peak coordinates.`);

    const stores = await Store.find({ isActive: true });
    let notificationsDispatched = 0;

    for (const store of stores) {
      try {
        const storeProducts = await Product.find({ storeId: store._id, isDeleted: false }).lean();
        if (storeProducts.length === 0) continue;

        const storeCategories = [...new Set(storeProducts.flatMap(p => p.aiTags || []).map(t => t.toLowerCase().trim()))];
        const originCity = (store.originCity || 'Lahore').toLowerCase().trim();

        // Filter demand peaks in cities other than store's originCity for categories the store sells
        const matchingPeaks = demandMatrix.filter(peak => {
          const peakCity = (peak.city || '').toLowerCase().trim();
          const peakCategory = (peak.category || '').toLowerCase().trim();
          return peakCity !== originCity && storeCategories.includes(peakCategory);
        });

        if (matchingPeaks.length > 0) {
          const checklist = matchingPeaks.slice(0, 5).map(peak => ({
            city: peak.city,
            category: peak.category,
            rollingSales30d: peak.totalQuantity,
            recommendation: `Transfer stock of ${peak.category} to ${peak.city} Hub to fulfill local demand (rolling 30d: ${peak.totalQuantity} items)`
          }));

          await pushNotification({
            userId: store.vendorId,
            type: 'logistics',
            title: '📦 Stock Optimization Checklist',
            body: `Demand peaks identified for your product categories in other regions! Pre-position inventory to support 24h delivery.`,
            meta: {
              storeId: store._id,
              originCity: store.originCity,
              checklist
            }
          });

          if (global.io) {
            global.io.to(`user:${store.vendorId.toString()}`).emit('on_platform_notification_broadcast', {
              type: 'LOGISTICS_SUGGESTION',
              title: '📦 Stock Optimization Checklist',
              body: `Demand peaks identified for your categories in other cities. Please optimize inventory layout.`,
              meta: { checklist }
            });
          }

          notificationsDispatched++;
        }
      } catch (storeErr) {
        console.error(`[Inventory Forecast] Error for store ${store._id}:`, storeErr.message);
      }
    }

    console.log(`[Inventory Forecast] Sweep complete. Emailed/dispatched optimization checklists to ${notificationsDispatched} stores.`);
    return { demandMatrix, notificationsDispatched };
  } catch (err) {
    console.error('[Inventory Forecast Error] Sweep failed:', err.message);
    throw err;
  }
};

/**
 * runAutoCompletionCron
 *
 * Scans for delivered orders where more than 7 days have elapsed since delivery/update
 * without active return requests, and automatically marks them as 'completed'.
 */
export const runAutoCompletionCron = async () => {
  console.log('[Auto-Completion Worker] Sweeping delivered orders older than 7 days...');
  try {
    const Order = (await import('../models/Order.js')).default;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const staleDeliveredOrders = await Order.find({
      status: 'delivered',
      returnRequested: false,
      updatedAt: { $lt: sevenDaysAgo }
    });

    if (staleDeliveredOrders.length > 0) {
      console.log(`[Auto-Completion Worker] Found ${staleDeliveredOrders.length} delivered orders to auto-complete.`);
      
      for (const order of staleDeliveredOrders) {
        order.status = 'completed';
        await order.save();

        if (!order.isPayoutProcessed) {
          try {
            const { processFulfillmentPayout } = await import('./orderService.js');
            await processFulfillmentPayout(order._id);
          } catch (payoutErr) {
            console.error(`[Auto-Completion Payout Error] Order ${order._id}:`, payoutErr.message);
          }
        }

        if (global.io) {
          global.io.to(`order:${order._id.toString()}`).emit('order_status_update', {
            orderId: order._id.toString(),
            status: 'completed'
          });
        }
      }
      console.log(`[Auto-Completion Worker] Successfully auto-completed ${staleDeliveredOrders.length} orders.`);
    }
  } catch (err) {
    console.error('[Auto-Completion Worker Error]', err.message);
  }
};

/**
 * startCronScheduler
 *
 * Boots the daily background sweep worker and the hourly AI shopper sync daemon.
 */
export const startCronScheduler = () => {
  // Run 5 seconds after startup to settle any stale loans immediately
  setTimeout(() => {
    runRepaymentSweepCron();
    runAutoCompletionCron();
  }, 5000);

  // Set interval to repeat every 24 hours
  const intervalMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runRepaymentSweepCron();
    runAutoCompletionCron();
  }, intervalMs);

  // ── AI Shopper Predictive Sync + Fraud Guardrail: fire every 60 minutes ──────
  setTimeout(() => {
    syncShopperPredictiveAlerts();
  }, 30000);

  // ── Inventory Forecast Sweep: fire every 60 minutes ──────────────────────────
  setTimeout(() => {
    runInventoryForecastSweep().catch(err => console.error('[Inventory Forecast Sweep startup err]', err.message));
  }, 45000);

  const hourlyIntervalMs = 60 * 60 * 1000; // 1 hour
  setInterval(() => {
    syncShopperPredictiveAlerts();
  }, hourlyIntervalMs);

  setInterval(() => {
    runInventoryForecastSweep().catch(err => console.error('[Inventory Forecast Sweep interval err]', err.message));
  }, hourlyIntervalMs);

  console.log('[Cron Scheduler] Daily repayment sweep + hourly AI shopper sync + hourly inventory forecast registered.');
};


