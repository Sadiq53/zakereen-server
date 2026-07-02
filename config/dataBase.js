const mongoose = require("mongoose");
const logger = require("../utils/logger");
require('dotenv').config();

const {
    MONGODB_USERNAME,
    MONGODB_PASSWORD,
    MONGODB_CLUSTER,
    MONGODB_DATABASE,
} = process.env;

mongoose.connect(
    `mongodb+srv://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@${MONGODB_CLUSTER}/${MONGODB_DATABASE}`
);

mongoose.connection.on("connected", () => {
    logger.info("✅ Database connected...");
});

mongoose.connection.on("error", (err) => {
    logger.error("❌ Database connection error:", err);
});

module.exports = mongoose;
