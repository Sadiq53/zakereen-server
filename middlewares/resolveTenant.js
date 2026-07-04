const Tenant = require('../models/tenant');
const AppError = require('../utils/AppError');

/**
 * Middleware: Resolves tenant context from JWT claims.
 *
 * - rootadmin: tenantId is optional (can specify via X-Tenant-Id header or query param)
 * - All other roles: tenantId is mandatory from JWT; verified against active tenant
 *
 * Sets:
 *   req.tenantId  — ObjectId string of the resolved tenant
 *   req.isRootAdmin — boolean
 */
const resolveTenant = async (req, res, next) => {
    const user = req.user;

    if (!user) {
        throw new AppError('Authentication required before tenant resolution.', 401);
    }

    // Root admin operates globally or on specific tenants
    if (user.role === 'rootadmin') {
        // Root admin can optionally target a specific tenant via header or query
        let targetTenantId = req.headers['x-tenant-id'] || req.query.tenantId || null;
        let isCrossTenant = false;

        // "global" or "all" keyword explicitly requests cross-tenant view
        if (targetTenantId === 'global' || targetTenantId === 'all') {
            targetTenantId = null;
            isCrossTenant = true;
        } else if (!targetTenantId) {
            // Default to their own tenant if no explicit scope is given (for mobile app)
            targetTenantId = user.tenantId || null;
            // Only cross-tenant if they don't even have their own tenant
            isCrossTenant = targetTenantId === null; 
        }

        if (targetTenantId) {
            const tenant = await Tenant.findById(targetTenantId).lean();
            if (!tenant || tenant.status === 'deleted') {
                throw new AppError('Target tenant not found.', 404);
            }
        }

        req.tenantId = targetTenantId;
        req.userTenantId = user.tenantId || null;
        req.isRootAdmin = true;
        req.isCrossTenant = isCrossTenant;
        return next();
    }

    // All other roles must have a tenantId
    const tenantId = user.tenantId;

    if (!tenantId) {
        throw new AppError('User is not associated with any tenant.', 403);
    }

    // Verify the tenant is active
    const tenant = await Tenant.findById(tenantId).lean();

    if (!tenant) {
        throw new AppError('Tenant not found.', 404);
    }

    if (tenant.status === 'suspended') {
        throw new AppError('Your organization has been suspended. Please contact support.', 403);
    }

    if (tenant.status !== 'active') {
        throw new AppError('Your organization is not currently active.', 403);
    }

    req.tenantId = tenantId.toString();
    req.isRootAdmin = false;
    next();
};

module.exports = { resolveTenant };
