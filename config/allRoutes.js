const routes = require('express').Router()

// routes.use('/api/v1', require('../controllers/AdminController'));
routes.use('/api/v1/users', require('../routes/userRoutes'));
routes.use('/api/v1/group', require('../routes/groupRoutes'));
routes.use('/api/v1/occasion', require('../routes/occasionRoutes'));
routes.use('/api/v1/analytics', require('../routes/analyticsRoutes'));

module.exports = routes;