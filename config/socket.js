const socketIO = require('socket.io');

let io;

const initializeSocket = (server) => {
    io = socketIO(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('New client connected', socket.id);

        socket.on('joinTenant', (tenantId) => {
            if (tenantId) {
                socket.join(`tenant:${tenantId}`);
                console.log(`Socket ${socket.id} joined tenant room: ${tenantId}`);
            }
        });

        // New listener for announcement groups
        socket.on('joinAnnouncementGroup', (groupId) => {
            if (groupId) {
                socket.join(`announcement:${groupId}`);
                console.log(`Socket ${socket.id} joined announcement group: ${groupId}`);
            }
        });

        // Leave announcement group (e.g., when removed from a custom group)
        socket.on('leaveAnnouncementGroup', (groupId) => {
            if (groupId) {
                socket.leave(`announcement:${groupId}`);
                console.log(`Socket ${socket.id} left announcement group: ${groupId}`);
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected', socket.id);
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