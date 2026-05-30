const { z } = require('zod');

const createTenantSchema = z.object({
    name: z.string().min(2, "Tenant name must be at least 2 characters").max(100),
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
    address: z.string().optional(),
    contactEmail: z.string().email("Invalid email format").optional().or(z.literal('')),
    contactPhone: z.coerce.string().optional(),
    maxUsers: z.number().int().positive().default(500),
    settings: z.object({
        timezone: z.string().default('Asia/Kolkata'),
        locale: z.string().default('en'),
        hijriOffset: z.number().int().default(0),
    }).optional()
});

const updateTenantSchema = z.object({
    name: z.string().min(2).max(100).optional(),
    address: z.string().optional(),
    contactEmail: z.string().email("Invalid email format").optional().or(z.literal('')),
    contactPhone: z.coerce.string().optional(),
    maxUsers: z.number().int().positive().optional(),
    settings: z.object({
        timezone: z.string().optional(),
        locale: z.string().optional(),
        hijriOffset: z.number().int().optional(),
    }).optional()
});

const assignCoordinatorSchema = z.object({
    userid: z.coerce.string().min(3, "ITS/User ID is required"),
    fullname: z.string().optional(),
    phone: z.coerce.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional()
});

const suspendTenantSchema = z.object({
    reason: z.string().min(5, "A reason must be provided for suspension").max(500)
});

module.exports = {
    createTenantSchema,
    updateTenantSchema,
    assignCoordinatorSchema,
    suspendTenantSchema
};
