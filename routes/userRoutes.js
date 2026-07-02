const express = require('express');
const router = express.Router();
const userController = require('../controllers/UserController');
const { verifyToken, authGroup, authAdmin } = require('../middlewares/auth');
const { resolveTenant } = require('../middlewares/resolveTenant');
const validateRequest = require('../middlewares/validateRequest');
const {
    loginSchema,
    createUserSchema,
    updateUserSchema,
    updateUserTitleSchema,
    addFcmTokenSchema
} = require('../validators/userValidators');

// GET /me — Any authenticated user can fetch their own profile
router.get('/me', verifyToken, resolveTenant, userController.getMe);

// GET / — List all users (any authenticated user can view all users)
router.get('/', verifyToken, resolveTenant, userController.getAllUsers);

// GET /fetch/paginated — Paginated, filterable user list
router.get('/fetch/paginated', verifyToken, resolveTenant, userController.fetchPaginated);

// PUT /update/:id/title — Update a user's title
router.put('/update/:id/title', authGroup, resolveTenant, validateRequest({ body: updateUserTitleSchema }), userController.updateUserTitle);

// GET /fetch/:id — Any authenticated user can fetch a specific user
router.get('/fetch/:id', verifyToken, resolveTenant, userController.getUserById);

// GET /count — Count all users (authenticated only)
router.get('/count', verifyToken, resolveTenant, userController.getUserCount);

// GET /count/:group — Count users in a specific group (authenticated only)
router.get('/count/:group', verifyToken, resolveTenant, userController.getGroupUserCount);

// DELETE /remove/:id — Delete a user
router.delete('/remove/:id', authGroup, resolveTenant, userController.deleteUser);

// POST /authentication/login — Public login endpoint
router.post('/authentication/login', validateRequest({ body: loginSchema }), userController.loginUser);

// POST /create — Create a new user
router.post('/create', authGroup, resolveTenant, validateRequest({ body: createUserSchema }), userController.createUser);

// POST /bulk-insert — Bulk insert users
router.post('/bulk-insert', authGroup, resolveTenant, userController.bulkInsertUsers);

// PATCH /update/:userid — Update a user
router.patch('/update/:userid', verifyToken, resolveTenant, validateRequest({ body: updateUserSchema }), userController.updateUser);

// PUT /fcm-token — Add/update a device token for the authenticated user
router.put('/fcm-token', verifyToken, resolveTenant, validateRequest({ body: addFcmTokenSchema }), userController.addFcmToken);

// DELETE /fcm-token — Remove a device token (e.g., on logout)
router.delete('/fcm-token', verifyToken, resolveTenant, validateRequest({ body: addFcmTokenSchema }), userController.removeFcmToken);

// POST /:userid/transfer-party — Transfer a user to a different party
router.post('/:userid/transfer-party', authGroup, resolveTenant, userController.transferParty);

// POST /:userid/transfer-jamaat — Transfer a user to a different Jamaat (Super/Root Admin only)
router.post('/:userid/transfer-jamaat', authGroup, resolveTenant, userController.transferJamaat);

module.exports = router;
