/**
 * testAppFactory.js
 * ─────────────────────────────────────────────────────────────
 * Creates an isolated Express + Socket.io server instance
 * bound to the REAL application routes for integration testing.
 *
 * Does NOT call server.listen() — Supertest handles ephemeral
 * binding so each test suite gets its own port-free server.
 *
 * For Module D (admin tests), the app injects a middleware
 * that short-circuits the AdminSession IP check by injecting
 * a trusted x-forwarded-for header at the socket level.
 * ─────────────────────────────────────────────────────────────
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

// Route imports (same as production server.js)
import authRoutes        from '../../src/routes/auth.js';
import negotiationRoutes from '../../src/routes/negotiation.js';
import adminRoutes       from '../../src/routes/admin.js';
import loyaltyRoutes     from '../../src/routes/loyalty.js';
import walletRoutes      from '../../src/routes/wallet.js';
import orderRoutes       from '../../src/routes/orders.js';
import storeRoutes       from '../../src/routes/stores.js';

// Socket handler
import socketHandler from '../../src/config/socketHandler.js';

// Admin models (for session IP normalization)
import AdminSession from '../../src/models/AdminSession.js';
import User from '../../src/models/User.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local';

/**
 * Builds a fully wired Express + Socket.io test application.
 *
 * @param {object} options
 * @param {boolean} [options.patchAdminIP=false] - If true, injects middleware
 *   that captures the actual server-side IP from the first admin request and
 *   upserts an AdminSession for it, enabling IP-sensitive admin auth tests.
 *
 * @returns {{ app, server, io }}
 */
export function buildTestApp(options = {}) {
  const app = express();
  const server = http.createServer(app);

  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // ── Test-only admin IP patcher middleware ──────────────────
  // When patchAdminIP is true, this intercepts admin requests,
  // reads the actual IP that Express sees, and upserts an
  // AdminSession for that IP before passing to protect().
  // This cleanly handles Node's dual-stack IPv4/IPv6 normalization.
  if (options.patchAdminIP) {
    app.use('/api/admin', async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.split(' ')[1];
          const decoded = jwt.verify(token, JWT_SECRET);
          if (decoded.role === 'admin') {
            // Get the IP Express actually sees (same as protect() sees)
            const actualIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
            // Upsert AdminSession for this IP
            if (actualIp) {
              await AdminSession.findOneAndUpdate(
                { adminId: new mongoose.Types.ObjectId(decoded.id), token },
                { adminId: new mongoose.Types.ObjectId(decoded.id), token, ipAddress: actualIp },
                { upsert: true, new: true }
              );
            }
          }
        }
      } catch (_) {
        // Silently ignore token errors — protect() will handle them
      }
      next();
    });
  }

  // Mount all routes under /api
  app.use('/api/auth',         authRoutes);
  app.use('/api/negotiation',  negotiationRoutes);
  app.use('/api/negotiations', negotiationRoutes);
  app.use('/api/admin',        adminRoutes);
  app.use('/api/loyalty',      loyaltyRoutes);
  app.use('/api/wallet',       walletRoutes);
  app.use('/api/orders',       orderRoutes);
  app.use('/api/stores',       storeRoutes);

  // Healthcheck
  app.get('/', (_req, res) =>
    res.json({ status: 'test-online', timestamp: new Date() })
  );

  // Wire Socket.io
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket'],
  });
  socketHandler(io);
  global.io = io;

  return { app, server, io };
}
