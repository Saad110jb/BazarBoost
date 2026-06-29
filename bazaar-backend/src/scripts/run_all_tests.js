import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// DB Connection
import connectDB from '../config/db.js';
import User from '../models/User.js';
import ChatSession from '../models/ChatSession.js';
import Message from '../models/Message.js';
import Store from '../models/Store.js';
import Product from '../models/Product.js';
import socketHandler from '../config/socketHandler.js';

async function runIntegrationTest() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost');
    console.log('MongoDB connected.');

    // Seed/resolve test users & stores
    const shopper = await User.findOne({ name: 'Saad110' });
    const store = await Store.findOne({ name: 'Shop Bazar' });
    
    if (!shopper || !store) {
      console.error('Test user or store not found in DB. Make sure database is seeded.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const customerId = shopper._id.toString();
    const vendorId = store.vendorId.toString();

    // Start Express + HTTP + Socket.io server
    const app = express();
    const server = http.createServer(app);
    const ioServer = new Server(server, {
      cors: { origin: '*' }
    });
    socketHandler(ioServer);

    const PORT = 5555; // Use different port for test
    server.listen(PORT, () => {
      console.log(`Test server listening on port ${PORT}`);
    });

    // Create client token
    const token = jwt.sign(
      { id: shopper._id, role: shopper.role },
      process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local',
      { expiresIn: '1d' }
    );

    // Resolve session via direct model logic (simulate resolve-session endpoint)
    let session = await ChatSession.findOne({ storeId: store._id, shopperId: shopper._id });
    if (!session) {
      session = await ChatSession.create({
        storeId: store._id,
        shopperId: shopper._id,
        status: 'unassigned'
      });
    }

    const roomId = session._id.toString();
    console.log(`Resolved roomId for test: ${roomId}`);

    // Connect client
    const { io: clientIo } = await import('socket.io-client');
    const clientSocket = clientIo(`http://localhost:${PORT}`, {
      auth: { token },
      transports: ['websocket']
    });

    clientSocket.on('connect', () => {
      console.log('Client socket connected to test server.');
      clientSocket.emit('join_negotiation_room', { roomId, userType: 'CUSTOMER' });

      setTimeout(() => {
        console.log('Emitting send_negotiation_msg payload...');
        clientSocket.emit('send_negotiation_msg', {
          roomId,
          senderId: customerId,
          text: 'Integration Test - Propose counter price Rs. 195.00',
          proposedPrice: 195.00,
          timestamp: new Date()
        });
      }, 500);
    });

    clientSocket.on('receive_negotiation_msg', (msg) => {
      console.log('--- TEST SUCCESS ---');
      console.log('Received payload:', msg);
      clientSocket.disconnect();
      server.close(() => {
        mongoose.disconnect().then(() => {
          console.log('Test completed successfully.');
          process.exit(0);
        });
      });
    });

    clientSocket.on('error_notification', (err) => {
      console.error('Socket error event:', err);
    });

    setTimeout(() => {
      console.error('Test timeout: did not receive broadcast');
      clientSocket.disconnect();
      server.close(() => {
        mongoose.disconnect().then(() => {
          process.exit(1);
        });
      });
    }, 6000);

  } catch (err) {
    console.error('Error during test execution:', err);
    process.exit(1);
  }
}

runIntegrationTest();
