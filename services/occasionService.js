const occasionClient = require('../models/occassion');
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
    console.log(JSON.stringify(occasionData));

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


    const startDateOnly = new Date(startAtIso);
    if (isNaN(startDateOnly)) {
        throw new AppError('Invalid start_at date', 400);
    }
    startDateOnly.setHours(0, 0, 0, 0);

    const timeDate = new Date(timeIso);
    if (isNaN(timeDate)) {
        throw new AppError('Invalid time', 400);
    }

    startDateOnly.setHours(timeDate.getHours(), timeDate.getMinutes(), 0, 0);
    const ends_at = new Date(startDateOnly.getTime() + 6 * 60 * 60 * 1000);

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
    
    // Schedule Event-Driven background jobs via BullMQ
    await scheduleOccasionJobs(newOccasion);
    
    emitOccasionCreated(newOccasion);

    try {
        await dispatchNotification('OCCASION_CREATED', newOccasion, {
            excludeUserId: newOccasion.created_by
        });
    } catch (fcmError) {
        console.error('FCM Broadcast Error:', fcmError);
    }

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

    const occasion = await occasionClient.findOne({ _id: id, tenantId: caller.tenantId });
    if (!occasion) {
        throw new AppError('Occasion not found', 404);
    }

    let attendees = Array.isArray(occasion.attendees) ? [...occasion.attendees] : [];

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

        const presentUserIds = updateData.attendance
            .filter((val) => val.status === "present" && val.userId)
            .map((val) => val.userId.toString());

        const nonPresentUserIds = updateData.attendance
            .filter((val) => val.status !== "present" && val.userId)
            .map((val) => val.userId.toString());

        // Remove non-present users
        attendees = attendees.filter(a => !nonPresentUserIds.includes(a.toString()));

        const existingUserIds = attendees.map((a) => a.toString());

        for (const userId of presentUserIds) {
            if (!existingUserIds.includes(userId)) {
                attendees.push(userId);
            }
        }

        occasion.attendees = attendees;
    }

    if (Array.isArray(updateData.events)) {
        const incomingEvents = updateData.events;
        const incomingMap = Object.create(null);
        incomingEvents.forEach((ev) => {
            if (ev._id) incomingMap[ev._id.toString()] = ev;
        });

        let updatedEvents = occasion.events.map((existingEv) => {
            const existingId = existingEv._id?.toString();
            if (existingId && incomingMap[existingId]) {
                const updateEv = incomingMap[existingId];

                if (Array.isArray(updateEv.rating)) {
                    const ratingMap = Object.create(null);
                    updateEv.rating.forEach((r) => {
                        if (r.ratingBy) ratingMap[r.ratingBy.toString()] = r;
                    });

                    let newRatings = existingEv.rating.map((r) => {
                        const key = r.ratingBy?.toString();
                        if (key && ratingMap[key]) {
                            return { ...r.toObject ? r.toObject() : r, ...ratingMap[key] };
                        }
                        return r.toObject ? r.toObject() : r;
                    });

                    updateEv.rating.forEach((r) => {
                        if (
                            r.ratingBy &&
                            !newRatings.some((nr) => nr.ratingBy?.toString() === r.ratingBy.toString())
                        ) {
                            newRatings.push(r);
                        }
                    });

                    updateEv.rating = newRatings;
                }

                return { ...existingEv.toObject(), ...updateEv };
            }
            return existingEv.toObject ? existingEv.toObject() : existingEv;
        });

        incomingEvents.forEach((ev) => {
            const evIdStr = ev._id ? ev._id.toString() : null;
            if (!evIdStr || !updatedEvents.some((e) => e._id?.toString() === evIdStr)) {
                updatedEvents.push(ev);
            }
        });

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
    const occasion = await occasionClient.findOne({ _id: id, tenantId });

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

    const updatedDoc = await occasion.save();
    emitOccasionUpdated(updatedDoc);

    return updatedDoc;
};

