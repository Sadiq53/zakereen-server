const Attendance = require('../models/attendance');
const Occasions = require('../models/occassion');
const User = require('../models/users');
const Group = require('../models/group');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const cacheService = require('./cacheService');
const { tenantQuery, tenantMatch } = require('../utils/tenantScope');

// ─── Canonical Kalam TYPES (mirrors middlewares/validateUtils.js allowedTypes & mobile KALAM_OPTIONS) ──
const KALAM_TYPES = [
    'dua', 'ilteja', 'madeh', 'manqabat', 'manzumaat', 'munajaat',
    'naat', 'nasheed', 'nasihat', 'noha', 'qasida', 'risa', 'salam',
];
const typeLabel = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Unknown');

const CACHE_TTL = 300; // 5 minutes
const cacheKey = (name, tenantId) => `analytics:${name}:v1:${tenantId || 'global'}`;

// ─── Party performance-score weights (documented, tunable) ────────────────────
const PARTY_SCORE_WEIGHTS = {
    attendanceConsistency: 0.30,
    participationFrequency: 0.25,
    participationFairness: 0.20,
    kalamDiversity: 0.15,
    memberAttendanceQuality: 0.10,
};

// ─── Recommendation-engine weights ────────────────────────────────────────────
const SUGGESTION_WEIGHTS = {
    typeFairness: 0.35,
    participationFairness: 0.25,
    attendanceConsistency: 0.25,
    recencyPenalty: 0.15,
};

// --- String matching for Kalam name clustering (kept; now cached) ---
const normalizeString = (str) => (str ? String(str).toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const levenshteinDistance = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[b.length][a.length];
};
const calculateSimilarity = (s1n, s2n) => {
    if (s1n === s2n) return 1.0;
    if (!s1n.length || !s2n.length) return 0.0;
    return 1 - levenshteinDistance(s1n, s2n) / Math.max(s1n.length, s2n.length);
};

// ─── Shared analytics context ─────────────────────────────────────────────────
// Loads exactly what every tab needs, ONCE, without pulling the full attendance
// table into memory: ended occasions (+events), groups, tenant users, and two
// lightweight present-count aggregations (per-user and per-occasion).
async function buildContext(tenantId) {
    const [occasions, groups, users, totalMembers] = await Promise.all([
        Occasions.find(
            tenantQuery(tenantId, { status: 'ended' }),
            'name start_at hijri_date location locationName status events'
        ).sort({ start_at: 1 }).lean(),
        Group.find(tenantQuery(tenantId), '_id name admin members').lean(),
        User.find(tenantQuery(tenantId), '_id fullname userid title belongsto role profileImage').lean(),
        User.countDocuments(tenantQuery(tenantId)),
    ]);

    const endedIds = occasions.map((o) => o._id);
    const [presentByOccAgg, presentByUserAgg] = endedIds.length
        ? await Promise.all([
            Attendance.aggregate([
                { $match: tenantMatch(tenantId, { status: 'present', occasion: { $in: endedIds } }) },
                { $group: { _id: '$occasion', c: { $sum: 1 } } },
            ]),
            Attendance.aggregate([
                { $match: tenantMatch(tenantId, { status: 'present', occasion: { $in: endedIds } }) },
                { $group: { _id: '$user', c: { $sum: 1 } } },
            ]),
        ])
        : [[], []];

    const presentCountByOccasion = new Map(presentByOccAgg.map((r) => [String(r._id), r.c]));
    const presentCountByUser = new Map(presentByUserAgg.map((r) => [String(r._id), r.c]));

    const groupById = new Map();
    const groupByName = new Map();
    for (const g of groups) {
        groupById.set(String(g._id), g);
        if (g.name) groupByName.set(g.name.toLowerCase(), g);
    }
    // events.party stores a stringified Group _id, but legacy rows may hold a name.
    const resolveGroup = (party) => {
        if (!party) return null;
        const s = String(party);
        return groupById.get(s) || groupByName.get(s.toLowerCase()) || null;
    };

    const usersById = new Map(users.map((u) => [String(u._id), u]));
    const totalEnded = occasions.length;
    const memberRate = (userId) => (totalEnded > 0 ? (presentCountByUser.get(String(userId)) || 0) / totalEnded : 0);

    return {
        tenantId, occasions, groups, users, usersById, totalMembers, totalEnded,
        groupById, groupByName, resolveGroup, presentCountByOccasion, presentCountByUser, memberRate,
    };
}

