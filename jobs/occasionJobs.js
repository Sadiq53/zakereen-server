const occassionClient = require('../models/occassion');
const attendanceClient = require('../models/attendance');
const userClient = require('../models/users');
const { dispatchNotification } = require('../utils/fcmUtils');

/**
 * startOccasion
 * Transitions pending → started for a single occasion.
 * @param {String} occasionId 
 */
async function startOccasion(occasionId) {
    const occasion = await occassionClient.findById(occasionId);
    if (!occasion || occasion.status !== 'pending') return;

    occasion.status = 'started';
    occasion.updatedat = new Date();
    await occasion.save();

    console.log(`✅ Started occasion ${occasionId} at ${new Date().toISOString()}`);

    if (!occasion.notifiedStarted) {
        try {
            await dispatchNotification('OCCASION_STARTED', occasion);
            occasion.notifiedStarted = true;
            await occasion.save();
        } catch (err) {
            console.error(`FCM: Failed to notify start for "${occasion.name}":`, err);
        }
    }
}

/**
 * endOccasion
 * Transitions started → ended for a single occasion.
 * @param {String} occasionId 
 */
async function endOccasion(occasionId) {
    const occasion = await occassionClient.findById(occasionId);
    if (!occasion || occasion.status !== 'started') return;

    occasion.status = 'ended';
    occasion.updatedat = new Date();
    await occasion.save();

    console.log(`✅ Ended occasion ${occasionId} at ${new Date().toISOString()}`);
}

/**
 * attendanceReminder
 * Identifies users who have NOT yet marked attendance for this occasion,
 * and sends a targeted ATTENDANCE_REMINDER.
 * @param {String} occasionId 
 */
async function attendanceReminder(occasionId) {
    const occasion = await occassionClient.findById(occasionId).lean();
    
    // Only send if it's currently started and hasn't been notified yet
    if (!occasion || occasion.status !== 'started' || occasion.notifiedReminder) return;

    try {
        // Get all user IDs who HAVE marked attendance
        const attendedRecords = await attendanceClient.find(
            { occasion: occasion._id, status: { $in: ['present', 'late'] } },
            { user: 1 }
        ).lean();
        const attendedUserIds = new Set(attendedRecords.map(r => r.user.toString()));

        // Get ALL users (we want to notify those who haven't attended)
        const allUsers = await userClient.find(
            { fcmTokens: { $exists: true, $ne: [] } },
            { _id: 1, fcmTokens: 1 }
        ).lean();

        // Collect FCM tokens of users who have NOT attended
        const tokens = [];
        for (const user of allUsers) {
            if (!attendedUserIds.has(user._id.toString())) {
                tokens.push(...user.fcmTokens);
            }
        }

        if (tokens.length > 0) {
            await dispatchNotification('ATTENDANCE_REMINDER', occasion, { tokens });
        }

        // Mark as notified to prevent duplicate sends
        await occassionClient.updateOne(
            { _id: occasion._id },
            { $set: { notifiedReminder: true } }
        );

        console.log(`⏰ Attendance reminder sent for "${occasion.name}" to ${tokens.length} tokens`);
    } catch (err) {
        console.error(`FCM: Attendance reminder failed for "${occasion.name}":`, err);
    }
}

module.exports = { startOccasion, endOccasion, attendanceReminder };
