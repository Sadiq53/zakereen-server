const userClient = require('../models/users');
const logger = require('./logger');

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
 * Fetches all FCM tokens for users belonging to a specific tenant.
 * Optionally excludes a specific user (e.g., the creator of the event).
 * @param {string} tenantId - The tenant ObjectId
 * @param {string|null} excludeUserId - A userId to exclude from the token list
 * @returns {Promise<string[]>} Array of FCM device tokens
 */
async function getTenantTokens(tenantId, excludeUserId = null) {
    const query = {
        tenantId,
        fcmTokens: { $exists: true, $ne: [] }
    };

    if (excludeUserId) {
        query._id = { $ne: excludeUserId };
    }

    const users = await userClient.find(query, { fcmTokens: 1 }).lean();
    const tokens = [];
    for (const user of users) {
        tokens.push(...user.fcmTokens);
    }
    return tokens;
}

/**
 * Sends a push notification to a specific list of device tokens.
 * Includes Android-specific high-priority config and notification channel
 * to ensure heads-up display and background delivery.
 * @param {string[]} tokens - Array of FCM device tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} dataPayload - Scalable data payload
 */
async function sendMulticastNotification(rawTokens, title, body, dataPayload) {
    const admin = require('../config/firebaseAdmin');
    if (!admin || !admin.apps.length || !rawTokens || rawTokens.length === 0) return;

    // Deduplicate tokens to prevent multiple notifications to the same device
    const tokens = [...new Set(rawTokens)];

    // FCM has a 500 token limit per multicast call — batch if needed
    const BATCH_SIZE = 500;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        try {
            const message = {
                tokens: batch,
                notification: { title, body },
                data: dataPayload,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'zakereen_default',
                        priority: 'max',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            alert: { title, body },
                            sound: 'default',
                            badge: 1,
                            'content-available': 1,
                        }
                    },
                    headers: {
                        'apns-priority': '10',
                    }
                }
            };
            const response = await admin.messaging().sendEachForMulticast(message);
            logger.info(`FCM: Batch ${Math.floor(i / BATCH_SIZE) + 1} — Success: ${response.successCount}, Failure: ${response.failureCount}`);

            // Log and clean up failed tokens
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(batch[idx]);
                        logger.error(`FCM token failure:`, resp.error?.code, resp.error?.message);
                    }
                });
                // Remove invalid tokens from the database
                if (failedTokens.length > 0) {
                    await userClient.updateMany(
                        { fcmTokens: { $in: failedTokens } },
                        { $pullAll: { fcmTokens: failedTokens } }
                    );
                    logger.info(`FCM: Cleaned up ${failedTokens.length} invalid tokens from DB.`);
                }
            }
        } catch (error) {
            logger.error('FCM Error sending multicast notification:', error);
        }
    }
}

// ─── Notification Templates Registry ────────────────────────────────────────────
// Centralized mapping of event types to notification content generators.
const NOTIFICATION_TEMPLATES = {
    OCCASION_CREATED: {
        title: () => '📢 New Miqaat Announced!',
        body: (occasion) => `${occasion.name} has been scheduled. Open the app to view details.`,
        action: 'CREATED',
    },
    OCCASION_STARTED: {
        title: () => '🕌 Miqaat Has Started!',
        body: (occasion) => `${occasion.name} is now live. Please mark your attendance.`,
        action: 'STARTED',
    },
    ATTENDANCE_REMINDER: {
        title: () => '⏰ Last Chance — Mark Attendance!',
        body: (occasion) => `${occasion.name} ends soon. Don't miss your last chance to mark attendance.`,
        action: 'REMINDER',
    },
};

/**
 * Centralized notification dispatch function.
 * All notifications are now tenant-scoped multicast — no more global topics.
 *
 * @param {string} eventType - Key from NOTIFICATION_TEMPLATES
 * @param {object} occasion - The occasion document (must have tenantId)
 * @param {object} [options] - Additional options
 * @param {string|null} [options.excludeUserId] - User ID to exclude (e.g., creator)
 * @param {string[]} [options.tokens] - Explicit token list (overrides tenant lookup)
 */
async function dispatchNotification(eventType, occasion, options = {}) {
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template) {
        logger.error(`FCM: Unknown notification event type: ${eventType}`);
        return;
    }

    const title = template.title(occasion);
    const body = template.body(occasion);
    const dataPayload = buildDataPayload('OCCASION', occasion._id, template.action, {
        name: occasion.name,
        creatorId: occasion.created_by ? String(occasion.created_by) : '',
    });

    try {
        let tokens = options.tokens || [];

        // If no explicit tokens provided, fetch all tokens for this tenant
        if (tokens.length === 0 && occasion.tenantId) {
            tokens = await getTenantTokens(occasion.tenantId, options.excludeUserId || null);
        }

        if (tokens.length === 0) {
            logger.info(`FCM: No tokens found for ${eventType}, skipping.`);
            return;
        }

        await sendMulticastNotification(tokens, title, body, dataPayload);
        logger.info(`FCM: Dispatched ${eventType} for occasion "${occasion.name}" to ${tokens.length} tokens`);
    } catch (error) {
        logger.error(`FCM: Failed to dispatch ${eventType}:`, error);
    }
}

module.exports = {
    buildDataPayload,
    getTenantTokens,
    sendMulticastNotification,
    dispatchNotification,
    NOTIFICATION_TEMPLATES,
};
