const groupService = require('../services/groupService');
const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');

// GET /
exports.getAllGroups = asyncHandler(async (req, res) => {
    const groups = await groupService.getAllGroups(req.tenantId);
    res.status(200).json(groups);
});

// GET /:groupId
exports.getGroupById = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const group = await groupService.getGroupById(req.tenantId, groupId);
    res.status(200).json(group);
});

// POST /create
exports.createGroup = asyncHandler(async (req, res) => {
    const { name, adminId, userDetails, tenantId } = req.body;
    
    let targetTenantId = req.tenantId;
    if (req.isRootAdmin) {
        targetTenantId = tenantId || req.tenantId || req.userTenantId;
    }

    if (!targetTenantId) {
        throw new AppError("Tenant ID is required to create a group.", 400);
    }

    const result = await groupService.createGroup(targetTenantId, name, adminId, userDetails);
    res.status(201).json(result);
});

// PUT /update/:groupId
exports.updateGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { name } = req.body;
    const group = await groupService.updateGroup(req.tenantId, req.user, groupId, name);
    res.status(200).json(group);
});

// DELETE /remove/:groupId
exports.deleteGroup = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    await groupService.deleteGroup(req.tenantId, groupId);
    res.status(204).send();
});

// POST /:groupId/transfer/role
exports.transferRole = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { newAdminId } = req.body;
    const group = await groupService.transferRole(req.tenantId, req.user, groupId, newAdminId);
    res.status(200).json(group);
});

// PUT /:groupId/add/member
exports.addMember = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { userId } = req.body;
    const group = await groupService.addMember(req.tenantId, req.user, groupId, userId);
    res.status(200).json(group);
});

// POST /:groupId/transfer/member
exports.transferMember = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { userId, newGroupId } = req.body;
    const newGroup = await groupService.transferMember(req.tenantId, req.user, groupId, userId, newGroupId);
    res.status(200).json(newGroup);
});

// POST /:groupId/remove/member
exports.removeMember = asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { userId } = req.body;
    await groupService.removeMember(req.tenantId, req.user, groupId, userId);
    res.status(204).send();
});

// PUT /leave/:userId
exports.leaveGroup = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    await groupService.leaveGroup(req.tenantId, req.user, userId);
    res.status(200).json({ message: 'Successfully left the group.' });
});
