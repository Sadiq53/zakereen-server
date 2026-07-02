const AnnouncementGroup = require('../models/announcementGroup');
const User = require('../models/users');
const { sendMulticastNotification, buildDataPayload } = require('../utils/fcmUtils');
const mongoose = require('mongoose');

/**
 * Sends push notifications for new announcement messages.
 * Called as a BullMQ worker job — runs entirely in the background.
 * 
 * Strategy by group type:
 *   - global_jamiat: Notify ALL users (except sender)
 *   - tenant_jamaat: Notify all users in that tenant (except sender)
 *   - custom: Notify only group.members (except sender)
 * 
 * Batches tokens in chunks of 500 (handled by sendMulticastNotification).
 */
async function processAnnouncementNotification(job) {
    const { groupId, senderId, senderName, content, mediaType, pollQuestion, groupName } = job.data;

    try {
        const group = await AnnouncementGroup.findById(groupId).lean();
        if (!group) {
            console.warn(`[Announcement Push] Group not found: ${groupId}`);
            return;
        }

        // Build the user query based on group type
        const senderObjectId = new mongoose.Types.ObjectId(senderId);
        let query = {
            _id: { $ne: senderObjectId },
            fcmTokens: { $exists: true, $ne: [] }
        };

        if (group.type === 'tenant_jamaat' && group.tenantId) {
            // Only users in the same tenant
            query.tenantId = group.tenantId;
        } else if (group.type === 'custom' && group.members && group.members.length > 0) {
            // Only explicit group members
            query._id = { $ne: senderObjectId, $in: group.members };
        }
        // For 'global_jamiat', we don't restrict by tenant — all users get notified

        // Fetch only FCM tokens (lean, projection-only query for speed)
        const users = await User.find(query, { fcmTokens: 1 }).lean();
        const tokens = [];
        for (const user of users) {
            tokens.push(...user.fcmTokens);
        }

        if (tokens.length === 0) {
            console.log(`[Announcement Push] No tokens found for group "${groupName}", skipping.`);
            return;
        }

        // Construct notification content (WhatsApp-style preview)
        const title = groupName;
        let body = '';
        if (content && content.trim().length > 0) {
            body = `${senderName}: ${content.substring(0, 200)}`;
        } else if (pollQuestion) {
            body = `${senderName}: Poll — ${pollQuestion.substring(0, 150)}`;
        } else if (mediaType) {
            const mediaLabels = { image: 'Photo', video: 'Video', pdf: 'PDF', document: 'Document' };
            body = `${senderName}: ${mediaLabels[mediaType] || 'Attachment'}`;
        } else {
            body = `${senderName} sent a message`;
        }

        const dataPayload = buildDataPayload('ANNOUNCEMENT', groupId, 'NEW_MESSAGE', {
            groupName,
            senderName,
            senderId: String(senderId),
        });

        await sendMulticastNotification(tokens, title, body, dataPayload);
        console.log(`✅ [Announcement Push] Sent to ${tokens.length} tokens for "${groupName}"`);
    } catch (error) {
        console.error(`❌ [Announcement Push] Failed for group ${groupId}:`, error);
        throw error; // Re-throw so BullMQ marks the job as failed and can retry
    }
}

module.exports = { processAnnouncementNotification };
