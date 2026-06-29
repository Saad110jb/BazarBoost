import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ChatSession from '../models/ChatSession.js';
import Message from '../models/Message.js';
import Store from '../models/Store.js';
import User from '../models/User.js';

async function checkDb() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost');
    console.log('Connected to DB');

    const sessions = await ChatSession.find({}).populate('storeId').populate('shopperId');
    console.log(`--- Active Sessions Count: ${sessions.length} ---`);
    for (const s of sessions) {
      console.log(`Session ID: ${s._id}`);
      console.log(`Store: ${s.storeId?.name} (${s.storeId?._id})`);
      console.log(`Shopper: ${s.shopperId?.name} (${s.shopperId?._id})`);
      console.log(`Status: ${s.status}`);
      console.log('------------------------');
    }

    const messages = await Message.find({}).sort({ createdAt: -1 }).limit(10);
    console.log(`--- Latest 10 Messages ---`);
    for (const m of messages) {
      console.log(`Msg ID: ${m._id}`);
      console.log(`Sender ID: ${m.senderId}`);
      console.log(`Text: ${m.text}`);
      console.log(`Price Offer: ${m.priceOffer}`);
      console.log(`Offer Status: ${m.offerStatus}`);
      console.log(`CreatedAt: ${m.createdAt}`);
      console.log('------------------------');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error running checkDb:', err);
  }
}

checkDb();
