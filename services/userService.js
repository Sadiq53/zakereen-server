const userClient = require('../models/users');
const groupClient = require('../models/group');
const Tenant = require('../models/tenant');
const { validatePassword, hashPassword, generateToken } = require('../middlewares/auth');
const { ALL_ROLES, canManageRole, isAtLeast } = require('../middlewares/validateUtils');
const AppError = require('../utils/AppError');

exports.getMe = async (user) => {
    return user;
};

exports.getAllUsers = async (tenantId) => {
    const query = tenantId ? { tenantId } : {};
    return await userClient.find(query);
};

exports.updateUserTitle = async (id, title, caller) => {
    const userToUpdate = await userClient.findById(id);
    if (!userToUpdate) {
        throw new AppError("User not found.", 404);
    }

    const isSelf = caller.userid === userToUpdate.userid;

    const isHighestRoleManagingSame = caller.role === userToUpdate.role && isAtLeast(caller.role, 'superadmin');
    if (!isSelf && !isHighestRoleManagingSame && !canManageRole(caller.role, userToUpdate.role)) {
        throw new AppError("You do not have permission to modify this user.", 403);
    }

    if (!isSelf && caller.role === 'groupadmin' && userToUpdate.belongsto !== caller.belongsto) {
        throw new AppError("You can only update members from your own group.", 403);
    }

    userToUpdate.title = title;
    await userToUpdate.save();
    return userToUpdate;
};

exports.getUserById = async (tenantId, id) => {
    const query = tenantId ? { _id: id, tenantId } : { _id: id };
    const user = await userClient.findOne(query);
    if (!user) {
        throw new AppError("User not found.", 404);
    }
    return user;
};

exports.getUserCount = async (tenantId) => {
    const query = tenantId ? { tenantId } : {};
    return await userClient.countDocuments(query);
};

exports.getGroupUserCount = async (tenantId, groupName) => {
    const query = tenantId ? { tenantId, belongsto: groupName } : { belongsto: groupName };
    return await userClient.countDocuments(query);
};

exports.deleteUser = async (id, replacementAdminId, creator) => {
    const userToDelete = await userClient.findOne({ userid: id });
    if (!userToDelete) {
        throw new AppError("User not found.", 404);
    }

    if (!canManageRole(creator.role, userToDelete.role)) {
        throw new AppError("You do not have permission to delete this user.", 403);
    }

    if (creator.role === 'groupadmin' && userToDelete.belongsto !== creator.belongsto) {
        throw new AppError("You can only delete members from your own group.", 403);
    }

    const { belongsto, _id: userObjectId } = userToDelete;
    let group = null;

    if (belongsto) {
        group = await groupClient.findOne({ name: belongsto });
    }

    if (group) {
        await groupClient.updateOne(
            { name: belongsto },
            { $pull: { members: userObjectId } }
        );

        if (replacementAdminId) {
            const newAdmin = await userClient.findById(replacementAdminId);
            if (newAdmin && newAdmin.role === 'member') {
                newAdmin.role = 'groupadmin';
                await newAdmin.save();
            }

            await groupClient.updateOne(
                { name: belongsto },
                { $set: { admin: replacementAdminId } }
            );
        }
    }

    const deletionResult = await userClient.deleteOne({ userid: id });
    if (deletionResult.deletedCount === 0) {
        throw new AppError("Failed to delete user.", 500);
    }

    const tenantId = creator.tenantId;
    const updatedUsers = await userClient.find({ tenantId });
    const updatedGroups = await groupClient.find({ tenantId });

    return { user: updatedUsers, group: updatedGroups };
};

exports.loginUser = async (userid, userpass) => {
    if (!userid || !userpass) {
        throw new AppError("Username and password are required.", 400);
    }

    const ITS = String(userid).trim();
    
    // Look up the user directly by their unique ITS ID.
    // The user's tenantId is inherently attached to their document.
    const user = await userClient.findOne({ userid: ITS });

    if (!user) {
        throw new AppError("Username or password is not valid.", 401);
    }

    if (typeof userpass !== 'string' || typeof user.userpass !== 'string') {
        throw new AppError("Invalid password format.", 400);
    }

    const passwordMatch = await validatePassword(userpass, user.userpass);
    if (!passwordMatch) {
        throw new AppError("Username or password is not valid.", 401);
    }

    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not defined in environment variables.");
        throw new AppError("Server configuration error.", 500);
    }

    const token = generateToken(user);
    return token;
};

