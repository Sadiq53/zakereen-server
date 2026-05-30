const express = require('express');
const router = express.Router();
const kalamController = require('../controllers/KalamController');
const { verifyToken } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');

// GET /api/v1/kalam/fetch
router.get('/fetch', verifyToken, resolveTenant, kalamController.fetchKalams);

// POST /api/v1/kalam/sync
router.post('/sync', verifyToken, resolveTenant, kalamController.syncKalams);

module.exports = router;
