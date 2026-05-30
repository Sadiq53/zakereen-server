const VocalSession = require('../models/vocalSession');
const AppError = require('../utils/appError');

exports.createSession = async (data) => {
    const newSession = new VocalSession(data);
    await newSession.save();
    return newSession;
};

exports.updateSession = async (id, updateData) => {
    const session = await VocalSession.findById(id);
    if (!session) {
        throw new AppError('Vocal session not found', 404);
    }

    Object.keys(updateData).forEach(key => {
        session[key] = updateData[key];
    });

    const updatedSession = await session.save();
    return updatedSession;
};

exports.deleteSession = async (id) => {
    const session = await VocalSession.findByIdAndDelete(id);
    if (!session) {
        throw new AppError('Vocal session not found', 404);
    }
    return true;
};

exports.fetchActiveSessions = async () => {
    // Fetch only active sessions for the mobile app
    const sessions = await VocalSession.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    return sessions;
};

exports.fetchAllSessions = async () => {
    // Fetch all sessions (active and inactive) for the admin panel
    const sessions = await VocalSession.find().sort({ order: 1, createdAt: 1 });
    return sessions;
};

exports.fetchSessionById = async (id) => {
    const session = await VocalSession.findById(id);
    if (!session) {
        throw new AppError('Vocal session not found', 404);
    }
    return session;
};
