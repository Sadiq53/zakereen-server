const userService = require('../services/userService');
const asyncHandler = require('express-async-handler');

// GET /me
exports.getMe = asyncHandler(async (req, res) => {
    const user = await userService.getMe(req.user);
    res.status(200).json(user);
});

// GET /
exports.getAllUsers = asyncHandler(async (req, res) => {
    const users = await userService.getAllUsers(req.tenantId);
    res.status(200).json(users);
});

// PUT /update/:id/title
exports.updateUserTitle = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    const userToUpdate = await userService.updateUserTitle(id, title, req.user);
    res.status(200).json(userToUpdate);
});

// GET /fetch/:id
exports.getUserById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await userService.getUserById(req.tenantId, id);
    res.status(200).json(user);
});

// GET /count
exports.getUserCount = asyncHandler(async (req, res) => {
    const count = await userService.getUserCount(req.tenantId);
    res.status(200).json({ count });
});

// GET /count/:group
exports.getGroupUserCount = asyncHandler(async (req, res) => {
    const { group } = req.params;
    const count = await userService.getGroupUserCount(req.tenantId, group);
    res.status(200).json({ count });
});

// DELETE /remove/:id
exports.deleteUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { admin } = req.body;
    const result = await userService.deleteUser(id, admin, req.user);
    res.status(200).json(result);
});

// POST /authentication/login
exports.loginUser = asyncHandler(async (req, res) => {
    const { userid, userpass } = req.body;
    const token = await userService.loginUser(userid, userpass);
    res.status(200).json({ token });
});

// POST /create
exports.createUser = asyncHandler(async (req, res) => {
    const newUser = await userService.createUser(req.user, req.body);
    res.status(201).json({
        message: "User created successfully.",
        user: newUser
    });
});

// PATCH /update/:userid
exports.updateUser = asyncHandler(async (req, res) => {
    const { userid } = req.params;
    const updatedUser = await userService.updateUser(req.user, userid, req.body);
    res.status(200).json({ message: "User updated successfully.", user: updatedUser });
});

// PUT /fcm-token
exports.addFcmToken = asyncHandler(async (req, res) => {
    const { token } = req.body;
    await userService.addFcmToken(req.user, token);
    res.status(200).json({ message: "FCM token registered successfully." });
});

// DELETE /fcm-token
exports.removeFcmToken = asyncHandler(async (req, res) => {
    const { token } = req.body;
    await userService.removeFcmToken(req.user, token);
    res.status(200).json({ message: "FCM token removed successfully." });
});