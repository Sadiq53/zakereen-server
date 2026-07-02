const occasionClient = require('../models/occassion');
const Kalam = require('../models/kalam');
const mongoose = require('mongoose');
const { invalidateTenantStats } = require('./tenantService');

// ─── Islamic Calendar (replicated from mobile calendarUtils.ts) ──────
const ISLAMIC_REF_DATE = new Date('2024-07-07');
const ISLAMIC_REF_YEAR = 1446;
const MS_PER_DAY = 86400000;

function getIslamicMonthLengths(year) {
    const leapYears = [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29];
    const yearInCycle = ((year - 1) % 30) + 1;
    const isLeap = leapYears.includes(yearInCycle);
    return [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, isLeap ? 30 : 29];
}

function getIslamicDate(gregDate) {
    const d = new Date(gregDate);
    const daysSinceRef = Math.floor((d.getTime() - ISLAMIC_REF_DATE.getTime()) / MS_PER_DAY);
    if (isNaN(daysSinceRef)) return null;

    let year = ISLAMIC_REF_YEAR;
    let dayCounter = daysSinceRef;

    while (true) {
        const yearLength = getIslamicMonthLengths(year).reduce((a, b) => a + b, 0);
        if (dayCounter < 0) {
            year--;
            dayCounter += getIslamicMonthLengths(year).reduce((a, b) => a + b, 0);
        } else if (dayCounter >= yearLength) {
            dayCounter -= yearLength;
            year++;
        } else {
            break;
        }
    }

    const monthLengths = getIslamicMonthLengths(year);
    let monthIndex = 0;
    while (dayCounter >= monthLengths[monthIndex]) {
        dayCounter -= monthLengths[monthIndex];
        monthIndex++;
    }

    return { year, month: monthIndex, day: dayCounter + 1 };
}
// ─── End Islamic Calendar ────────────────────────────────────────────
const attendanceClient = require('../models/attendance');
const userClient = require('../models/users');
const { emitOccasionCreated, emitOccasionUpdated, emitOccasionDeleted, emitAttendanceUpdated } = require('../utils/socketEmit');
const { isAtLeast } = require('../middlewares/validateUtils');
const sharp = require('sharp');
const { uploadToS3 } = require('../utils/s3Upload');
const { dispatchNotification } = require('../utils/fcmUtils');
const AppError = require('../utils/AppError');
const { scheduleOccasionJobs, rescheduleOccasionJobs, cancelOccasionJobs } = require('../jobs/bullQueue');
const { getDistanceInMeters } = require('../utils/geoUtils');
const logger = require('../utils/logger');

async function markAttendance(tenantId, userId, occasionId, status) {
    const occasion = await occasionClient.findOne({ _id: occasionId, tenantId });
    
    const hasStartedByTime = occasion && occasion.start_at && new Date(occasion.start_at) <= new Date();
    if (!occasion || (occasion.status !== 'started' && !hasStartedByTime)) {
        throw new AppError('Event not active', 400);
    }

    const now = new Date();

    const attendance = await attendanceClient.findOneAndUpdate(
        { tenantId, user: userId, occasion: occasionId },
        { checkedInAt: now, status, updatedAt: now },
        { upsert: true, new: true }
    );
    return attendance;
}

/**
 * Shared helper: Merge attendance changes into the occasion.attendees array.
 * Adds present users and removes non-present users.
 * @param {Array} currentAttendees - The existing occasion.attendees array
 * @param {Array} attendanceUpdates - Array of { userId, status } objects
 * @returns {Array} Updated attendees array
 */
