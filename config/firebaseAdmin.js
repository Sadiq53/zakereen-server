const admin = require('firebase-admin');
const serviceAccount = require("../firebase-adminsdk.json"); // Make sure the path is correct
const logger = require('../utils/logger');

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        logger.info("Firebase Admin Initialized successfully.");
    }
} catch (error) {
    logger.error("Firebase Admin Initialization Error:", error);
}

module.exports = admin;