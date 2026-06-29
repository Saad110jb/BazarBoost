import Product from '../models/Product.js';
import { logActivity } from '../services/auditService.js';

/**
 * Tenant Isolation Middleware
 * Formulates the step-by-step logic checks a request must pass through.
 * Explicitly checks user token scopes against resource tenant boundaries before mutations.
 */
export const verifyTenantAccess = async (req, res, next) => {
  try {
    // 1. Platform Admins bypass tenant isolation checks (GLOBAL token scope)
    if (req.user && (req.user.role === 'admin' || req.user.tenantStores?.includes('GLOBAL'))) {
      return next();
    }

    // 2. Identify the store context for the request
    let storeId = req.params.storeId || req.query.storeId || req.body.storeId;

    // 3. If there is a productId / id in params, look up the product to find its store
    const productId = req.params.productId || req.params.id;
    
    // Check if the current route handles products and has a potential product ID
    if (!storeId && productId && (req.baseUrl.includes('products') || req.path.includes('products'))) {
      try {
        const product = await Product.findById(productId);
        if (product) {
          storeId = product.storeId.toString();
          // Attach loaded product to request to save database lookups downstream
          req.loadedProduct = product;
        }
      } catch (err) {
        // ID might not be a valid ObjectId, ignore and fall back
      }
    }

    // 4. If no storeId is found, fall back to req.user.activeStoreId
    if (!storeId) {
      if (req.user && req.user.activeStoreId) {
        storeId = req.user.activeStoreId;
      } else {
        return res.status(400).json({ success: false, message: 'Store context is required' });
      }
    }

    // ── Helper: fire breach alarm ───────────────────────────────────────────────
    const fireBreachAlarm = async (reason) => {
      const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      const targetModel = req.baseUrl.includes('products') ? 'Product'
        : req.baseUrl.includes('orders') ? 'Order'
        : req.baseUrl.includes('ads') ? 'AdBid'
        : 'Unknown';

      const breachPayload = {
        userId:        req.user?._id?.toString() || 'Unknown',
        userName:      req.user?.name || 'Unknown User',
        userRole:      req.user?.role || 'Unknown',
        targetStoreId: storeId?.toString() || 'Unknown',
        targetModel,
        ipAddress,
        reason,
        blockedAt:     new Date(),
      };

      // Emit real-time neon alarm to SuperAdmin security desk
      if (global.io) {
        global.io.to('admin:security').emit('security_breach_alert', breachPayload);
      }

      // Persist a platform-scope audit log
      if (req.user?._id) {
        await logActivity(
          null,
          req.user._id,
          req.user.name || 'Unknown User',
          'SECURITY_BREACH',
          `Tenant boundary violation attempt: ${reason}. Target store: ${storeId}. Model: ${targetModel}. IP: ${ipAddress}`,
          { scope: 'platform', ipAddress, targetModel }
        );
      }
    };

    // 5. Verify the storeId is inside the user's authorized tenantStores array
    if (!req.user || !req.user.tenantStores || !req.user.tenantStores.includes(storeId.toString())) {
      await fireBreachAlarm('User does not have authorization for this store tenant');
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not have authorization for this store tenant'
      });
    }

    // 6. Inspect the token's activeStoreId and reject requests where context store ID deviates from token scope
    if (req.user && req.user.activeStoreId && storeId.toString() !== req.user.activeStoreId.toString()) {
      await fireBreachAlarm('Store context does not match active session store scope');
      return res.status(403).json({
        success: false,
        message: 'Access denied: Store context does not match active session store'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Require specific permission for a route (bypassed by admin and vendor roles)
 * @param {string} permissionName - The required permission string (e.g. 'EDIT_INVENTORY')
 */
export const requirePermission = (permissionName) => {
  return (req, res, next) => {
    // 1. Platform Admins bypass permission checks
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    // 2. Vendors bypass granular storeAdmin permissions as they are owners
    if (req.user && req.user.role === 'vendor') {
      return next();
    }

    // 3. Verify storeAdmin has the required permission
    if (!req.user || !req.user.permissionsArray || !req.user.permissionsArray.includes(permissionName)) {
      return res.status(403).json({
        success: false,
        message: `Access denied: You do not have the required permission (${permissionName})`
      });
    }

    next();
  };
};
