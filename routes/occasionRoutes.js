const express = require('express');
const router = express.Router();
const occasionController = require('../controllers/OccasionController');
const { verifyToken, authAdmin, authGroup } = require('../middlewares/auth');
const multer = require('multer');
const validateRequest = require('../middlewares/validateRequest');
const {
    createOccasionSchema,
    updateOccasionSchema,
    updateAttendanceSchema
} = require('../validators/occasionValidators');

const upload = multer({ storage: multer.memoryStorage() });

// POST /create — Create occasion (admin/superadmin only)
router.post('/create', authAdmin, validateRequest({ body: createOccasionSchema }), occasionController.createOccasion);

// PATCH /update/:id — Update occasion (admin/superadmin/groupadmin)
router.patch('/update/:id', authGroup, validateRequest({ body: updateOccasionSchema }), occasionController.updateOccasion);

// PATCH /end/:id — Admin/SuperAdmin instant end occasion
router.patch('/end/:id', authAdmin, occasionController.endOccasion);

// PATCH /attendance/:id — Role-scoped attendance + rating submission
router.patch('/attendance/:id', verifyToken, validateRequest({ body: updateAttendanceSchema }), occasionController.updateAttendance);

// DELETE /remove/:id — Delete occasion (admin/superadmin only)
router.delete('/remove/:id', authAdmin, occasionController.deleteOccasion);

// POST /image/:id — Upload occasion photo
router.post('/image/:id', verifyToken, upload.single('photo'), occasionController.uploadImage);

// GET /fetch/all — Fetch all occasions
router.get('/fetch/all', verifyToken, occasionController.fetchAll);

// GET /fetch/paginated — Fetch paginated occasions
router.get('/fetch/paginated', verifyToken, occasionController.fetchPaginated);

// GET /fetch/id/:id — Fetch occasion by ID
router.get('/fetch/id/:id', verifyToken, occasionController.fetchById);

// GET /fetch/status — Fetch occasions by status
router.get('/fetch/status', verifyToken, occasionController.fetchByStatus);

// GET /fetch/date/:date — Fetch occasions by date
router.get('/fetch/date/:date', verifyToken, occasionController.fetchByDate);

// GET /fetch/month/:month — Fetch occasions by month
router.get('/fetch/month/:month', verifyToken, occasionController.fetchByMonth);

// GET /fetch/year/:year — Fetch occasions by year
router.get('/fetch/year/:year', verifyToken, occasionController.fetchByYear);

// GET /fetch/group — Fetch grouped parties
router.get('/fetch/group', verifyToken, occasionController.fetchGrouped);

module.exports = router;
