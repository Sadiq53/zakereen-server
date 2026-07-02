const pino = require('pino');
const { getRequestId, getContext } = require('../middlewares/requestContext');

// Determine if we are in production
const isProd = process.env.NODE_ENV === 'production';

// Pino redaction rules to prevent sensitive data leakage
const redactPaths = [
    'req.headers.authorization',
    'req.headers.cookie',
    'body.password',
    'body.userpass',
    'body.token',
    'body.refreshToken',
    'res.headers["set-cookie"]'
];

/**
 * Mixin function is called every time a log is written.
 * This dynamically injects the correlation ID (reqId), user ID, and tenant ID
 * from AsyncLocalStorage without needing to pass the `req` object everywhere.
 */
const dynamicContextMixin = () => {
    const context = {};
    const reqId = getRequestId();
    if (reqId) context.reqId = reqId;
    
    const userId = getContext('userId');
    if (userId) context.userId = userId;

    const tenantId = getContext('tenantId');
    if (tenantId) context.tenantId = tenantId;

    return context;
};

// Logger configuration
const loggerConfig = {
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    redact: redactPaths,
    mixin: dynamicContextMixin,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level: (label) => {
            return { level: label.toUpperCase() };
        },
    },
};

// In development, use pino-pretty for human-readable logs.
// In production, emit raw JSON for high-performance machine parsing.
if (!isProd) {
    loggerConfig.transport = {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            singleLine: false,
        }
    };
}

const logger = pino(loggerConfig);

module.exports = logger;
