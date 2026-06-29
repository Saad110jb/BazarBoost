/**
 * Base wrapper for email layout, ensuring consistent dark-theme branding
 */
const wrapBaseLayout = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f8f8ff; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0a0a0f; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table width="100%" maxWidth="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #12121a; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header Banner -->
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #7c3aed, #a855f7); padding: 30px 20px;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">Bazaar<span style="color: #e9ecef;">Boost</span></h1>
              <p style="margin: 5px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.85); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">${title}</p>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 30px 25px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 25px; border-top: 1px solid rgba(255,255,255,0.07); background-color: #0f0f15;">
              <p style="margin: 0; font-size: 12px; color: #6b6b85;">This is an automated security / transaction alert from BazaarBoost.</p>
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #6b6b85;">&copy; 2026 BazaarBoost Multi-Tenant SaaS. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

/**
 * Order Status Update Template (Shopper Notification)
 */
export const buildOrderStatusEmail = (order, statusText, details = {}) => {
  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #f8f8ff;">${item.title}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #a9a9c0; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #f8f8ff; text-align: right;">Rs. ${Number(item.price * item.quantity).toLocaleString()}</td>
    </tr>
  `).join('');

  let deliveryDetails = '';
  if (order.deliveryType === 'in-city') {
    deliveryDetails = `
      <div style="background-color: rgba(124, 58, 237, 0.05); border: 1px solid rgba(124, 58, 237, 0.15); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
        <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #a855f7; text-transform: uppercase;">Delivery Rider Details</h4>
        <p style="margin: 0; font-size: 14px; color: #f8f8ff;"><strong>Rider Name:</strong> ${order.driverName || 'Assigned'}</p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #f8f8ff;"><strong>Contact:</strong> ${order.driverContact || 'N/A'}</p>
      </div>
    `;
  } else if (order.deliveryType === 'out-of-city') {
    deliveryDetails = `
      <div style="background-color: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
        <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #10b981; text-transform: uppercase;">Courier Tracking Details</h4>
        <p style="margin: 0; font-size: 14px; color: #f8f8ff;"><strong>Courier:</strong> ${order.courierName || 'Pending'}</p>
        <p style="margin: 5px 0 0 0; font-size: 14px; color: #f8f8ff;"><strong>Tracking ID:</strong> <span style="font-family: monospace; color: #10b981; font-weight: bold;">${order.trackingId || 'Pending'}</span></p>
      </div>
    `;
  }

  const content = `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">Order #${order._id.toString().slice(-8).toUpperCase()} is ${statusText}!</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      Hi there! The status of your order has been updated to <strong>${statusText}</strong>. Below are your shipping details and itemized receipt:
    </p>

    ${deliveryDetails}

    <div style="margin-bottom: 25px;">
      <h3 style="font-size: 14px; color: #f8f8ff; border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 8px; margin-bottom: 12px; text-transform: uppercase;">Shipping Destination</h3>
      <p style="margin: 0; font-size: 14px; color: #a9a9c0;">${order.shippingAddress}, ${order.city}</p>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
      <thead>
        <tr style="border-bottom: 2px solid rgba(255,255,255,0.07);">
          <th align="left" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase;">Item</th>
          <th align="center" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase; width: 60px;">Qty</th>
          <th align="right" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase; width: 100px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: rgba(255,255,255,0.02); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <tr>
        <td style="font-size: 14px; color: #a9a9c0; padding: 5px 0;">Subtotal</td>
        <td align="right" style="font-size: 14px; color: #f8f8ff; padding: 5px 0;">Rs. ${Number(order.totalAmount + (order.marketingDiscount || 0) - (order.shippingPremium || 0)).toLocaleString()}</td>
      </tr>
      ${order.marketingDiscount ? `
      <tr>
        <td style="font-size: 14px; color: #ef4444; padding: 5px 0;">Discount</td>
        <td align="right" style="font-size: 14px; color: #ef4444; padding: 5px 0;">- Rs. ${Number(order.marketingDiscount).toLocaleString()}</td>
      </tr>
      ` : ''}
      <tr>
        <td style="font-size: 14px; color: #a9a9c0; padding: 5px 0;">Shipping Fee</td>
        <td align="right" style="font-size: 14px; color: #f8f8ff; padding: 5px 0;">Rs. ${Number(order.shippingPremium || 0).toLocaleString()}</td>
      </tr>
      <tr style="border-top: 1px solid rgba(255,255,255,0.05);">
        <td style="font-size: 16px; font-weight: 800; color: #a855f7; padding: 10px 0 0 0;">Total Amount Paid</td>
        <td align="right" style="font-size: 16px; font-weight: 800; color: #a855f7; padding: 10px 0 0 0;">Rs. ${Number(order.totalAmount).toLocaleString()}</td>
      </tr>
    </table>
  `;

  return wrapBaseLayout(`Order Update: ${statusText}`, content);
};

/**
 * New Order Placement Notification (Vendor / StoreAdmin Alert)
 */
export const buildNewOrderAlertEmail = (order, store) => {
  const itemsRows = (order.items || []).map(item => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #f8f8ff;">${item.title}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #a9a9c0; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #f8f8ff; text-align: right;">Rs. ${Number(item.price * item.quantity).toLocaleString()}</td>
    </tr>
  `).join('');

  const content = `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">New Order Placed for "${store.name}"!</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      You have received a new purchase order on your storefront! Log into your Vendor Control Dashboard to process the fulfillment.
    </p>

    <div style="background-color: rgba(255, 255, 255, 0.02); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <p style="margin: 0; font-size: 14px; color: #f8f8ff;"><strong>Order Ref ID:</strong> #${order._id.toString().slice(-8).toUpperCase()}</p>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #f8f8ff;"><strong>Destination:</strong> ${order.shippingAddress}, ${order.city}</p>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #f8f8ff;"><strong>Payment Type:</strong> ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Manual Bank Transfer'}</p>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
      <thead>
        <tr>
          <th align="left" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase;">Product</th>
          <th align="center" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase; width: 60px;">Qty</th>
          <th align="right" style="padding-bottom: 8px; font-size: 12px; color: #6b6b85; text-transform: uppercase; width: 100px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
      <tr>
        <td style="font-size: 14px; color: #a9a9c0; font-weight: bold;">Grand Total</td>
        <td align="right" style="font-size: 16px; font-weight: 900; color: #10b981;">Rs. ${Number(order.totalAmount).toLocaleString()}</td>
      </tr>
    </table>

    <div align="center">
      <a href="http://localhost:3000/vendor/orders" style="background: linear-gradient(135deg, #7c3aed, #a855f7); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; display: inline-block; box-shadow: 0 4px 12px rgba(124,58,237,0.25);">Manage Order Dispatch</a>
    </div>
  `;

  return wrapBaseLayout("New Incoming Order Alert", content);
};

