import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Store from '../models/Store.js';
import Message from '../models/Message.js';
import ChatSession from '../models/ChatSession.js';
import { sendPlatformEmail } from '../config/mailer.js';
import {
  buildOrderStatusEmail,
  buildNewOrderAlertEmail,
  buildStoreStatusEmail,
  buildAdStatusEmail,
  buildSystemAuditEmail,
  buildMarketingDiscountEmail,
  buildChatOfflineEmail
} from '../utils/emailTemplates.js';

/**
 * Creates a push notification record and delivers it in real-time
 * via Socket.IO to the recipient's personal room `user:{recipientId}`.
 * If the user is offline, the DB record persists for flush on reconnect.
 *
 * @param {string} recipientId - MongoDB User ID of the notification recipient
 * @param {string} type        - Notification type enum value
 * @param {string} title       - Short headline
 * @param {string} body        - Full message body
 * @param {object} [meta]      - Optional extra payload (e.g. { orderId, storeName })
 */
export const pushNotification = async (recipientId, type, title, body, meta = {}) => {
  try {
    const notification = await Notification.create({
      recipientId,
      type,
      title,
      body,
      meta,
      isRead: false,
    });

    // Attempt real-time delivery to the user's personal socket room
    if (global.io) {
      global.io.to(`user:${recipientId.toString()}`).emit('push_notification', {
        _id:       notification._id,
        type:      notification.type,
        title:     notification.title,
        body:      notification.body,
        meta:      notification.meta,
        isRead:    notification.isRead,
        createdAt: notification.createdAt,
      });
      console.log(`[Push Notification] Delivered real-time alert via Socket.io to room "user:${recipientId}"`);
    }

    return notification;
  } catch (error) {
    console.error('[Notification Service Error] Push notification failed:', error.message);
  }
};

/**
 * Main Asynchronous Event Router & Dispatcher for notifications.
 * Unifies NodeMailer transactional email dispatch and real-time push alerts.
 * 
 * @param {string} eventName - Notification event key
 * @param {object} payload - Action context containing mongoose objects and variables
 */
