const express = require('express')
const app = express();
const path = require('path')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const rateLimit = require('express-rate-limit')
const routes = require('./config/allRoutes')
const userClient = require('./models/users')

const { initializeSocket } = require("./config/socket");
const { seedRootAdmin } = require("./config/seedAdmin");
const { verifyToken } = require('./middlewares/auth');

// Trust proxy (required when behind ngrok, nginx, or any reverse proxy)
app.set('trust proxy', 1);

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes'
});

// Apply rate limiting to all requests
app.use(limiter);

// Security Headers
app.use(helmet());

// Compress response bodies
app.use(compression());

app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets')))
app.use(express.urlencoded({ extended : true }))
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allow required methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allow required headers
}));

app.get("/all", verifyToken, async (req, res) => {
    const user = await userClient.find()
    res.status(200).json(user)
})

app.use(routes)

// Remove legacy node-cron schedule jobs

const errorHandler = require('./middlewares/errorHandler');

// Global Error Handler
app.use(errorHandler);

const { initializeWorker } = require('./jobs/bullQueue');

const port = process.env.PORT || 8080
const server = app.listen(port, async () => {
    console.log(`Server is running on : ${port}`)
    await seedRootAdmin();
    
    // Initialize BullMQ background event worker
    initializeWorker();
    console.log(`BullMQ Worker initialized successfully`);
})

initializeSocket(server);

