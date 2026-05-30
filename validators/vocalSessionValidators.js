const { z } = require('zod');

exports.createVocalSessionSchema = z.object({
    title: z.string().min(1, 'Title is required').trim(),
    description: z.string().min(1, 'Description is required').trim(),
    instructions: z.array(z.string().trim()).min(1, 'At least one instruction step is required'),
    sequence: z.array(
        z.string().regex(/^([A-G]#?)([3-5])$|^Tick$/, 'Sequence must contain valid musical notes (e.g., C3, G#4) or Tick.')
    ).min(1, 'Sequence must have at least one note'),
    order: z.number().int().min(0).optional(),
    isActive: z.boolean().optional()
});

exports.updateVocalSessionSchema = z.object({
    title: z.string().min(1, 'Title cannot be empty').trim().optional(),
    description: z.string().min(1, 'Description cannot be empty').trim().optional(),
    instructions: z.array(z.string().trim()).min(1, 'At least one instruction step is required').optional(),
    sequence: z.array(
        z.string().regex(/^([A-G]#?)([3-5])$|^Tick$/, 'Sequence must contain valid musical notes (e.g., C3, G#4) or Tick.')
    ).min(1, 'Sequence must have at least one note').optional(),
    order: z.number().int().min(0).optional(),
    isActive: z.boolean().optional()
});
