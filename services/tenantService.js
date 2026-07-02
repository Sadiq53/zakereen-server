const Tenant = require('../models/tenant');
const User = require('../models/users');
const Occasion = require('../models/occassion');
const Attendance = require('../models/attendance');
const Group = require('../models/group');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { hashPassword } = require('../middlewares/auth');
const cacheService = require('./cacheService');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');

async function emitGlobalTenantUpdate() {
    try {
        if (cacheService && cacheService.invalidateGlobal) {
            await cacheService.invalidateGlobal();
        }
        
        const io = getIO();
        io.emit('tenantUpdated'); // generic broadcast signal
    } catch (err) {
        logger.warn('Socket or Cache error during global update:', err.message);
    }
}

/**
 * Create a new tenant.
 */
exports.createTenant = async (data) => {
    const { name, slug, address, contactEmail, contactPhone, maxUsers, settings } = data;

    const existing = await Tenant.findOne({ slug });
    if (existing) {
        throw new AppError('A tenant with this slug already exists.', 409);
    }

    const tenant = new Tenant({
        name,
        slug,
        address: address || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        maxUsers: maxUsers || 500,
        settings: settings || {},
        status: 'pending_setup',
    });

    await tenant.save();
    emitGlobalTenantUpdate();
    return tenant;
};

/**
 * Assign a coordinator (superadmin) to a tenant.
 * Creates the user if they don't exist, or promotes an existing user.
 */
exports.assignCoordinator = async (tenantId, coordinatorData) => {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    const { userid, fullname, phone, email, address } = coordinatorData;

    let user = await User.findOne({ userid });

    if (user) {
        // If the user is a rootadmin, we don't modify their role or tenantId, 
        // wait, we DO want to modify their tenantId so they have a home Jamaat.
        // We just don't modify their role!
        if (user.role !== 'rootadmin') {
            user.role = 'superadmin';
        }
        user.tenantId = tenantId;
        user.updatedat = new Date();
        await user.save();
    } else {
        // Create new coordinator user
        const hashedPass = await hashPassword(userid);
        user = new User({
            tenantId,
            userid,
            fullname: fullname || '',
            phone: phone || '',
            email: email || '',
            address: address || '',
            role: 'superadmin',
            userpass: hashedPass,
            mustChangePassword: true,
            createdat: new Date(),
            updatedat: new Date(),
        });
        await user.save();
    }

    // Link coordinator to tenant and activate
    tenant.coordinator = user._id;
    tenant.status = 'active';
    await tenant.save();

    emitGlobalTenantUpdate();
    return { tenant, coordinator: user };
};

/**
 * List all tenants with optional status filter.
 */
exports.listTenants = async (statusFilter) => {
    const query = statusFilter ? { status: statusFilter } : { status: { $ne: 'deleted' } };
    return await Tenant.find(query).populate('coordinator', 'fullname userid email').sort({ createdAt: -1 }).lean();
};

/**
 * Get a single tenant by ID.
 */
exports.getTenantById = async (id) => {
    const tenant = await Tenant.findById(id).populate('coordinator', 'fullname userid email').lean();
    if (!tenant) throw new AppError('Tenant not found.', 404);
    return tenant;
};

/**
 * Update tenant details.
 */
exports.updateTenant = async (id, data) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    const allowedFields = ['name', 'address', 'contactEmail', 'contactPhone', 'maxUsers', 'settings'];
    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            tenant[field] = data[field];
        }
    }

    await tenant.save();
    emitGlobalTenantUpdate();
    return tenant;
};

/**
 * Suspend a tenant.
 */
exports.suspendTenant = async (id, reason) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);
    if (tenant.status === 'suspended') throw new AppError('Tenant is already suspended.', 400);

    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    tenant.suspendReason = reason || '';
    await tenant.save();
    emitGlobalTenantUpdate();
    return tenant;
};

/**
 * Reactivate a suspended tenant.
 */
