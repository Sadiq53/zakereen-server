const routes = require('express').Router()

// routes.use('/api/v1', require('../controllers/AdminController'));
routes.use('/api/v1/health', require('../routes/healthRoutes'));
routes.use('/api/v1/users', require('../routes/userRoutes'));
routes.use('/api/v1/group', require('../routes/groupRoutes'));
routes.use('/api/v1/occasion', require('../routes/occasionRoutes'));
routes.use('/api/v1/analytics', require('../routes/analyticsRoutes'));
routes.use('/api/v1/admin', require('../routes/adminRoutes'));
routes.use('/api/v1/saved-locations', require('../routes/savedLocationRoute'));
routes.use('/api/v1/vocal-sessions', require('../routes/vocalSessionRoutes'));
routes.use('/api/v1/announcements', require('../routes/announcementRoutes'));
routes.use('/api/v1/kalam', require('../routes/kalamRoutes'));
routes.use('/api/v1/tenants', require('../routes/tenantRoutes'));

module.exports = routes;