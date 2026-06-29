import AuditLog from '../models/AuditLog.js';

/**
 * Records a platform or store-level operational event in the audit ledger
 * and broadcasts it live to the SuperAdmin's audit console via Socket.IO.
 *
 * @param {string|null} storeId  - Store/Tenant ID, or null for platform-global events
 * @param {string}      userId   - User/Operator MongoDB ID
 * @param {string}      userName - User/Operator display name
 * @param {string}      action   - Action identifier (e.g. ORDER_STATUS_UPDATE, SECURITY_BREACH)
 * @param {string}      details  - Human-readable state-change description
 * @param {object}      [options]
 * @param {string}      [options.scope='store']      - 'store' or 'platform'
 * @param {string}      [options.ipAddress='']       - Source IP for security events
 * @param {string}      [options.targetModel='']     - DB model targeted (breach context)
 */
export const logActivity = async (storeId, userId, userName, action, details, options = {}) => {
  try {
    const { scope = 'store', ipAddress = '', targetModel = '' } = options;

    const log = await AuditLog.create({
      storeId: storeId || null,
      userId,
      userName,
      action,
      details,
      scope,
      ipAddress,
      targetModel,
      timestamp: new Date(),
    });

    console.log(`[Audit Logger] ${log.userName} (${log.action}): ${log.details}`);

    // If the audit action is security-sensitive, vendor-related, or product-modifying, email the SuperAdmins
    const isSensitive = 
      action.includes('SECURITY') || 
      action.includes('FRAUD') || 
      action === 'VENDOR_REGISTER' || 
      action === 'STORE_CREATE' || 
      action === 'PRODUCT_UPDATE' || 
      action === 'PRODUCT_DELETE' || 
      action === 'PRODUCT_CREATE';

    if (isSensitive) {
      try {
        const { dispatchNotification } = await import('./notificationService.js');
        dispatchNotification('SYSTEM_AUDIT', {
          type: action,
          description: details,
          meta: {
            operator: userName,
            operatorId: userId?.toString() || 'System',
            ipAddress: ipAddress || 'N/A',
            scope,
            targetModel: targetModel || 'N/A',
            timestamp: log.timestamp.toISOString()
          }
        });
      } catch (notifErr) {
        console.error('[Audit Logger Notification Error] Failed to dispatch system audit email:', notifErr.message);
      }
    }

    // Broadcast live entry to SuperAdmin audit terminal
    if (global.io) {
      global.io.to('admin:audit').emit('audit_log_entry', {
        _id:         log._id,
        action:      log.action,
        userName:    log.userName,
        details:     log.details,
        scope:       log.scope,
        ipAddress:   log.ipAddress,
        targetModel: log.targetModel,
        storeId:     log.storeId,
        timestamp:   log.timestamp,
      });
    }

    return log;
  } catch (error) {
    console.error('[Audit Logger Error] Failed to write log entry:', error.message);
  }
};
