const cacheService = require('../services/cacheService');
const logger = require('./logger');

/**
 * Mongoose Plugin to automatically invalidate Redis caches when data mutates.
 */
module.exports = function cacheBusterPlugin(schema, options) {
    const bustCache = async (doc, next) => {
        if (!doc) {
            if (next) return next();
            return;
        }
        
        try {
            const docs = Array.isArray(doc) ? doc : [doc];
            for (const d of docs) {
                if (d.tenantId) {
                    await cacheService.invalidateTenant(d.tenantId.toString());
                }
            }
            // Always bust global cache since it aggregates across tenants
            await cacheService.invalidateGlobal();
        } catch (error) {
            logger.error('[CacheBuster] Error busting cache via document:', error);
        }
        if (next) next();
    };

    // Document Middleware
    schema.post('save', bustCache);
    schema.post('remove', bustCache);
    schema.post('insertMany', bustCache);
    
    // Query Middleware (returns modified document)
    schema.post('findOneAndUpdate', bustCache);
    schema.post('findOneAndDelete', bustCache);
    schema.post('findOneAndReplace', bustCache);
    
    // Query Middleware (returns operation result, doc not accessible)
    const handleQueryBust = async function(res, next) {
        try {
            const filter = this.getFilter();
            if (filter && filter.tenantId) {
                // If the query filter contains a tenantId, invalidate that tenant
                await cacheService.invalidateTenant(filter.tenantId.toString());
            } else {
                // If it's an update by _id, we might not have tenantId. 
                // We could pre-fetch it, but busting global is a safe minimum.
            }
            await cacheService.invalidateGlobal();
        } catch (error) {
            logger.error('[CacheBuster] Error busting cache via query:', error);
        }
        if (next) next();
    };

    schema.post('updateOne', handleQueryBust);
    schema.post('updateMany', handleQueryBust);
    schema.post('deleteOne', handleQueryBust);
    schema.post('deleteMany', handleQueryBust);
};
