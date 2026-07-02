const analyticsService = require('../services/analyticsService');
const asyncHandler = require('express-async-handler');

exports.getAttendanceAnalytics = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const results = await analyticsService.getAttendanceAnalytics(req.tenantId, req.user, startDate, endDate);
    res.status(200).json({ success: true, data: results });
});

exports.getKalamAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getKalamAnalytics(req.tenantId);
    res.status(200).json({ success: true, data: results });
});

exports.getPartyAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getPartyAnalytics(req.tenantId);
    res.status(200).json({ success: true, data: results });
});

exports.getOverviewAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getOverviewAnalytics(req.tenantId);
    res.status(200).json({ success: true, data: results });
});

exports.getUserAnalytics = asyncHandler(async (req, res) => {
    const { userid } = req.params;
    const results = await analyticsService.getUserAnalytics(req.tenantId, userid);
    res.status(200).json({ success: true, data: results });
});
