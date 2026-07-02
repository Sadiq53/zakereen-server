const moment = require('moment-hijri');
const islamicEvents = require('../constants/islamicEvents');
const userClient = require('../models/users');
const { sendMulticastNotification, buildDataPayload } = require('../utils/fcmUtils');
const logger = require('../utils/logger');

/**
 * Sweeps for high-priority Miqaats happening tomorrow and alerts all admins.
 */
async function checkMiqaatReminders() {
    try {
        // Calculate tomorrow's Hijri Date
        const tomorrow = moment().add(1, 'days');
        const hMonth = tomorrow.iMonth();
        const hDate = tomorrow.iDate();

        // Find matching events
        const eventMatch = islamicEvents.find(e => e.month === hMonth && e.date === hDate);
        if (!eventMatch || !eventMatch.miqaats) return;

        // Filter for high priority (priority === 1)
        const highPriorityMiqaats = eventMatch.miqaats.filter(m => m.priority === 1);
        if (highPriorityMiqaats.length === 0) return;

        logger.info({ count: highPriorityMiqaats.length, date: `${hDate}/${hMonth}` }, 'Found high priority miqaats for tomorrow');

        // Get all admin users across all tenants
        const admins = await userClient.find({
            role: { $in: ['rootadmin', 'superadmin', 'admin'] },
            fcmTokens: { $exists: true, $ne: [] }
        }, { fcmTokens: 1 }).lean();

        const tokens = [];
        for (const admin of admins) {
            tokens.push(...admin.fcmTokens);
        }

        if (tokens.length === 0) {
            logger.info('No admin tokens found to notify for Miqaat');
            return;
        }

        for (const miqaat of highPriorityMiqaats) {
            const title = `🚨 High Priority Miqaat Tomorrow`;
            const body = `New Miqaat "${miqaat.title}". Tap to schedule the occasion now.`;
            
            const dataPayload = buildDataPayload('MIQAAT_REMINDER', 'global', 'REMINDER', {
                miqaatTitle: miqaat.title,
                date: hDate,
                month: hMonth
            });

            await sendMulticastNotification(tokens, title, body, dataPayload);
            logger.info({ miqaatTitle: miqaat.title, tokensCount: tokens.length }, 'Sent reminder for Miqaat to admins');
        }

    } catch (error) {
        logger.error({ err: error }, 'Error checking miqaat reminders');
    }
}

module.exports = { checkMiqaatReminders };
