const Attendance = require('../models/attendance');
const Occasions = require('../models/occassion');
const User = require('../models/users');
const Group = require('../models/group');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { tenantQuery, tenantMatch } = require('../utils/tenantScope');


// --- String Matching Algorithms for Kalam Analytics ---
const normalizeString = (str) => {
    if (!str) return '';
    // Lowercase and remove all non-alphanumeric characters (including spaces)
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const levenshteinDistance = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1  // deletion
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

const calculateSimilarity = (str1, str2) => {
    const s1 = normalizeString(str1);
    const s2 = normalizeString(str2);
    
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;
    
    const distance = levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    return 1 - (distance / maxLength);
};
// ---------------------------------------------------

exports.getAttendanceAnalytics = async (tenantId, user, startDate, endDate) => {
    let matchStage = tenantMatch(tenantId);

    if (startDate && endDate) {
        matchStage.createdAt = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    const pipeline = [
        { $match: matchStage },
        {
            $group: {
                _id: "$user",
                totalPresent: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
                totalExcused: { $sum: { $cond: [{ $eq: ["$status", "excused"] }, 1, 0] } },
                totalOccasions: { $sum: 1 }
            }
        },
        {
            $addFields: {
                attendancePercentage: {
                    $cond: [
                        { $gt: ["$totalOccasions", 0] },
                        { $multiply: [ { $divide: ["$totalPresent", "$totalOccasions"] }, 100 ] },
                        0
                    ]
                }
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "_id",
                foreignField: "_id",
                as: "userData"
            }
        },
        { $unwind: { path: "$userData", preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 1,
                totalPresent: 1,
                totalOccasions: 1,
                attendancePercentage: 1,
                "userData.fullname": { $ifNull: ["$userData.fullname", "Former Member"] },
                "userData.profileImage": 1,
                "userData.belongsto": 1
            }
        },
        {
            $facet: {
                topMembers: [
                    { $sort: { attendancePercentage: -1, totalPresent: -1 } },
                    { $limit: 10 }
                ],
                bottomMembers: [
                    { $sort: { attendancePercentage: 1, totalPresent: 1 } },
                    { $limit: 10 }
                ],
                overallStats: [
                    {
                        $group: {
                            _id: null,
                            totalPresentAcrossAll: { $sum: "$totalPresent" },
                            totalOccasionsAcrossAll: { $sum: "$totalOccasions" },
                            averageAttendancePercentage: { $avg: "$attendancePercentage" }
                        }
                    }
                ]
            }
        }
    ];

    const results = await Attendance.aggregate(pipeline);
    return results[0];
};

exports.getKalamAnalytics = async (tenantId) => {
    const pipeline = [
        { $match: tenantMatch(tenantId) },
        { $unwind: "$events" },
        {
            $group: {
                _id: { type: "$events.type", name: "$events.name" },
                count: { $sum: 1 },
                partyNames: { $addToSet: "$events.party" }
            }
        },
        {
            $project: {
                _id: 0,
                type: "$_id.type",
                name: "$_id.name",
                count: 1,
                parties: "$partyNames"
            }
        }
    ];

    const exactKalams = await Occasions.aggregate(pipeline);

    const SIMILARITY_THRESHOLD = 0.60;
    const clusters = [];

    for (const item of exactKalams) {
        if (!item.name) continue;

        let matchedCluster = null;

        for (const cluster of clusters) {
            if (cluster.type === item.type) {
                const similarity = calculateSimilarity(item.name, cluster.canonicalName);
                if (similarity >= SIMILARITY_THRESHOLD) {
                    matchedCluster = cluster;
                    break;
                }
            }
        }

        if (matchedCluster) {
            matchedCluster.count += item.count;
            matchedCluster.parties = [...new Set([...matchedCluster.parties, ...(item.parties || [])])];
        } else {
            clusters.push({
                type: item.type,
                canonicalName: item.name,
                count: item.count,
                parties: item.parties ? [...item.parties] : []
            });
        }
    }

    return clusters.map(c => ({
        type: c.type,
        name: c.canonicalName,
        count: c.count,
        parties: c.parties
    })).sort((a, b) => b.count - a.count);
};

exports.getPartyAnalytics = async (tenantId) => {
    const totalGlobalOccasions = await Occasions.countDocuments(tenantQuery(tenantId, { status: "ended" }));
    const allGroups = await Group.find(tenantQuery(tenantId), '_id name').lean();
    const groupMap = allGroups.reduce((acc, g) => {
        acc[g._id.toString()] = g.name;
        return acc;
    }, {});
    
    const pipeline = [
        { $match: tenantMatch(tenantId, { status: "ended" }) },
        { $unwind: "$events" },
        { $match: { "events.party": { $ne: null, $ne: "" } } },
        {
            $group: {
                _id: { partyName: "$events.party" },
                totalTurns: { $sum: 1 },
                kalamsRecited: { $addToSet: "$events.name" },
                types: { $push: "$events.type" },
                lastParticipated: { $max: "$start_at" },
                occasionsParticipated: { $addToSet: "$_id" }
            }
        },
        {
            $project: {
                _id: 0,
                partyId: "$_id.partyName",
                totalTurns: 1,
                totalOccasionsParticipated: { $size: "$occasionsParticipated" },
                participationPercentage: {
                    $cond: [
                        { $gt: [totalGlobalOccasions, 0] },
                        { $multiply: [ { $divide: [{ $size: "$occasionsParticipated" }, totalGlobalOccasions] }, 100 ] },
                        0
                    ]
                },
                kalamsRecitedCount: { $size: "$kalamsRecited" },
                lastParticipated: 1,
                types: 1
            }
        },
        { $sort: { totalTurns: -1 } }
    ];

    let parties = await Occasions.aggregate(pipeline);
    
    parties = parties.map(p => {
        const typeCounts = p.types.reduce((acc, t) => {
            const type = t ? t.toLowerCase() : 'unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        
        const totalTypes = p.types.length;
        const typeBreakdown = {};
        for (const [t, count] of Object.entries(typeCounts)) {
            typeBreakdown[t] = totalTypes > 0 ? (count / totalTypes) * 100 : 0;
        }
        
        return {
            ...p,
            party: groupMap[p.partyId] || p.partyId,
            partyId: undefined,
            types: undefined,
            typeBreakdown
        };
    });

    return parties;
};

exports.getOverviewAnalytics = async (tenantId) => {
    const lastOccasion = await Occasions.findOne(tenantQuery(tenantId, { status: "ended" })).sort({ start_at: -1 }).lean();
    
    if (!lastOccasion) {
        return { message: "No completed occasions found" };
    }

    const attendanceStats = await Attendance.aggregate([
        { $match: { occasion: lastOccasion._id } },
        {
            $group: {
                _id: "$status",
                count: { $sum: 1 }
            }
        }
    ]);

    const allGroups = await Group.find(tenantQuery(tenantId), '_id name').lean();
    const groupMap = allGroups.reduce((acc, g) => {
        acc[g._id.toString()] = g.name;
        return acc;
    }, {});

    const formattedStats = {
        occasionName: lastOccasion.name,
        date: lastOccasion.start_at,
        attendance: attendanceStats.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, { present: 0, absent: 0, excused: 0 }),
        events: lastOccasion.events.map(e => ({
            name: e.name,
            type: e.type,
            party: groupMap[e.party] || e.party
        }))
    };

    return formattedStats;
};

exports.getUserAnalytics = async (tenantId, userid) => {
    const isObjectId = mongoose.Types.ObjectId.isValid(userid);
    
    const query = {
        $or: isObjectId ? [{ _id: userid }, { userid: String(userid) }] : [{ userid: String(userid) }]
    };
    Object.assign(query, tenantQuery(tenantId));

    const targetUser = await User.findOne(query);
    
    if (!targetUser) throw new AppError("User not found", 404);
    
    // Fallback: If accessed globally by rootadmin, use the user's native tenantId
    tenantId = tenantId || targetUser.tenantId;

    const attendanceStats = await Attendance.aggregate([
        { $match: { user: targetUser._id } },
        {
            $group: {
                _id: null,
                totalPresent: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
                totalOccasions: { $sum: 1 }
            }
        }
    ]);

    let attendancePercentage = 0;
    let totalPresent = 0;
    let totalOccasions = 0;
    if (attendanceStats.length > 0) {
        totalPresent = attendanceStats[0].totalPresent;
        totalOccasions = attendanceStats[0].totalOccasions;
        attendancePercentage = totalOccasions > 0 ? (totalPresent / totalOccasions) * 100 : 0;
    }

    let participationPercentage = 0;
    let partyName = targetUser.belongsto;

    if (partyName) {
        const group = await Group.findOne(tenantQuery(tenantId, { name: partyName })).lean();
        if (group) {
            const totalGlobalOccasions = await Occasions.countDocuments(tenantQuery(tenantId, { status: "ended" }));
            
            const partyOccasions = await Occasions.aggregate([
                { $match: tenantMatch(tenantId, { status: "ended" }) },
                { $unwind: "$events" },
                { $match: { "events.party": group._id.toString() } },
                {
                    $group: {
                        _id: "$_id" 
                    }
                }
            ]);

            const occasionsParticipated = partyOccasions.length;
            participationPercentage = totalGlobalOccasions > 0 ? (occasionsParticipated / totalGlobalOccasions) * 100 : 0;
        }
    }

    return {
        attendancePercentage,
        participationPercentage,
        totalPresent,
        totalOccasions
    };
};
