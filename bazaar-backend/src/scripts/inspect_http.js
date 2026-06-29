import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User.js';

async function testEndpoint() {
  await mongoose.connect('mongodb://localhost:27017/bazaarboost');
  const shopper = await User.findOne({ name: 'Saad110' });
  if (!shopper) {
    console.error('Saad110 not found');
    await mongoose.disconnect();
    return;
  }

  const token = jwt.sign(
    { id: shopper._id, role: shopper.role },
    process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local',
    { expiresIn: '30d' }
  );

  console.log('Token generated for Saad110:', token);

  const response = await fetch('http://localhost:5000/api/negotiations/resolve-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      customerId: shopper._id.toString(),
      vendorId: '6a32884ff8cbf87e4c052c5b',
      productId: null
    })
  });

  const data = await response.json();
  console.log('HTTP Resolve-session response success:', data.success);
  console.log('HTTP RoomId returned:', data.roomId);
  console.log('HTTP Messages Count returned:', data.messages?.length);
  data.messages?.forEach(m => {
    console.log(`- [Sender: ${m.senderId?._id || m.senderId}]: ${m.text}`);
  });

  await mongoose.disconnect();
}

testEndpoint();
