import axios from 'axios';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure dotenv is loaded
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://muhammadsaad110jb.app.n8n.cloud/webhook-test/send-email';

// Configure direct Nodemailer transporter for fallback
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'bazarboost884@gmail.com',
    pass: process.env.EMAIL_PASS || 'lhle sntm pohl qtcb',
  },
});

/**
 * Dispatches notification request directly to n8n Workflow Automation Engine.
 * Automatically falls back to direct Nodemailer SMTP if n8n is offline or unreachable.
 * 
 * @param {string|string[]} to - Recipient email address(es)
 * @param {string} subject - Email subject line
 * @param {string} eventType - The action trigger (e.g. 'welcome', 'ORDER_CREATED')
 * @param {object} eventData - Custom payload context containing variables or htmlTemplate
 */
export const sendPlatformEmail = async (to, subject, eventType, eventData = {}) => {
  const recipientStr = Array.isArray(to) ? to.join(', ') : to;

  // 1. Primary Strategy: Try sending to n8n Webhook
  try {
    const payload = {
      recipient: recipientStr,
      subject,
      event: eventType,
      data: eventData,
    };

    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 4000 // 4 seconds timeout to failover quickly if n8n is unreachable
    });

    console.log(`[Notification Engine - n8n] Event "${eventType}" processed by n8n. (Recipient: ${recipientStr})`);
    return response.data;
  } catch (n8nError) {
    console.warn(`[Notification Engine Warning] n8n webhook unavailable (${n8nError.message}). Initiating fallback to direct Nodemailer...`);
    
    // 2. Fallback Strategy: Direct Nodemailer SMTP
    try {
      const htmlBody = eventData.htmlTemplate || typeof eventData === 'string' ? eventData : `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2>${subject}</h2>
          <p>Event: <strong>${eventType}</strong></p>
          <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px;">${JSON.stringify(eventData, null, 2)}</pre>
        </div>
      `;

      const mailOptions = {
        from: `"BazaarBoost Support" <${process.env.EMAIL_USER || 'bazarboost884@gmail.com'}>`,
        to: recipientStr,
        subject,
        html: htmlBody,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[Notification Engine - Fallback] Email delivered directly via Nodemailer SMTP. Message ID: ${info.messageId} (Recipient: ${recipientStr})`);
      return info;
    } catch (fallbackError) {
      console.error(`[Notification Engine Error] Direct Nodemailer fallback also failed for ${recipientStr}:`, fallbackError.message);
    }
  }
};

export default sendPlatformEmail;


