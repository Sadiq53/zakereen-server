const asyncHandler = require('express-async-handler');
const tenantService = require('../services/tenantService');
const Tenant = require('../models/tenant');

exports.createTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.createTenant(req.body);
    res.status(201).json({ success: true, data: tenant });
});

exports.assignCoordinator = asyncHandler(async (req, res) => {
    const result = await tenantService.assignCoordinator(req.params.id, req.body);
    res.status(200).json({ success: true, data: result });
});

exports.listTenants = asyncHandler(async (req, res) => {
    const tenants = await tenantService.listTenants(req.query.status);
    res.status(200).json({ success: true, data: tenants });
});

exports.searchTenants = asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(200).json({ tenants: [] });
    
    const tenants = await Tenant.find({ name: { $regex: q, $options: 'i' } })
        .select('_id name')
        .limit(20)
        .lean();
    res.status(200).json({ tenants });
});

exports.getTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.getTenantById(req.params.id);
    res.status(200).json({ success: true, data: tenant });
});

exports.updateTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.updateTenant(req.params.id, req.body);
    res.status(200).json({ success: true, data: tenant });
});

exports.suspendTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.suspendTenant(req.params.id, req.body.reason);
    res.status(200).json({ success: true, data: tenant });
});

exports.reactivateTenant = asyncHandler(async (req, res) => {
    const tenant = await tenantService.reactivateTenant(req.params.id);
    res.status(200).json({ success: true, data: tenant });
});

exports.deleteTenant = asyncHandler(async (req, res) => {
    await tenantService.deleteTenant(req.params.id);
    res.status(200).json({ success: true, message: 'Tenant soft-deleted successfully.' });
});

exports.getTenantStats = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const stats = await tenantService.getTenantStats(id);
    res.status(200).json({ success: true, data: stats });
});

exports.getGlobalStats = asyncHandler(async (req, res) => {
    const stats = await tenantService.getGlobalStats();
    res.status(200).json({ success: true, data: stats });
});

exports.getAllTenantsAnalytics = asyncHandler(async (req, res) => {
    const analytics = await tenantService.getAllTenantsAnalytics();
    res.status(200).json({ success: true, data: analytics });
});

exports.getAuditLogs = asyncHandler(async (req, res) => {
    const AuditLog = require('../models/auditLog');
    const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(100).populate('actor', 'userid');
    res.status(200).json({ success: true, data: logs });
});

exports.getTenantMiqaats = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    const miqaats = await tenantService.getTenantMiqaats(id, limit);
    res.status(200).json({ success: true, data: miqaats });
});
