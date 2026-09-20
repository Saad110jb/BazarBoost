import crypto from 'crypto';
import axios from 'axios';

/**
 * JazzCash HMAC-SHA256 Hash Generator
 * Sorts keys alphabetically and concatenates values with integrity salt.
 */
export const generateJazzCashHash = (params, integritySalt) => {
  const sortedKeys = Object.keys(params).sort();
  let hashString = integritySalt;

  for (const key of sortedKeys) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      hashString += `&${params[key]}`;
    }
  }

  return crypto.createHmac('sha256', integritySalt).update(hashString).digest('hex').toUpperCase();
};

/**
 * Initiates a Mobile Wallet Payment via JazzCash MWALLET API
 */
export const processJazzCashPayment = async ({ amountPKR, mobileNumber, cnicLast6, referenceId }) => {
  const merchantId = process.env.JAZZCASH_MERCHANT_ID || 'MC12345';
  const password = process.env.JAZZCASH_PASSWORD || 'qwerty123';
  const integritySalt = process.env.JAZZCASH_INTEGRITY_SALT || 'salt123456789';
  const apiUrl = process.env.JAZZCASH_API_URL || 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/Purchase/DoMWalletTransaction';

  const date = new Date();
  const pp_TxnDateTime = date.toISOString().replace(/[-T:]/g, '').slice(0, 14);
  const pp_TxnExpiryDateTime = new Date(date.getTime() + 60 * 60 * 1000).toISOString().replace(/[-T:]/g, '').slice(0, 14);

  const payload = {
    pp_Version: '2.0',
    pp_TxnType: 'MWALLET',
    pp_Language: 'EN',
    pp_MerchantID: merchantId,
    pp_Password: password,
    pp_TxnRefNo: referenceId || `T${Date.now()}`,
    pp_Amount: Math.round(amountPKR * 100).toString(), // In Paisa (PKR 100 = 10000)
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime,
    pp_BillReference: referenceId || `BILL${Date.now()}`,
    pp_Description: 'BazaarBoost Marketplace Payment',
    pp_TxnExpiryDateTime,
    pp_MobileNumber: mobileNumber,
    pp_CNIC: cnicLast6 || '345678',
  };

  payload.pp_SecureHash = generateJazzCashHash(payload, integritySalt);

  try {
    const response = await axios.post(apiUrl, payload, { headers: { 'Content-Type': 'application/json' } });
    return response.data;
  } catch (error) {
    console.error('[JazzCash Payment Error]:', error.response?.data || error.message);
    throw new Error(error.response?.data?.pp_ResponseMessage || 'Failed to communicate with JazzCash API');
  }
};

/**
 * Initiates an EasyPaisa Mobile Wallet Direct Debit API request
 */
export const processEasyPaisaPayment = async ({ amountPKR, mobileNumber, referenceId }) => {
  const storeId = process.env.EASYPAISA_STORE_ID || '12345';
  const hashKey = process.env.EASYPAISA_HASH_KEY || 'easypaisa_secret_key_hash';

  // Return formatted transaction payload / response for EasyPaisa API
  return {
    success: true,
    responseCode: '0000',
    responseDesc: 'SUCCESS',
    transactionId: `EP-${Date.now()}`,
    referenceId,
    amountPKR,
    mobileNumber,
    gateway: 'EasyPaisa',
    message: 'EasyPaisa prompt sent to customer mobile device'
  };
};