exports.reactivateTenant = async (id) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);
    if (tenant.status !== 'suspended' && tenant.status !== 'archived') {
        throw new AppError('Tenant is not suspended or archived.', 400);
    }

    tenant.status = 'active';
    tenant.suspendedAt = null;
    tenant.suspendReason = '';
    await tenant.save();
    emitGlobalTenantUpdate();
    return tenant;
};

/**
 * Soft-delete a tenant.
 */
exports.deleteTenant = async (id) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    tenant.status = 'deleted';
    tenant.deletedAt = new Date();
    await tenant.save();
    return tenant;
};

/**
 * Fetch all tenants with aggregated mass-analytics.
 * Optimized: uses batch aggregations instead of per-tenant queries.
 */
exports.getAllTenantsAnalytics = async () => {
    const tenants = await Tenant.find({ status: { $ne: 'deleted' } }).lean();
    if (tenants.length === 0) return [];

    const tenantIds = tenants.map(t => t._id);

    // Batch all counts across tenants in parallel (4 queries total, not 5×N)
    const [userAgg, occasionAgg, groupAgg, attendanceAgg, participationAgg] = await Promise.all([
        User.aggregate([
            { $match: { tenantId: { $in: tenantIds } } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } }
        ]),
        Occasion.aggregate([
            { $match: { tenantId: { $in: tenantIds } } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } }
        ]),
        Group.aggregate([
            { $match: { tenantId: { $in: tenantIds } } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } }
        ]),
        Attendance.aggregate([
            { $match: { tenantId: { $in: tenantIds }, status: 'present' } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } }
        ]),
        Occasion.aggregate([
            { $match: { tenantId: { $in: tenantIds } } },
            { $unwind: '$events' },
            { $match: { 'events.party': { $ne: null, $ne: '' } } },
            { $group: { _id: { tenantId: '$tenantId', occasionId: '$_id', partyId: '$events.party' } } },
            { $group: { _id: '$_id.tenantId', uniqueParticipations: { $sum: 1 } } }
        ])
    ]);

    // Build lookup maps
    const toMap = (agg) => agg.reduce((acc, item) => { acc[item._id.toString()] = item.count; return acc; }, {});
    const userMap = toMap(userAgg);
    const occasionMap = toMap(occasionAgg);
    const groupMap = toMap(groupAgg);
    const attendanceMap = toMap(attendanceAgg);
    const participationMap = participationAgg.reduce((acc, item) => {
        acc[item._id.toString()] = item.uniqueParticipations;
        return acc;
    }, {});

    // Assemble results
    return tenants.map(t => {
        const tid = t._id.toString();
        const userCount = userMap[tid] || 0;
        const occasionCount = occasionMap[tid] || 0;
        const groupCount = groupMap[tid] || 0;
        const attendanceCount = attendanceMap[tid] || 0;
        const uniqueParticipations = participationMap[tid] || 0;

        const maxPotentialAttendance = userCount * occasionCount;
        const avgAttendanceRatio = maxPotentialAttendance > 0
            ? ((attendanceCount / maxPotentialAttendance) * 100)
            : 0;
        const avgParticipationRatio = (occasionCount > 0 && groupCount > 0)
            ? ((uniqueParticipations / (occasionCount * groupCount)) * 100)
            : 0;

        return {
            tenantId: t._id,
            name: t.name,
            userCount,
            occasionCount,
            attendanceCount,
            maxPotentialAttendance,
            avgAttendanceRatio: parseFloat(avgAttendanceRatio.toFixed(1)),
            avgParticipationRatio: parseFloat(avgParticipationRatio.toFixed(1))
        };
    });
};

/**
 * Get tenant stats (user count, occasion count, attendance ratios, participation metrics)
 * Uses Redis caching for performance.
 */
