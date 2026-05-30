const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/AnnouncementController');
const { verifyToken } = require('../middlewares/auth');

// All announcement routes require authentication
router.use(verifyToken);

// Get user's available announcement groups
router.get('/groups', announcementController.getGroups);

// Create a custom group (Super/Root Admin only)
router.post('/groups', announcementController.createGroup);

// Get paginated messages for a group
router.get('/groups/:groupId/messages', announcementController.getMessages);

// Post a message to a group
router.post('/groups/:groupId/messages', announcementController.postMessage);

// Reaction and Polls
router.post('/groups/:groupId/messages/:messageId/reactions', announcementController.toggleReaction);
router.post('/groups/:groupId/messages/:messageId/poll/vote', announcementController.votePoll);

// Group Shared Media (must be before /:groupId to avoid matching 'media' as groupId)
router.get('/groups/:groupId/media', announcementController.getGroupMedia);

// Group Settings
router.get('/groups/:groupId', announcementController.getGroupDetails);
router.put('/groups/:groupId', announcementController.updateGroupSettings);

// Message Actions (Edit / Delete / Pin)
router.put('/groups/:groupId/messages/:messageId', announcementController.editMessage);
router.delete('/groups/:groupId/messages/:messageId', announcementController.deleteMessage);
router.post('/groups/:groupId/messages/:messageId/delete-for-me', announcementController.deleteMessageForMe);
router.post('/groups/:groupId/messages/:messageId/pin', announcementController.pinMessage);
router.post('/groups/:groupId/unpin', announcementController.unpinMessage);

// Get S3 presigned URL for direct media upload
router.post('/presigned-url', announcementController.getPresignedUploadUrl);

module.exports = router;
