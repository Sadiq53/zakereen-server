const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const AnnouncementGroup = require('../models/announcementGroup');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

let io;

const initializeSocket = (server) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3000', 'http://localhost:3001'];

    io = socketIO(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"]
        }
    });

    // ── Authentication Middleware ─────────────────────────────────────────────
    // Every connecting client MUST provide a valid JWT in handshake.auth.token.
    // This runs before any event handlers are attached.
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('Authentication required: no token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Attach minimal user context to the socket for authorization checks
            socket.user = {
                _id: decoded._id || decoded.sub,
                userid: decoded.userid,
                role: decoded.role,
                tenantId: decoded.tenantId || null,
            };
            next();
        } catch (err) {
            return next(new Error('Authentication failed: invalid or expired token'));
        }
    });

    // ── Connection Handler ───────────────────────────────────────────────────
    io.on('connection', (socket) => {
        logger.info({ socketId: socket.id, userId: socket.user?._id, tenantId: socket.user?.tenantId }, 'Socket connected');

        // ── Join Tenant Room ─────────────────────────────────────────────────
        // Only allow joining the tenant room that matches the user's JWT tenantId,
        // or allow rootadmin to join any tenant room.
        socket.on('joinTenant', (tenantId) => {
            if (!tenantId) return;

            const isRootAdmin = socket.user.role === 'rootadmin';
            const isOwnTenant = socket.user.tenantId &&
                socket.user.tenantId.toString() === tenantId.toString();

            if (isRootAdmin || isOwnTenant) {
                socket.join(`tenant:${tenantId}`);
            } else {
                socket.emit('error', { message: 'Unauthorized: cannot join this tenant room' });
            }
        });

        // ── Join Announcement Group Room ─────────────────────────────────────
        // Verify the user has access to the group before allowing them to join.
        socket.on('joinAnnouncementGroup', async (groupId) => {
            if (!groupId) return;

            try {
                // Validate that groupId is a valid ObjectId format
                if (!mongoose.Types.ObjectId.isValid(groupId)) {
                    return socket.emit('error', { message: 'Invalid group ID' });
                }

                const group = await AnnouncementGroup.findById(groupId)
                    .select('type tenantId members')
                    .lean();

                if (!group) {
                    return socket.emit('error', { message: 'Group not found' });
                }

                const isRootAdmin = socket.user.role === 'rootadmin';
                let authorized = false;

                if (isRootAdmin) {
                    // rootadmin can join any group
                    authorized = true;
                } else if (group.type === 'global_jamiat') {
                    // All authenticated users can join global groups
                    authorized = true;
                } else if (group.type === 'tenant_jamaat') {
                    // Must belong to the same tenant
                    authorized = socket.user.tenantId &&
                        group.tenantId &&
                        socket.user.tenantId.toString() === group.tenantId.toString();
                } else if (group.type === 'custom') {
                    // Must be a member of the custom group
                    const userId = socket.user._id?.toString();
                    authorized = group.members?.some(
                        (memberId) => memberId.toString() === userId
                    );
                }

                if (authorized) {
                    socket.join(`announcement:${groupId}`);
                } else {
                    socket.emit('error', { message: 'Unauthorized: cannot join this announcement group' });
                }
            } catch (err) {
                logger.error({ err, socketId: socket.id, userId: socket.user?._id }, 'Error authorizing group join');
                socket.emit('error', { message: 'Failed to join group' });
            }
        });

        // ── Leave Announcement Group Room ────────────────────────────────────
        socket.on('leaveAnnouncementGroup', (groupId) => {
            if (groupId) {
                socket.leave(`announcement:${groupId}`);
            }
        });

        socket.on('disconnect', () => {
            logger.info({ socketId: socket.id, userId: socket.user?._id }, 'Socket disconnected');
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};

module.exports = {
    initializeSocket,
    getIO
};
 