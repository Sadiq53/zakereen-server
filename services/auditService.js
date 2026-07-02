const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');

/**
 * Standardized audit logging service
 * 
 * @param {Object} actor - The user object of the person performing the action
 * @param {String} action - The action constant (e.g. 'PARTY_TRANSFERRED')
 * @param {String} resource - The resource type (e.g. 'USER', 'GROUP')
 * @param {ObjectId|String} resourceId - The ID of the affected resource
 * @param {Object} details - Additional metadata (e.g. { previous, current, reason })
 * @param {String} ip - Optional caller IP
 * @param {String} userAgent - Optional caller User-Agent
 * @param {mongoose.ClientSession} session - Optional MongoDB session for transactions
 */
exports.logAudit = async (actor, action, resource, resourceId, details = {}, ip = '', userAgent = '', session = null) => {
    try {
        const auditData = {
            tenantId: actor.tenantId || null,
            actor: actor._id || actor.id,
            action,
            resource,
            resourceId,
            details,
            ip,
            userAgent
        };

        const auditEntry = new AuditLog(auditData);

        if (session) {
            await auditEntry.save({ session });
        } else {
            await auditEntry.save();
        }
    } catch (error) {
        // We log the error but do not throw, as we don't want audit logging failure 
        // to crash the main transaction unless strictly required, though using a session
        // will naturally fail the transaction if save fails.
        logger.error("Failed to write audit log:", error);
        if (session) throw error;
    }
};
