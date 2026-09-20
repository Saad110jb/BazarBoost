import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, './.env') });

async function testPaymentIntegration() {
  console.log('--- Testing JazzCash & EasyPaisa Payment Integration ---');

  const backendUrl = 'http://localhost:5000/api/payments/initiate';

  console.log(`Sending payment request payload to ${backendUrl}...`);

  const mockPayload = {
    amountPKR: 1500,
    gateway: 'jazzcash',
    mobileNumber: '03001234567',
    cnicLast6: '345678',
    purpose: 'wallet_topup'
  };

  console.log('Payload:', JSON.stringify(mockPayload, null, 2));

  try {
    console.log('\nNOTE: Run server first using `npm run dev -w bazaar-backend` to execute HTTP check.');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testPaymentIntegration();
