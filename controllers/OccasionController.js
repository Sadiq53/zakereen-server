const occasionService = require('../services/occasionService');
const asyncHandler = require('express-async-handler');

// POST /create
exports.createOccasion = asyncHandler(async (req, res) => {
    const newOccasion = await occasionService.createOccasion(req.body);
    res.status(201).json(newOccasion);
});

// PATCH /update/:id
exports.updateOccasion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updatedDoc = await occasionService.updateOccasion(req.user, id, req.body);
    res.status(200).json({ success: true, data: updatedDoc });
});

// PATCH /end/:id
exports.endOccasion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updatedDoc = await occasionService.endOccasion(id);
    res.status(200).json({ success: true, data: updatedDoc });
});

// PATCH /attendance/:id
exports.updateAttendance = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updatedDoc = await occasionService.updateAttendance(req.user, id, req.body);
    res.status(200).json({ success: true, data: updatedDoc });
});

// DELETE /remove/:id
exports.deleteOccasion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await occasionService.deleteOccasion(id);
    res.status(200).json({ success: true, message: "Occasion deleted successfully." });
});

// POST /image/:id
exports.uploadImage = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const fileBuffer = req.file ? req.file.buffer : null;
    const result = await occasionService.uploadImage(req.user, id, fileBuffer);
    res.status(200).json({ success: true, data: result.imageRecord, occasion: result.occasion });
});

// GET /fetch/all
exports.fetchAll = asyncHandler(async (req, res) => {
    const occasions = await occasionService.fetchAll();
    res.status(200).json(occasions);
});

// GET /fetch/paginated
exports.fetchPaginated = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const result = await occasionService.fetchPaginated(page, limit);
    res.status(200).json(result);
});

// GET /fetch/id/:id
exports.fetchById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const occasion = await occasionService.fetchById(id);
    res.status(200).json(occasion);
});

// GET /fetch/status
exports.fetchByStatus = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const occasions = await occasionService.fetchByStatus(status);
    res.status(200).json(occasions);
});

// GET /fetch/date/:date
exports.fetchByDate = asyncHandler(async (req, res) => {
    const { date } = req.params;
    const occasions = await occasionService.fetchByDate(date);
    res.status(200).json(occasions);
});

// GET /fetch/month/:month
exports.fetchByMonth = asyncHandler(async (req, res) => {
    const { month } = req.params;
    const occasions = await occasionService.fetchByMonth(month);
    res.status(200).json(occasions);
});

// GET /fetch/year/:year
exports.fetchByYear = asyncHandler(async (req, res) => {
    const { year } = req.params;
    const occasions = await occasionService.fetchByYear(year);
    res.status(200).json(occasions);
});

// GET /fetch/group
exports.fetchGrouped = asyncHandler(async (req, res) => {
    const groupedParties = await occasionService.fetchGrouped();
    res.status(200).json(groupedParties);
});