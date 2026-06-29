import mongoose from 'mongoose';
import User from '../models/User.js';
import AdminSession from '../models/AdminSession.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost';

async function reactivate() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Clear all active sessions to reset the login state
    await AdminSession.deleteMany({});
    
    // Reactivate admin account
    const result = await User.updateOne(
      { email: 'admin@bazaarboost.com', role: 'admin' },
      { $set: { status: 'active' } }
    );
    
    console.log(`✓ SuperAdmin account successfully reactivated: modifiedCount=${result.modifiedCount}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Failed to reactivate admin:', error.message);
    process.exit(1);
  }
}

reactivate();
