// ── Boot-time validation (must be first) ─────────────────────────────────────
require('dotenv').config();
// const validateEnv = require('./config/validateEnv');
// validateEnv();
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express')
const app = express();
const path = require('path')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const rateLimit = require('express-rate-limit')
const routes = require('./config/allRoutes')

const { initializeSocket } = require("./config/socket");
const { seedRootAdmin } = require("./config/seedAdmin");


const { requestContextMiddleware } = require('./middlewares/requestContext');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');

// Trust proxy (required when behind ngrok, nginx, or any reverse proxy)
app.set('trust proxy', 1);

// Initialize Request Context (AsyncLocalStorage)
app.use(requestContextMiddleware);

// Initialize HTTP request logging
app.use(pinoHttp({
    logger,
    autoLogging: {
        ignore: (req) => req.url === '/api/v1/health'
    },
    customLogLevel: function (req, res, err) {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    customSuccessMessage: function (req, res) {
        return `${req.method} ${req.url} completed with status ${res.statusCode}`;
    },
}));

// Disable ETags to prevent React Native 304 empty body bug
app.set('etag', false);

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 300, // Limit each IP to 300 requests per 5 minutes globally
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 5 minutes'
});

const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // Limit each IP to 10 login requests per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many login attempts from this IP, please try again after 5 minutes'
});

// Apply rate limiting
app.use('/api/v1/auth/login', loginLimiter);
app.use(limiter);

// Security Headers
app.use(helmet());

// Compress response bodies
app.use(compression());

app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets')))
app.use(express.urlencoded({ extended : true }))
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001'];
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
    credentials: true
}));

app.use(routes)

// Remove legacy node-cron schedule jobs

const errorHandler = require('./middlewares/errorHandler');

// Global Error Handler
app.use(errorHandler);

const { initializeWorker, sweepStaleOccasions } = require('./jobs/bullQueue');

const port = process.env.PORT || 8080
const server = app.listen(port, async () => {
    console.log(`Server is running on : ${port}`)
    await seedRootAdmin();
    
    // Initialize BullMQ background event worker
    initializeWorker();
    console.log(`BullMQ Worker initialized successfully`);

    // Sweep stale occasions that missed their end jobs (e.g. server was down)
    await sweepStaleOccasions();
})

initializeSocket(server);

