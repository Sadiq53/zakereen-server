const admin = require('firebase-admin');
const serviceAccount = require("../firebase-adminsdk.json"); // Make sure the path is correct

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized successfully.");
    }
} catch (error) {
    console.error("Firebase Admin Initialization Error:", error);
}

module.exports = admin;