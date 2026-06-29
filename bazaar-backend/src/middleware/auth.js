import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import AdminSession from '../models/AdminSession.js';

/**
 * Protect routes - checks for JWT token in Authorization header
 */
export const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'bazaarboost_secret_key_2026_local');

      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }

      if (decoded.role) {
        req.user.role = decoded.role;
      }

      // Check AdminSession for SuperAdmin to prevent session hijacking & concurrent login bypass
      if (req.user.role === 'admin') {
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const session = await AdminSession.findOne({ adminId: req.user._id, token });
        if (!session || session.ipAddress !== ipAddress) {
          return res.status(401).json({ success: false, message: 'Session invalid or expired' });
        }
      }
      
      // Instant Account Suspension Enforcement
      if (req.user.status !== 'active') {
        return res.status(401).json({ success: false, message: 'Account suspended' });
      }

      // First-time Activation & Force Reset check (Hydration Block)
      const pathClean = (req.originalUrl || '').split('?')[0];
      if (decoded.isTempPassword && pathClean !== '/api/auth/profile/setup-password') {
        return res.status(403).json({
          success: false,
          message: 'First-time password reset required. Access blocked.',
          passwordResetRequired: true
        });
      }

      // Populate tenant isolation properties directly from the token state
      req.user.tenantStores = decoded.tenantStores || [];
      req.user.activeStoreId = decoded.activeStoreId || null;
      req.user.permissionsArray = decoded.permissions || [];
      next();
    } catch (error) {
      console.error('JWT Verification Error:', error.message);
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }
};

/**
 * Restrict routes to specific user roles
 * @param {...string} roles - List of allowed roles ('shopper', 'vendor', 'admin')
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role (${req.user?.role || 'Guest'}) is not authorized to access this resource`
      });
    }
    next();
  };
};
