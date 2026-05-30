const SavedLocation = require('../models/savedLocation');
const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');

// GET /locations
exports.getLocations = asyncHandler(async (req, res) => {
    const locations = await SavedLocation.find({ tenantId: req.tenantId }).sort({ name: 1 });
    res.status(200).json(locations);
});

// POST /locations
exports.createLocation = asyncHandler(async (req, res) => {
    const { name, address, latitude, longitude } = req.body;
    
    if (!name || latitude == null || longitude == null) {
        throw new AppError('Name, latitude, and longitude are required', 400);
    }

    const location = await SavedLocation.create({
        tenantId: req.tenantId,
        name,
        address,
        latitude,
        longitude,
        createdBy: req.user._id
    });

    res.status(201).json(location);
});

// DELETE /locations/:id
exports.deleteLocation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deleted = await SavedLocation.findOneAndDelete({ _id: id, tenantId: req.tenantId });
    
    if (!deleted) {
        throw new AppError('Saved location not found', 404);
    }

    res.status(200).json({ success: true, message: 'Saved location deleted' });
});