export const dispatchNotification = async (eventName, payload) => {
  // Fire and forget asynchronously to decouple execution from database transactions
  setImmediate(async () => {
    try {
      console.log(`[Notification Engine] Intercepted event: "${eventName}"`);
      
      switch (eventName) {
        case 'ORDER_CREATED': {
          const { order, shopper } = payload;
          if (!order || !shopper) return;

          // 1. Send shopper confirmation push + email/whatsapp trigger
          const shopperTitle = '🛒 Order Placed!';
          const shopperBody = `Your order #${order._id.toString().slice(-8).toUpperCase()} has been submitted. Check details in your email.`;
          pushNotification(shopper._id, 'general', shopperTitle, shopperBody, { orderId: order._id.toString() });
          
          const shopperEmailTemplate = buildOrderStatusEmail(order, 'submitted / pending payment');
          sendPlatformEmail(
            shopper.email, 
            `Order Placed - #${order._id.toString().slice(-8).toUpperCase()}`, 
            'ORDER_CREATED', 
            {
              orderId: order._id.toString(),
              customerName: shopper.name,
              customerPhone: shopper.phone || order.shippingAddress?.phone || '+923001234567',
              totalAmount: order.totalAmount,
              items: order.items,
              status: order.status,
              htmlTemplate: shopperEmailTemplate
            }
          );

          // 2. Fetch Store & Vendor & StoreAdmins
          const store = await Store.findById(order.storeId).populate('vendorId', 'name email');
          if (store && store.vendorId) {
            // Find all storeAdmins for this store
            const storeAdmins = await User.find({ 
              $or: [
                { storeId: store._id },
                { activeStoreId: store._id.toString() }
              ],
              role: { $in: ['vendor', 'storeAdmin'] } 
            }).select('email _id');

            const operatorEmails = Array.from(new Set([
              store.vendorId.email, 
              ...storeAdmins.map(sa => sa.email)
            ])).filter(Boolean);

            // Send order alert to all store operators (Vendor + StoreAdmins)
            if (operatorEmails.length > 0) {
              const vendorEmailTemplate = buildNewOrderAlertEmail(order, store);
              sendPlatformEmail(
                operatorEmails, 
                `New Order Incoming - Store: ${store.name} (#${order._id.toString().slice(-8).toUpperCase()})`, 
                'VENDOR_ORDER_ALERT',
                {
                  orderId: order._id.toString(),
                  storeName: store.name,
                  totalAmount: order.totalAmount,
                  htmlTemplate: vendorEmailTemplate
                }
              );
            }

            // Send real-time push notification to all store operators
            const vendorTitle = '🛍️ New Order Received';
            const vendorBody = `Store "${store.name}" received order #${order._id.toString().slice(-8).toUpperCase()} for Rs. ${order.totalAmount.toLocaleString()}`;
            
            for (const operator of storeAdmins) {
              pushNotification(operator._id, 'general', vendorTitle, vendorBody, { orderId: order._id.toString() });
            }
          }
          break;
        }

        case 'ORDER_STATUS_CHANGED':
        case 'order.statusChange': {
          const { order, statusText, status } = payload;
          const currentStatus = statusText || status;
          if (!order) return;

          // Skip generic status change notification if order is in retake workflow
          if (['return_requested', 'return_approved', 'returned'].includes(currentStatus)) {
            return;
          }

          // Fetch shopper user details
          const shopper = await User.findById(order.shopperId).select('name email');
          if (shopper) {
            const store = await Store.findById(order.storeId).select('name');
            const storeName = store?.name || 'your store';
            const notifMessages = {
              processing:  { title: '📦 Order Being Packed',    body: `Your order from ${storeName} is now being packed and prepared for dispatch!` },
              dispatched:  { title: '🛵 Order Dispatched',      body: `Your order from ${storeName} has been handed to the delivery rider. It's on the way!` },
              delivered:   { title: '✅ Order Delivered',        body: `Your order from ${storeName} has been delivered. We hope you enjoy it!` },
              completed:   { title: '🎉 Order Complete',         body: `Your order from ${storeName} is complete. Thank you for shopping with us!` },
              cancelled:   { title: '❌ Order Cancelled',        body: `Your order from ${storeName} has been cancelled. Contact support if this was unexpected.` },
            };
            const notif = notifMessages[currentStatus];
            if (notif) {
              await pushNotification(shopper._id, 'order_update', notif.title, notif.body, { orderId: order._id.toString(), storeName });

              // Send email
              const emailTemplate = buildOrderStatusEmail(order, currentStatus);
              sendPlatformEmail(shopper.email, `Order Status Update: ${currentStatus.toUpperCase()} - #${order._id.toString().slice(-8).toUpperCase()}`, emailTemplate);
            }
          }

          // Trigger chat cleanup if order is completed or cancelled
          if (currentStatus && (currentStatus.toLowerCase() === 'completed' || currentStatus.toLowerCase() === 'cancelled')) {
            try {
              const storeDoc = await Store.findById(order.storeId).populate('vendorId', 'email');
              const vendorEmail = storeDoc?.vendorId?.email;
              const customerEmail = shopper?.email || (await User.findById(order.shopperId).select('email'))?.email;

              if (customerEmail && vendorEmail) {
                // Asynchronously delete chat room and messages
                deletePostFulfillmentChat(customerEmail, vendorEmail, order._id.toString());
              }
            } catch (cleanupErr) {
              console.error('[COMPLIANCE ERROR] Failed to trigger post-fulfillment cleanup:', cleanupErr.message);
            }
          }
          break;
        }

        case 'STORE_STATUS_CHANGED': {
          const { store, isActive, reason } = payload;
          if (!store) return;

          const vendor = await User.findById(store.vendorId).select('name email');
          if (vendor) {
            // Send push
            const notifTitle = isActive ? '✅ Store Activated' : '🚨 Store Suspended';
            const notifBody = isActive 
              ? `Your store "${store.name}" has been activated on the marketplace.` 
              : `Your store "${store.name}" has been suspended. Reason: ${reason}`;
            await pushNotification(vendor._id, 'general', notifTitle, notifBody, { storeId: store._id.toString() });

            // Send email
            const emailTemplate = buildStoreStatusEmail(store, isActive, reason);
            await sendPlatformEmail(vendor.email, notifTitle, emailTemplate);
          }
          break;
        }

        case 'AD_STATUS_CHANGED': {
          const { bid, isApproved, reason } = payload;
          if (!bid) return;

          const vendor = await User.findById(bid.vendorId).select('name email');
          if (vendor) {
            // Send push
            const notifTitle = isApproved ? '⭐ Sponsored Ad Activated' : '❌ Ad Bid Rejected';
            const notifBody = isApproved 
              ? `Your promo ad slot bid has been approved and activated.` 
              : `Your promo ad slot bid has been rejected. Reason: ${reason}`;
            await pushNotification(vendor._id, 'ad_approved', notifTitle, notifBody, { bidId: bid._id.toString() });

            // Send email
            const emailTemplate = buildAdStatusEmail(bid, isApproved, { reason });
            await sendPlatformEmail(vendor.email, notifTitle, emailTemplate);
          }
          break;
        }

        case 'SYSTEM_AUDIT': {
          const { type, description, meta } = payload;
          
          // Get all platform admin emails
          const admins = await User.find({ role: 'admin' }).select('email');
          const adminEmails = admins.map(a => a.email).filter(Boolean);

          if (adminEmails.length > 0) {
            const emailTemplate = buildSystemAuditEmail(type, description, meta);
            await sendPlatformEmail(adminEmails, `BazaarBoost System Audit: ${type}`, emailTemplate);
          }
          break;
        }

        case 'MARKETING_EVENT': {
          const { campaign } = payload;
          if (!campaign) return;

          // Get all shoppers to broadcast voucher
          const shoppers = await User.find({ role: 'shopper' }).select('email');
          const shopperEmails = shoppers.map(s => s.email).filter(Boolean);

          if (shopperEmails.length > 0) {
            const emailTemplate = buildMarketingDiscountEmail(campaign);
            await sendPlatformEmail(shopperEmails, `Discount Alert: New Code ${campaign.code} Unlocked!`, emailTemplate);
          }

          // Broadcast push notification payload concurrently to all shoppers
          if (global.io) {
            const alertText = `Discount Alert: New Code ${campaign.code} unlocked! Save big on BazaarBoost.`;
            global.io.emit('push_notification', {
              type: 'marketing',
              title: '⚡ Promo Voucher Unlocked',
              body: alertText,
              meta: { couponCode: campaign.code },
              createdAt: new Date(),
            });
            console.log(`[Notification Engine] Broadcasted marketing push to all active WebSockets.`);
          }
          break;
        }

        case 'CHAT_MESSAGE_OFFLINE': {
          const { senderName, recipientEmail, messageText, storeName } = payload;
          if (!recipientEmail || !messageText) return;
          const emailTemplate = buildChatOfflineEmail(senderName, messageText, storeName);
          await sendPlatformEmail(recipientEmail, `New Message from ${senderName} (BazaarBoost)`, emailTemplate);
          break;
        }

        default:
          console.warn(`[Notification Engine Warning] Unknown notification event key: "${eventName}"`);
      }
    } catch (err) {
      console.error('[Notification Engine Dispatch Error]', err.message);
    }
  });
};

