import Message from '../models/Message.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import ChatSession from '../models/ChatSession.js';
import Notification from '../models/Notification.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import WalletTopup from '../models/WalletTopup.js';
import jwt from 'jsonwebtoken';
import { dispatchNotification } from '../services/notificationService.js';
import mongoose from 'mongoose';

/**
 * Initializes and configures WebSocket events for real-time shopper-vendor negotiation.
 * 
 * @param {object} io - Socket.io Server instance
 */
const socketHandler = (io) => {
  // Global Platform Financial Sync Simulator
  let activeBidsPool = 42;
  
  const getRandomLogMessage = () => {
    const orderId = Math.floor(Math.random() * 800) + 100;
    const storeNames = ['StoreBash', 'BazarPrime', 'AlphaDeals', 'SufiBazar', 'TechHaven'];
    const name = storeNames[Math.floor(Math.random() * storeNames.length)];
    const amount = Math.floor(Math.random() * 8000) + 2000;
    const comm = Math.round(amount * 0.05);

    const logs = [
      `Order #ORD-${orderId} finalized. Rs. ${comm} Platform Commission routed to escrow ledger.`,
      `Vendor Account '${name}' crossed Soft Debt Threshold (Rs. ${amount.toLocaleString()}). Phase 1 warning flag injected.`,
      `Inactive session cleanup completed. Purged 6-month stale cart cache segments securely.`,
      `Top-up verification request submitted for Store '${name}' (Ref: REF-${Math.floor(Math.random() * 800000)}).`,
      `Adbid Campaign placed on homepage hero banner by Store '${name}'.`
    ];
    return logs[Math.floor(Math.random() * logs.length)];
  };

  setInterval(async () => {
    try {
      const stores = await Store.find({}).select('wallet isActive');
      const totalCommissionDebt = stores.reduce((sum, st) => sum + (st.wallet?.outstandingCommission || 0), 0);
      
      const orders = await Order.find({ status: { $ne: 'cancelled' } }).select('totalAmount platformCommission');
      const totalGMV = orders.reduce((sum, o) => sum + o.totalAmount, 0);
      const totalCommission = orders.reduce((sum, o) => sum + (o.platformCommission || 0), 0);

      if (Math.random() > 0.5) {
        activeBidsPool += Math.random() > 0.5 ? 1 : -1;
        if (activeBidsPool < 10) activeBidsPool = 10;
        if (activeBidsPool > 100) activeBidsPool = 100;
      }

      io.emit('on_platform_financial_update', {
        totalGMV: totalGMV + (Math.random() * 5000), // minor dynamic growth
        totalCommission: totalCommission + (Math.random() * 250),
        totalCommissionDebt,
        activeBidsDensity: activeBidsPool,
        liveLog: Math.random() > 0.6 ? {
          time: new Date().toLocaleTimeString(),
          type: Math.random() > 0.6 ? 'WARNING' : Math.random() > 0.85 ? 'SECURITY' : 'INFO',
          message: getRandomLogMessage()
        } : null
      });
    } catch (err) {
      console.error('Platform financial update broadcast error:', err.message);
    }
  }, 6000);

  // Connection Authentication Interceptor Check
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication error: Token required'));
      }
      
      const tokenClean = token.startsWith('Bearer ') ? token.slice(7) : token;
      const decoded = jwt.verify(tokenClean, process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local');
      
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }
      
      // Enforce instant account suspension
      if (user.status !== 'active') {
        return next(new Error('Authentication error: Account suspended'));
      }
      
      // Store user details on socket context
      socket.user = {
        _id: user._id,
        role: user.role,
        name: user.name,
        tenantStores: decoded.tenantStores || [],
        activeStoreId: decoded.activeStoreId || null
      };
      
      next();
    } catch (error) {
      console.error('Socket authentication failure:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`WebSocket client connected: ${socket.id} (User: ${socket.user.name}, Role: ${socket.user.role})`);

    // Auto-join personal user room for push notifications
    const userRoom = `user:${socket.user._id.toString()}`;
    socket.join(userRoom);
    console.log(`Socket ${socket.id} auto-joined personal room: ${userRoom}`);

    // Campaign Analytics Simulation Interval
    let analyticsInterval;
    if (socket.user.role === 'vendor' || socket.user.role === 'storeAdmin') {
      let currentImpressions = 8900;
      let currentClicks = 400;
      let currentConversions = 110;

      analyticsInterval = setInterval(() => {
        // Randomly increment stats to simulate streaming traffic
        const impressionsDiff = Math.floor(Math.random() * 5) + 1; // +1 to +5 impressions
        currentImpressions += impressionsDiff;

        // Simulate click chance: ~5% CTR on new impressions
        let newClicks = 0;
        for (let i = 0; i < impressionsDiff; i++) {
          if (Math.random() < 0.05) {
            newClicks++;
          }
        }
        currentClicks += newClicks;

        // Simulate conversion chance: ~20% conversion rate on new clicks
        let newConversions = 0;
        for (let i = 0; i < newClicks; i++) {
          if (Math.random() < 0.20) {
            newConversions++;
          }
        }
        currentConversions += newConversions;

        // Cap at targets
        if (currentImpressions > 10000) currentImpressions = 10000;
        if (currentClicks > 500) currentClicks = 500;
        if (currentConversions > 150) currentConversions = 150;

        socket.emit('campaign_analytics_broadcast', {
          impressions: currentImpressions,
          clicks: currentClicks,
          conversions: currentConversions,
          targetImpressions: 10000,
          targetClicks: 500,
          targetConversions: 150
        });
      }, 4000); // every 4 seconds
    }

    // Flush unread DB notifications to this newly connected user
    try {
      const unread = await Notification.find({
        recipientId: socket.user._id,
        isRead: false,
      }).sort({ createdAt: -1 }).limit(50);

      if (unread.length > 0) {
        socket.emit('notification:flush', { notifications: unread, count: unread.length });
        console.log(`Flushed ${unread.length} unread notifications to ${socket.user.name}`);
      }
    } catch (flushErr) {
      console.error('Notification flush error:', flushErr.message);
    }

    // ── Admin-only: join security & audit broadcast channels ────────────────
    socket.on('join_admin_channel', () => {
      if (socket.user.role !== 'admin') {
        return socket.emit('error_notification', { message: 'Access denied: Admin channel requires admin role' });
      }
      socket.join('admin:audit');
      socket.join('admin:security');
      console.log(`Admin ${socket.user.name} joined admin:audit and admin:security channels`);
      socket.emit('joined_admin_channels', { channels: ['admin:audit', 'admin:security'] });
    });

    // ── Join store channel for real-time dashboard notifications ─────────────
    socket.on('join_store', (data) => {
      const { storeId } = data;
      if (!storeId) return socket.emit('error_notification', { message: 'storeId required' });
      if (socket.user.tenantStores.includes(storeId.toString()) || socket.user.activeStoreId === storeId.toString() || socket.user.role === 'admin') {
        socket.join(`store:${storeId}`);
        console.log(`Socket ${socket.id} joined store channel: store:${storeId}`);
        socket.emit('joined_store', { storeId });
      } else {
        socket.emit('error_notification', { message: 'Access denied: Unauthorized store channel context' });
      }
    });

    // ── Join vendor dashboard channel room for real-time metrics ─────────────
    socket.on('join_vendor_dashboard_room', (data) => {
      const { vendorId } = data;
      if (!vendorId) return socket.emit('error_notification', { message: 'vendorId required' });
      
      const userIdStr = socket.user._id.toString();
      const isAuthorized = userIdStr === vendorId.toString() || socket.user.role === 'admin';
      
      if (isAuthorized) {
        socket.join(`dashboard:${vendorId}`);
        console.log(`Socket ${socket.id} joined dashboard room: dashboard:${vendorId}`);
        socket.emit('joined_vendor_dashboard_room', { vendorId });
      } else {
        socket.emit('error_notification', { message: 'Access denied: Unauthorized dashboard room context' });
      }
    });

    // Assign chat room to specific operator
    socket.on('assign_chat', async ({ storeId, shopperId }) => {
      try {
        // Skip assignment in DB for mock/demo IDs to avoid CastErrors
        if (!storeId || !shopperId || !mongoose.Types.ObjectId.isValid(storeId) || !mongoose.Types.ObjectId.isValid(shopperId)) {
          io.to(`store:${storeId}`).emit('chat_assigned', {
            storeId,
            shopperId,
            assignedOperatorId: socket.user._id,
            operatorName: socket.user.name,
            status: 'active'
          });
          console.log(`Mock Chat room room:${storeId}_${shopperId} assigned to operator ${socket.user.name} (DB skipped)`);
          return;
        }

        const session = await ChatSession.findOneAndUpdate(
          { storeId, shopperId },
          { assignedOperatorId: socket.user._id, status: 'active', lastActivity: Date.now() },
          { new: true, upsert: true }
        ).populate('assignedOperatorId', 'name role');

        io.to(`store:${storeId}`).emit('chat_assigned', {
          storeId,
          shopperId,
          assignedOperatorId: socket.user._id,
          operatorName: socket.user.name,
          status: 'active'
        });
        console.log(`Chat room room:${storeId}_${shopperId} assigned to operator ${socket.user.name}`);
      } catch (err) {
        console.error('assign_chat error:', err.message);
        socket.emit('error_notification', { message: 'Failed to assign chat' });
      }
    });

    // End shift and release active chats
    socket.on('end_shift', async ({ storeId }) => {
      try {
        if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
          // Mock Shift-End fallback
          io.to(`store:${storeId}`).emit('shift_ended', {
            operatorId: socket.user._id,
            operatorName: socket.user.name,
            releasedShopperIds: []
          });
          console.log(`Mock operator shift ended (DB skipped)`);
          return;
        }

        const activeSessions = await ChatSession.find({
          storeId,
          assignedOperatorId: socket.user._id,
          status: 'active'
        });

        await ChatSession.updateMany(
          { storeId, assignedOperatorId: socket.user._id, status: 'active' },
          { assignedOperatorId: null, status: 'unassigned', lastActivity: Date.now() }
        );

        io.to(`store:${storeId}`).emit('shift_ended', {
          operatorId: socket.user._id,
          operatorName: socket.user.name,
          releasedShopperIds: activeSessions.map(s => s.shopperId.toString())
        });

        const store = await Store.findById(storeId);
        const ownerVendorId = store ? store.vendorId : socket.user._id;

        for (const session of activeSessions) {
          const roomId = `room:${storeId}_${session.shopperId}`;
          const textMsg = `Shift operator ${socket.user.name} ended shift. Your chat is returning to the active queue for handover.`;

          const newMessage = await Message.create({
            shopperId: session.shopperId,
            vendorId: ownerVendorId,
            storeId: storeId,
            senderId: socket.user._id,
            text: textMsg,
          });

          io.to(roomId).emit('receive_message', {
            meta: {
              roomId,
              timestamp: newMessage.createdAt.toISOString(),
              senderRole: 'System'
            },
            content: {
              messageText: textMsg
            },
            attachments: {
              hasProductSnippet: false,
              productData: null
            },
            _id: newMessage._id
          });
        }
        console.log(`Operator ${socket.user.name} ended shift. Released ${activeSessions.length} chats.`);
      } catch (err) {
        console.error('end_shift error:', err.message);
        socket.emit('error_notification', { message: 'Failed to complete shift handover' });
      }
    });

    // Join room supporting both old format and new room:storeId_customerId format
    socket.on('join_room', async (data) => {
      let roomId = '';
      if (data && data.roomId) {
        roomId = data.roomId;
      } else if (data && data.shopperId && data.vendorId) {
        // Legacy fallback
        try {
          const store = await Store.findOne({ vendorId: data.vendorId });
          const storeId = store ? store._id.toString() : 'mock_store';
          roomId = `room:${storeId}_${data.shopperId}`;
        } catch {
          roomId = `negotiation_${data.shopperId}_${data.vendorId}`;
        }
      }

      if (!roomId) {
        return socket.emit('error_notification', { message: 'Invalid room details' });
      }

      // Identity Authorization Check for Room Subscriptions
      const match = roomId.match(/^room:([a-fA-F0-9]{24})_([a-fA-F0-9]{24})$/);
      if (match) {
        const storeId = match[1];
        const customerId = match[2];
        const userIdStr = socket.user._id.toString();
        const userRole = socket.user.role;

        let hasAccess = false;
        if (userRole === 'shopper') {
          // Customers can only join their own chat rooms
          if (customerId === userIdStr) {
            hasAccess = true;
          }
        } else if (userRole === 'vendor' || userRole === 'storeAdmin') {
          // Store operators can only join rooms belonging to their store fleet
          if (socket.user.tenantStores.includes(storeId) || socket.user.activeStoreId === storeId) {
            hasAccess = true;
          }
        } else if (userRole === 'admin') {
          // Platform admins can access any room
          hasAccess = true;
        }

        if (!hasAccess) {
          console.warn(`Unauthorized join attempt to room ${roomId} by user ${userIdStr}`);
          return socket.emit('error_notification', { message: 'Access denied: Unauthorized room context' });
        }
      }

      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room: ${roomId}`);
      socket.emit('joined_room', { roomId });
    });

    // Support join_negotiation_room alias
    socket.on('join_negotiation_room', async (data) => {
      const roomId = data?.roomId;
      if (roomId) {
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined negotiation room: ${roomId}`);
        socket.emit('joined_room', { roomId });
      }
    });

    // Send a message supporting new JSON payload and legacy payload
    socket.on('send_message', async (payload) => {
      if (payload && payload.meta && payload.meta.roomId) {
        const { meta, content, attachments } = payload;
        const match = meta.roomId.match(/^room:([a-fA-F0-9]{24})_([a-fA-F0-9]{24})$/);
        
        let storeId = null;
        let customerId = null;
        let isMock = false;

        if (match) {
          storeId = match[1];
          customerId = match[2];
        } else if (meta.roomId.startsWith('room:')) {
          const parts = meta.roomId.slice(5).split('_');
          if (parts.length === 2) {
            storeId = parts[0];
            customerId = parts[1];
            isMock = true;
          } else {
            return socket.emit('error_notification', { message: 'Invalid Room ID format' });
          }
        } else {
          return socket.emit('error_notification', { message: 'Invalid Room ID format' });
        }

        try {
          const textMsg = content.messageText || '';
          const mediaUrl = content.mediaUrl || null;
          const productId = attachments?.hasProductSnippet ? attachments.productData?.productId : null;

          let newMessage;
          let storeName = 'BazaarBoost';
          let vendorId = socket.user?._id;

          if (!isMock) {
            const store = await Store.findById(storeId);
            if (!store) {
              return socket.emit('error_notification', { message: 'Store not found' });
            }
            if (!store.isActive) {
              return socket.emit('error_notification', { message: 'This store is suspended. Active negotiations are frozen.' });
            }
            storeName = store.name;
            vendorId = store.vendorId;

            newMessage = await Message.create({
              shopperId: customerId,
              vendorId: vendorId,
              storeId: storeId,
              productId: productId || null,
              senderId: socket.user._id,
              text: textMsg,
              mediaUrl: mediaUrl,
            });

            // Upsert active ChatSession
            let currentSession = await ChatSession.findOne({ storeId, shopperId: customerId });
            if (!currentSession) {
              currentSession = await ChatSession.create({
                storeId,
                shopperId: customerId,
                status: socket.user.role === 'shopper' ? 'unassigned' : 'active',
                assignedOperatorId: socket.user.role === 'shopper' ? null : socket.user._id,
                lastActivity: new Date()
              });
            } else {
              currentSession.lastActivity = new Date();
              if (socket.user.role !== 'shopper' && !currentSession.assignedOperatorId) {
                currentSession.assignedOperatorId = socket.user._id;
                currentSession.status = 'active';
              }
              await currentSession.save();
            }

            // Broadcast session update to store channel
            io.to(`store:${storeId}`).emit('chat_session_updated', {
              session: {
                _id: currentSession._id,
                storeId: currentSession.storeId,
                shopperId: currentSession.shopperId,
                assignedOperatorId: currentSession.assignedOperatorId,
                status: currentSession.status,
                lastActivity: currentSession.lastActivity.toISOString()
              }
            });
          } else {
            newMessage = {
              _id: `mock_${Date.now()}`,
              createdAt: new Date()
            };
          }

          // Standardized payload data contract response
          const outboundPayload = {
            meta: {
              roomId: meta.roomId,
              timestamp: newMessage.createdAt.toISOString(),
              senderRole: socket.user.role === 'shopper' ? 'Customer' : (socket.user.role === 'storeAdmin' ? 'StoreAdmin' : 'Vendor')
            },
            content: {
              messageText: textMsg,
              mediaUrl: mediaUrl
            },
            attachments: {
              hasProductSnippet: !!productId,
              productData: productId ? {
                productId: productId,
                name: attachments.productData.name,
                price: attachments.productData.price,
                thumbnailUrl: attachments.productData.thumbnailUrl,
                slug: attachments.productData.slug
              } : null
            },
            _id: newMessage._id
          };

          io.to(meta.roomId).emit('receive_message', outboundPayload);
          io.to(meta.roomId).emit('receive_negotiation_msg', outboundPayload);

          if (storeId && customerId) {
            const formattedRoom = `room:${storeId}_${customerId}`;
            io.to(formattedRoom).emit('receive_message', outboundPayload);
            io.to(formattedRoom).emit('receive_negotiation_msg', outboundPayload);
          }

          if (customerId) {
            io.to(`user:${customerId.toString()}`).emit('receive_message', outboundPayload);
            io.to(`user:${customerId.toString()}`).emit('receive_negotiation_msg', outboundPayload);
          }
          if (vendorId) {
            io.to(`user:${vendorId.toString()}`).emit('receive_message', outboundPayload);
            io.to(`user:${vendorId.toString()}`).emit('receive_negotiation_msg', outboundPayload);
          }

          // Offline notification check
          if (!isMock) {
            const isShopperSender = socket.user.role === 'shopper';
            const recipientId = isShopperSender ? vendorId.toString() : customerId;
            const recipientRoom = `user:${recipientId}`;
            const activeSockets = io.sockets.adapter.rooms.get(recipientRoom);
            const isRecipientOnline = activeSockets && activeSockets.size > 0;

            if (!isRecipientOnline) {
              const recipientUser = await User.findById(recipientId).select('name email');
              if (recipientUser && recipientUser.email) {
                dispatchNotification('CHAT_MESSAGE_OFFLINE', {
                  senderName: isShopperSender ? socket.user.name : storeName,
                  recipientEmail: recipientUser.email,
                  messageText: textMsg,
                  storeName: storeName
                });
              }
            }
          }
        } catch (error) {
          console.error('Socket send_message error:', error.message);
          socket.emit('error_notification', { message: 'Could not deliver message' });
        }
      } else {
        // Legacy fallback support
        const { shopperId, vendorId, productId, senderId, text, priceOffer } = payload;
        const roomName = `negotiation_${shopperId}_${vendorId}`;
        try {
          const newMessage = await Message.create({
            shopperId,
            vendorId,
            productId: productId || null,
            senderId,
            text,
            priceOffer: priceOffer ? parseFloat(priceOffer) : null,
            offerStatus: priceOffer ? 'pending' : 'none'
          });

          if (productId) {
            await newMessage.populate('productId', 'title price images');
          }
          await newMessage.populate('senderId', 'name role');

          io.to(roomName).emit('receive_message', newMessage);

          // Offline notification check
          const isShopperSender = senderId === shopperId;
          const recipientId = isShopperSender ? vendorId : shopperId;
          const recipientRoom = `user:${recipientId}`;
          const activeSockets = io.sockets.adapter.rooms.get(recipientRoom);
          const isRecipientOnline = activeSockets && activeSockets.size > 0;

          if (!isRecipientOnline) {
            const recipientUser = await User.findById(recipientId).select('name email');
            if (recipientUser && recipientUser.email) {
              const senderUser = await User.findById(senderId).select('name');
              const store = await Store.findOne({ vendorId: isShopperSender ? vendorId : senderId });
              dispatchNotification('CHAT_MESSAGE_OFFLINE', {
                senderName: isShopperSender ? (senderUser?.name || 'Customer') : (store?.name || 'Vendor'),
                recipientEmail: recipientUser.email,
                messageText: text || (priceOffer ? `Offer: Rs. ${priceOffer}` : 'New attachment'),
                storeName: store?.name || 'BazaarBoost'
              });
            }
          }
        } catch (error) {
          console.error('Socket send_message legacy error:', error.message);
          socket.emit('error_notification', { message: 'Could not send message' });
        }
      }
    });

    // Respond to legacy price offer (accept/reject)
    socket.on('respond_offer', async ({ shopperId, vendorId, messageId, action, roomId }) => {
      const roomName = `negotiation_${shopperId}_${vendorId}`;
      try {
        if (!['accepted', 'rejected'].includes(action)) {
          return socket.emit('error_notification', { message: 'Invalid action' });
        }

        const message = await Message.findById(messageId);
        if (!message) {
          return socket.emit('error_notification', { message: 'Message not found' });
        }

        if (message.storeId) {
          const store = await Store.findById(message.storeId);
          if (store && !store.isActive) {
            return socket.emit('error_notification', { message: 'This store is suspended. Active negotiations are frozen.' });
          }
        }

        message.offerStatus = action;
        await message.save();

        // Broadcast to legacy room name
        io.to(roomName).emit('offer_status_changed', {
          messageId: message._id,
          offerStatus: action
        });

        // Broadcast to the new room format room:${storeId}_${shopperId}
        const activeRoomId = roomId || (message.storeId && message.shopperId ? `room:${message.storeId}_${message.shopperId}` : null);
        if (activeRoomId) {
          let populatedMsg = message;
          if (message.productId) {
            populatedMsg = await message.populate('productId', 'title price images slug');
          }
          const hasProduct = !!populatedMsg.productId;
          const outboundPayload = {
            meta: {
              roomId: activeRoomId,
              timestamp: populatedMsg.createdAt.toISOString(),
              senderRole: populatedMsg.senderId.toString() === message.shopperId.toString() ? 'Customer' : 'Vendor'
            },
            content: {
              messageText: populatedMsg.text || '',
              mediaUrl: populatedMsg.mediaUrl || null
            },
            attachments: {
              hasProductSnippet: hasProduct,
              productData: hasProduct ? {
                productId: populatedMsg.productId._id || populatedMsg.productId,
                name: populatedMsg.productId.title || populatedMsg.productId.name || "Product",
                price: populatedMsg.productId.price || 0,
                thumbnailUrl: populatedMsg.productId.images?.[0]?.url || "",
                slug: populatedMsg.productId.slug || ""
              } : null
            },
            priceOffer: populatedMsg.priceOffer,
            offerStatus: action,
            _id: populatedMsg._id
          };
          io.to(activeRoomId).emit('on_negotiation_state_change', outboundPayload);
        }

        console.log(`Offer ${messageId} updated to ${action} in rooms: ${roomName}, ${activeRoomId}`);
      } catch (error) {
        console.error('Socket respond offer failed:', error.message);
        socket.emit('error_notification', { message: 'Could not update offer status' });
      }
    });

    // Handle structured counter price negotiation proposing
    socket.on('submit_negotiation_counter', async ({ roomId, productId, proposedPrice, customerMsg }) => {
      try {
        if (!roomId) {
          return socket.emit('error_notification', { message: 'roomId is required' });
        }
        
        const match = roomId.match(/^room:([a-fA-F0-9]{24})_([a-fA-F0-9]{24})$/);
        if (!match) {
          return socket.emit('error_notification', { message: 'Invalid roomId format' });
        }
        
        const storeId = match[1];
        const shopperId = match[2];
        
        const store = await Store.findById(storeId);
        if (!store) {
          return socket.emit('error_notification', { message: 'Store not found' });
        }
        if (!store.isActive) {
          return socket.emit('error_notification', { message: 'This store is suspended. Active negotiations are frozen.' });
        }
        
        const vendorId = store.vendorId;
        const textMsg = customerMsg || `Proposed Counter Price: Rs. ${proposedPrice}`;
        
        const newMessage = await Message.create({
          shopperId,
          vendorId,
          storeId,
          productId: productId || null,
          senderId: socket.user._id,
          text: textMsg,
          priceOffer: proposedPrice ? parseFloat(proposedPrice) : null,
          offerStatus: 'pending'
        });
        
        let populatedMsg = newMessage;
        if (productId) {
          populatedMsg = await newMessage.populate('productId', 'title price images slug');
        }
        
        const hasProduct = !!productId;
        const outboundPayload = {
          meta: {
            roomId: roomId,
            timestamp: populatedMsg.createdAt.toISOString(),
            senderRole: socket.user.role === 'shopper' ? 'Customer' : 'Vendor'
          },
          content: {
            messageText: textMsg,
            mediaUrl: null
          },
          attachments: {
            hasProductSnippet: hasProduct,
            productData: hasProduct ? {
              productId: productId,
              name: populatedMsg.productId?.title || populatedMsg.productId?.name || "Product",
              price: populatedMsg.productId?.price || 0,
              thumbnailUrl: populatedMsg.productId?.images?.[0]?.url || "",
              slug: populatedMsg.productId?.slug || ""
            } : null
          },
          priceOffer: newMessage.priceOffer,
          offerStatus: 'pending',
          _id: newMessage._id
        };
        
        io.to(roomId).emit('on_negotiation_state_change', outboundPayload);
        
        // Also emit to the legacy room just in case
        const legacyRoom = `negotiation_${shopperId}_${vendorId}`;
        io.to(legacyRoom).emit('receive_message', newMessage);
        
        console.log(`Counter-offer of Rs. ${proposedPrice} proposed in room ${roomId}`);
      } catch (error) {
        console.error('Socket submit_negotiation_counter error:', error.message);
        socket.emit('error_notification', { message: 'Could not propose counter price' });
      }
    });

    // Isolate conversation room traffic stream explicitly
    socket.on('join_negotiation_room', (data) => {
      const activeRoomId = data?.roomId || data?.threadId || data?.orderId;
      const userType = data?.userType || 'UNKNOWN';
      const userId = data?.userId || socket.user?._id;
      if (activeRoomId) {
        socket.join(activeRoomId);
        console.log(`[DEBUG Socket Join] User ${userId} (${userType}) joined room: ${activeRoomId}`);
        console.log(`[DEBUG Socket Rooms] Current rooms for socket ${socket.id}:`, Array.from(socket.rooms));
      }
    });

    // Handle high-performance bi-directional message pipeline handshake
    socket.on('send_negotiation_msg', async (payload) => {
      try {
        const { roomId, senderId, text, proposedPrice } = payload;
        const messageText = text || payload.messageText || "";
        
        console.log(`[DEBUG Send Msg] Received send_negotiation_msg payload:`, payload);

        if (!roomId) return socket.emit('error_notification', { message: 'roomId is required' });

        let storeId = null;
        let shopperId = null;

        // Try to resolve room context from ChatSession ObjectId
        if (mongoose.Types.ObjectId.isValid(roomId)) {
          const session = await ChatSession.findById(roomId);
          if (session) {
            storeId = session.storeId;
            shopperId = session.shopperId;
          }
        }

        // Fallback: parse legacy roomId room:storeId_shopperId
        if (!storeId || !shopperId) {
          const match = roomId.match(/^room:([a-fA-F0-9]{24})_([a-fA-F0-9]{24})$/);
          if (match) {
            storeId = match[1];
            shopperId = match[2];
          } else {
            shopperId = senderId;
          }
        }

        let store = null;
        if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
          store = await Store.findById(storeId);
        }
        if (store && !store.isActive) {
          return socket.emit('error_notification', { message: 'This store is suspended. Active negotiations are frozen.' });
        }
        const vendorId = store ? store.vendorId : socket.user?._id;

        const isStoreIdValid = storeId && mongoose.Types.ObjectId.isValid(storeId);
        const isShopperIdValid = shopperId && mongoose.Types.ObjectId.isValid(shopperId);
        const isVendorIdValid = vendorId && mongoose.Types.ObjectId.isValid(vendorId);
        const isSenderIdValid = senderId && mongoose.Types.ObjectId.isValid(senderId);

        const isMockMode = !isStoreIdValid || !isShopperIdValid || !isVendorIdValid || !isSenderIdValid;

        let newMessage;
        if (!isMockMode) {
          newMessage = await Message.create({
            shopperId: shopperId,
            vendorId: vendorId,
            storeId: storeId,
            senderId: senderId,
            text: messageText,
            priceOffer: proposedPrice ? parseFloat(proposedPrice) : null,
            offerStatus: proposedPrice ? 'pending' : 'none'
          });
        } else {
          newMessage = {
            _id: `mock_${Date.now()}`,
            shopperId: shopperId,
            vendorId: vendorId,
            storeId: storeId,
            senderId: senderId,
            text: messageText,
            priceOffer: proposedPrice ? parseFloat(proposedPrice) : null,
            offerStatus: proposedPrice ? 'pending' : 'none',
            createdAt: new Date()
          };
        }

        const outboundPayload = {
          _id: newMessage._id,
          roomId,
          storeId,
          shopperId,
          vendorId,
          senderId,
          text: messageText,
          messageText,
          proposedPrice: proposedPrice ? parseFloat(proposedPrice) : null,
          offerStatus: proposedPrice ? 'pending' : 'none',
          meta: {
            roomId,
            timestamp: (newMessage.createdAt instanceof Date ? newMessage.createdAt : new Date(newMessage.createdAt)).toISOString(),
            senderRole: senderId.toString() === shopperId.toString() ? 'Customer' : 'Vendor'
          },
          content: {
            messageText,
            mediaUrl: null
          },
          priceOffer: proposedPrice ? parseFloat(proposedPrice) : null
        };

        // Physically map to room broadcast targets
        io.to(roomId).emit('receive_negotiation_msg', outboundPayload);
        io.to(roomId).emit('receive_message', outboundPayload);
        
        if (storeId && shopperId) {
          const formattedRoom = `room:${storeId}_${shopperId}`;
          io.to(formattedRoom).emit('receive_negotiation_msg', outboundPayload);
          io.to(formattedRoom).emit('receive_message', outboundPayload);
        }

        // Broadcast to personal user rooms (guarantees delivery even if tab reconnected/joined late)
        if (shopperId) {
          io.to(`user:${shopperId.toString()}`).emit('receive_negotiation_msg', outboundPayload);
          io.to(`user:${shopperId.toString()}`).emit('receive_message', outboundPayload);
        }
        if (vendorId) {
          io.to(`user:${vendorId.toString()}`).emit('receive_negotiation_msg', outboundPayload);
          io.to(`user:${vendorId.toString()}`).emit('receive_message', outboundPayload);
        }

        // Backward compatibility notifications
        const legacyRoom = `negotiation_${shopperId}_${vendorId}`;
        io.to(legacyRoom).emit('receive_negotiation_msg', outboundPayload);
        io.to(legacyRoom).emit('receive_message', outboundPayload);

        console.log(`Negotiation msg from ${senderId} broadcasted to room: ${roomId} (Mock: ${isMockMode})`);
      } catch (err) {
        console.error('Socket send_negotiation_msg error:', err.message);
        socket.emit('error_notification', { message: 'Failed to route negotiation message' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`WebSocket client disconnected: ${socket.id}`);
      if (analyticsInterval) {
        clearInterval(analyticsInterval);
      }
    });
  });
};

