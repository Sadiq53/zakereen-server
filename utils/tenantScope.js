/**
 * ── Tenant Scoping Utilities ────────────────────────────────────────────────
 *
 * Centralised, single-source-of-truth helpers for multi-tenant query building.
 *
 * EVERY service that needs to filter by tenant MUST use these functions instead
 * of writing inline ternaries. This guarantees:
 *
 *   1. rootadmin (tenantId = null) never accidentally queries { tenantId: null }
 *   2. Aggregation pipelines never crash with ObjectId(null)
 *   3. New services get correct scoping by default
 *   4. Adding new admin roles requires zero service-layer changes
 *
 * Usage examples:
 *   const { tenantQuery, tenantMatch, resolveWriteTenant } = require('../utils/tenantScope');
 *
 *   // .find() / .countDocuments()
 *   Model.find(tenantQuery(tenantId));
 *   Model.find(tenantQuery(tenantId, { status: 'active' }));
 *
 *   // Aggregation $match stage
 *   pipeline.push({ $match: tenantMatch(tenantId) });
 *   pipeline.push({ $match: tenantMatch(tenantId, { status: 'ended' }) });
 *
 *   // Write operations (controllers only)
 *   const tid = resolveWriteTenant(req);
 */

const mongoose = require('mongoose');

/**
 * Build a Mongoose filter object for tenant-scoped queries (.find, .findOne, .countDocuments).
 *
 * When tenantId is truthy  → { tenantId, ...extra }
 * When tenantId is falsy   → { ...extra }  (cross-tenant / global)
 *
 * @param {string|null|undefined} tenantId - The tenant ID from req.tenantId
 * @param {Object} [extra={}] - Additional filter conditions to merge
 * @returns {Object} A Mongoose query filter — safe for any tenantId value
 */
const tenantQuery = (tenantId, extra = {}) => {
    if (tenantId) {
        return { tenantId, ...extra };
    }
    return { ...extra };
};

/**
 * Build a $match stage filter for aggregation pipelines.
 *
 * Handles ObjectId conversion safely — when tenantId is null/undefined,
 * the tenantId condition is omitted entirely (no crash, no silent miss).
 *
 * @param {string|null|undefined} tenantId - The tenant ID from req.tenantId
 * @param {Object} [extra={}] - Additional $match conditions
 * @returns {Object} A $match-compatible filter object
 */
const tenantMatch = (tenantId, extra = {}) => {
    if (tenantId) {
        return { tenantId: new mongoose.Types.ObjectId(tenantId), ...extra };
    }
    return { ...extra };
};

/**
 * Resolve the effective tenant ID for WRITE operations (create, update).
 *
 * Priority chain for rootadmin:
 *   1. req.body.tenantId   — explicit tenant target from the request payload
 *   2. req.tenantId        — from X-Tenant-Id header (set by resolveTenant middleware)
 *   3. req.userTenantId    — the rootadmin's own tenant (fallback)
 *
 * For all other roles: always returns req.tenantId (middleware-resolved, guaranteed non-null).
 *
 * @param {Object} req - Express request object (must have passed resolveTenant middleware)
 * @returns {string|null} The tenant ID to use for the write operation
 */
const resolveWriteTenant = (req) => {
    if (req.isRootAdmin) {
        return req.body?.tenantId || req.tenantId || req.userTenantId || null;
    }
    return req.tenantId;
};

module.exports = { tenantQuery, tenantMatch, resolveWriteTenant };
