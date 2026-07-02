const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');

// Store boot time
const BOOT_TIME = Date.now();

// Liveness check (very lightweight, 200 OK if Node loop is free)
// Used by orchestrators to determine if the container should be restarted
router.get('/liveness', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Readiness/Health check (verifies downstream dependencies)
// Used by load balancers to determine if traffic should be routed here
router.get('/', async (req, res) => {
    let isHealthy = true;
    
    // Memory usage converted to MB for readability
    const memoryUsage = process.memoryUsage();
    const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
    };

    const diagnostics = {
        uptimeSeconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
        memoryMB,
        database: 'UNKNOWN',
        cache: 'UNKNOWN'
    };

    // Check MongoDB connection state
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbState = mongoose.connection.readyState;
    if (dbState === 1) {
        diagnostics.database = 'CONNECTED';
    } else {
        diagnostics.database = `DISCONNECTED (${dbState})`;
        isHealthy = false;
    }

    // Check Redis connectivity with a simple PING
    try {
        const ping = await redisClient.ping();
        if (ping === 'PONG') {
            diagnostics.cache = 'CONNECTED';
        } else {
            diagnostics.cache = 'DEGRADED';
            isHealthy = false;
        }
    } catch (err) {
        diagnostics.cache = 'DISCONNECTED';
        isHealthy = false;
        logger.error({ err }, 'Redis health check failed');
    }

    if (isHealthy) {
        res.status(200).json({ status: 'HEALTHY', ...diagnostics });
    } else {
        res.status(503).json({ status: 'UNHEALTHY', ...diagnostics });
    }
});

module.exports = router;