/**
 * Store Status Suspension / Activation Alert (Vendor Notification)
 */
export const buildStoreStatusEmail = (store, isActive, reason = '') => {
  const content = isActive ? `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">Store "${store.name}" Activated!</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 25px;">
      Excellent news! Your merchant storefront <strong>"${store.name}"</strong> has been approved and activated by the platform administrators. You are now live on the marketplace directory, and shoppers can browse, buy, and negotiate deals on your items.
    </p>
    <div align="center">
      <a href="http://localhost:3000/vendor/dashboard" style="background: #10b981; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; display: inline-block;">Go to Vendor Console</a>
    </div>
  ` : `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">🚨 Store "${store.name}" Suspended</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      Please be advised that your vendor store <strong>"${store.name}"</strong> has been suspended from the BazaarBoost platform. Your product catalogs are hidden, and order checkouts are disabled.
    </p>
    <div style="background-color: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #ef4444; text-transform: uppercase;">Reason for Suspension</h4>
      <p style="margin: 0; font-size: 14px; color: #f8f8ff;">${reason || 'Violation of platform guidelines or payment terms.'}</p>
    </div>
    <p style="font-size: 12px; color: #6b6b85;">
      To appeal this decision, please contact the SuperAdmin team at bazarboost884@gmail.com with your Store ID: ${store._id}.
    </p>
  `;

  return wrapBaseLayout(isActive ? "Merchant Store Live Notice" : "Merchant Store Suspension Notice", content);
};

/**
 * Ad Bid Status Approval / Rejection Alert
 */
