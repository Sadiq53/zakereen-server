const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Unified Redis connection factory.
 * 
 * - cacheClient:  Used by cacheService for key-value caching (maxRetriesPerRequest: 3)
 * - bullClient:   Used by BullMQ queues/workers (maxRetriesPerRequest: null, required by BullMQ)
 * 
 * Both share the same REDIS_URL so they connect to the same Redis instance.
 */

let cacheClient;
let bullClient;

try {
    cacheClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    cacheClient.on('error', (err) => {
        console.error('Redis (cache) connection error:', err.message);
    });

    cacheClient.on('connect', () => {
        console.log('✅ Connected to Redis (cache)');
    });
} catch (error) {
    console.error('Failed to initialize Redis cache client:', error);
    cacheClient = null;
}

try {
    bullClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required by BullMQ
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    bullClient.on('error', (err) => {
        console.error('Redis (BullMQ) connection error:', err.message);
    });

    bullClient.on('connect', () => {
        console.log('✅ Connected to Redis (BullMQ)');
    });
} catch (error) {
    console.error('Failed to initialize Redis BullMQ client:', error);
    bullClient = null;
}

module.exports = { cacheClient, bullClient };
