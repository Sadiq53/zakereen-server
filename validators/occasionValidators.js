const { z } = require('zod');
const { allowedTypes } = require('../middlewares/validateUtils');

exports.createOccasionSchema = z.object({
    name: z.string().min(1, 'Occasion name is required'),
    start_at: z.string().min(1, 'Start date is required'),
    time: z.string().min(1, 'Time is required'),
    created_by: z.string().min(1, 'Creator ID is required'),
    location: z.string().optional(),
    hijri_date: z.string().optional(),
    description: z.string().optional(),
    events: z.array(z.object({
        name: z.string(),
        type: z.enum(allowedTypes, { errorMap: () => ({ message: `Invalid event type. Allowed: ${allowedTypes.join(', ')}` }) }),
        party: z.string().optional().nullable()
    })).optional().default([]),
});

exports.updateOccasionSchema = z.object({
    name: z.string().optional(),
    start_at: z.string().optional(),
    location: z.string().optional(),
    hijri_date: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['pending', 'started', 'ended']).optional(),
    events: z.array(z.any()).optional(), // Events can be complex, skipping deep validation for partial updates
    attendance: z.array(z.object({
        userId: z.string(),
        status: z.enum(['present', 'excused', 'absent'])
    })).optional()
});

exports.updateAttendanceSchema = z.object({
    attendance: z.array(z.object({
        userId: z.string(),
        status: z.enum(['present', 'excused', 'absent'])
    })).optional(),
    events: z.array(z.any()).optional()
});
