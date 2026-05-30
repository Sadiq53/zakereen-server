const Redis = require('ioredis');

// Default to localhost if no env variable is provided
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let redisClient;

try {
    redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    redisClient.on('error', (err) => {
        console.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
        console.log('Connected to Redis for caching');
    });
} catch (error) {
    console.error('Failed to initialize Redis client', error);
}

module.exports = redisClient;
