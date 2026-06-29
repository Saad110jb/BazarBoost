import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure dotenv is loaded from absolute path relative to mailer.js (src/config/mailer.js -> ../../.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'bazarboost884@gmail.com',
    pass: process.env.EMAIL_PASS || 'lhle sntm pohl qtcb',
  },
});

/**
 * Reusable utility to send transactional and system emails asynchronously.
 * Catches errors internally to prevent parent DB transactions from rollback.
 * 
 * @param {string|string[]} to - Recipient email address(es)
 * @param {string} subject - Email subject line
 * @param {string} htmlTemplate - HTML body content
 */
export const sendPlatformEmail = async (to, subject, htmlTemplate) => {
  try {
    const mailOptions = {
      from: `"BazaarBoost Support" <${process.env.EMAIL_USER || 'bazarboost884@gmail.com'}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html: htmlTemplate,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Notification Engine] Email dispatched successfully. Message ID: ${info.messageId} (Recipient: ${to})`);
    return info;
  } catch (error) {
    console.error(`[Notification Engine Error] Failed to send email to ${to}:`, error.message);
  }
};

export default transporter;