export async function broadcastVendorDashboardMetrics(storeId, mutationType, targetProductId = null) {
  try {
    if (!global.io) return;
    const Store = mongoose.model('Store');
    const Product = mongoose.model('Product');
    const Order = mongoose.model('Order');

    const store = await Store.findById(storeId).lean();
    if (!store) return;
    const vendorId = store.vendorId;

    // Count active products
    const currentActiveCount = await Product.countDocuments({
      vendorId: vendorId,
      status: 'ACTIVE',
      stockBalance: { $gt: 0 } // Exclude completely exhausted inventory profiles dynamically
    });

    // Sum revenue of non-cancelled orders
    const orders = await Order.find({
      storeId: store._id,
      status: { $ne: 'cancelled' }
    }).lean();
    const computedTotalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const changePayload = {
      mutationType: mutationType || 'UPDATE',
      targetProductId: targetProductId ? targetProductId.toString() : null,
      currentActiveCount,
      computedTotalRevenue: Math.round(computedTotalRevenue * 100) / 100
    };

    console.log(`[Socket Broadcast] Emitting vendor_product_catalog_mutated to vendor_dashboard_${vendorId} and dashboard:${vendorId}`, changePayload);
    global.io.to(`vendor_dashboard_${vendorId.toString()}`).to(`dashboard:${vendorId.toString()}`).emit('vendor_product_catalog_mutated', changePayload);
  } catch (err) {
    console.error('Error in broadcastVendorDashboardMetrics:', err);
  }
}

export default socketHandler;