exports.createUser = async (creator, userData) => {
    let { fullname, phone, userid, belongsto, role, title } = userData;

    if (!ALL_ROLES.includes(role)) {
        throw new AppError(`Invalid role '${role}'. Must be one of: ${ALL_ROLES.join(', ')}`, 400);
    }

    if (creator.role === 'groupadmin') {
        if (role !== 'member' && role !== 'groupadmin') {
            throw new AppError("Group admins can only create members or transfer admin rights.", 403);
        }
        belongsto = creator.belongsto;
        userData.belongsto = creator.belongsto;
    }

    const isTransfer = creator.role === 'groupadmin' && role === 'groupadmin';
    if (!isTransfer && !canManageRole(creator.role, role)) {
        throw new AppError("You cannot create a user with a role equal to or higher than your own.", 403);
    }

    if (!fullname || !phone || !userid || !role || !title) {
        throw new AppError("All required fields (fullname, phone, userid, role, title) must be provided.", 400);
    }

    // if (!isAtLeast(role, 'admin') && !belongsto && !isAtLeast(creator.role, 'superadmin')) {
    //     throw new AppError("belongsto field is required for non-admin users.", 400);
    // }

    const tenantId = creator.tenantId;

    if (tenantId) {
        const tenant = await Tenant.findById(tenantId);
        if (tenant) {
            const currentUserCount = await userClient.countDocuments({ tenantId });
            if (currentUserCount >= tenant.maxUsers) {
                throw new AppError(`Cannot create user. This Jamaat has reached its maximum user limit of ${tenant.maxUsers}.`, 403);
            }
        }
    }

    const existingUser = await userClient.findOne({
        tenantId,
        $or: [{ fullname }, { phone }, { userid }]
    });

    if (existingUser) {
        throw new AppError("A user with the same fullname, phone, or userid already exists.", 400);
    }

    if (belongsto) {
        const group = await groupClient.findOne({ name: belongsto });
        if (!group) {
            throw new AppError("Group does not exist.", 400);
        }
    }

    const hashedPass = await hashPassword(String(userid));

    const newUser = new userClient({
        ...userData,
        tenantId: creator.tenantId,
        userpass: hashedPass,
        createdat: new Date(),
        updatedat: new Date(),
    });

    await newUser.save();

    if (belongsto && role !== 'member') {
        const group = await groupClient.findOne({ name: belongsto });
        const groupAdminData = await userClient.findById(group.admin);

        if (groupAdminData && groupAdminData.role === 'groupadmin') {
            groupAdminData.role = 'member';
            await groupAdminData.save();
        }

        group.admin = newUser._id;
        await group.save();
    }

    if (belongsto) {
        await groupClient.updateOne(
            { name: belongsto },
            { $addToSet: { members: newUser._id } }
        );
    }

    return newUser;
};

exports.updateUser = async (updater, userid, updatePayload) => {
    const userToUpdate = await userClient.findOne({ userid });
    if (!userToUpdate) {
        throw new AppError("User not found.", 404);
    }

    const isSelf = updater.userid === userid;

    if (isSelf) {
        const allowedSelfFields = ['fullname', 'phone', 'email', 'address', 'title'];
        const updateData = {};
        for (const field of allowedSelfFields) {
            if (updatePayload[field] !== undefined) {
                updateData[field] = updatePayload[field];
            }
        }

        if (updatePayload.newPassword && updatePayload.newPassword.trim().length >= 4) {
            updateData.userpass = await hashPassword(updatePayload.newPassword.trim());
        }

        const { fullname, email, phone } = updateData;
        if (fullname || email || phone) {
            const conflictQuery = [];
            if (fullname) conflictQuery.push({ fullname, userid: { $ne: userid } });
            if (email) conflictQuery.push({ email, userid: { $ne: userid } });
            if (phone) conflictQuery.push({ phone, userid: { $ne: userid } });

            if (conflictQuery.length > 0) {
                const existingUser = await userClient.findOne({ $or: conflictQuery });
                if (existingUser) {
                    throw new AppError("User with the same fullname, email, or phone already exists.", 400);
                }
            }
        }

        Object.assign(userToUpdate, updateData);
        userToUpdate.updatedat = Date.now();
        await userToUpdate.save();
        return userToUpdate;
    }

    if (!canManageRole(updater.role, userToUpdate.role)) {
        throw new AppError("You do not have permission to update this user.", 403);
    }

    if (updater.role === 'groupadmin' && userToUpdate.belongsto !== updater.belongsto) {
        throw new AppError("You can only update members in your own group.", 403);
    }

    if (updatePayload.role) {
        if (updater.role === 'groupadmin') {
            if (!['member', 'groupadmin'].includes(updatePayload.role)) {
                throw new AppError("Group admins can only assign member or groupadmin roles.", 403);
            }
        } else if (!canManageRole(updater.role, updatePayload.role)) {
            throw new AppError("You cannot assign a role equal to or higher than your own.", 403);
        }
    }

    const { fullname, email, phone } = updatePayload;
    if (fullname || email || phone) {
        const conflictQuery = [];
        if (fullname) conflictQuery.push({ fullname, userid: { $ne: userid } });
        if (email) conflictQuery.push({ email, userid: { $ne: userid } });
        if (phone) conflictQuery.push({ phone, userid: { $ne: userid } });

        if (conflictQuery.length > 0) {
            const existingUser = await userClient.findOne({ $or: conflictQuery });
            if (existingUser) {
                throw new AppError("User with the same fullname, email, or phone already exists.", 400);
            }
        }
    }

    const forbiddenFields = ['userpass', 'userid', '_id', '__v'];
    for (const field of forbiddenFields) {
        delete updatePayload[field];
    }

    Object.assign(userToUpdate, updatePayload);
    userToUpdate.updatedat = Date.now();
    await userToUpdate.save();

    return userToUpdate;
};

exports.addFcmToken = async (user, token) => {
    if (!token) {
        throw new AppError("Token is required.", 400);
    }

    await userClient.findByIdAndUpdate(
        user._id,
        { $addToSet: { fcmTokens: token }, updatedat: new Date() }
    );
};

exports.removeFcmToken = async (user, token) => {
    if (!token) {
        throw new AppError("Token is required.", 400);
    }

    await userClient.findByIdAndUpdate(
        user._id,
        { $pull: { fcmTokens: token }, updatedat: new Date() }
    );
};
