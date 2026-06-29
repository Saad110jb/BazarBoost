import mongoose from 'mongoose';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bazaarboost');
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Seed default SuperAdmin if none exists
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('gatekeeper@2026', salt);
      await User.create({
        name: 'System Gatekeeper',
        email: 'admin@bazaarboost.com',
        password: hashedPassword,
        role: 'admin',
        status: 'active'
      });
      console.log('✓ Default SuperAdmin account seeded (admin@bazaarboost.com / gatekeeper@2026)');
    }
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    // Do not crash the server in local development, but show warning
    console.warn('Backend running without active database connection. Make sure MongoDB is running!');
  }
};

export default connectDB;