exports.updateAttendance = async (caller, id, updateData) => {
    const occasion = await occasionClient.findOne({ _id: id, tenantId: caller.tenantId });
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

    let attendees = Array.isArray(occasion.attendees) ? [...occasion.attendees] : [];

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
                        filter: { tenantId: caller.tenantId, user: attendee.userId, occasion: id },
                        update: { $set: updateFields },
                        upsert: true
                    }
                });
            }

            await attendanceClient.bulkWrite(bulkOps);
            
            // Optionally, we could still emit socket events, but emit a single bulk event instead
            // For now, to keep the contract, we fetch the updated records to emit
            const updatedRecords = await attendanceClient.find({
                occasion: id,
                user: { $in: scopedAttendance.map(a => a.userId) }
            });
            updatedRecords.forEach(rec => emitAttendanceUpdated(rec));
        }

        const presentUserIds = scopedAttendance
            .filter(val => val.status === 'present' && val.userId)
            .map(val => val.userId.toString());

        const nonPresentUserIds = scopedAttendance
            .filter(val => val.status !== 'present' && val.userId)
            .map(val => val.userId.toString());

        // Remove non-present users
        attendees = attendees.filter(a => !nonPresentUserIds.includes(a.toString()));

        const existingUserIds = attendees.map(a => a.toString());
        for (const userId of presentUserIds) {
            if (!existingUserIds.includes(userId)) {
                attendees.push(userId);
            }
        }
        occasion.attendees = attendees;
    }

    if (Array.isArray(updateData.events)) {
        const incomingEvents = updateData.events;
        const callerId = caller._id.toString();

        const incomingMap = Object.create(null);
        incomingEvents.forEach(ev => {
            if (ev._id) incomingMap[ev._id.toString()] = ev;
        });

        let updatedEvents = occasion.events.map(existingEv => {
            const existingId = existingEv._id?.toString();
            if (existingId && incomingMap[existingId]) {
                const updateEv = incomingMap[existingId];

                if (Array.isArray(updateEv.rating)) {
                    const selfRatings = updateEv.rating.filter(
                        r => r.ratingBy?.toString() === callerId
                    );

                    const ratingMap = Object.create(null);
                    selfRatings.forEach(r => {
                        if (r.ratingBy) ratingMap[r.ratingBy.toString()] = r;
                    });

                    let newRatings = existingEv.rating.map(r => {
                        const key = r.ratingBy?.toString();
                        if (key && ratingMap[key]) {
                            return { ...(r.toObject ? r.toObject() : r), ...ratingMap[key] };
                        }
                        return r.toObject ? r.toObject() : r;
                    });

                    selfRatings.forEach(r => {
                        if (
                            r.ratingBy &&
                            !newRatings.some(nr => nr.ratingBy?.toString() === r.ratingBy.toString())
                        ) {
                            newRatings.push(r);
                        }
                    });

                    return { ...existingEv.toObject(), rating: newRatings };
                }

                return existingEv.toObject ? existingEv.toObject() : existingEv;
            }
            return existingEv.toObject ? existingEv.toObject() : existingEv;
        });

        occasion.events = updatedEvents;
    }

    occasion.updatedat = new Date();
    const updatedDoc = await occasion.save();
    emitOccasionUpdated(updatedDoc);

    return updatedDoc;
};

exports.deleteOccasion = async (tenantId, id) => {
    const result = await occasionClient.deleteOne({ _id: id, tenantId });
    if (result.deletedCount === 0) {
        throw new AppError("Occasion not found.", 404);
    }
    
    await attendanceClient.deleteMany({ occasion: id, tenantId });
    
    // Cancel any scheduled background jobs
    await cancelOccasionJobs(id);
    
    emitOccasionDeleted(tenantId, id);
};

exports.uploadImage = async (caller, id, fileBuffer) => {
    const occasion = await occasionClient.findOne({ _id: id, tenantId: caller.tenantId });

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
    return await occasionClient.find({ tenantId, start_at: { $eq: new Date(date) } });
};

exports.fetchByMonth = async (tenantId, month) => {
    return await occasionClient.find({ start_at: { $regex: new RegExp(`^${month}`) } });
};

exports.fetchByYear = async (tenantId, year) => {
    return await occasionClient.find({ start_at: { $regex: new RegExp(`^${year}`) } });
};

exports.fetchGrouped = async (tenantId) => {
    return await occasionClient.aggregate([
        { $match: { tenantId: new (require("mongoose").Types.ObjectId)(tenantId) } },
        { $unwind: '$events' },
        {
            $group: {
                _id: '$events.party',
                count: { $sum: 1 },
                events: { $push: '$events' }
            }
        },
        { $sort: { count: -1 } }
    ]);
};
