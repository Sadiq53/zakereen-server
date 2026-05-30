const Kalam = require('../models/kalam');

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
    
    const results = [];
    for (const item of items) {
        if (!item || !item.name || typeof item.name !== 'string') continue;
        const normalized = item.name.trim();
        if (!normalized) continue;
        const itemType = item.type || 'kalam';

        const searchRegexStr = '^' + normalized.replace(/\s+/g, '\\s*') + '$';

        let kalam = await Kalam.findOne({ 
            name: { $regex: new RegExp(searchRegexStr, 'i') } 
        });
        
        if (!kalam) {
            kalam = await Kalam.create({ tenantId, name: normalized, type: itemType });
        }
        results.push(kalam);
    }
    return results;
};
