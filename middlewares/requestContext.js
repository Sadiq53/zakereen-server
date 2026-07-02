const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

// The ALS instance that will hold request context across async boundaries
const requestContext = new AsyncLocalStorage();

/**
 * Middleware to generate a unique request ID and initialize the AsyncLocalStorage context.
 * Must be applied early in the middleware stack (before pino-http).
 */
const requestContextMiddleware = (req, res, next) => {
    // Generate a unique ID for request correlation
    const reqId = crypto.randomUUID();
    
    // Attach to the request object for easy access in controllers if needed
    req.id = reqId;

    // Run the rest of the request lifecycle within the context of this store
    requestContext.run(new Map([['reqId', reqId]]), () => {
        next();
    });
};

/**
 * Utility to get the current request ID from anywhere in the application.
 * @returns {string | undefined}
 */
const getRequestId = () => {
    const store = requestContext.getStore();
    return store ? store.get('reqId') : undefined;
};

/**
 * Utility to enrich the context dynamically (e.g. adding userId after auth middleware).
 * @param {string} key 
 * @param {any} value 
 */
const setContext = (key, value) => {
    const store = requestContext.getStore();
    if (store) {
        store.set(key, value);
    }
};

/**
 * Utility to get a context value.
 * @param {string} key 
 */
const getContext = (key) => {
    const store = requestContext.getStore();
    return store ? store.get(key) : undefined;
};

module.exports = {
    requestContextMiddleware,
    getRequestId,
    setContext,
    getContext
};
