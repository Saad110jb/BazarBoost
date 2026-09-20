import express from 'express';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Store from '../models/Store.js';
import WalletTopup from '../models/WalletTopup.js';
import { processJazzCashPayment, processEasyPaisaPayment, generateJazzCashHash } from '../services/paymentService.js';
import { dispatchNotification } from '../services/notificationService.js';

const router = express.Router();

const toPKR = (value) => Math.round(parseFloat(value) * 100) / 100;

// @desc    Initiate a mobile wallet payment (JazzCash or EasyPaisa)
// @route   POST /api/payments/initiate
// @access  Private (Shopper or Vendor)
router.post('/initiate', protect, async (req, res) => {
  const { amountPKR, gateway, mobileNumber, cnicLast6, orderId, purpose } = req.body;

  if (!amountPKR || !gateway || !mobileNumber) {
    return res.status(400).json({ success: false, message: 'amountPKR, gateway (jazzcash|easypaisa), and mobileNumber are required' });
  }

  const cleanAmount = toPKR(amountPKR);
  if (cleanAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payment amount' });
  }

  const referenceId = `TXN-${Date.now()}`;

  try {
    let result = null;

    if (gateway.toLowerCase() === 'jazzcash') {
      result = await processJazzCashPayment({
        amountPKR: cleanAmount,
        mobileNumber,
        cnicLast6,
        referenceId
      });
    } else if (gateway.toLowerCase() === 'easypaisa') {
      result = await processEasyPaisaPayment({
        amountPKR: cleanAmount,
        mobileNumber,
        referenceId
      });
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported gateway. Choose "jazzcash" or "easypaisa"' });
    }

    // Check response code (000 for JazzCash / 0000 for EasyPaisa / Sandbox Mock)
    const isSuccess = result?.pp_ResponseCode === '000' || result?.responseCode === '0000' || result?.success === true;

    if (isSuccess) {
      // 1. If paying for an Order
      if (purpose === 'order' && orderId) {
        const order = await Order.findById(orderId);
        if (order) {
          order.status = 'processing';
          order.referenceId = referenceId;
          order.paymentMethod = gateway.toLowerCase();
          await order.save();

          dispatchNotification('ORDER_STATUS_CHANGED', { order, statusText: 'processing' });
        }
      } 
      // 2. If topping up Vendor Store Wallet
      else if (purpose === 'wallet_topup') {
        const storeId = req.user.role === 'storeAdmin' ? req.user.activeStoreId : req.user.storeId;
        const store = await Store.findById(storeId);
        if (store) {
          store.wallet = store.wallet || {};
          store.wallet.balancePKR = toPKR((store.wallet.balancePKR || 0) + cleanAmount);
          store.wallet.totalDepositedPKR = toPKR((store.wallet.totalDepositedPKR || 0) + cleanAmount);
          store.wallet.lastUpdated = new Date();
          await store.save();

          await WalletTopup.create({
            vendorId: store.vendorId,
            storeId: store._id,
            amountPKR: cleanAmount,
            referenceId,
            paymentReceiptUrl: '/uploads/receipts/api_gateway.png',
            paymentStatus: 'approved',
            type: 'topup',
            message: `Instant ${gateway.toUpperCase()} deposit`
          });
        }
      }

      return res.json({
        success: true,
        message: `${gateway.toUpperCase()} transaction processed successfully. MPIN prompt sent to device.`,
        referenceId,
        gatewayResponse: result
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result?.pp_ResponseMessage || result?.responseDesc || 'Transaction failed on mobile wallet',
        gatewayResponse: result
      });
    }

  } catch (error) {
    console.error(`[Payment API Error]:`, error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    JazzCash Instant Payment Notification Callback (IPN Webhook)
// @route   POST /api/payments/jazzcash/callback
// @access  Public (Called by JazzCash Server)
router.post('/jazzcash/callback', async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('[JazzCash Callback Received]:', callbackData);

    const integritySalt = process.env.JAZZCASH_INTEGRITY_SALT || 'salt123456789';
    const receivedHash = callbackData.pp_SecureHash;

    // Verify hash integrity
    delete callbackData.pp_SecureHash;
    const computedHash = generateJazzCashHash(callbackData, integritySalt);

    if (receivedHash !== computedHash) {
      console.warn('[JazzCash Callback Warning] Invalid hash signature match!');
      return res.status(400).json({ success: false, message: 'Invalid hash signature' });
    }

    if (callbackData.pp_ResponseCode === '000') {
      console.log(`[JazzCash IPN] Payment verified for Ref ${callbackData.pp_TxnRefNo}`);
      return res.status(200).send('OK');
    } else {
      return res.status(400).send('Payment Failed');
    }
  } catch (error) {
    console.error('[JazzCash Callback Error]:', error.message);
    res.status(500).send('Server Error');
  }
});

export default router;
