const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/AnalyticsController');
const { verifyToken } = require('../middlewares/auth');

// GET /attendance — Attendance analytics (trend + leaderboards)
router.get('/attendance', verifyToken, analyticsController.getAttendanceAnalytics);

// GET /kalams — Kalam recitation analytics
router.get('/kalams', verifyToken, analyticsController.getKalamAnalytics);

// GET /parties — Party participation analytics
router.get('/parties', verifyToken, analyticsController.getPartyAnalytics);

// GET /overview — Last occasion / realtime overview
router.get('/overview', verifyToken, analyticsController.getOverviewAnalytics);

// GET /user/:userid — User-specific analytics
router.get('/user/:userid', verifyToken, analyticsController.getUserAnalytics);

module.exports = router;
