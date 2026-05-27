const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/AnalyticsController');
const { verifyToken } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');

// GET /attendance — Attendance analytics (trend + leaderboards)
router.get('/attendance', verifyToken, resolveTenant, analyticsController.getAttendanceAnalytics);

// GET /kalams — Kalam recitation analytics
router.get('/kalams', verifyToken, resolveTenant, analyticsController.getKalamAnalytics);

// GET /parties — Party participation analytics
router.get('/parties', verifyToken, resolveTenant, analyticsController.getPartyAnalytics);

// GET /overview — Last occasion / realtime overview
router.get('/overview', verifyToken, resolveTenant, analyticsController.getOverviewAnalytics);

// GET /user/:userid — User-specific analytics
router.get('/user/:userid', verifyToken, resolveTenant, analyticsController.getUserAnalytics);

module.exports = router;
