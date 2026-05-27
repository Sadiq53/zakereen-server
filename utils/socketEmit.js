const { getIO } = require("../config/socket");

function emitOccasionCreated(occasion) {
    const tenantId = occasion.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('occasion:created', { occasion, timestamp: new Date() }); }
}

function emitOccasionUpdated(occasion) {
    const tenantId = occasion.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('occasion:updated', { occasion, timestamp: new Date() }); }
}

function emitOccasionDeleted(tenantId, occasionId) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('occasion:deleted', { occasionId, timestamp: new Date() }); }
}

function emitAttendanceUpdated(attendance) {
    const tenantId = attendance.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('occasion:attendance-updated', { attendance, timestamp: new Date() }); }
}

function emitEventsGrouped(tenantId, groupedParties) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('occasion:events-grouped', { groupedParties, timestamp: new Date() }); }
}

function emitOccasionsFetched(tenantId, occasions) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('occasion:fetched-all', { occasions, timestamp: new Date() }); }
}

module.exports = {
    emitOccasionCreated,
    emitOccasionUpdated,
    emitOccasionDeleted,
    emitAttendanceUpdated,
    emitEventsGrouped,
    emitOccasionsFetched
};
