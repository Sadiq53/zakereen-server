const express = require('express');
const router = express.Router();
const savedLocationController = require('../controllers/savedLocationController');
const { verifyToken, authAdmin } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');

router.get('/', authAdmin, resolveTenant, savedLocationController.getLocations);
router.post('/', authAdmin, resolveTenant, savedLocationController.createLocation);
router.delete('/:id', authAdmin, resolveTenant, savedLocationController.deleteLocation);

module.exports = router;