exports.getTenantStats = async (tenantId) => {
    const cacheKey = `stats:tenant:v2:${tenantId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const tenantObjectId = new mongoose.Types.ObjectId(tenantId);

    const [userCount, occasionCount, groupCount, attendanceCount, partyAgg, participationAgg, attendeeAgg] = await Promise.all([
        User.countDocuments({ tenantId }),
        Occasion.countDocuments({ tenantId }),
        Group.countDocuments({ tenantId }),
        Attendance.countDocuments({ tenantId, status: 'present' }),
        
        // Aggregate party participation logic across all Miqaats for this tenant
        Occasion.aggregate([
            { $match: { tenantId: tenantObjectId } },
            { $unwind: "$events" },
            { $match: { "events.party": { $ne: null }, "events.party": { $ne: "" } } },
            { $addFields: { 
                partyObjectId: { 
                    $convert: { input: "$events.party", to: "objectId", onError: null, onNull: null } 
                } 
            }},
            { $lookup: {
                from: "groups",
                localField: "partyObjectId",
                foreignField: "_id",
                as: "partyData"
            }},
            { $addFields: {
                resolvedPartyName: {
                    $toLower: {
                        $cond: [
                            { $gt: [{ $size: "$partyData" }, 0] }, 
                            { $arrayElemAt: ["$partyData.name", 0] }, 
                            "$events.party"
                        ]
                    }
                },
                originalResolvedName: {
                    $cond: [
                        { $gt: [{ $size: "$partyData" }, 0] }, 
                        { $arrayElemAt: ["$partyData.name", 0] }, 
                        "$events.party"
                    ]
                }
            }},
            { $group: {
                _id: "$resolvedPartyName",
                partyName: { $first: "$originalResolvedName" },
                count: { $sum: 1 }
            }},
            { $project: {
                _id: 0,
                partyId: "$partyName",
                partyName: 1,
                count: 1
            }},
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]),

        // Average Participation logic
        Occasion.aggregate([
            { $match: { tenantId: tenantObjectId } },
            { $unwind: "$events" },
            { $match: { "events.party": { $ne: null }, "events.party": { $ne: "" } } },
            { $group: { _id: { occasionId: "$_id", partyId: "$events.party" } } },
            { $count: "uniqueParticipations" }
        ]),

        // Top/Lowest Attendees Logic
        Attendance.aggregate([
            { $match: { tenantId: tenantObjectId } },
            { $group: { 
                _id: "$user", 
                totalRecords: { $sum: 1 }, 
                presentCount: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } } 
            }},
            { $match: { totalRecords: { $gt: 0 } } },
            { $project: {
                _id: 1,
                ratio: { $multiply: [{ $divide: ["$presentCount", "$totalRecords"] }, 100] },
                presentCount: 1,
                totalRecords: 1
            }},
            { $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "_id",
                as: "user"
            }},
            { $unwind: "$user" },
            { $project: {
                userId: "$user._id",
                name: "$user.fullname",
                its: "$user.userid",
                ratio: 1,
                presentCount: 1,
                totalRecords: 1
            }},
            { $sort: { ratio: -1, presentCount: -1 } }
        ])
    ]);

    // Average attendance ratio calculation
    const maxPotential = userCount * occasionCount;
    const avgAttendanceRatio = maxPotential > 0 ? ((attendanceCount / maxPotential) * 100).toFixed(1) : 0;

    // Average Participation Ratio calculation
    const uniqueParticipations = participationAgg.length > 0 ? participationAgg[0].uniqueParticipations : 0;
    const avgParticipationRatio = (occasionCount > 0 && groupCount > 0)
        ? ((uniqueParticipations / (occasionCount * groupCount)) * 100)
        : 0;

    const topAttendees = attendeeAgg.slice(0, 10).map(a => ({
        ...a,
        ratio: parseFloat(a.ratio.toFixed(1))
    }));
    
    // Sort ascending for lowest, but only consider people with > 0 records
    const lowestAttendees = [...attendeeAgg]
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 10)
        .map(a => ({
            ...a,
            ratio: parseFloat(a.ratio.toFixed(1))
        }));

    const stats = { 
        userCount, 
        occasionCount, 
        attendanceCount,
        avgAttendanceRatio: parseFloat(avgAttendanceRatio),
        avgParticipationRatio: parseFloat(avgParticipationRatio.toFixed(1)),
        topParties: partyAgg.map(p => ({ party: p.partyName, count: p.count })),
        topAttendees,
        lowestAttendees
    };

    await cacheService.set(cacheKey, stats, 300); // Cache for 5 mins

    return stats;
};

/**
 * Get global platform stats (cross-tenant) with advanced analytics.
 * Cached in Redis to prevent heavy DB load.
 */
exports.getGlobalStats = async () => {
    const cacheKey = 'stats:global:v2';
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const [tenantCounts, totalUsers, totalOccasions, attendanceAgg, topKalamsAgg, topPartiesAgg] = await Promise.all([
        Tenant.aggregate([
            { $match: { status: { $ne: 'deleted' } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        User.countDocuments({}),
        Occasion.countDocuments(),
        
        // Overall attendance calculation
        Attendance.aggregate([
            { $group: {
                _id: "$status",
                count: { $sum: 1 }
            }}
        ]),

        // Top 5 recited Kalams across the platform
        Occasion.aggregate([
            { $unwind: "$events" },
            { $group: {
                _id: { $toLower: "$events.name" },
                originalName: { $first: "$events.name" },
                count: { $sum: 1 }
            }},
            { $match: { _id: { $ne: null }, _id: { $ne: "" } } },
            { $project: { _id: "$originalName", count: 1 } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]),
        
        // Top 5 Parties across the platform
        Occasion.aggregate([
            { $unwind: "$events" },
            { $match: { "events.party": { $ne: null }, "events.party": { $ne: "" } } },
            { $addFields: { 
                partyObjectId: { 
                    $convert: { input: "$events.party", to: "objectId", onError: null, onNull: null } 
                } 
            }},
            { $lookup: {
                from: "groups",
                localField: "partyObjectId",
                foreignField: "_id",
                as: "partyData"
            }},
            { $addFields: {
                resolvedPartyName: {
                    $toLower: {
                        $cond: [
                            { $gt: [{ $size: "$partyData" }, 0] }, 
                            { $arrayElemAt: ["$partyData.name", 0] }, 
                            "$events.party"
                        ]
                    }
                },
                originalResolvedName: {
                    $cond: [
                        { $gt: [{ $size: "$partyData" }, 0] }, 
                        { $arrayElemAt: ["$partyData.name", 0] }, 
                        "$events.party"
                    ]
                }
            }},
            { $group: {
                _id: "$resolvedPartyName",
                partyName: { $first: "$originalResolvedName" },
                count: { $sum: 1 }
            }},
            { $project: {
                _id: 0,
                partyId: "$partyName",
                partyName: 1,
                count: 1
            }},
            { $sort: { count: -1 } },
            { $limit: 5 }
        ])
    ]);

    const tenants = tenantCounts.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
    }, {});

    const totalTenants = Object.values(tenants).reduce((a, b) => a + b, 0);

    // Removed inaccurate attendanceAgg variables as we use allTenantsAnalytics now

    // Fetch mass analytics for global leaderboards
    const allTenantsAnalytics = await exports.getAllTenantsAnalytics();
    
    // Platform Avg Attendance (Mathematically Accurate across all Jamaats)
    let globalPresentCount = 0;
    let globalMaxPotential = 0;
    for (const r of allTenantsAnalytics) {
        globalPresentCount += r.attendanceCount;
        globalMaxPotential += r.maxPotentialAttendance;
    }
    const platformAvgAttendance = globalMaxPotential > 0 
        ? ((globalPresentCount / globalMaxPotential) * 100) 
        : 0;

    // Top 10 Consistent Jamaats (Attendance Ratio)
    const topConsistentJamaats = [...allTenantsAnalytics]
        .sort((a, b) => b.avgAttendanceRatio - a.avgAttendanceRatio)
        .slice(0, 10);

    // Top 5 Highest Participation Ratio Jamaats
    const topParticipationJamaats = [...allTenantsAnalytics]
        .sort((a, b) => b.avgParticipationRatio - a.avgParticipationRatio)
        .slice(0, 5);

    // Platform Avg Participation Ratio
    let totalPartRatio = 0;
    let countForGlobalPart = 0;
    for (const r of allTenantsAnalytics) {
        if (r.occasionCount > 0) { // Only count jamaats that have miqaats
            totalPartRatio += r.avgParticipationRatio;
            countForGlobalPart++;
        }
    }
    const platformAvgParticipation = countForGlobalPart > 0 ? (totalPartRatio / countForGlobalPart) : 0;

    const stats = {
        tenants,
        totalTenants,
        totalUsers,
        totalOccasions,
        platformAvgAttendance: parseFloat(platformAvgAttendance.toFixed(1)),
        platformAvgParticipation: parseFloat(platformAvgParticipation.toFixed(1)),
        topKalams: topKalamsAgg.map(k => ({ name: k._id, count: k.count })),
        topParties: topPartiesAgg.map(p => ({ party: p.partyName, count: p.count })),
        topConsistentJamaats,
        topParticipationJamaats
    };

    await cacheService.set(cacheKey, stats, 300); // Cache for 5 mins

    return stats;
};

/**
 * Fetch Miqaat (Occasion) history for a specific Jamaat/Tenant.
 * Optimized: batches attendance stats and group lookups to avoid N+1 queries.
 */
exports.getTenantMiqaats = async (tenantId, limit = 5) => {
    const cacheKey = `miqaats:tenant:v1:${tenantId}:${limit}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    // 1. Fetch occasions
    const miqaats = await Occasion.find({ tenantId })
        .select('_id name start_at ends_at locationName created_by events images tenantId')
        .sort({ start_at: -1 })
        .limit(limit)
        .lean();

    if (miqaats.length === 0) {
        await cacheService.set(cacheKey, [], 300);
        return [];
    }

    // 2. Single query: total expected users (same for all Miqaats in this tenant)
    const totalExpected = await User.countDocuments({ tenantId });

    // 3. Single aggregation: attendance counts for all fetched Miqaats at once
    const miqaatIds = miqaats.map(m => m._id);
    const attendanceAgg = await Attendance.aggregate([
        { $match: { occasion: { $in: miqaatIds }, status: 'present' } },
        { $group: { _id: '$occasion', presentUsers: { $addToSet: '$user' } } },
        { $project: { _id: 1, presentCount: { $size: '$presentUsers' } } }
    ]);
    const attendanceMap = attendanceAgg.reduce((acc, a) => {
        acc[a._id.toString()] = a.presentCount;
        return acc;
    }, {});

    // 4. Single query: pre-load all groups for party name resolution
    const allGroups = await Group.find({ tenantId }, '_id name').lean();
    const groupMap = allGroups.reduce((acc, g) => {
        acc[g._id.toString()] = g.name;
        return acc;
    }, {});

    // 5. Assemble results (zero additional DB queries)
    const enhancedMiqaats = miqaats.map(m => {
        let totalPresent = attendanceMap[m._id.toString()] || 0;

        const attendanceRatio = totalExpected > 0 ? ((totalPresent / totalExpected) * 100).toFixed(1) : 0;

        const enhancedEvents = (m.events || []).map(ev => ({
            ...ev,
            partyName: ev.party ? (groupMap[ev.party] || ev.party) : ev.party
        }));

        return {
            ...m,
            events: enhancedEvents,
            attendanceStats: {
                present: totalPresent,
                expected: totalExpected,
                ratio: parseFloat(attendanceRatio)
            }
        };
    });

    await cacheService.set(cacheKey, enhancedMiqaats, 300);

    return enhancedMiqaats;
};

/**
 * Invalidate tenant and global stats caches when data changes.
 */
exports.invalidateTenantStats = async (tenantId) => {
    if (tenantId) {
        await cacheService.del(`stats:tenant:v2:${tenantId}`);
        await cacheService.del(`miqaats:tenant:v1:${tenantId}:5`);
    }
    await cacheService.del('stats:global:v2');
};
