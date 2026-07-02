const { z } = require('zod');
const { ALL_ROLES } = require('../middlewares/validateUtils');

exports.loginSchema = z.object({
    userid: z.coerce.string().min(1, 'User ID is required'),
    userpass: z.coerce.string().min(1, 'Password is required'),
});

exports.createUserSchema = z.object({
    fullname: z.string().min(1, 'Full name is required'),
    phone: z.coerce.string().optional(),
    userid: z.coerce.string().min(1, 'User ID is required'),
    role: z.enum(ALL_ROLES, { errorMap: () => ({ message: `Role must be one of: ${ALL_ROLES.join(', ')}` }) }),
    title: z.string().min(1, 'Title is required'),
    belongsto: z.string().optional(),
    grade: z.string().optional(),
    address: z.string().optional(),
    tenantId: z.string().optional(),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
});

exports.updateUserSchema = z.object({
    fullname: z.string().optional(),
    phone: z.coerce.string().optional(),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    address: z.string().optional(),
    title: z.string().optional(),
    role: z.enum(ALL_ROLES).optional(),
    belongsto: z.string().optional(),
    grade: z.string().optional(),
    newPassword: z.string().min(4, 'Password must be at least 4 characters').optional(),
});

exports.updateUserTitleSchema = z.object({
    title: z.string().min(1, 'Title is required'),
});

exports.addFcmTokenSchema = z.object({
    token: z.string().min(1, 'FCM token is required'),
});