/**
 * Automated Post-Fulfillment Chat Deletion Pipeline
 * Deletes all nested records in the Message collection and ChatSession document
 * once an order reaches the Completed lifecycle stage.
 * 
 * @param {string} customerEmail - Customer email address
 * @param {string} vendorEmail - Vendor email address
 * @param {string} orderId - Target order ID for logs
 */
export const deletePostFulfillmentChat = async (customerEmail, vendorEmail, orderId) => {
  try {
    // 1. Find Customer (Shopper) and Vendor users by email
    const customer = await User.findOne({ email: customerEmail });
    const vendor = await User.findOne({ email: vendorEmail });

    if (!customer || !vendor) {
      console.log(`[COMPLIANCE LOG] Post-fulfillment cleanup skipped. Customer or vendor not found in DB.`);
      return;
    }

    // 2. Resolve Vendor's Store context
    const store = await Store.findOne({ vendorId: vendor._id });
    if (!store) {
      console.log(`[COMPLIANCE LOG] Post-fulfillment cleanup skipped. Store not found for vendor.`);
      return;
    }

    // 3. Find if there is an active ChatSession matching the shopper and store context
    const chatSession = await ChatSession.findOne({ storeId: store._id, shopperId: customer._id });
    if (!chatSession) {
      console.log(`[COMPLIANCE LOG] Post-fulfillment cleanup gracefully exited. No active Chat Room for Order #${orderId}.`);
      return;
    }

    // 4. Perform cascading deletes inside an atomic transaction fallback
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.client) {
        const dbSession = await mongoose.startSession();
        await dbSession.withTransaction(async () => {
          // Delete messages belonging to that room context
          await Message.deleteMany({ storeId: store._id, shopperId: customer._id }).session(dbSession);
          // Delete the ChatSession (ChatRoom)
          await ChatSession.deleteOne({ _id: chatSession._id }).session(dbSession);
        });
        dbSession.endSession();
      } else {
        // Fallback directly
        await Message.deleteMany({ storeId: store._id, shopperId: customer._id });
        await ChatSession.deleteOne({ _id: chatSession._id });
      }
    } catch (txErr) {
      // Standalone MongoDB / non-replica set fallback
      await Message.deleteMany({ storeId: store._id, shopperId: customer._id });
      await ChatSession.deleteOne({ _id: chatSession._id });
    }

    console.log(`[COMPLIANCE LOG] Post-fulfillment cleanup successful. Purged Chat Room for Order #${orderId}.`);
  } catch (error) {
    // Fail silently on database error per compliance rules
    console.error(`[COMPLIANCE ERROR] Silent database error in chat cleanup:`, error.message);
  }
};
