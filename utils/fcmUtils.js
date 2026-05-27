const admin = require('../config/firebaseAdmin');

/**
 * Builds a robust and scalable data payload for FCM notifications.
 * @param {string} entityType - E.g., 'OCCASION', 'CHAT', 'SYSTEM'
 * @param {string} entityId - The ID of the related entity
 * @param {string} action - E.g., 'CREATED', 'UPDATED', 'DELETED', 'STARTED', 'REMINDER'
 * @param {object} additionalMetadata - Any extra data (will be stringified)
 * @returns {object} The formatted data payload (all values must be strings)
 */
function buildDataPayload(entityType, entityId, action, additionalMetadata = {}) {
    return {
        entityType: String(entityType),
        entityId: String(entityId),
        action: String(action),
        metadata: JSON.stringify(additionalMetadata)
    };
}

/**
 * Sends a push notification to a specific topic.
 * @param {string} topic - The FCM topic (e.g., 'occasions')
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} dataPayload - Scalable data payload
 */
async function sendTopicNotification(topic, title, body, dataPayload) {
    if (!admin.apps.length) return;
    try {
        const message = {
            topic,
            notification: { title, body },
            data: dataPayload
        };
        await admin.messaging().send(message);
        console.log(`FCM: Successfully sent topic notification to ${topic}`);
    } catch (error) {
        console.error(`FCM Error sending topic notification to ${topic}:`, error);
    }
}

/**
 * Sends a push notification to a specific list of device tokens.
 * @param {string[]} tokens - Array of FCM device tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} dataPayload - Scalable data payload
 */
async function sendMulticastNotification(tokens, title, body, dataPayload) {
    if (!admin.apps.length || !tokens || tokens.length === 0) return;
    try {
        const message = {
            tokens,
            notification: { title, body },
            data: dataPayload
        };
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`FCM: Successfully sent multicast notification. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);
        
        // Handle failed tokens (e.g., expired tokens)
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                }
            });
            console.log('FCM: Failed tokens:', failedTokens);
            // In a production app, you might want to remove these failedTokens from the database
        }
    } catch (error) {
        console.error('FCM Error sending multicast notification:', error);
    }
}

// ─── Notification Templates Registry ────────────────────────────────────────────
// Centralized mapping of event types to notification content generators.
// Future admin panel can toggle these on/off or customize the messages.
const NOTIFICATION_TEMPLATES = {
    OCCASION_CREATED: {
        title: () => '📢 New Miqaat Announced!',
        body: (occasion) => `${occasion.name} has been scheduled. Open the app to view details.`,
        action: 'CREATED',
        channel: 'topic',       // 'topic' or 'multicast'
        topic: 'occasions',
    },
    OCCASION_STARTED: {
        title: () => '🕌 Miqaat Has Started!',
        body: (occasion) => `${occasion.name} is now live. Please mark your attendance.`,
        action: 'STARTED',
        channel: 'topic',
        topic: 'occasions',
    },
    ATTENDANCE_REMINDER: {
        title: () => '⏰ Last Chance — Mark Attendance!',
        body: (occasion) => `${occasion.name} ends soon. Don't miss your last chance to mark attendance.`,
        action: 'REMINDER',
        channel: 'multicast',   // Targeted to specific user tokens
        topic: null,
    },
};

/**
 * Centralized notification dispatch function.
 * Controllers and cron jobs call this single entry point — they never deal with
 * formatting, topics, or token logic directly.
 *
 * @param {string} eventType - Key from NOTIFICATION_TEMPLATES (e.g., 'OCCASION_CREATED')
 * @param {object} occasion - The occasion document
 * @param {object} [options] - Additional options
 * @param {string[]} [options.tokens] - FCM tokens (required for multicast channel)
 */
async function dispatchNotification(eventType, occasion, options = {}) {
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template) {
        console.error(`FCM: Unknown notification event type: ${eventType}`);
        return;
    }

    const title = template.title(occasion);
    const body = template.body(occasion);
    const dataPayload = buildDataPayload('OCCASION', occasion._id, template.action, {
        name: occasion.name,
    });

    try {
        if (template.channel === 'topic') {
            await sendTopicNotification(template.topic, title, body, dataPayload);
        } else if (template.channel === 'multicast') {
            const tokens = options.tokens || [];
            if (tokens.length === 0) {
                console.log(`FCM: No tokens provided for ${eventType}, skipping.`);
                return;
            }
            await sendMulticastNotification(tokens, title, body, dataPayload);
        }
        console.log(`FCM: Dispatched ${eventType} for occasion "${occasion.name}"`);
    } catch (error) {
        console.error(`FCM: Failed to dispatch ${eventType}:`, error);
    }
}

module.exports = {
    buildDataPayload,
    sendTopicNotification,
    sendMulticastNotification,
    dispatchNotification,
    NOTIFICATION_TEMPLATES,
};

