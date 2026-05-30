const kalamService = require('../services/kalamService');
const asyncHandler = require('express-async-handler');

exports.fetchKalams = asyncHandler(async (req, res) => {
    const { q } = req.query;
    const kalams = await kalamService.fetchKalams(req.tenantId, q);
    res.status(200).json(kalams);
});

exports.syncKalams = asyncHandler(async (req, res) => {
    const { items } = req.body;
    const synced = await kalamService.syncKalams(req.tenantId, items);
    res.status(201).json({ success: true, data: synced });
});
