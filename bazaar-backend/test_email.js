import { sendPlatformEmail } from './src/config/mailer.js';
import dotenv from 'dotenv';
dotenv.config();

async function testEmail() {
  console.log('Sending test email trigger to n8n...');
  const recipient = 'ms0574203@gmail.com';
  const subject = 'Welcome to BazaarBoost!';
  const eventType = 'user.welcome';
  const eventData = {
    userName: 'John Doe',
    platformLink: 'http://localhost:3000',
    verificationCode: 'XYZ-123456'
  };

  await sendPlatformEmail(recipient, subject, eventType, eventData);
}

testEmail();
