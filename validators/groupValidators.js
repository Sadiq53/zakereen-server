const { z } = require('zod');

exports.createGroupSchema = z.object({
    name: z.string().min(1, 'Group name is required'),
    adminId: z.string().optional(),
    userDetails: z.object({
        fullname: z.string(),
        phone: z.coerce.string().optional(),
        userid: z.coerce.string(),
        email: z.string().email().optional().or(z.literal('')),
        address: z.string().optional(),
    }).optional()
}).refine(data => data.adminId || data.userDetails, {
    message: "Either adminId or userDetails must be provided",
    path: ["adminId"]
});

exports.updateGroupSchema = z.object({
    name: z.string().min(1, 'Group name is required'),
});

exports.transferRoleSchema = z.object({
    newAdminId: z.string().min(1, 'New Admin ID is required'),
});

exports.addMemberSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
});

exports.transferMemberSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
    newGroupId: z.string().min(1, 'New Group ID is required'),
});

exports.removeMemberSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
});
