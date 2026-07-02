const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/TenantController');
const { verifyToken } = require('../middlewares/auth');

// Allow searching tenants (for authenticated users, typically rootadmin or global users assigning Jamaats)
router.get('/search', verifyToken, tenantController.searchTenants);

module.exports = router;
