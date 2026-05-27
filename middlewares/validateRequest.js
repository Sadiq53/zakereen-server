const AppError = require('../utils/AppError');

/**
 * Validates request data (body, query, params) against Zod schemas.
 * @param {Object} schemas - An object containing Zod schemas for body, query, and/or params.
 * @returns {Function} Express middleware function
 */
const validateRequest = (schemas) => (req, res, next) => {
    try {
        if (schemas.body) {
            req.body = schemas.body.parse(req.body);
        }
        if (schemas.query) {
            req.query = schemas.query.parse(req.query);
        }
        if (schemas.params) {
            req.params = schemas.params.parse(req.params);
        }
        next();
    } catch (error) {
        // Forward Zod errors to the global error handler
        next(error);
    }
};

module.exports = validateRequest;