function _mergeAttendees(currentAttendees, attendanceUpdates) {
    let attendees = Array.isArray(currentAttendees) ? [...currentAttendees] : [];

    const presentUserIds = attendanceUpdates
        .filter(val => val.status === 'present' && val.userId)
        .map(val => val.userId.toString());

    const nonPresentUserIds = attendanceUpdates
        .filter(val => val.status !== 'present' && val.userId)
        .map(val => val.userId.toString());

    // Remove non-present users
    attendees = attendees.filter(a => !nonPresentUserIds.includes(a.toString()));

    // Add new present users
    const existingUserIds = new Set(attendees.map(a => a.toString()));
    for (const userId of presentUserIds) {
        if (!existingUserIds.has(userId)) {
            attendees.push(userId);
        }
    }

    return attendees;
}

/**
 * Shared helper: Merge incoming event ratings into existing events.
 * @param {Array} existingEvents - The occasion's current events array
 * @param {Array} incomingEvents - New/updated events from the request
 * @param {string|null} restrictToCallerId - If provided, only this user's ratings are applied (for non-admin)
 * @returns {Array} Merged events array
 */
function _mergeEventRatings(existingEvents, incomingEvents, restrictToCallerId = null) {
    const incomingMap = Object.create(null);
    incomingEvents.forEach(ev => {
        if (ev._id) incomingMap[ev._id.toString()] = ev;
    });

    const updatedEvents = existingEvents.map(existingEv => {
        const existingId = existingEv._id?.toString();
        if (existingId && incomingMap[existingId]) {
            const updateEv = incomingMap[existingId];

            if (Array.isArray(updateEv.rating)) {
                // Filter ratings to only the caller's if restricted
                const ratingsToApply = restrictToCallerId
                    ? updateEv.rating.filter(r => r.ratingBy?.toString() === restrictToCallerId)
                    : updateEv.rating;

                const ratingMap = Object.create(null);
                ratingsToApply.forEach(r => {
                    if (r.ratingBy) ratingMap[r.ratingBy.toString()] = r;
                });

                // Update existing ratings or keep them unchanged
                let newRatings = existingEv.rating.map(r => {
                    const key = r.ratingBy?.toString();
                    if (key && ratingMap[key]) {
                        return { ...(r.toObject ? r.toObject() : r), ...ratingMap[key] };
                    }
                    return r.toObject ? r.toObject() : r;
                });

                // Add new ratings that don't exist yet
                ratingsToApply.forEach(r => {
                    if (r.ratingBy && !newRatings.some(nr => nr.ratingBy?.toString() === r.ratingBy.toString())) {
                        newRatings.push(r);
                    }
                });

                if (restrictToCallerId) {
                    return { ...existingEv.toObject(), rating: newRatings };
                }
                updateEv.rating = newRatings;
            }

            if (restrictToCallerId) {
                return existingEv.toObject ? existingEv.toObject() : existingEv;
            }
            return { ...existingEv.toObject(), ...updateEv };
        }
        return existingEv.toObject ? existingEv.toObject() : existingEv;
    });

    return updatedEvents;
}

