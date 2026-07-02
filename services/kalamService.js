const Kalam = require('../models/kalam');

const normalizeString = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const getBigrams = (str) => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
};

const bigramSimilarity = (b1, b2) => {
    if (b1.size === 0 || b2.size === 0) return 0;
    let intersection = 0;
    for (const bg of b1) {
        if (b2.has(bg)) intersection++;
    }
    return intersection / Math.min(b1.size, b2.size);
};

exports.fetchKalams = async (tenantId, searchQuery) => {
    let query = {}; // Cross-tenant: fetch all
    if (searchQuery) {
        query.name = { $regex: new RegExp(searchQuery, 'i') };
    }
    // Return max 50 kalams for autocomplete
    return await Kalam.find(query).sort({ name: 1 }).limit(50);
};

exports.syncKalams = async (tenantId, items) => {
    if (!items || !Array.isArray(items)) return [];
    
    // 1. Fetch all existing Kalams globally
    const existingKalams = await Kalam.find({}).lean();
    
    // 2. Pre-compute bigrams for all existing Kalams in memory
    const kalamsCache = existingKalams.map(k => ({
        ...k,
        normalizedName: normalizeString(k.name),
        bigrams: getBigrams(normalizeString(k.name))
    }));

    const results = [];
    for (const item of items) {
        if (!item || !item.name || typeof item.name !== 'string') continue;
        const originalName = item.name.trim();
        if (!originalName) continue;
        const itemType = item.type || 'kalam';

        const normalizedInput = normalizeString(originalName);
        const inputBigrams = getBigrams(normalizedInput);

        let matchedKalam = null;

        // Very short strings (1 char) have no bigrams, handle exact match fallback
        if (inputBigrams.size === 0) {
            matchedKalam = kalamsCache.find(k => k.normalizedName === normalizedInput);
        } else {
            // Find the best match using Bigram Set Intersection
            let bestSim = 0;
            let bestMatch = null;

            for (const cached of kalamsCache) {
                const sim = bigramSimilarity(inputBigrams, cached.bigrams);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestMatch = cached;
                }
            }

            if (bestSim >= 0.85) { // 85% match threshold
                matchedKalam = bestMatch;
            }
        }
        
        if (matchedKalam) {
            results.push(matchedKalam);
        } else {
            // Create new Kalam globally
            const newKalam = await Kalam.create({ name: originalName, type: itemType });
            results.push(newKalam);
            
            // Add to in-memory cache to prevent intra-batch duplicates
            kalamsCache.push({
                _id: newKalam._id,
                name: newKalam.name,
                type: newKalam.type,
                normalizedName: normalizedInput,
                bigrams: inputBigrams
            });
        }
    }
    return results;
};
