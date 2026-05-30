const redisClient = require('../config/redis');

class CacheService {
    async get(key) {
        if (!redisClient) return null;
        try {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Redis GET error for key ${key}:`, error);
            return null;
        }
    }

    async set(key, data, ttlSeconds = 300) {
        if (!redisClient) return;
        try {
            await redisClient.setex(key, ttlSeconds, JSON.stringify(data));
        } catch (error) {
            console.error(`Redis SET error for key ${key}:`, error);
        }
    }

    async invalidatePattern(pattern) {
        if (!redisClient) return;
        try {
            let cursor = '0';
            const keysToDelete = [];
            do {
                const [newCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = newCursor;
                if (keys.length > 0) {
                    keysToDelete.push(...keys);
                }
            } while (cursor !== '0');

            if (keysToDelete.length > 0) {
                await redisClient.del(...keysToDelete);
                console.log(`[CacheService] Invalidated ${keysToDelete.length} keys matching pattern: ${pattern}`);
            }
        } catch (error) {
            console.error(`Redis pattern invalidation error for ${pattern}:`, error);
        }
    }

    async invalidateTenant(tenantId) {
        if (!tenantId) return;
        console.log(`[CacheService] Busting cache for tenant: ${tenantId}`);
        // Invalidate tenant stats
        await this.invalidatePattern(`stats:tenant:*:${tenantId}*`);
        // Invalidate miqaat lists
        await this.invalidatePattern(`miqaats:tenant:*:${tenantId}*`);
    }

    async invalidateGlobal() {
        console.log(`[CacheService] Busting global cache`);
        await this.invalidatePattern(`stats:global:*`);
    }
}

module.exports = new CacheService();