exports.createOccasion = async (tenantId, occasionData) => {
    let {
        name,
        start_at: startAtIso,
        events,
        time: timeIso,
        created_by,
        location,
        hijri_date,
        description,
        latitude,
        longitude,
        geoRestrictionEnabled,
        geofenceRadius,
        locationName,
        locationId
    } = occasionData;

    if (locationId) {
        const SavedLocation = require('../models/savedLocation');
        const loc = await SavedLocation.findOne({ _id: locationId, tenantId });
        if (loc) {
            locationName = loc.name;
            location = loc.name;
            latitude = loc.latitude;
            longitude = loc.longitude;
            geoRestrictionEnabled = true;
            geofenceRadius = 150;
        }
    }


    if (!hijri_date && startAtIso) {
        hijri_date = getIslamicDate(startAtIso);
    }

    const startDateOnly = new Date(startAtIso);
    if (isNaN(startDateOnly)) {
        throw new AppError('Invalid start_at date', 400);
    }
    startDateOnly.setHours(0, 0, 0, 0);

    let timeHours, timeMinutes;
    if (typeof timeIso === 'string' && /^\d{2}:\d{2}$/.test(timeIso)) {
        const parts = timeIso.split(':');
        timeHours = parseInt(parts[0], 10);
        timeMinutes = parseInt(parts[1], 10);
    } else {
        const timeDate = new Date(timeIso);
        if (isNaN(timeDate)) {
            throw new AppError('Invalid time format. Use ISO string or HH:mm', 400);
        }
        timeHours = timeDate.getHours();
        timeMinutes = timeDate.getMinutes();
    }

    startDateOnly.setHours(timeHours, timeMinutes, 0, 0);
    const durationMinutes = occasionData.duration || 180;
    const ends_at = new Date(startDateOnly.getTime() + durationMinutes * 60 * 1000);

    if (ends_at <= startDateOnly) {
        throw new AppError('Ends time must be after start time', 400);
    }

    const payload = {
        name,
        description,
        created_by,
        hijri_date,
        location,
        locationName,
        latitude,
        longitude,
        geoRestrictionEnabled: (latitude != null && longitude != null) ? (geoRestrictionEnabled !== false) : false,
        geofenceRadius,
        start_at: startDateOnly,
        ends_at,
        events,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const newOccasion = new occasionClient(payload);
    await newOccasion.save();

    // Auto-save any new kalams
    if (events && Array.isArray(events)) {
        for (const ev of events) {
            if (ev.name) {
                try {
                    await Kalam.updateOne(
                        { name: ev.name },
                        { $setOnInsert: { name: ev.name, type: ev.type || 'salam', createdat: new Date(), updatedat: new Date() } },
                        { upsert: true }
                    );
                } catch (err) {
                    // Ignore duplicate key or parallel insert errors
                }
            }
        }
    }
    
    // Schedule Event-Driven background jobs via BullMQ
    await scheduleOccasionJobs(newOccasion);
    
    // Invalidate caches
    invalidateTenantStats(tenantId);
    
    emitOccasionCreated(newOccasion);

    try {
        await dispatchNotification('OCCASION_CREATED', newOccasion, {
            excludeUserId: newOccasion.created_by
        });
    } catch (fcmError) {
        logger.error('FCM Broadcast Error:', fcmError);
    }

    return newOccasion;
};

exports.createPastOccasion = async (tenantId, occasionData, caller) => {
    let {
        name,
        start_at: startAtIso,
        events,
        time: timeIso,
        created_by,
        location,
        hijri_date,
        description,
        latitude,
        longitude,
        geoRestrictionEnabled,
        geofenceRadius,
        locationName,
        locationId,
        attendance // Array of userId strings who were 'present'
    } = occasionData;

    if (locationId) {
        const SavedLocation = require('../models/savedLocation');
        const loc = await SavedLocation.findOne({ _id: locationId, tenantId });
        if (loc) {
            locationName = loc.name;
            location = loc.name;
            latitude = loc.latitude;
            longitude = loc.longitude;
            geoRestrictionEnabled = true;
            geofenceRadius = 150;
        }
    }

    if (!hijri_date && startAtIso) {
        hijri_date = getIslamicDate(startAtIso);
    }

    const startDateOnly = new Date(startAtIso);
    if (isNaN(startDateOnly)) {
        throw new AppError('Invalid start_at date', 400);
    }
    startDateOnly.setHours(0, 0, 0, 0);

    let timeHours, timeMinutes;
    if (typeof timeIso === 'string' && /^\d{2}:\d{2}$/.test(timeIso)) {
        const parts = timeIso.split(':');
        timeHours = parseInt(parts[0], 10);
        timeMinutes = parseInt(parts[1], 10);
    } else {
        const timeDate = new Date(timeIso);
        if (isNaN(timeDate)) {
            throw new AppError('Invalid time format. Use ISO string or HH:mm', 400);
        }
        timeHours = timeDate.getHours();
        timeMinutes = timeDate.getMinutes();
    }

    startDateOnly.setHours(timeHours, timeMinutes, 0, 0);
    const ends_at = new Date(startDateOnly.getTime() + 3 * 60 * 60 * 1000);

    const payload = {
        name,
        description,
        created_by,
        hijri_date,
        location,
        locationName,
        latitude,
        longitude,
        geoRestrictionEnabled: (latitude != null && longitude != null) ? (geoRestrictionEnabled !== false) : false,
        geofenceRadius,
        start_at: startDateOnly,
        ends_at,
        events,
        tenantId,
        status: 'ended', // Force ended status
        createdAt: new Date(),
        updatedAt: new Date(),
        attendees: []
    };

    if (Array.isArray(attendance) && attendance.length > 0) {
        // Handle both legacy array of strings and new array of {userId, status} objects
        payload.attendees = attendance
            .filter(item => item)
            .map(item => typeof item === 'object' ? item.userId : item)
            .map(id => id.toString());
    }

    const newOccasion = new occasionClient(payload);
    await newOccasion.save();

    // Auto-save any new kalams
    if (events && Array.isArray(events)) {
        for (const ev of events) {
            if (ev.name) {
                try {
                    await Kalam.updateOne(
                        { name: ev.name },
                        { $setOnInsert: { name: ev.name, type: ev.type || 'salam', createdat: new Date(), updatedat: new Date() } },
                        { upsert: true }
                    );
                } catch (err) {
                    // Ignore duplicate key or parallel insert errors
                }
            }
        }
    }

    // Handle Bulk Attendance immediately
    if (payload.attendees.length > 0) {
        const now = new Date(startDateOnly);
        const bulkOps = payload.attendees.map(userId => {
            // Find status if provided, else default to 'present'
            const attObj = attendance.find(a => (typeof a === 'object' ? a.userId === userId : false));
            const status = attObj && attObj.status ? attObj.status : 'present';
            
            return {
                updateOne: {
                    filter: {
                        tenantId: new mongoose.Types.ObjectId(tenantId),
                        user: new mongoose.Types.ObjectId(userId),
                        occasion: newOccasion._id
                    },
                    update: {
                        $set: {
                            checkedInAt: now,
                            status: status,
                            updatedAt: now
                        },
                        $setOnInsert: {
                            createdAt: now
                        }
                    },
                    upsert: true
                }
            };
        });
        if (bulkOps.length > 0) {
            await attendanceClient.bulkWrite(bulkOps);
        }
    }

    // Explicitly bypass scheduleOccasionJobs and FCM broadcast
    emitOccasionCreated(newOccasion);
    
    // Invalidate caches
    invalidateTenantStats(tenantId);

    return newOccasion;
};

exports.updateOccasion = async (caller, id, updateData) => {
    const forbiddenFields = ['created_by'];

    if (!isAtLeast(caller.role, 'admin')) {
        forbiddenFields.push('start_at');
    }

    for (const field of forbiddenFields) {
        if (field in updateData) {
            throw new AppError(`Updating the field '${field}' is not allowed for your role.`, 403);
        }
    }

    const query = { _id: id };
    if (caller.role !== 'rootadmin') {
        query.tenantId = caller.tenantId;
    }

    const occasion = await occasionClient.findOne(query);
    if (!occasion) {
        throw new AppError('Occasion not found', 404);
    }


    if (Array.isArray(updateData.attendance)) {
        if (updateData.attendance.length > 0) {
            const now = new Date();
            const bulkOps = updateData.attendance.map(attendee => ({
                updateOne: {
                    filter: { tenantId: caller.tenantId, user: attendee.userId, occasion: id },
                    update: { $set: { checkedInAt: now, status: attendee.status, updatedAt: now } },
                    upsert: true
                }
            }));
            
            await attendanceClient.bulkWrite(bulkOps);
            
            const updatedRecords = await attendanceClient.find({
                tenantId: caller.tenantId,
                occasion: id,
                user: { $in: updateData.attendance.map(a => a.userId) }
            });
            updatedRecords.forEach(rec => emitAttendanceUpdated(rec));
        }

        occasion.attendees = _mergeAttendees(occasion.attendees, updateData.attendance);
    }

    if (Array.isArray(updateData.events)) {
        // Admin: unrestricted rating merge (null = no caller restriction)
        let updatedEvents = _mergeEventRatings(occasion.events, updateData.events, null);

        // Add brand-new events that don't exist yet
        updateData.events.forEach(ev => {
            const evIdStr = ev._id ? ev._id.toString() : null;
            if (!evIdStr || !updatedEvents.some(e => e._id?.toString() === evIdStr)) {
                updatedEvents.push(ev);
            }
        });

        // Remove explicitly deleted events
        if (Array.isArray(updateData.removedEventIds) && updateData.removedEventIds.length > 0) {
            updatedEvents = updatedEvents.filter(ev => {
                const evId = ev._id?.toString();
                return !evId || !updateData.removedEventIds.includes(evId);
            });
        }

        occasion.events = updatedEvents;
    }

    if (updateData.locationId) {
        const SavedLocation = require('../models/savedLocation');
        const loc = await SavedLocation.findOne({ _id: updateData.locationId, tenantId: caller.tenantId });
        if (loc) {
            occasion.locationName = loc.name;
            occasion.location = loc.name;
            occasion.latitude = loc.latitude;
            occasion.longitude = loc.longitude;
            occasion.geoRestrictionEnabled = true;
            occasion.geofenceRadius = 150;
        }
    }

    Object.keys(updateData).forEach((key) => {
        if (forbiddenFields.includes(key) || key === 'events' || key === 'attendance' || key === 'removedEventIds' || key === 'locationId') return;
        occasion[key] = updateData[key];
    });

    occasion.updatedat = new Date();
    const updatedDoc = await occasion.save();
    
    // Reschedule Event-Driven background jobs via BullMQ
    await rescheduleOccasionJobs(updatedDoc);
    
    emitOccasionUpdated(updatedDoc);

    return updatedDoc;
};

exports.endOccasion = async (tenantId, id) => {
    const query = tenantId ? { _id: id, tenantId } : { _id: id };
    const occasion = await occasionClient.findOne(query);

    if (!occasion) {
        throw new AppError('Occasion not found', 404);
    }

    if (occasion.status === 'ended') {
        throw new AppError('Occasion is already ended.', 400);
    }

    const now = new Date();
    occasion.status = 'ended';
    occasion.ends_at = now;
    occasion.updatedat = now;
    
    // Cancel any pending BullMQ jobs (start, end, reminder) for this occasion
    await cancelOccasionJobs(id);

    const updatedDoc = await occasion.save();
    emitOccasionUpdated(updatedDoc);

    return updatedDoc;
};

exports.updateAttendance = async (caller, id, updateData) => {
    const query = caller.tenantId ? { _id: id, tenantId: caller.tenantId } : { _id: id };
    const occasion = await occasionClient.findOne(query);
    if (!occasion) {
        throw new AppError('Occasion not found', 404);
    }

    const hasStartedByTime = occasion.start_at && new Date(occasion.start_at) <= new Date();
    
    if (occasion.status !== 'started' && !hasStartedByTime) {
        throw new AppError('Attendance can only be marked for active events.', 400);
    }
    
    if (occasion.status === 'pending' && hasStartedByTime) {
        occasion.status = 'started';
    }


    if (Array.isArray(updateData.attendance)) {
        let allowedUserIds = new Set();

        if (isAtLeast(caller.role, 'admin')) {
            updateData.attendance.forEach(a => allowedUserIds.add(a.userId));
        } else if (caller.role === 'groupadmin') {
            allowedUserIds.add(caller._id.toString());
            if (caller.belongsto) {
                const groupMembers = await userClient.find(
                    { belongsto: caller.belongsto, tenantId: caller.tenantId },
                    { _id: 1 }
                ).lean();
                groupMembers.forEach(m => allowedUserIds.add(m._id.toString()));
            }
        } else {
            allowedUserIds.add(caller._id.toString());
        }

        const scopedAttendance = updateData.attendance.filter(
            a => allowedUserIds.has(a.userId?.toString())
        );

        if (scopedAttendance.length === 0 && updateData.attendance.length > 0) {
            throw new AppError('You do not have permission to mark attendance for the specified users.', 403);
        }

        // Perform bulk write for attendance
        if (scopedAttendance.length > 0) {
            const now = new Date();
            const bulkOps = [];
            const requiresGeoValidation = occasion.geoRestrictionEnabled && !isAtLeast(caller.role, 'superadmin');

            for (const attendee of scopedAttendance) {
                const updateFields = { checkedInAt: now, status: attendee.status, updatedAt: now };

                if (attendee.status === 'present' && requiresGeoValidation) {
                    const loc = attendee.location;
                    if (!loc || loc.latitude == null || loc.longitude == null) {
                        throw new AppError('Location is required to mark attendance for this event.', 400);
                    }
                    if (loc.mocked) {
                        throw new AppError('Mock location detected. Attendance denied.', 403);
                    }
                    
                    // Prevent replay attacks / stale locations (older than 5 minutes)
                    if (loc.timestamp && (now.getTime() - loc.timestamp > 5 * 60 * 1000)) {
                        throw new AppError('Location data is too old. Please try again.', 400);
                    }

                    const distance = getDistanceInMeters(
                        occasion.latitude,
                        occasion.longitude,
                        loc.latitude,
                        loc.longitude
                    );

                    if (distance === null || distance > (occasion.geofenceRadius || 150)) {
                        throw new AppError(`You are outside the allowed attendance area. Distance: ${Math.round(distance)}m (Max: ${occasion.geofenceRadius || 150}m).`, 403);
                    }

                    updateFields.attendanceLatitude = loc.latitude;
                    updateFields.attendanceLongitude = loc.longitude;
                    updateFields.distanceFromOccasion = distance;
                    updateFields.geoValidated = true;
                    updateFields.locationVerificationTimestamp = loc.timestamp ? new Date(loc.timestamp) : now;
                }

                bulkOps.push({
                    updateOne: {
                        filter: { tenantId: occasion.tenantId, user: attendee.userId, occasion: id },
                        update: { $set: updateFields },
                        upsert: true
                    }
                });
            }

            await attendanceClient.bulkWrite(bulkOps);
            
            const updatedRecords = await attendanceClient.find({
                tenantId: occasion.tenantId,
                occasion: id,
                user: { $in: scopedAttendance.map(a => a.userId) }
            });
            updatedRecords.forEach(rec => emitAttendanceUpdated(rec));
        }

        occasion.attendees = _mergeAttendees(occasion.attendees, scopedAttendance);
    }

    if (Array.isArray(updateData.events)) {
        // Non-admin: restrict rating merge to caller's own ratings only
        occasion.events = _mergeEventRatings(occasion.events, updateData.events, caller._id.toString());
    }

    occasion.updatedat = new Date();
    const updatedDoc = await occasion.save();
    
    // Invalidate caches
    invalidateTenantStats(caller.tenantId);

    emitOccasionUpdated(updatedDoc);

    return updatedDoc;
};

exports.deleteOccasion = async (tenantId, id) => {
    const query = tenantId ? { _id: id, tenantId } : { _id: id };
    const result = await occasionClient.deleteOne(query);
    if (result.deletedCount === 0) {
        throw new AppError("Occasion not found.", 404);
    }
    
    await attendanceClient.deleteMany(tenantId ? { occasion: id, tenantId } : { occasion: id });
    
    // Cancel any scheduled background jobs
    await cancelOccasionJobs(id);
    
    emitOccasionDeleted(tenantId, id);
};

exports.uploadImage = async (caller, id, fileBuffer) => {
    const query = { _id: id };
    if (caller.role !== 'rootadmin') {
        query.tenantId = caller.tenantId;
    }

    const occasion = await occasionClient.findOne(query);

    if (!occasion) {
        throw new AppError('Occasion not found', 404);
    }

    if (!fileBuffer) {
        throw new AppError('No photo provided', 400);
    }

    const compressedBuffer = await sharp(fileBuffer)
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

    const sizeMB = compressedBuffer.length / (1024 * 1024);

    const publicUrl = await uploadToS3(compressedBuffer, 'image/webp', 'occasions');

    const imageRecord = {
        url: publicUrl,
        sizeMB: Number(sizeMB.toFixed(2)),
        uploadedBy: caller._id,
        createdAt: new Date()
    };

    if (!occasion.images) occasion.images = [];
    occasion.images.push(imageRecord);
    occasion.updatedat = new Date();

    const updatedDoc = await occasion.save();
    emitOccasionUpdated(updatedDoc);

    return { imageRecord, occasion: updatedDoc };
};

exports.fetchAll = async (tenantId) => {
    const query = tenantId ? { tenantId } : {};
    return await occasionClient.find(query);
};

exports.fetchPaginated = async (tenantId, page, limit) => {
    const skip = (page - 1) * limit;

    const [total, occasions] = await Promise.all([
        occasionClient.countDocuments({ tenantId }),
        occasionClient.find({ tenantId }).sort({ start_at: -1, _id: -1 }).skip(skip).limit(limit)
    ]);

    const hasNextPage = total > skip + occasions.length;

    return {
        data: occasions,
        metadata: {
            total,
            page,
            limit,
            hasNextPage
        }
    };
};

exports.fetchById = async (tenantId, id) => {
    const occasion = await occasionClient.findOne({ _id: id, tenantId });
    if (!occasion) {
        throw new AppError("Occasion not found.", 404);
    }
    return occasion;
};

exports.fetchByStatus = async (tenantId, statusRaw) => {
    if (!statusRaw) {
        throw new AppError("Missing status parameter.", 400);
    }
    
    let status = statusRaw;
    if (typeof status === "string") {
        status = status.split(',');
    }

    return await occasionClient.find({
        tenantId,
        status: { $in: status }
    });
};

exports.fetchByDate = async (tenantId, date) => {
    const start = new Date(date);
    if (isNaN(start.getTime())) return [];
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const query = tenantId 
        ? { tenantId, start_at: { $gte: start, $lt: end } } 
        : { start_at: { $gte: start, $lt: end } };
        
    return await occasionClient.find(query);
};

exports.fetchByMonth = async (tenantId, monthString) => {
    const start_at = new Date(monthString);
    if (isNaN(start_at.getTime())) return [];
    
    const start = new Date(start_at.getFullYear(), start_at.getMonth(), 1);
    const end = new Date(start_at.getFullYear(), start_at.getMonth() + 1, 1);
    
    const query = tenantId 
        ? { tenantId, start_at: { $gte: start, $lt: end } } 
        : { start_at: { $gte: start, $lt: end } };
        
    return await occasionClient.find(query);
};

exports.fetchByYear = async (tenantId, yearString) => {
    const year = parseInt(yearString, 10);
    if (isNaN(year)) return [];
    
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    
    const query = tenantId 
        ? { tenantId, start_at: { $gte: start, $lt: end } } 
        : { start_at: { $gte: start, $lt: end } };
        
    return await occasionClient.find(query);
};

exports.fetchGrouped = async (tenantId) => {
    const results = await occasionClient.aggregate([
        { $match: { tenantId: new (require("mongoose").Types.ObjectId)(tenantId) } },
        { $unwind: '$events' },
        {
            $group: {
                _id: { partyName: '$events.party' },
                count: { $sum: 1 },
                events: { $push: '$events' }
            }
        },
        { $sort: { count: -1 } }
    ]);

    return results.map(r => ({
        _id: r._id.partyName,
        count: r.count,
        events: r.events
    }));
};
