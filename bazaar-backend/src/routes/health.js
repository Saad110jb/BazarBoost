import express from 'express';
import mongoose from 'mongoose';
import net from 'net';
import { URL } from 'url';

const router = express.Router();

const checkRedisConnection = (redisUrlString) => {
  return new Promise((resolve) => {
    let host = '127.0.0.1';
    let port = 6379;

    if (redisUrlString) {
      try {
        const parsed = new URL(redisUrlString);
        host = parsed.hostname || '127.0.0.1';
        port = parsed.port ? parseInt(parsed.port, 10) : 6379;
      } catch (err) {
        // Fallback to default host and port if URL parsing fails
      }
    }

    const socket = new net.Socket();
    socket.setTimeout(2000); // 2 second timeout

    socket.on('connect', () => {
      // Send standard Redis PING command
      socket.write('PING\r\n');
    });

    socket.on('data', (data) => {
      const response = data.toString().trim();
      socket.destroy();
      // Redis returns +PONG, or if password protected it might return -NOAUTH, which still means it is up and listening
      if (response.includes('PONG') || response.includes('NOAUTH') || response.includes('ERR')) {
        resolve({ ok: true, message: 'Redis is responsive' });
      } else {
        resolve({ ok: false, message: `Unexpected Redis PING response: ${response}` });
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, message: 'Redis connection timed out' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ ok: false, message: `Redis connection error: ${err.message}` });
    });
  });
};

router.get('/readiness', async (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  const redisResult = await checkRedisConnection(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

  if (mongoConnected && redisResult.ok) {
    return res.status(200).json({
      status: 'HEALTHY',
      mongodb: 'CONNECTED',
      redis: 'CONNECTED',
      timestamp: new Date()
    });
  } else {
    return res.status(503).json({
      status: 'UNHEALTHY',
      mongodb: mongoConnected ? 'CONNECTED' : 'DISCONNECTED',
      redis: redisResult.ok ? 'CONNECTED' : `DISCONNECTED: ${redisResult.message}`,
      timestamp: new Date()
    });
  }
});

export default router;