export const buildAdStatusEmail = (bid, isApproved, details = {}) => {
  const content = isApproved ? `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">Ad Bid Approved!</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 25px;">
      Your promotional bid has been approved! Your store will now receive priority sponsored slots visibility on the marketplace homepage directory.
    </p>
    <div style="background-color: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <p style="margin: 0; font-size: 14px; color: #f8f8ff;"><strong>Bid Amount:</strong> Rs. ${Number(bid.amountPKR).toLocaleString()}</p>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #f8f8ff;"><strong>Status:</strong> Active & Sponsored</p>
    </div>
  ` : `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">Ad Bid Rejected</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      Your promotional ad slot bid was rejected. If a payment slip was uploaded, the funds have been credited back to your merchant wallet.
    </p>
    <div style="background-color: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <h4 style="margin: 0 0 8px 0; font-size: 14px; color: #ef4444; text-transform: uppercase;">Feedback</h4>
      <p style="margin: 0; font-size: 14px; color: #f8f8ff;">The uploaded bank transfer reference number or receipt did not match the bank records.</p>
    </div>
  `;

  return wrapBaseLayout(isApproved ? "Ad Bid Activated Notice" : "Ad Bid Rejected Notice", content);
};

/**
 * System Audit Alert (SuperAdmin Security / Audit Logging)
 */
export const buildSystemAuditEmail = (type, description, meta = {}) => {
  const metaRows = Object.keys(meta).map(key => `
    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
      <td style="padding: 8px 0; font-size: 13px; color: #6b6b85; text-transform: uppercase; font-weight: 700; width: 140px;">${key}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #f8f8ff; font-family: monospace; word-break: break-all;">${meta[key]}</td>
    </tr>
  `).join('');

  const content = `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff; display: flex; align-items: center; gap: 8px;">
      <span style="color: #f59e0b;">⚠️</span> System Audit Log: ${type}
    </h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      A system state transition or security-sensitive action occurred on the platform. Review the audit parameters below:
    </p>

    <div style="background-color: rgba(245, 158, 11, 0.04); border: 1px solid rgba(245, 158, 11, 0.15); border-radius: 8px; padding: 15px; margin-bottom: 25px;">
      <p style="margin: 0; font-size: 14px; color: #f8f8ff;"><strong>Details:</strong> ${description}</p>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 10px;">
      <tbody>
        ${metaRows}
      </tbody>
    </table>
  `;

  return wrapBaseLayout(`Platform Audit Alert`, content);
};

/**
 * Marketing Discount Code Email Template (Broadcast campaigns)
 */
export const buildMarketingDiscountEmail = (campaign) => {
  const content = `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff; text-align: center;">⚡ Discount Alert: New Coupon Unlocked!</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; text-align: center; margin-bottom: 25px;">
      Great news! A new promotional coupon code is now active on the marketplace. Copy the code below and paste it at checkout to claim your discounts:
    </p>

    <div style="background-color: rgba(124, 58, 237, 0.06); border: 2px dashed #7c3aed; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 25px;">
      <span style="font-family: monospace; font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: 0.1em;">${campaign.code}</span>
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #a855f7; font-weight: 700;">
        Save ${campaign.discountType === 'percentage' ? `${campaign.discountValue}%` : `Rs. ${campaign.discountValue}`} on order totals!
      </p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #6b6b85;">Minimum Spend: Rs. ${campaign.minSpend.toLocaleString()}</p>
    </div>

    <div align="center">
      <a href="http://localhost:3000" style="background: linear-gradient(135deg, #7c3aed, #a855f7); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; display: inline-block;">Go to Marketplace</a>
    </div>
  `;

  return wrapBaseLayout("Voucher Code Alert", content);
};

/**
 * Chat Offline Message Email Template
 */
export const buildChatOfflineEmail = (senderName, messageText, storeName) => {
  const content = `
    <h2 style="margin: 0 0 10px 0; font-size: 18px; color: #f8f8ff;">New Message from ${senderName}</h2>
    <p style="font-size: 14px; color: #a9a9c0; line-height: 1.6; margin-bottom: 20px;">
      Hi there! You received a new message in your chat room for <strong>${storeName || 'BazaarBoost'}</strong> while you were offline:
    </p>

    <div style="background-color: rgba(255, 255, 255, 0.02); border-left: 4px solid #7c3aed; border-radius: 4px; padding: 15px; margin-bottom: 25px;">
      <p style="margin: 0; font-size: 14px; color: #f8f8ff; font-style: italic;">"${messageText}"</p>
    </div>

    <div align="center">
      <a href="http://localhost:3000" style="background: linear-gradient(135deg, #7c3aed, #a855f7); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; display: inline-block; box-shadow: 0 4px 12px rgba(124,58,237,0.25);">View and Reply</a>
    </div>
  `;

  return wrapBaseLayout(`New Offline Message`, content);
};
