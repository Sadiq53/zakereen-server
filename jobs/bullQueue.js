const { Queue } = require('bullmq');
const redisClient = require('../utils/redisClient');

const occasionQueue = new Queue('occasion-events', {
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
            delay: startDelay,
            removeOnComplete: true,
            removeOnFail: false
        });
    }

    // Schedule end job if it hasn't ended
    if (occasion.status !== 'ended') {
        await occasionQueue.add('end-occasion', { occasionId: occasionIdStr }, {
            jobId: `end-${occasionIdStr}`,
            delay: endDelay,
            removeOnComplete: true,
            removeOnFail: false
        });
        
        // Schedule reminder job
        await occasionQueue.add('attendance-reminder', { occasionId: occasionIdStr }, {
            jobId: `reminder-${occasionIdStr}`,
            delay: reminderDelay,
            removeOnComplete: true,
            removeOnFail: false
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

let worker;

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
}

module.exports = {
    occasionQueue,
    scheduleOccasionJobs,
    cancelOccasionJobs,
    rescheduleOccasionJobs,
    initializeWorker
};
