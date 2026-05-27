const AppError = require('../utils/AppError');

/**
 * Middleware factory: restricts access to the specified roles.
 *
 * Usage:
 *   authorize('rootadmin')                              — Root admin only
 *   authorize('rootadmin', 'superadmin')                — Root admin or tenant coordinator
 *   authorize('rootadmin', 'superadmin', 'admin')       — Any admin level
 *
 * Must be used AFTER verifyToken (req.user must exist).
 */
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new AppError('Authentication required.', 401);
        }

        if (!allowedRoles.includes(req.user.role)) {
            throw new AppError('Insufficient permissions for this action.', 403);
        }

        next();
    };
};

// Pre-built guards for common patterns
const requireRootAdmin = authorize('rootadmin');
const requireAdmin = authorize('rootadmin', 'superadmin', 'admin');
const requireGroupAdmin = authorize('rootadmin', 'superadmin', 'admin', 'groupadmin');

module.exports = {
    authorize,
    requireRootAdmin,
    requireAdmin,
    requireGroupAdmin,
};
