import { sendPlatformEmail } from './src/config/mailer.js';
import dotenv from 'dotenv';
dotenv.config();

async function testWhatsappOrderNotification() {
  console.log('Sending test ORDER_CREATED payload to n8n (Email + WhatsApp)...');
  
  const recipient = 'ms0574203@gmail.com';
  const subject = 'Order Placed - #ORD-882319';
  const eventType = 'ORDER_CREATED';
  const eventData = {
    orderId: '66bc901a1f4b238923a1012f',
    customerName: 'Muhammad Saad',
    customerPhone: '+923189663004',
    totalAmount: 3450,
    status: 'pending_approval',
    items: [
      { title: 'Wireless Bluetooth Headphones', quantity: 1, price: 3450 }
    ]
  };

  await sendPlatformEmail(recipient, subject, eventType, eventData);
}

testWhatsappOrderNotification();
