require('../config/dataBase');
const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ['image', 'video', 'pdf', 'document'], required: true },
        url: { type: String, required: true }, // S3 URL
        thumbnailUrl: { type: String, default: '' }, // For videos/PDFs preview
        sizeBytes: { type: Number, default: 0 },
        mimeType: { type: String, required: true },
        fileName: { type: String, required: true },
        s3Key: { type: String, required: true }, // For efficient deletion from S3 later
    },
    { _id: false } // Prevent creating separate ObjectId for each media item to save space
);

const reactionSchema = new mongoose.Schema(
    {
        emoji: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Array of users who reacted with this emoji
    },
    { _id: false }
);

const pollOptionSchema = new mongoose.Schema(
    {
        id: { type: String, required: true }, // e.g., uuid
        text: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    },
    { _id: false }
);

const pollSchema = new mongoose.Schema(
    {
        question: { type: String, required: true },
        options: { type: [pollOptionSchema], required: true },
        multipleAnswers: { type: Boolean, default: false }
    },
    { _id: false }
);

const announcementMessageSchema = new mongoose.Schema(
    {
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnnouncementGroup', required: true, index: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        content: { type: String, default: '' },
        media: { type: [mediaSchema], default: [] },
        poll: { type: pollSchema, default: null },
        reactions: { type: [reactionSchema], default: [] },
        isDeleted: { type: Boolean, default: false },
        isEdited: { type: Boolean, default: false },
        // Per-user soft-delete: message hidden only for users listed here
        deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
    { timestamps: true }
);

// Critical index for chat history pagination: Sort by groupId and createdAt (descending)
announcementMessageSchema.index({ groupId: 1, createdAt: -1 });

// Index for sender lookup (if needed)
announcementMessageSchema.index({ senderId: 1, createdAt: -1 });

const cacheBuster = require('../utils/cacheBuster');
announcementMessageSchema.plugin(cacheBuster);

module.exports = mongoose.model('AnnouncementMessage', announcementMessageSchema);
