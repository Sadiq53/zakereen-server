const express = require('express');
const router = express.Router();
const occasionController = require('../controllers/OccasionController');
const { verifyToken, authAdmin, authGroup } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');
const multer = require('multer');
const validateRequest = require('../middlewares/validateRequest');
const {
    createOccasionSchema,
    updateOccasionSchema,
    updateAttendanceSchema
} = require('../validators/occasionValidators');
const AppError = require('../utils/AppError');

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new AppError('Invalid file type. Only images are allowed.', 400), false);
        }
    }
});

// POST /create — Create occasion (admin/superadmin only)
router.post('/create', authAdmin, resolveTenant, validateRequest({ body: createOccasionSchema }), occasionController.createOccasion);

// POST /create-past — Create past occasion without side effects (admin/superadmin only)
router.post('/create-past', authAdmin, resolveTenant, validateRequest({ body: createOccasionSchema }), occasionController.createPastOccasion);

// PATCH /update/:id — Update occasion (admin/superadmin/groupadmin)
router.patch('/update/:id', authGroup, resolveTenant, validateRequest({ body: updateOccasionSchema }), occasionController.updateOccasion);

// PATCH /end/:id — Admin/SuperAdmin instant end occasion
router.patch('/end/:id', authAdmin, resolveTenant, occasionController.endOccasion);

// PATCH /attendance/:id — Role-scoped attendance + rating submission
router.patch('/attendance/:id', verifyToken, resolveTenant, validateRequest({ body: updateAttendanceSchema }), occasionController.updateAttendance);

// DELETE /remove/:id — Delete occasion (admin/superadmin only)
router.delete('/remove/:id', authAdmin, resolveTenant, occasionController.deleteOccasion);

// POST /image/:id — Upload occasion photo
router.post('/image/:id', verifyToken, resolveTenant, upload.single('photo'), occasionController.uploadImage);

// GET /fetch/all — Fetch all occasions
router.get('/fetch/all', verifyToken, resolveTenant, occasionController.fetchAll);

// GET /fetch/paginated — Fetch paginated occasions
router.get('/fetch/paginated', verifyToken, resolveTenant, occasionController.fetchPaginated);

// GET /fetch/id/:id — Fetch occasion by ID
router.get('/fetch/id/:id', verifyToken, resolveTenant, occasionController.fetchById);

// GET /fetch/status — Fetch occasions by status
router.get('/fetch/status', verifyToken, resolveTenant, occasionController.fetchByStatus);

// GET /fetch/date/:date — Fetch occasions by date
router.get('/fetch/date/:date', verifyToken, resolveTenant, occasionController.fetchByDate);

// GET /fetch/month/:month — Fetch occasions by month
router.get('/fetch/month/:month', verifyToken, resolveTenant, occasionController.fetchByMonth);

// GET /fetch/year/:year — Fetch occasions by year
router.get('/fetch/year/:year', verifyToken, resolveTenant, occasionController.fetchByYear);

// GET /fetch/group — Fetch grouped parties
router.get('/fetch/group', verifyToken, resolveTenant, occasionController.fetchGrouped);

module.exports = router;
