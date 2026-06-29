import io from 'socket.io-client';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import User from '../models/User.js';

async function testSocket() {
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

  await mongoose.disconnect();

  console.log('Connecting to Socket.io...');
  const socket = io('http://localhost:5000', {
    auth: { token },
    transports: ['websocket']
  });

  const roomId = '6a3cd465ee0606bf776d0751';

  socket.on('connect', () => {
    console.log('Socket connected successfully!');
    console.log('Joining room:', roomId);
    socket.emit('join_negotiation_room', { roomId, userType: 'CUSTOMER' });

    setTimeout(() => {
      console.log('Sending test message...');
      socket.emit('send_negotiation_msg', {
        roomId,
        senderId: shopper._id.toString(),
        text: 'Test message from simulator',
        proposedPrice: null,
        timestamp: new Date()
      });
    }, 1000);
  });

  socket.on('receive_negotiation_msg', (msg) => {
    console.log('SUCCESS! Received real-time broadcast:', msg);
    socket.disconnect();
    process.exit(0);
  });

  socket.on('error_notification', (err) => {
    console.error('Socket error received:', err);
  });

  setTimeout(() => {
    console.error('Timeout waiting for socket message');
    socket.disconnect();
    process.exit(1);
  }, 5000);
}

testSocket();
