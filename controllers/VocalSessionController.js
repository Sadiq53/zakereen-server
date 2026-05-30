const vocalSessionService = require('../services/vocalSessionService');
const asyncHandler = require('express-async-handler');

// POST /create
exports.createSession = asyncHandler(async (req, res) => {
    const newSession = await vocalSessionService.createSession(req.body);
    res.status(201).json({ success: true, data: newSession });
});

// PATCH /update/:id
exports.updateSession = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updatedSession = await vocalSessionService.updateSession(id, req.body);
    res.status(200).json({ success: true, data: updatedSession });
});

// DELETE /remove/:id
exports.deleteSession = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await vocalSessionService.deleteSession(id);
    res.status(200).json({ success: true, message: "Vocal session deleted successfully." });
});

// GET /fetch/active
exports.fetchActiveSessions = asyncHandler(async (req, res) => {
    const sessions = await vocalSessionService.fetchActiveSessions();
    res.status(200).json({ success: true, data: sessions });
});

// GET /fetch/all
exports.fetchAllSessions = asyncHandler(async (req, res) => {
    const sessions = await vocalSessionService.fetchAllSessions();
    res.status(200).json({ success: true, data: sessions });
});

// GET /fetch/id/:id
exports.fetchSessionById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const session = await vocalSessionService.fetchSessionById(id);
    res.status(200).json({ success: true, data: session });
});
