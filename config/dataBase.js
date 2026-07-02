const mongoose = require("mongoose");
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
    console.log("✅ Database connected...");
});

mongoose.connection.on("error", (err) => {
    console.error("❌ Database connection error:", err);
});

module.exports = mongoose;
