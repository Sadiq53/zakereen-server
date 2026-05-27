const express = require('express');
const router = express.Router();
const groupController = require('../controllers/GroupController');
const { verifyToken, authAdmin, authGroup } = require('../middlewares/auth');
const validateRequest = require('../middlewares/validateRequest');
const {
    createGroupSchema,
    updateGroupSchema,
    transferRoleSchema,
    addMemberSchema,
    transferMemberSchema,
    removeMemberSchema
} = require('../validators/groupValidators');

// GET / — Get all groups
router.get('/', verifyToken, groupController.getAllGroups);

// GET /:groupId — Get group by ID
router.get('/:groupId', verifyToken, groupController.getGroupById);

// POST /create — Create a new group (admin/superadmin only)
router.post('/create', authAdmin, validateRequest({ body: createGroupSchema }), groupController.createGroup);

// PUT /update/:groupId — Update group
router.put('/update/:groupId', authGroup, validateRequest({ body: updateGroupSchema }), groupController.updateGroup);

// DELETE /remove/:groupId — Delete group (admin/superadmin only)
router.delete('/remove/:groupId', authAdmin, groupController.deleteGroup);

// POST /:groupId/transfer/role — Transfer group admin rights
router.post('/:groupId/transfer/role', authGroup, validateRequest({ body: transferRoleSchema }), groupController.transferRole);

// PUT /:groupId/add/member — Add a member to a group
router.put('/:groupId/add/member', authGroup, validateRequest({ body: addMemberSchema }), groupController.addMember);

// POST /:groupId/transfer/member — Transfer a member between groups
router.post('/:groupId/transfer/member', authGroup, validateRequest({ body: transferMemberSchema }), groupController.transferMember);

// POST /:groupId/remove/member — Remove a member from a group
router.post('/:groupId/remove/member', authGroup, validateRequest({ body: removeMemberSchema }), groupController.removeMember);

// PUT /leave/:userId — Leave a group
router.put('/leave/:userId', verifyToken, groupController.leaveGroup);

module.exports = router;
