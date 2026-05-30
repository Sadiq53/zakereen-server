const { Queue } = require('bullmq');
const redisClient = require('../utils/redisClient');

const occasionQueue = new Queue('occasion-events', {
    connection: redisClient,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50, // Keep last 50 failures for debugging
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 }
    }
});

const announcementQueue = new Queue('announcement-notifications', {
    connection: redisClient,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50, // Keep last 50 failures for debugging
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
    }
});

const miqaatQueue = new Queue('miqaat-cron', {
    connection: redisClient
});

/**
 * Schedules the 3 core jobs for an occasion.
 * @param {Object} occasion The occasion document.
 */
async function scheduleOccasionJobs(occasion) {
    if (!occasion || !occasion._id) return;

    const occasionIdStr = occasion._id.toString();
    const now = Date.now();

    const startAt = new Date(occasion.start_at).getTime();
    const endsAt = new Date(occasion.ends_at).getTime();
    const reminderAt = endsAt - (15 * 60 * 1000); // 15 minutes before end

    const startDelay = Math.max(0, startAt - now);
    const endDelay = Math.max(0, endsAt - now);
    const reminderDelay = Math.max(0, reminderAt - now);

    // Schedule start job if it hasn't ended and hasn't started yet
    if (occasion.status === 'pending' || (startAt > now)) {
        await occasionQueue.add('start-occasion', { occasionId: occasionIdStr }, {
            jobId: `start-${occasionIdStr}`,
            delay: startDelay
        });
    }

    // Schedule end job if it hasn't ended
    if (occasion.status !== 'ended') {
        await occasionQueue.add('end-occasion', { occasionId: occasionIdStr }, {
            jobId: `end-${occasionIdStr}`,
            delay: endDelay
        });
        
        // Schedule reminder job
        await occasionQueue.add('attendance-reminder', { occasionId: occasionIdStr }, {
            jobId: `reminder-${occasionIdStr}`,
            delay: reminderDelay
        });
    }
}

/**
 * Cancels scheduled jobs for an occasion.
 * @param {String} occasionId 
 */
async function cancelOccasionJobs(occasionId) {
    const occasionIdStr = occasionId.toString();
    
    const startJob = await occasionQueue.getJob(`start-${occasionIdStr}`);
    if (startJob) await startJob.remove();

    const endJob = await occasionQueue.getJob(`end-${occasionIdStr}`);
    if (endJob) await endJob.remove();

    const reminderJob = await occasionQueue.getJob(`reminder-${occasionIdStr}`);
    if (reminderJob) await reminderJob.remove();
}

/**
 * Reschedules jobs for an occasion (e.g. after update)
 * @param {Object} occasion 
 */
async function rescheduleOccasionJobs(occasion) {
    await cancelOccasionJobs(occasion._id);
    await scheduleOccasionJobs(occasion);
}

const { Worker } = require('bullmq');
const { startOccasion, endOccasion, attendanceReminder } = require('./occasionJobs');
const { processAnnouncementNotification } = require('./announcementJobs');
const { checkMiqaatReminders } = require('./miqaatJobs');

let worker;
let announcementWorker;
let miqaatWorker;

/**
 * Initializes the BullMQ worker to process jobs
 */
function initializeWorker() {
    worker = new Worker('occasion-events', async (job) => {
        const { occasionId } = job.data;
        if (!occasionId) return;

        switch (job.name) {
            case 'start-occasion':
                await startOccasion(occasionId);
                break;
            case 'end-occasion':
                await endOccasion(occasionId);
                break;
            case 'attendance-reminder':
                await attendanceReminder(occasionId);
                break;
            default:
                console.warn(`Unknown job name: ${job.name}`);
        }
    }, {
        connection: redisClient
    });

    worker.on('completed', (job) => {
        console.log(`✅ Job completed: ${job.name} for occasion ${job.data.occasionId}`);
    });

    worker.on('failed', (job, err) => {
        console.error(`❌ Job failed: ${job.name} for occasion ${job.data.occasionId}`, err);
    });

    // ─── Announcement Notification Worker ───────────────────────────────
    announcementWorker = new Worker('announcement-notifications', async (job) => {
        if (job.name === 'push-notification') {
            await processAnnouncementNotification(job);
        }
    }, {
        connection: redisClient,
        concurrency: 5 // Process up to 5 notification jobs in parallel
    });

    announcementWorker.on('completed', (job) => {
        console.log(`✅ Announcement push completed for group: ${job.data.groupName}`);
    });

    announcementWorker.on('failed', (job, err) => {
        console.error(`❌ Announcement push failed for group: ${job.data.groupName}`, err);
    });

    // ─── Miqaat Cron Worker ───────────────────────────────
    miqaatWorker = new Worker('miqaat-cron', async (job) => {
        if (job.name === 'check-miqaat-reminders') {
            await checkMiqaatReminders();
        }
    }, {
        connection: redisClient
    });

    miqaatWorker.on('completed', (job) => {
        console.log(`✅ Miqaat cron job completed successfully`);
    });

    miqaatWorker.on('failed', (job, err) => {
        console.error(`❌ Miqaat cron job failed`, err);
    });
}

/**
 * Startup sweep: auto-end occasions whose ends_at has passed,
 * and reschedule jobs for any active occasions that lost their BullMQ jobs.
 */
async function sweepStaleOccasions() {
    const occasionClient = require('../models/occassion');
    const now = new Date();

    // 1. End all occasions whose ends_at has passed but are still active
    const stale = await occasionClient.find({
        status: { $in: ['started', 'pending'] },
        ends_at: { $lte: now }
    });

    for (const occasion of stale) {
        occasion.status = 'ended';
        occasion.updatedat = now;
        await occasion.save();
        console.log(`🧹 Sweep: auto-ended stale occasion "${occasion.name}" (ends_at: ${occasion.ends_at})`);
    }

    if (stale.length > 0) {
        console.log(`🧹 Sweep complete: ended ${stale.length} stale occasion(s)`);
    }

    // 2. Reschedule jobs for any active occasions that may have lost their BullMQ delayed jobs
    const active = await occasionClient.find({
        status: { $in: ['started', 'pending'] },
        ends_at: { $gt: now }
    });

    for (const occasion of active) {
        await scheduleOccasionJobs(occasion);
    }

    if (active.length > 0) {
        console.log(`🔄 Rescheduled jobs for ${active.length} active occasion(s)`);
    }

    // 3. Ensure the daily Miqaat Cron job is scheduled
    await miqaatQueue.add('check-miqaat-reminders', {}, {
        repeat: {
            pattern: '0 0 * * *' // Runs at 00:00 every day
        },
        jobId: 'daily-miqaat-reminder'
    });
    console.log(`📅 Scheduled daily Miqaat Reminder cron job`);
}

module.exports = {
    occasionQueue,
    announcementQueue,
    scheduleOccasionJobs,
    cancelOccasionJobs,
    rescheduleOccasionJobs,
    initializeWorker,
    sweepStaleOccasions
};
