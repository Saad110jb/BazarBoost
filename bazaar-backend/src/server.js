import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve directory paths in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config from absolute path relative to server.js (src/server.js -> ../.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// DB Connection
import connectDB from './config/db.js';
connectDB();

// Route Imports
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import adRoutes from './routes/ads.js';
import negotiationRoutes from './routes/negotiation.js';
import aiRoutes from './routes/ai.js';
import walletRoutes from './routes/wallet.js';   // Atomic wallet ledger (schema integrity §3.2)
import orderRoutes from './routes/orders.js';
import couponRoutes from './routes/coupons.js';
import notificationRoutes from './routes/notifications.js';
import storeRoutes from './routes/stores.js';
import adminRoutes from './routes/admin.js';
import complaintRoutes from './routes/complaints.js';
import loyaltyRoutes from './routes/loyalty.js';
import paymentRoutes from './routes/payments.js';
import healthRoutes from './routes/health.js';

// Socket Event Handler
import socketHandler from './config/socketHandler.js';

const app = express();
const server = http.createServer(app);

// Configure CORS
const corsOptions = {
  origin: '*', // Allow all origins for local development testing
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());

// Serve the full uploads tree as static files from project root and src directory
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/negotiation', negotiationRoutes);
app.use('/api/negotiations', negotiationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/wallet', walletRoutes);   // Atomic wallet ledger (schema integrity §3.2)
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/health', healthRoutes);

// Root Healthcheck Route
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'BazaarBoost Central API Engine is active',
    timestamp: new Date()
  });
});

// Configure Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
socketHandler(io);
global.io = io; // Set globally for Mongoose listeners (low stock & image updates)

// Boot server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`BazaarBoost Backend server running on port ${PORT}`);
  console.log(`AI Sandbox OCR endpoint:     http://localhost:${PORT}/api/ai/ocr`);
  console.log(`AI Sandbox Tagging endpoint: http://localhost:${PORT}/api/ai/tag`);
  console.log(`Wallet Ledger endpoint:      http://localhost:${PORT}/api/wallet/ledger`);
  console.log(`Payment Engine endpoint:     http://localhost:${PORT}/api/payments/initiate`);

  try {
    const { startCronScheduler } = await import('./services/cronService.js');
    startCronScheduler();
    console.log('✓ Headless background cron sweep worker started successfully');
  } catch (cronErr) {
    console.error('✗ Failed to boot background cron sweep worker:', cronErr.message);
  }
});