const avgRating = (rating) => {
    const scores = (rating || []).map((r) => r && r.score).filter((s) => typeof s === 'number' && s > 0);
    if (!scores.length) return { avg: 0, count: 0 };
    return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Recent Miqaat snapshot (enriched overview)
// ══════════════════════════════════════════════════════════════════════════════
exports.getOverviewAnalytics = async (tenantId) => {
    const key = cacheKey('overview', tenantId);
    const cached = await cacheService.get(key);
    if (cached) return cached;

    const ctx = await buildContext(tenantId);
    if (!ctx.totalEnded) {
        const empty = { message: 'No completed occasions found' };
        return empty;
    }

    const last = ctx.occasions[ctx.occasions.length - 1]; // sorted asc → last = most recent
    const presentRows = await Attendance.find(
        tenantQuery(tenantId, { occasion: last._id, status: 'present' }), 'user'
    ).lean();
    const presentSet = new Set(presentRows.map((r) => String(r.user)));

    const totalMembers = ctx.totalMembers;
    const totalAttendees = presentSet.size;
    const attendancePercentage = totalMembers > 0 ? (totalAttendees / totalMembers) * 100 : 0;
    const quality = attendancePercentage >= 80 ? 'excellent' : attendancePercentage >= 50 ? 'good' : 'low';

    // Full member list for instant client-side search (name / ITS) with attended flag.
    const attendees = ctx.users.map((u) => ({
        userId: String(u._id),
        fullname: u.fullname || 'Member',
        userid: u.userid,
        title: u.title || '',
        belongsto: u.belongsto || '',
        attended: presentSet.has(String(u._id)),
    })).sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''));

    const events = (last.events || []).map((e) => {
        const g = ctx.resolveGroup(e.party);
        const r = avgRating(e.rating);
        return {
            type: e.type || null,
            typeLabel: typeLabel(e.type),
            name: e.name || null,
            party: g ? g.name : (e.party || null),
            avgRating: Math.round(r.avg * 10) / 10,
            ratingCount: r.count,
        };
    });

    const result = {
        occasion: {
            name: last.name,
            date: last.start_at,
            time: last.start_at,
            hijriDate: last.hijri_date || null,
            location: last.locationName || last.location || null,
        },
        summary: { totalMembers, totalAttendees, attendancePercentage, quality },
        attendees,
        events,
    };

    await cacheService.set(key, result, CACHE_TTL);
    return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2a — Kalam analytics grouped by TYPE
