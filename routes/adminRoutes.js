const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/TenantController');
const { verifyToken } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');
const { requireRootAdmin, authorize } = require('../middlewares/authorize');
const { auditAction } = require('../middlewares/auditLog');
const validateRequest = require('../middlewares/validateRequest');
const { 
    createTenantSchema, 
    updateTenantSchema, 
    assignCoordinatorSchema, 
    suspendTenantSchema 
} = require('../validators/tenantValidators');

// All admin routes require root admin privileges
router.use(verifyToken);
router.use(resolveTenant);
router.use(requireRootAdmin);

// Tenant CRUD
router.get('/tenants/search', tenantController.searchTenants);
router.post('/tenants', validateRequest({ body: createTenantSchema }), auditAction('tenant.create', 'Tenant'), tenantController.createTenant);
router.get('/tenants', tenantController.listTenants);
router.get('/tenants/:id', tenantController.getTenant);
router.put('/tenants/:id', validateRequest({ body: updateTenantSchema }), auditAction('tenant.update', 'Tenant'), tenantController.updateTenant);
router.delete('/tenants/:id', auditAction('tenant.delete', 'Tenant'), tenantController.deleteTenant);

// Tenant Lifecycle
router.post('/tenants/:id/suspend', validateRequest({ body: suspendTenantSchema }), auditAction('tenant.suspend', 'Tenant'), tenantController.suspendTenant);
router.post('/tenants/:id/reactivate', auditAction('tenant.reactivate', 'Tenant'), tenantController.reactivateTenant);
router.post('/tenants/:id/coordinator', validateRequest({ body: assignCoordinatorSchema }), auditAction('tenant.assignCoordinator', 'Tenant'), tenantController.assignCoordinator);

// Stats
router.get('/stats/global', tenantController.getGlobalStats);
router.get('/stats/tenants-comparison', tenantController.getAllTenantsAnalytics);
router.get('/tenants/:id/stats', tenantController.getTenantStats);
router.get('/tenants/:id/miqaats', tenantController.getTenantMiqaats);
router.get('/audit-logs', tenantController.getAuditLogs);

module.exports = router;
