const express = require('express');
const router = express.Router();
const vocalSessionController = require('../controllers/VocalSessionController');
const { verifyToken, authAdmin } = require('../middlewares/auth');
const validateRequest = require('../middlewares/validateRequest');
const {
    createVocalSessionSchema,
    updateVocalSessionSchema
} = require('../validators/vocalSessionValidators');

// POST /create — Create vocal session (admin only)
router.post('/create', authAdmin, validateRequest({ body: createVocalSessionSchema }), vocalSessionController.createSession);

// PATCH /update/:id — Update vocal session (admin only)
router.patch('/update/:id', authAdmin, validateRequest({ body: updateVocalSessionSchema }), vocalSessionController.updateSession);

// DELETE /remove/:id — Delete vocal session (admin only)
router.delete('/remove/:id', authAdmin, vocalSessionController.deleteSession);

// GET /fetch/active — Fetch active vocal sessions (Mobile app users)
router.get('/fetch/active', verifyToken, vocalSessionController.fetchActiveSessions);

// GET /fetch/all — Fetch all vocal sessions (Admin panel)
router.get('/fetch/all', authAdmin, vocalSessionController.fetchAllSessions);

// GET /fetch/id/:id — Fetch specific vocal session
router.get('/fetch/id/:id', verifyToken, vocalSessionController.fetchSessionById);

module.exports = router;
