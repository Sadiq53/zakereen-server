const expressAsyncHandler = require("express-async-handler");
const announcementService = require("../services/announcementService");
const { z } = require('zod');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const { announcementQueue } = require('../jobs/bullQueue');

// Minimal S3 Setup for presigned URLs (Media Attachments)
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const getGroups = expressAsyncHandler(async (req, res) => {
    const groups = await announcementService.getUserGroups(req.user);
    res.status(200).json({ success: true, groups });
});

const getMessages = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const messages = await announcementService.getGroupMessages(groupId, req.user, page, limit);
    res.status(200).json({ success: true, messages });
});

const postMessageSchema = z.object({
    content: z.string().optional(),
    media: z.array(z.object({
        type: z.enum(['image', 'video', 'pdf', 'document']),
        url: z.string().url(),
        thumbnailUrl: z.string().optional(),
        sizeBytes: z.number().optional(),
        mimeType: z.string(),
        fileName: z.string(),
        s3Key: z.string()
    })).optional(),
    poll: z.object({
        question: z.string(),
        options: z.array(z.object({
            id: z.string(),
            text: z.string()
        })).min(2).max(12),
        multipleAnswers: z.boolean().default(false)
    }).optional()
}).refine(data => data.content || (data.media && data.media.length > 0) || data.poll, {
    message: "Message must contain either content, media, or a poll"
});

const postMessage = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const validatedData = postMessageSchema.parse(req.body);

    const message = await announcementService.postMessage(
        groupId,
        req.user,
        validatedData.content || '',
        validatedData.media || [],
        validatedData.poll || null
    );

    // Fire-and-forget: dispatch push notification via BullMQ (zero API latency impact)
    const group = await require('../models/announcementGroup').findById(groupId, 'name').lean();
    announcementQueue.add('push-notification', {
        groupId,
        groupName: group?.name || 'Announcement',
        senderId: req.user._id.toString(),
        senderName: req.user.fullname || 'Admin',
        content: validatedData.content || '',
        mediaType: validatedData.media?.[0]?.type || null,
        pollQuestion: validatedData.poll?.question || null,
    }).catch(err => console.error('[Announcement] Failed to enqueue push job:', err));

    res.status(201).json({ success: true, message });
});

const toggleReaction = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
        return res.status(400).json({ success: false, message: "Emoji is required" });
    }

    const reactions = await announcementService.toggleReaction(groupId, messageId, req.user, emoji);
    
    // Dispatch push notification
    const group = await require('../models/announcementGroup').findById(groupId, 'name').lean();
    announcementQueue.add('push-notification', {
        groupId,
        groupName: group?.name || 'Announcement',
        senderId: req.user._id.toString(),
        senderName: req.user.fullname || 'Admin',
        content: `reacted ${emoji} to a message`
    }).catch(err => console.error('[Announcement] Failed to enqueue push job:', err));

    res.status(200).json({ success: true, reactions });
});

const votePoll = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;
    const { optionIds } = req.body;

    if (!Array.isArray(optionIds)) {
        return res.status(400).json({ success: false, message: "optionIds must be an array" });
    }

    const poll = await announcementService.votePoll(groupId, messageId, req.user, optionIds);

    // Dispatch push notification
    const group = await require('../models/announcementGroup').findById(groupId, 'name').lean();
    announcementQueue.add('push-notification', {
        groupId,
        groupName: group?.name || 'Announcement',
        senderId: req.user._id.toString(),
        senderName: req.user.fullname || 'Admin',
        content: `voted in a poll`
    }).catch(err => console.error('[Announcement] Failed to enqueue push job:', err));

    res.status(200).json({ success: true, poll });
});

const createGroupSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    members: z.array(z.string()).optional() // Array of ObjectIds
});

const createGroup = expressAsyncHandler(async (req, res) => {
    const validatedData = createGroupSchema.parse(req.body);

    const group = await announcementService.createCustomGroup(
        req.user,
        validatedData.name,
        validatedData.description || '',
        validatedData.members || []
    );

    res.status(201).json({ success: true, group });
});

/**
 * Generate a presigned URL so the mobile app can upload media directly to S3.
 * This ensures the Node.js backend doesn't bottle-neck with heavy file uploads.
 */
const getPresignedUploadUrl = expressAsyncHandler(async (req, res) => {
    const { fileName, mimeType } = req.body;
    if (!fileName || !mimeType) return res.status(400).json({ success: false, message: "fileName and mimeType required" });

    // Generate unique key
    const uniqueId = crypto.randomBytes(16).toString("hex");
    const s3Key = `announcements/${req.user.tenantId || 'global'}/${uniqueId}-${fileName}`;

    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        ContentType: mimeType,
    });

    // URL expires in 5 minutes
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    res.status(200).json({
        success: true,
        uploadUrl: presignedUrl,
        s3Key: s3Key,
        publicUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${s3Key}`
    });
});

const getGroupDetails = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const group = await announcementService.getGroupDetails(groupId, req.user);
    res.status(200).json({ success: true, group });
});

const updateGroupSettings = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { name, groupIcon, allowedSenders } = req.body;

    const updatedGroup = await announcementService.updateGroupSettings(
        groupId,
        req.user,
        { name, groupIcon, allowedSenders }
    );

    res.status(200).json({ success: true, group: updatedGroup });
});

const editMessage = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;
    const { content } = req.body;

    if (content === undefined || content === null) {
        return res.status(400).json({ success: false, message: "Content is required" });
    }

    const result = await announcementService.editMessage(groupId, messageId, req.user, content);
    res.status(200).json({ success: true, ...result });
});

const deleteMessage = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;

    const result = await announcementService.deleteMessageForEveryone(groupId, messageId, req.user);
    res.status(200).json({ success: true, ...result });
});

const deleteMessageForMe = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;

    const result = await announcementService.deleteMessageForMe(groupId, messageId, req.user);
    res.status(200).json({ success: true, ...result });
});

const getGroupMedia = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const type = req.query.type || 'images'; // 'images' | 'docs' | 'links'
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;

    const media = await announcementService.getGroupMedia(groupId, req.user, type, page, limit);
    res.status(200).json({ success: true, media });
});

const pinMessage = expressAsyncHandler(async (req, res) => {
    const { groupId, messageId } = req.params;
    const { durationHours } = req.body;
    const message = await announcementService.pinMessage(groupId, messageId, req.user, durationHours);
    res.status(200).json({ success: true, pinnedMessage: message });
});

const unpinMessage = expressAsyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const result = await announcementService.unpinMessage(groupId, req.user);
    res.status(200).json({ success: true, ...result });
});

module.exports = {
    getGroups,
    getMessages,
    postMessage,
    toggleReaction,
    votePoll,
    createGroup,
    getPresignedUploadUrl,
    getGroupDetails,
    updateGroupSettings,
    editMessage,
    deleteMessage,
    deleteMessageForMe,
    getGroupMedia,
    pinMessage,
    unpinMessage
};
