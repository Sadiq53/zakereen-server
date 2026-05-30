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

function emitGroupCreated(group) {
    const tenantId = group.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('group:created', { group, timestamp: new Date() }); }
}

function emitGroupUpdated(group) {
    const tenantId = group.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('group:updated', { group, timestamp: new Date() }); }
}

function emitGroupDeleted(tenantId, groupId) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('group:deleted', { groupId, timestamp: new Date() }); }
}

function emitUserCreated(user) {
    const tenantId = user.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('user:created', { user, timestamp: new Date() }); }
}

function emitUserUpdated(user) {
    const tenantId = user.tenantId?.toString();
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId}`).emit('user:updated', { user, timestamp: new Date() }); }
}

function emitUserDeleted(tenantId, userId) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('user:deleted', { userId, timestamp: new Date() }); }
}

function emitEventsGrouped(tenantId, groupedParties) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('occasion:events-grouped', { groupedParties, timestamp: new Date() }); }
}

function emitOccasionsFetched(tenantId, occasions) {
    const io = getIO();
    if (tenantId) { io.to(`tenant:${tenantId.toString()}`).emit('occasion:fetched-all', { occasions, timestamp: new Date() }); }
}

function emitNewAnnouncement(groupId, message) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:new_message', { message, timestamp: new Date() }); }
}

function emitAnnouncementReaction(groupId, messageId, reactions) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:reaction_updated', { messageId, reactions, timestamp: new Date() }); }
}

function emitAnnouncementPollUpdate(groupId, messageId, poll) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:poll_updated', { messageId, poll, timestamp: new Date() }); }
}

function emitAnnouncementGroupUpdated(groupId, group) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:group_updated', { group, timestamp: new Date() }); }
}

function emitAnnouncementMessageEdited(groupId, messageId, content, isEdited) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:message_edited', { messageId, content, isEdited, timestamp: new Date() }); }
}

function emitAnnouncementMessageDeleted(groupId, messageId) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:message_deleted', { messageId, timestamp: new Date() }); }
}
function emitAnnouncementMessagePinned(groupId, message) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:message_pinned', { groupId: groupId.toString(), message, timestamp: new Date() }); }
}

function emitAnnouncementMessageUnpinned(groupId) {
    const io = getIO();
    if (groupId) { io.to(`announcement:${groupId.toString()}`).emit('announcement:message_unpinned', { groupId: groupId.toString(), timestamp: new Date() }); }
}

module.exports = {
    emitOccasionCreated,
    emitOccasionUpdated,
    emitOccasionDeleted,
    emitAttendanceUpdated,
    emitEventsGrouped,
    emitOccasionsFetched,
    emitGroupCreated,
    emitGroupUpdated,
    emitGroupDeleted,
    emitUserCreated,
    emitUserUpdated,
    emitUserDeleted,
    emitNewAnnouncement,
    emitAnnouncementReaction,
    emitAnnouncementPollUpdate,
    emitAnnouncementGroupUpdated,
    emitAnnouncementMessageEdited,
    emitAnnouncementMessageDeleted,
    emitAnnouncementMessagePinned,
    emitAnnouncementMessageUnpinned
};
