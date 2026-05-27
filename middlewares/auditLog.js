const AuditLog = require('../models/auditLog');

/**
 * Middleware factory: logs actions to the immutable audit trail.
 *
 * Usage in routes:
 *   router.post('/tenants', verifyToken, auditAction('tenant.create', 'Tenant'), controller);
 *
 * The middleware wraps res.json to capture successful responses and
 * log the action asynchronously (fire-and-forget — never blocks the response).
 */
const auditAction = (action, resource) => {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);

        res.json = (data) => {
            // Only log on success responses
            if (res.statusCode < 400) {
                AuditLog.create({
                    tenantId: req.tenantId || null,
                    actor: req.user?._id,
                    action,
                    resource,
                    resourceId: req.params?.id || data?._id || null,
                    details: {
                        method: req.method,
                        path: req.originalUrl,
                        body: _sanitizeBody(req.body),
                    },
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || '',
                }).catch(err => console.error('Audit log write failed:', err));
            }

            return originalJson(data);
        };

        next();
    };
};

/**
 * Remove sensitive fields from the request body before logging.
 */
const _sanitizeBody = (body) => {
    if (!body || typeof body !== 'object') return null;
    const sanitized = { ...body };
    const sensitiveFields = ['userpass', 'password', 'token', 'secret'];
    for (const field of sensitiveFields) {
        if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
        }
    }
    return sanitized;
};

module.exports = { auditAction };
