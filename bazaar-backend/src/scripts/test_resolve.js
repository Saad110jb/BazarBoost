import mongoose from 'mongoose';
import ChatSession from '../models/ChatSession.js';
import Message from '../models/Message.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import Product from '../models/Product.js';

async function testQuery() {
  await mongoose.connect('mongodb://localhost:27017/bazaarboost');
  const shopperId = '6a33e9a9fd666fc4f8f6603b';
  const vendorId = '6a32884ff8cbf87e4c052c5b';

  const store = await Store.findOne({ vendorId: new mongoose.Types.ObjectId(vendorId) });
  console.log('Store resolved:', store?.name, store?._id);

  if (store) {
    const session = await ChatSession.findOne({ storeId: store._id, shopperId: new mongoose.Types.ObjectId(shopperId) });
    console.log('Session resolved:', session?._id, session?.status);

    const messages = await Message.find({ storeId: store._id, shopperId: new mongoose.Types.ObjectId(shopperId) })
      .populate('productId', 'title price images slug')
      .populate('senderId', 'name role')
      .sort({ createdAt: 1 });

    console.log('Messages retrieved:', messages.length);
    messages.forEach(m => {
      console.log(`- [${m.senderId?.name}]: ${m.text} (Proposed: ${m.priceOffer})`);
    });
  }

  await mongoose.disconnect();
}

testQuery();
