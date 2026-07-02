const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;
    error.statusCode = err.statusCode || 500;

    // Use structured logger instead of console.error
    if (error.statusCode >= 500) {
        logger.error({ err }, 'Critical Internal Server Error');
    } else {
        logger.warn({ err: { message: err.message, name: err.name, statusCode: error.statusCode } }, 'Operational Error');
    }

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = `Resource not found. Invalid: ${err.path}`;
        error = new AppError(message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const value = err.errmsg ? err.errmsg.match(/(["'])(\\?.)*?\1/)[0] : 'Value';
        const message = `Duplicate field value: ${value}. Please use another value!`;
        error = new AppError(message, 400);
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map((val) => val.message);
        const message = `Invalid input data. ${errors.join('. ')}`;
        error = new AppError(message, 400);
    }

    // Zod validation error
    if (err.name === 'ZodError') {
        const issues = err.issues || JSON.parse(err.message);
        const errors = issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        const message = `Validation Error: ${errors.join(', ')}`;
        error = new AppError(message, 400);
    }

    // JWT Errors
    if (err.name === 'JsonWebTokenError') {
        error = new AppError('Invalid token. Please log in again.', 401);
    }

    if (err.name === 'TokenExpiredError') {
        error = new AppError('Your token has expired! Please log in again.', 401);
    }

    res.status(error.statusCode).json({
        success: false,
        error: error.message || 'Internal Server Error'
    });
};

module.exports = errorHandler;