// ══════════════════════════════════════════════════════════════════════════════
exports.getKalamAnalytics = async (tenantId) => {
    const key = cacheKey('kalams', tenantId);
    const cached = await cacheService.get(key);
    if (cached) return cached;

    // Count exact (type,name) pairs across ALL occasions in the tenant.
    const exact = await Occasions.aggregate([
        { $match: tenantMatch(tenantId) },
        { $unwind: '$events' },
        { $match: { 'events.name': { $ne: null, $ne: '' } } },
        { $group: { _id: { type: '$events.type', name: '$events.name' }, count: { $sum: 1 } } },
    ]);

    // Cluster near-duplicate names WITHIN a type (fuzzy), then group by type.
    const SIMILARITY_THRESHOLD = 0.6;
    const byType = new Map(); // type -> [{ name, norm, count }]
    for (const item of exact) {
        if (!item._id.name) continue;
        const type = (item._id.type || 'unknown').toLowerCase();
        const norm = normalizeString(item._id.name);
        if (!byType.has(type)) byType.set(type, []);
        const clusters = byType.get(type);
        let matched = null;
        for (const c of clusters) {
            if (calculateSimilarity(norm, c.norm) >= SIMILARITY_THRESHOLD) { matched = c; break; }
        }
        if (matched) matched.count += item.count;
        else clusters.push({ name: item._id.name, norm, count: item.count });
    }

    const result = [...byType.entries()].map(([type, clusters]) => {
        const totalCount = clusters.reduce((a, c) => a + c.count, 0);
        return {
            type,
            typeLabel: typeLabel(type),
            totalCount,
            kalams: clusters
                .map((c) => ({ name: c.name, count: c.count, pct: totalCount > 0 ? (c.count / totalCount) * 100 : 0 }))
                .sort((a, b) => b.count - a.count),
        };
    }).sort((a, b) => b.totalCount - a.totalCount);

    await cacheService.set(key, result, CACHE_TTL);
    return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2b — Attendance analytics (fixed denominator + overall + trend + ranking)
// ══════════════════════════════════════════════════════════════════════════════
exports.getAttendanceAnalytics = async (tenantId) => {
    const key = cacheKey('attendance', tenantId);
    const cached = await cacheService.get(key);
    if (cached) return cached;

    const ctx = await buildContext(tenantId);
    const totalEnded = ctx.totalEnded;

    // Per-member ranking — denominator is total ELIGIBLE (ended) miqaats, not the
    // member's own attendance-row count (the previous bug).
    const ranked = ctx.users.map((u) => {
        const attended = ctx.presentCountByUser.get(String(u._id)) || 0;
        const attendancePercentage = totalEnded > 0 ? Math.min(100, (attended / totalEnded) * 100) : 0;
        return {
            userId: String(u._id),
            fullname: u.fullname || 'Member',
            userid: u.userid,
            belongsto: u.belongsto || '',
            attended,
            totalEligible: totalEnded,
            attendancePercentage,
        };
    });

    const topMembers = [...ranked].sort((a, b) => b.attendancePercentage - a.attendancePercentage || b.attended - a.attended).slice(0, 10);
    const bottomMembers = [...ranked].sort((a, b) => a.attendancePercentage - b.attendancePercentage || a.attended - b.attended).slice(0, 10);

    // Overall + trend (per-occasion present count / totalMembers).
    let presentSum = 0;
    const trend = ctx.occasions.map((o) => {
        const present = ctx.presentCountByOccasion.get(String(o._id)) || 0;
        presentSum += present;
        return {
            occasionId: String(o._id),
            name: o.name,
            date: o.start_at,
            present,
            percentage: ctx.totalMembers > 0 ? (present / ctx.totalMembers) * 100 : 0,
        };
    });
    const avgAttendancePerMiqaat = totalEnded > 0 ? presentSum / totalEnded : 0;
    const overallAttendancePercentage = (ctx.totalMembers > 0 && totalEnded > 0)
        ? (presentSum / (ctx.totalMembers * totalEnded)) * 100 : 0;

    const result = {
        overall: {
            totalMiqaatsHeld: totalEnded,
            totalMembers: ctx.totalMembers,
            avgAttendancePerMiqaat: Math.round(avgAttendancePerMiqaat * 10) / 10,
            overallAttendancePercentage,
        },
        trend: trend.slice(-12), // last 12 for a compact sparkline
        topMembers,
        bottomMembers,
    };

    await cacheService.set(key, result, CACHE_TTL);
    return result;
};

// ── Shared per-party aggregate used by leaderboard + suggestions ──────────────
function computePartyStats(ctx) {
    // partyId -> stats
    const stats = new Map();
    const ensure = (g) => {
        const id = String(g._id);
        if (!stats.has(id)) {
            stats.set(id, {
                partyId: id, name: g.name, admin: g.admin, members: g.members || [],
                turns: 0, typeCount: {}, occasionSet: new Set(), lastType: null, lastIdx: -1,
            });
        }
        return stats.get(id);
    };

    ctx.occasions.forEach((occ, idx) => {
        (occ.events || []).forEach((ev) => {
            const g = ctx.resolveGroup(ev.party);
            if (!g) return;
            const s = ensure(g);
            const t = (ev.type || '').toLowerCase();
            s.turns += 1;
            s.occasionSet.add(String(occ._id));
            if (t) {
                s.typeCount[t] = (s.typeCount[t] || 0) + 1;
                s.lastType = t;
                s.lastIdx = idx;
            }
        });
    });

    // Ensure every group appears (even with zero turns) for fair suggestions.
    ctx.groups.forEach((g) => ensure(g));

    // Attendance rate per party = mean of member overall attendance rates.
    for (const s of stats.values()) {
        const rates = (s.members || []).map((m) => ctx.memberRate(m));
        s.memberAttendanceRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
        s.participationCount = s.occasionSet.size;
    }
    return stats;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Party performance leaderboard
// ══════════════════════════════════════════════════════════════════════════════
exports.getPartyAnalytics = async (tenantId) => {
    const key = cacheKey('parties', tenantId);
    const cached = await cacheService.get(key);
    if (cached) return cached;

    const ctx = await buildContext(tenantId);
    const stats = [...computePartyStats(ctx).values()];
    const totalEnded = ctx.totalEnded || 0;

    const maxParticipation = Math.max(1, ...stats.map((s) => s.participationCount));
    const meanPct = stats.length
        ? stats.reduce((a, s) => a + (totalEnded > 0 ? s.participationCount / totalEnded : 0), 0) / stats.length
        : 0;
    const tenantAvgMemberRate = ctx.users.length
        ? ctx.users.reduce((a, u) => a + ctx.memberRate(u._id), 0) / ctx.users.length
        : 0;

    let parties = stats.map((s) => {
        // Kalam-type breakdown across all 13 types (+ any others), as % of turns.
        const typeBreakdown = {};
        KALAM_TYPES.forEach((t) => { typeBreakdown[t] = 0; });
        let others = 0;
        for (const [t, c] of Object.entries(s.typeCount)) {
            const pct = s.turns > 0 ? (c / s.turns) * 100 : 0;
            if (KALAM_TYPES.includes(t)) typeBreakdown[t] = pct; else others += pct;
        }
        const distinctTypes = Object.keys(s.typeCount).length;

        const participationPct = totalEnded > 0 ? (s.participationCount / totalEnded) * 100 : 0;

        // ── Weighted performance score (0-100) ──
        const attendanceConsistency = s.memberAttendanceRate; // 0..1
        const participationFrequency = s.participationCount / maxParticipation; // 0..1
        const participationFairness = meanPct > 0
            ? Math.max(0, 1 - Math.abs((participationPct / 100) - meanPct) / meanPct) : 1;
        const kalamDiversity = s.turns > 0 ? distinctTypes / Math.min(KALAM_TYPES.length, s.turns) : 0;
        const memberAttendanceQuality = (s.members && s.members.length)
            ? s.members.filter((m) => ctx.memberRate(m) >= tenantAvgMemberRate).length / s.members.length : 0;

        const performanceScore = 100 * (
            PARTY_SCORE_WEIGHTS.attendanceConsistency * attendanceConsistency +
            PARTY_SCORE_WEIGHTS.participationFrequency * participationFrequency +
            PARTY_SCORE_WEIGHTS.participationFairness * participationFairness +
            PARTY_SCORE_WEIGHTS.kalamDiversity * kalamDiversity +
            PARTY_SCORE_WEIGHTS.memberAttendanceQuality * memberAttendanceQuality
        );

        const adminUser = ctx.usersById.get(String(s.admin));
        return {
            partyId: s.partyId,
            party: s.name,
            admin: adminUser ? adminUser.fullname : null,
            memberCount: (s.members || []).length,
            participationCount: s.participationCount,
            participationPct,
            totalTurns: s.turns,
            memberAttendanceRate: attendanceConsistency * 100,
            typeBreakdown: { ...typeBreakdown, others },
            distinctTypes,
            performanceScore: Math.round(performanceScore * 10) / 10,
            scoreBreakdown: {
                attendanceConsistency: Math.round(attendanceConsistency * 100),
                participationFrequency: Math.round(participationFrequency * 100),
                participationFairness: Math.round(participationFairness * 100),
                kalamDiversity: Math.round(kalamDiversity * 100),
                memberAttendanceQuality: Math.round(memberAttendanceQuality * 100),
            },
        };
    });

    parties.sort((a, b) => b.performanceScore - a.performanceScore);
    parties = parties.map((p, i) => ({ ...p, rank: i + 1 }));

    await cacheService.set(key, parties, CACHE_TTL);
    return parties;
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — Smart recitation suggestion engine (deterministic, fair, explainable)
// ══════════════════════════════════════════════════════════════════════════════
// Heavy per-party stats for the engine — cached + bustable (independent of the
// caller's selected types so the type filter stays a cheap in-memory step).
async function getSuggestionStats(tenantId) {
    const key = cacheKey('suggestions-stats', tenantId);
    const cached = await cacheService.get(key);
    if (cached) return cached;

    const ctx = await buildContext(tenantId);
    const stats = [...computePartyStats(ctx).values()].map((s) => {
        const adminUser = ctx.usersById.get(String(s.admin));
        return {
            partyId: s.partyId, name: s.name, admin: adminUser ? adminUser.fullname : null,
            turns: s.turns, typeCount: s.typeCount, lastType: s.lastType,
            memberAttendanceRate: s.memberAttendanceRate, participationCount: s.participationCount,
        };
    });
    await cacheService.set(key, stats, CACHE_TTL);
    return stats;
}

exports.getSuggestions = async (tenantId, allowedTypes) => {
    const stats = await getSuggestionStats(tenantId);

    if (!stats.length) {
        return { suggestions: [], meta: { message: 'No parties available.' } };
    }

    // Types to rotate over: caller-selected (validated) → historical → all 13.
    const valid = (allowedTypes || []).map((t) => String(t).toLowerCase()).filter((t) => KALAM_TYPES.includes(t));
    const typesUsedSet = new Set();
    stats.forEach((s) => Object.keys(s.typeCount).forEach((t) => typesUsedSet.add(t)));
    let types;
    if (valid.length) types = [...new Set(valid)].sort();
    else if (typesUsedSet.size) types = [...typesUsedSet].sort();
    else types = KALAM_TYPES.slice();

    const maxTurns = Math.max(1, ...stats.map((s) => s.turns));
    const avgTurns = stats.reduce((a, s) => a + s.turns, 0) / stats.length;
    const maxTypeCountFor = {};
    const sumTypeCountFor = {};
    types.forEach((t) => {
        maxTypeCountFor[t] = Math.max(1, ...stats.map((s) => s.typeCount[t] || 0));
        sumTypeCountFor[t] = stats.reduce((a, s) => a + (s.typeCount[t] || 0), 0);
    });

    const scoreFor = (s, t) => {
        const typeFairness = 1 - (s.typeCount[t] || 0) / maxTypeCountFor[t];
        const participationFairness = 1 - s.turns / maxTurns;
        const attendanceConsistency = s.memberAttendanceRate;
        const recencyPenalty = s.lastType === t ? 1 : 0;
        return SUGGESTION_WEIGHTS.typeFairness * typeFairness
            + SUGGESTION_WEIGHTS.participationFairness * participationFairness
            + SUGGESTION_WEIGHTS.attendanceConsistency * attendanceConsistency
            - SUGGESTION_WEIGHTS.recencyPenalty * recencyPenalty;
    };

    // Build all (party,type) candidates, deterministically ordered.
    const candidates = [];
    for (const s of stats) {
        for (const t of types) candidates.push({ pid: s.partyId, t, score: scoreFor(s, t) });
    }
    candidates.sort((a, b) => b.score - a.score || a.pid.localeCompare(b.pid) || a.t.localeCompare(b.t));

    const statById = new Map(stats.map((s) => [s.partyId, s]));
    const assignedParties = new Set();
    const usedTypes = new Set();
    const assignments = new Map(); // pid -> { t, score }

    // Pass 1: distinct types per round (matches A→Noha / B→Madeh / C→Salam rotation).
    for (const c of candidates) {
        if (assignedParties.has(c.pid) || usedTypes.has(c.t)) continue;
        assignments.set(c.pid, { t: c.t, score: c.score });
        assignedParties.add(c.pid);
        usedTypes.add(c.t);
        if (assignedParties.size === stats.length || usedTypes.size === types.length) break;
    }
    // Pass 2: parties still unassigned (more parties than types) — allow type reuse.
    if (assignedParties.size < stats.length) {
        for (const c of candidates) {
            if (assignedParties.has(c.pid)) continue;
            assignments.set(c.pid, { t: c.t, score: c.score });
            assignedParties.add(c.pid);
        }
    }

    const suggestions = stats.map((s) => {
        const a = assignments.get(s.partyId);
        const t = a ? a.t : types[0];
        const typeCountForParty = s.typeCount[t] || 0;
        const avgTypeForT = stats.length ? sumTypeCountFor[t] / stats.length : 0;
        const attPct = Math.round(s.memberAttendanceRate * 100);

        const reasons = [];
        reasons.push(`fewest ${typeLabel(t)} opportunities historically (${typeCountForParty} vs avg ${avgTypeForT.toFixed(1)})`);
        reasons.push(`${s.turns < avgTurns ? 'below' : 'at/above'}-average participation (${s.turns} vs ${avgTurns.toFixed(1)} turns)`);
        reasons.push(`${attPct}% member attendance consistency`);
        if (s.lastType && s.lastType !== t) reasons.push(`avoids repeating last recitation (${typeLabel(s.lastType)})`);

        return {
            partyId: s.partyId,
            party: s.name,
            admin: s.admin || null,
            suggestedType: t,
            suggestedTypeLabel: typeLabel(t),
            score: Math.round(Math.max(0, Math.min(1, (a ? a.score : 0))) * 100),
            reason: `Recommended because this party has ${reasons.join(', ')}.`,
            stats: {
                totalTurns: s.turns,
                participationCount: s.participationCount,
                attendanceRate: attPct,
                typeCountForSuggested: typeCountForParty,
            },
        };
    }).sort((a, b) => b.score - a.score);

    return {
        suggestions,
        meta: {
            partiesConsidered: stats.length,
            typesConsidered: types.length,
            selectedTypes: types,
            weights: SUGGESTION_WEIGHTS,
            generatedFor: 'next miqaat',
        },
    };
};

// ══════════════════════════════════════════════════════════════════════════════
// Per-user analytics (ProfileScreen) — participation now ATTENDANCE-GATED
// ══════════════════════════════════════════════════════════════════════════════
exports.getUserAnalytics = async (tenantId, userid) => {
    const isObjectId = mongoose.Types.ObjectId.isValid(userid);
    const query = { $or: isObjectId ? [{ _id: userid }, { userid: String(userid) }] : [{ userid: String(userid) }] };
    Object.assign(query, tenantQuery(tenantId));

    const targetUser = await User.findOne(query);
    if (!targetUser) throw new AppError('User not found', 404);
    tenantId = tenantId || targetUser.tenantId;

    const totalEnded = await Occasions.countDocuments(tenantQuery(tenantId, { status: 'ended' }));

    // Attendance: present rows / total eligible (ended) miqaats.
    const totalPresent = await Attendance.countDocuments(tenantQuery(tenantId, { user: targetUser._id, status: 'present' }));
    const attendancePercentage = totalEnded > 0 ? Math.min(100, (totalPresent / totalEnded) * 100) : 0;

    // Participation (attendance-gated): of the ended miqaats where the member's
    // PARTY was assigned a recitation, how many did the member ACTUALLY attend.
    let participationPercentage = 0;
    let partyOpportunities = 0;
    let attendedOpportunities = 0;
    if (targetUser.belongsto) {
        const group = await Group.findOne(tenantQuery(tenantId, { name: targetUser.belongsto })).lean();
        if (group) {
            const gid = String(group._id);
            const assigned = await Occasions.find(
                tenantQuery(tenantId, { status: 'ended', 'events.party': { $in: [gid, group.name] } }), '_id'
            ).lean();
            partyOpportunities = assigned.length;
            if (partyOpportunities > 0) {
                attendedOpportunities = await Attendance.countDocuments(
                    tenantQuery(tenantId, { user: targetUser._id, status: 'present', occasion: { $in: assigned.map((o) => o._id) } })
                );
                participationPercentage = (attendedOpportunities / partyOpportunities) * 100;
            }
        }
    }

    return {
        attendancePercentage,
        participationPercentage,
        totalPresent,
        totalOccasions: totalEnded,
        partyOpportunities,
        attendedOpportunities,
    };
};
