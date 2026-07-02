const { cacheClient: redisClient } = require('../config/redis');

class CacheService {
    async get(key) {
        if (!redisClient) return null;
        try {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Redis GET error for key ${key}:`, error.message);
            return null;
        }
    }

    async set(key, data, ttlSeconds = 300) {
        if (!redisClient) return;
        try {
            await redisClient.setex(key, ttlSeconds, JSON.stringify(data));
        } catch (error) {
            console.error(`Redis SET error for key ${key}:`, error.message);
        }
    }

    /**
     * Deterministic cache invalidation for a tenant.
     * Deletes known cache keys by name instead of using SCAN.
     * 
     * IMPORTANT: If you add new cache keys in tenant/stats services,
     * add them to the TENANT_KEY_TEMPLATES array below.
     */
    async invalidateTenant(tenantId) {
        if (!redisClient || !tenantId) return;
        try {
            const keys = [
                `stats:tenant:v2:${tenantId}`,
                `miqaats:tenant:v1:${tenantId}:5`,
                `miqaats:tenant:v1:${tenantId}:10`,
                `miqaats:tenant:v1:${tenantId}:20`,
            ];
            await redisClient.del(...keys);
        } catch (error) {
            console.error(`Redis tenant invalidation error for ${tenantId}:`, error.message);
        }
    }

    /**
     * Deterministic global cache invalidation.
     * Deletes the known global stats cache key.
     */
    async invalidateGlobal() {
        if (!redisClient) return;
        try {
            await redisClient.del('stats:global:v2');
        } catch (error) {
            console.error(`Redis global invalidation error:`, error.message);
        }
    }
}

module.exports = new CacheService();
