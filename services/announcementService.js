const AnnouncementGroup = require('../models/announcementGroup');
const AnnouncementMessage = require('../models/announcementMessage');
const { emitNewAnnouncement, emitAnnouncementReaction } = require('../utils/socketEmit');
const mongoose = require('mongoose');

class AnnouncementService {
    
    /**
     * Resolves all groups a user has access to.
     * Includes Global Jamiat, their Tenant Jamaat, and Custom groups.
     */
    async getUserGroups(user) {
        const query = {
            $or: [
                { type: 'global_jamiat' }, // Everyone sees global jamiat
                { type: 'tenant_jamaat', tenantId: user.tenantId }, // User's specific jamaat
                { type: 'custom', members: user._id } // Custom groups they are part of
            ]
        };

        const groups = await AnnouncementGroup.find(query)
            .populate({
                path: 'pinnedMessage.messageId',
                populate: { path: 'senderId', select: 'fullname profileImage' }
            })
            .populate('pinnedMessage.pinnedBy', 'fullname profileImage')
            .sort({ createdAt: -1 })
            .lean();
        return groups;
    }

    /**
     * Fetch paginated messages for a group.
     * Validates if the user has access to the group first.
     */
    async getGroupMessages(groupId, user, page = 1, limit = 50) {
        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        // Permission check
        if (group.type === 'tenant_jamaat' && group.tenantId.toString() !== user.tenantId.toString()) {
            throw new Error("Unauthorized access to this Jamaat group");
        }
        if (group.type === 'custom' && !group.members.includes(user._id)) {
            throw new Error("You are not a member of this custom group");
        }

        const skip = (page - 1) * limit;
        const messages = await AnnouncementMessage.find({
                groupId,
                deletedFor: { $nin: [user._id] } // Exclude messages the user has deleted for themselves
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('senderId', 'fullname profileImage role title belongsto')
            .populate('reactions.users', 'fullname profileImage')
            .populate('poll.options.users', 'fullname profileImage')
            .lean();

        return messages;
    }

    /**
     * Checks if a user has permission to send a message.
     */
    canSendMessage(group, user) {
        if (['rootadmin', 'superadmin'].includes(user.role)) return true;
        if (group.admins.includes(user._id)) return true;
        if (!group.isReadOnly) return true;
        if (group.allowedSenders.includes(user._id)) return true;
        return false;
    }

    /**
     * Posts a new message to a group.
     */
    async postMessage(groupId, user, content, media = [], poll = null) {
        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        if (!this.canSendMessage(group, user)) {
            throw new Error("You do not have permission to send messages in this group");
        }

        const newMessage = new AnnouncementMessage({
            groupId,
            senderId: user._id,
            content,
            media,
            poll
        });

        await newMessage.save();

        const populatedMessage = await AnnouncementMessage.findById(newMessage._id)
            .populate('senderId', 'fullname profileImage role title belongsto')
            .populate('poll.options.users', 'fullname profileImage')
            .lean();

        // Emit via Socket.io
        emitNewAnnouncement(groupId, populatedMessage);

        return populatedMessage;
    }

    /**
     * Toggles an emoji reaction on a message.
     */
    async toggleReaction(groupId, messageId, user, emoji) {
        const message = await AnnouncementMessage.findById(messageId);
        if (!message) throw new Error("Message not found");

        // 1. Check if the user already reacted with this exact emoji
        const existingReactionIndex = message.reactions.findIndex(r => r.emoji === emoji);
        let userHasThisEmoji = false;
        
        if (existingReactionIndex > -1) {
            userHasThisEmoji = message.reactions[existingReactionIndex].users.includes(user._id);
        }

        // 2. Remove the user from ALL reactions on this message
        message.reactions.forEach(reaction => {
            const userIndex = reaction.users.indexOf(user._id);
            if (userIndex > -1) {
                reaction.users.splice(userIndex, 1);
            }
        });

        // 3. Clean up any empty reactions
        message.reactions = message.reactions.filter(r => r.users.length > 0);

        // 4. If they didn't already have this exact emoji, add it (toggling it ON)
        // If they did have it, we just removed it in step 2 (toggling it OFF)
        if (!userHasThisEmoji) {
            const targetReaction = message.reactions.find(r => r.emoji === emoji);
            if (targetReaction) {
                targetReaction.users.push(user._id);
            } else {
                message.reactions.push({ emoji, users: [user._id] });
            }
        }

        await message.save();

        const populatedMessage = await AnnouncementMessage.findById(message._id)
            .populate('reactions.users', 'fullname profileImage')
            .lean();

        // Emit updated reactions via Socket.io
        emitAnnouncementReaction(groupId, messageId, populatedMessage.reactions);

        return populatedMessage.reactions;
    }

    /**
     * Votes on a poll inside a message.
     */
    async votePoll(groupId, messageId, user, optionIds) {
        const message = await AnnouncementMessage.findById(messageId);
        if (!message) throw new Error("Message not found");
        if (!message.poll) throw new Error("This message does not contain a poll");

        const poll = message.poll;
        const userId = user._id.toString();

        // If multiple answers are NOT allowed, remove user from ALL options first
        if (!poll.multipleAnswers) {
            poll.options.forEach(opt => {
                const index = opt.users.findIndex(u => u.toString() === userId);
                if (index > -1) {
                    opt.users.splice(index, 1);
                }
            });
        }

        // Iterate requested options to toggle them
        optionIds.forEach(targetOptionId => {
            const option = poll.options.find(o => o.id === targetOptionId);
            if (option) {
                const userIndex = option.users.findIndex(u => u.toString() === userId);
                
                if (poll.multipleAnswers) {
                    // Toggle behavior for multiple answers
                    if (userIndex > -1) {
                        option.users.splice(userIndex, 1);
                    } else {
                        option.users.push(user._id);
                    }
                } else {
                    // Single answer: Just push the new vote (we already removed from others above)
                    if (userIndex === -1) {
                        option.users.push(user._id);
                    }
                }
            }
        });

        await message.save();

        const populatedMessage = await AnnouncementMessage.findById(message._id)
            .populate('poll.options.users', 'fullname profileImage')
            .lean();

        // We need to emit the updated poll
        // Let's assume emitAnnouncementPollUpdate is added to socketEmit.js
        const { emitAnnouncementPollUpdate } = require('../utils/socketEmit');
        emitAnnouncementPollUpdate(groupId, messageId, populatedMessage.poll);

        return populatedMessage.poll;
    }

    /**
     * Create a custom group (Admin only)
     */
    async createCustomGroup(user, name, description, members = []) {
        if (!['rootadmin', 'superadmin'].includes(user.role)) {
            throw new Error("Only super/root admins can create announcement groups");
        }

        // Always include creator in members and admins
        const uniqueMembers = [...new Set([...members, user._id.toString()])];

        const newGroup = new AnnouncementGroup({
            name,
            description,
            type: 'custom',
            tenantId: user.tenantId,
            members: uniqueMembers,
            admins: [user._id],
            createdBy: user._id,
            isReadOnly: true // Default to broadcast mode
        });

        await newGroup.save();
        return newGroup;
    }

    /**
     * Get full group details including populated members, admins, allowedSenders.
     * For tenant/global groups, resolves members dynamically from User collection.
     */
    async getGroupDetails(groupId, user) {
        const group = await AnnouncementGroup.findById(groupId)
            .populate('admins', 'fullname profileImage role title belongsto')
            .populate('allowedSenders', 'fullname profileImage role title belongsto')
            .populate('members', 'fullname profileImage role title belongsto')
            .populate('createdBy', 'fullname profileImage role')
            .populate({
                path: 'pinnedMessage.messageId',
                populate: { path: 'senderId', select: 'fullname profileImage' }
            })
            .populate('pinnedMessage.pinnedBy', 'fullname profileImage')
            .lean();

        if (!group) throw new Error("Group not found");

        // For global/tenant groups, members are resolved dynamically
        let resolvedMembers = group.members || [];
        if (group.type === 'global_jamiat') {
            const User = require('../models/users');
            resolvedMembers = await User.find({}, 'fullname profileImage role title belongsto').lean();
        } else if (group.type === 'tenant_jamaat' && group.tenantId) {
            const User = require('../models/users');
            resolvedMembers = await User.find({ tenantId: group.tenantId }, 'fullname profileImage role title belongsto').lean();
        }

        return { ...group, resolvedMembers };
    }

    /**
     * Update group settings: name, groupIcon, allowedSenders.
     * Only rootadmin/superadmin can do this.
     */
    async updateGroupSettings(groupId, user, updates) {
        if (!['rootadmin', 'superadmin'].includes(user.role)) {
            throw new Error("Only super/root admins can update group settings");
        }

        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        if (updates.name !== undefined) {
            group.name = updates.name.trim();
        }
        if (updates.groupIcon !== undefined) {
            group.groupIcon = updates.groupIcon;
        }
        if (updates.allowedSenders !== undefined) {
            group.allowedSenders = updates.allowedSenders;
        }

        await group.save();

        // Get full details with resolvedMembers
        const populated = await this.getGroupDetails(groupId, user);

        const { emitAnnouncementGroupUpdated } = require('../utils/socketEmit');
        emitAnnouncementGroupUpdated(groupId, populated);

        return populated;
    }

    /**
     * Edit a message's text content.
     * Only the original sender can edit their own message.
     * Only text content is editable (not media/polls).
     */
    async editMessage(groupId, messageId, user, newContent) {
        const message = await AnnouncementMessage.findById(messageId);
        if (!message) throw new Error("Message not found");
        if (message.groupId.toString() !== groupId) throw new Error("Message does not belong to this group");
        if (message.senderId.toString() !== user._id.toString()) {
            throw new Error("You can only edit your own messages");
        }
        if (message.isDeleted) throw new Error("Cannot edit a deleted message");

        message.content = newContent.trim();
        message.isEdited = true;
        await message.save();

        const { emitAnnouncementMessageEdited } = require('../utils/socketEmit');
        emitAnnouncementMessageEdited(groupId, messageId, message.content, message.isEdited);

        return { messageId, content: message.content, isEdited: true };
    }

    /**
     * Delete a message for everyone.
     * Sender can delete their own messages; admins can delete any message.
     */
    async deleteMessageForEveryone(groupId, messageId, user) {
        const message = await AnnouncementMessage.findById(messageId);
        if (!message) throw new Error("Message not found");
        if (message.groupId.toString() !== groupId) throw new Error("Message does not belong to this group");

        const isSender = message.senderId.toString() === user._id.toString();
        const isAdmin = ['rootadmin', 'superadmin'].includes(user.role);

        if (!isSender && !isAdmin) {
            throw new Error("You can only delete your own messages");
        }

        message.isDeleted = true;
        await message.save();

        const { emitAnnouncementMessageDeleted } = require('../utils/socketEmit');
        emitAnnouncementMessageDeleted(groupId, messageId);

        return { messageId, deleted: true };
    }

    /**
     * Delete a message for the requesting user only.
     * The message remains visible to all other users.
     */
    async deleteMessageForMe(groupId, messageId, user) {
        const message = await AnnouncementMessage.findById(messageId);
        if (!message) throw new Error("Message not found");
        if (message.groupId.toString() !== groupId) throw new Error("Message does not belong to this group");

        // Use $addToSet to prevent duplicates
        await AnnouncementMessage.updateOne(
            { _id: messageId },
            { $addToSet: { deletedFor: user._id } }
        );

        return { messageId, deletedForMe: true };
    }

    /**
     * Fetch shared media for a group, filtered by type.
     * Types: 'images' (image/video), 'docs' (pdf/document), 'links' (URLs in content)
     */
    async getGroupMedia(groupId, user, type = 'images', page = 1, limit = 30) {
        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        const skip = (page - 1) * limit;

        if (type === 'links') {
            // Find messages with URLs in content
            const urlRegex = /https?:\/\/[^\s]+/;
            const messages = await AnnouncementMessage.find({
                    groupId,
                    isDeleted: false,
                    deletedFor: { $nin: [user._id] },
                    content: { $regex: urlRegex }
                })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('senderId', 'fullname profileImage')
                .select('content senderId createdAt')
                .lean();

            // Extract URLs from content
            const extractRegex = /https?:\/\/[^\s]+/g;
            return messages.map(msg => {
                const urls = msg.content.match(extractRegex) || [];
                return { ...msg, urls };
            });
        }

        // For images and docs
        const mediaTypeFilter = type === 'images'
            ? { $in: ['image', 'video'] }
            : { $in: ['pdf', 'document'] };

        const messages = await AnnouncementMessage.find({
                groupId,
                isDeleted: false,
                deletedFor: { $nin: [user._id] },
                'media.type': mediaTypeFilter
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('senderId', 'fullname profileImage')
            .select('media senderId createdAt')
            .lean();

        // Flatten: one entry per media item (a message could have multiple)
        const items = [];
        messages.forEach(msg => {
            msg.media.forEach(m => {
                const isMatch = type === 'images'
                    ? ['image', 'video'].includes(m.type)
                    : ['pdf', 'document'].includes(m.type);
                if (isMatch) {
                    items.push({
                        ...m,
                        senderId: msg.senderId,
                        messageId: msg._id,
                        createdAt: msg.createdAt
                    });
                }
            });
        });

        return items;
    }

    /**
     * Pin a message to the group.
     * Only users who can send messages can pin.
     */
    async pinMessage(groupId, messageId, user, durationHours = null) {
        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        if (!this.canSendMessage(group, user)) {
            throw new Error("You do not have permission to pin messages in this group");
        }

        const message = await AnnouncementMessage.findById(messageId)
            .populate('senderId', 'fullname profileImage')
            .lean();
            
        if (!message) throw new Error("Message not found");
        if (message.groupId.toString() !== groupId) throw new Error("Message does not belong to this group");
        if (message.isDeleted) throw new Error("Cannot pin a deleted message");

        let expiresAt = null;
        if (durationHours) {
            expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + parseInt(durationHours, 10));
        }

        const pinMetadata = {
            messageId,
            pinnedBy: user._id,
            pinnedAt: new Date(),
            expiresAt
        };

        group.pinnedMessage = pinMetadata;
        await group.save();

        const { emitAnnouncementMessagePinned } = require('../utils/socketEmit');
        
        emitAnnouncementMessagePinned(groupId, {
            ...pinMetadata,
            messageId: message,
            pinnedBy: { _id: user._id, fullname: user.fullname, profileImage: user.profileImage }
        });

        return pinMetadata;
    }

    /**
     * Unpin the current pinned message.
     */
    async unpinMessage(groupId, user) {
        const group = await AnnouncementGroup.findById(groupId);
        if (!group) throw new Error("Group not found");

        if (!this.canSendMessage(group, user)) {
            throw new Error("You do not have permission to unpin messages in this group");
        }

        group.pinnedMessage = null;
        await group.save();

        const { emitAnnouncementMessageUnpinned } = require('../utils/socketEmit');
        emitAnnouncementMessageUnpinned(groupId);

        return { success: true };
    }
}

module.exports = new AnnouncementService();
