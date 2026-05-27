const analyticsService = require('../services/analyticsService');
const asyncHandler = require('express-async-handler');

exports.getAttendanceAnalytics = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const results = await analyticsService.getAttendanceAnalytics(req.user, startDate, endDate);
    res.status(200).json(results);
});

exports.getKalamAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getKalamAnalytics();
    res.status(200).json(results);
});

exports.getPartyAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getPartyAnalytics();
    res.status(200).json(results);
});

exports.getOverviewAnalytics = asyncHandler(async (req, res) => {
    const results = await analyticsService.getOverviewAnalytics();
    res.status(200).json(results);
});

exports.getUserAnalytics = asyncHandler(async (req, res) => {
    const { userid } = req.params;
    const results = await analyticsService.getUserAnalytics(userid);
    res.status(200).json(results);
});
