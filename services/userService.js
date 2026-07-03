const mongoose = require('mongoose');
const userClient = require('../models/users');
const groupClient = require('../models/group');
const Tenant = require('../models/tenant');
const { validatePassword, hashPassword, generateToken } = require('../middlewares/auth');
const { ALL_ROLES, canManageRole, isAtLeast } = require('../middlewares/validateUtils');
const AppError = require('../utils/AppError');
const { emitUserCreated, emitUserUpdated, emitUserDeleted, emitGroupUpdated } = require('../utils/socketEmit');
const auditService = require('./auditService');
const { invalidateTenantStats } = require('./tenantService');

exports.getMe = async (user) => {
    return user;
};

exports.getAllUsers = async (tenantId) => {
    const query = tenantId ? { tenantId } : {};
    return await userClient.find(query).select('-attendence');
};

exports.fetchPaginatedUsers = async (tenantId, options) => {
    const { page = 1, limit = 20, search, jamaat, role, sort, party } = options;
    const skip = (page - 1) * limit;

    const matchStage = {};
    if (tenantId) {
        matchStage.tenantId = new mongoose.Types.ObjectId(tenantId);
    }

    if (search) {
        matchStage.$or = [
            { fullname: { $regex: search, $options: 'i' } },
            { userid: { $regex: search, $options: 'i' } }
        ];
    }

    if (party) {
        matchStage.belongsto = { $regex: party, $options: 'i' };
    }

    if (jamaat) {
        const matchingTenants = await Tenant.find({ name: { $regex: jamaat, $options: 'i' } }).select('_id').lean();
        const tenantIds = matchingTenants.map(t => t._id);
        if (matchStage.tenantId) {
            if (!tenantIds.find(id => id.toString() === matchStage.tenantId.toString())) {
                matchStage.tenantId = new mongoose.Types.ObjectId(); 
            }
        } else {
            matchStage.tenantId = { $in: tenantIds };
        }
    }

    if (role) {
        matchStage.role = role;
    }

    const pipeline = [
        { $match: matchStage },
        {
            $addFields: {
                attendanceCount: {
                    $cond: {
                        if: { $isArray: "$attendence" },
                        then: { $size: "$attendence" },
                        else: 0
                    }
                }
            }
        }
    ];

    if (!tenantId) {
        pipeline.push(
            {
                $lookup: {
                    from: "tenants",
                    localField: "tenantId",
                    foreignField: "_id",
                    as: "tenantInfo"
                }
            },
            {
                $addFields: {
                    jamaatName: { $arrayElemAt: ["$tenantInfo.name", 0] }
                }
            },
            {
                $project: {
                    tenantInfo: 0
                }
            }
        );
    }

    // Sorting
    let sortStage = { createdat: -1 };
    if (sort) {
        if (sort === 'attendance_high') sortStage = { attendanceCount: -1 };
        else if (sort === 'attendance_low') sortStage = { attendanceCount: 1 };
        else if (sort === 'oldest') sortStage = { createdat: 1 };
        else if (sort === 'name_asc') sortStage = { fullname: 1 };
        else if (sort === 'name_desc') sortStage = { fullname: -1 };
    }
    pipeline.push({ $sort: sortStage });

    const countPipeline = [...pipeline];
    countPipeline.push({ $count: 'total' });
    const countResult = await userClient.aggregate(countPipeline);
    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    pipeline.push({ $skip: skip }, { $limit: limit });
    
    // Add populate-like lookup for belongsto if needed, but we keep it fast
    const users = await userClient.aggregate(pipeline);

    return {
        users,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
    };
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
    emitUserUpdated(userToUpdate);
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

    const { belongsto, _id: userObjectId, tenantId: userTenantId } = userToDelete;
    let group = null;

    if (belongsto) {
        group = await groupClient.findOne({ tenantId: userTenantId, name: belongsto });
    }

    if (group) {
        await groupClient.updateOne(
            { tenantId: userTenantId, name: belongsto },
            { $pull: { members: userObjectId } }
        );

        if (replacementAdminId) {
            const newAdmin = await userClient.findById(replacementAdminId);
            if (newAdmin && newAdmin.role === 'member') {
                newAdmin.role = 'groupadmin';
                await newAdmin.save();
                emitUserUpdated(newAdmin);
            }

            await groupClient.updateOne(
                { tenantId: userTenantId, name: belongsto },
                { $set: { admin: replacementAdminId } }
            );
        }
    }

    const deletionResult = await userClient.deleteOne({ userid: id });
    if (deletionResult.deletedCount === 0) {
        throw new AppError("Failed to delete user.", 500);
    }
    
    emitUserDeleted(creator.tenantId, userObjectId);
    if (group) {
        const updatedGroup = await groupClient.findOne({ tenantId: userTenantId, name: belongsto });
        if (updatedGroup) {
            emitGroupUpdated(updatedGroup);
        }
    }

    invalidateTenantStats(userTenantId);

    const updatedUsers = await userClient.find(creator.tenantId ? { tenantId: creator.tenantId } : {});
    const updatedGroups = await groupClient.find(creator.tenantId ? { tenantId: creator.tenantId } : {});

    return { user: updatedUsers, group: updatedGroups };
};

exports.loginUser = async (userid, userpass) => {
    if (!userid || !userpass) {
        throw new AppError("Username and password are required.", 400);
    }

    const ITS = String(userid).trim();
    const user = await userClient.findOne({ userid: ITS }).select('+userpass');

    if (!user) {
        throw new AppError("Username or password is not valid.", 401);
    }

    if (typeof userpass !== 'string') {
        throw new AppError("Invalid password format.", 400);
    }

    if (!user.userpass || typeof user.userpass !== 'string') {
        throw new AppError("Username or password is not valid.", 401);
    }

    const passwordMatch = await validatePassword(userpass, user.userpass);
    if (!passwordMatch) {
        throw new AppError("Username or password is not valid.", 401);
    }

    const token = generateToken(user);
    return token;
};

exports.createUser = async (creator, userData) => {
    if (!userData.role) userData.role = 'member';
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

    if (!fullname || !userid || !title) {
        throw new AppError("All required fields (fullname, userid, title) must be provided.", 400);
    }

    let tenantId = creator.tenantId;
    if (creator.role === 'rootadmin') {
        if (!userData.tenantId) {
            if (creator.tenantId) {
                tenantId = creator.tenantId;
            } else {
                throw new AppError('Root admin must specify a tenantId when creating users.', 400);
            }
        } else {
            tenantId = userData.tenantId;
        }
    } else if (userData.tenantId && String(userData.tenantId) !== String(creator.tenantId)) {
        throw new AppError("You cannot create a user in a different Jamaat.", 403);
    }

    if (tenantId) {
        const tenant = await Tenant.findById(tenantId);
        if (tenant) {
            const currentUserCount = await userClient.countDocuments({ tenantId });
            if (currentUserCount >= tenant.maxUsers) {
                throw new AppError(`Cannot create user. This Jamaat has reached its maximum user limit of ${tenant.maxUsers}.`, 403);
            }
        }
    }

    const globalExistingUser = await userClient.findOne({ userid });
    if (globalExistingUser) {
        throw new AppError("A user with this userid already exists on the platform. Userid must be globally unique.", 400);
    }

    const existingUser = await userClient.findOne({
        tenantId,
        $or: [{ fullname }, { phone }]
    });

    if (existingUser) {
        throw new AppError("A user with the same fullname or phone already exists in your Jamaat.", 400);
    }

    if (belongsto) {
        const group = await groupClient.findOne({ tenantId, name: belongsto });
        if (!group) {
            throw new AppError(`Group '${belongsto}' does not exist in the selected Jamaat.`, 400);
        }
    }

    const hashedPass = await hashPassword(String(userid));

    const newUser = new userClient({
        ...userData,
        tenantId,
        userpass: hashedPass,
        createdat: new Date(),
        updatedat: new Date(),
    });

    await newUser.save();

    if (belongsto && role !== 'member') {
        const group = await groupClient.findOne({ tenantId, name: belongsto });
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
            { tenantId, name: belongsto },
            { $addToSet: { members: newUser._id } }
        );
    }
    
    await auditService.logAudit(
        creator, 
        'USER_CREATED', 
        'USER', 
        newUser._id, 
        { newUser: { userid: newUser.userid, role: newUser.role, belongsto: newUser.belongsto } }
    );

    invalidateTenantStats(tenantId);

    emitUserCreated(newUser);
    if (belongsto) {
        const updatedGroup = await groupClient.findOne({ tenantId, name: belongsto });
        if (updatedGroup) emitGroupUpdated(updatedGroup);
    }

    return newUser;
};

exports.updateUser = async (updater, userid, updatePayload) => {
    const query = updater.role === 'rootadmin' ? { userid } : { userid, tenantId: updater.tenantId };
    const userToUpdate = await userClient.findOne(query);
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
            updateData.mustChangePassword = false;
        }

        const { fullname, email, phone } = updateData;
        if (fullname || email || phone) {
            const conflictQuery = [];
            if (fullname) conflictQuery.push({ fullname, userid: { $ne: userid } });
            if (email) conflictQuery.push({ email, userid: { $ne: userid } });
            if (phone) conflictQuery.push({ phone, userid: { $ne: userid } });

            if (conflictQuery.length > 0) {
                const existingUser = await userClient.findOne({ 
                    tenantId: userToUpdate.tenantId, 
                    $or: conflictQuery 
                });
                if (existingUser) {
                    throw new AppError("User with the same fullname, email, or phone already exists.", 400);
                }
            }
        }

        Object.assign(userToUpdate, updateData);
        userToUpdate.updatedat = Date.now();
        await userToUpdate.save();
        
        emitUserUpdated(userToUpdate);
        invalidateTenantStats(userToUpdate.tenantId);
        
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
            const existingUser = await userClient.findOne({ 
                tenantId: userToUpdate.tenantId, 
                $or: conflictQuery 
            });
            if (existingUser) {
                throw new AppError("User with the same fullname, email, or phone already exists in your Jamaat.", 400);
            }
        }
    }

    const adminNewPassword = updatePayload.newPassword;

    const forbiddenFields = ['userpass', 'userid', '_id', '__v', 'newPassword'];
    for (const field of forbiddenFields) {
        delete updatePayload[field];
    }

    if (adminNewPassword && adminNewPassword.trim().length >= 4) {
        userToUpdate.userpass = await hashPassword(adminNewPassword.trim());
        userToUpdate.mustChangePassword = true;
    }

    Object.assign(userToUpdate, updatePayload);
    userToUpdate.updatedat = Date.now();
    await userToUpdate.save();
    
    emitUserUpdated(userToUpdate);
    invalidateTenantStats(userToUpdate.tenantId);

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

exports.bulkInsertUsers = async (caller, usersArray) => {
    if (!Array.isArray(usersArray) || usersArray.length === 0) {
        throw new AppError("No users provided for bulk insert.", 400);
    }

    // 1. Preparation
    const userids = [];
    const groupnames = new Set();
    const validUsers = [];
    const result = {
        successCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        skippedDetails: [],
        errors: []
    };

    // Filter missing required fields and collect IDs/groups
    for (const u of usersArray) {
        if (!u.userid || !u.fullname || !u.role) {
            result.skippedCount++;
            result.skippedDetails.push(`Row missing required fields (userid, fullname, role): ${JSON.stringify(u)}`);
            continue;
        }

        const targetTenantId = caller.role === 'rootadmin' ? (u.tenantId || caller.tenantId || caller.userTenantId) : caller.tenantId;
        
        if (!targetTenantId) {
            result.skippedCount++;
            result.skippedDetails.push(`User ${u.userid}: Could not determine Jamaat/Tenant.`);
            continue;
        }

        const formattedUser = {
            ...u,
            targetTenantId: new mongoose.Types.ObjectId(targetTenantId)
        };

        userids.push(formattedUser.userid);
        if (formattedUser.groupname) {
            groupnames.add(formattedUser.groupname);
            formattedUser.belongsto = formattedUser.groupname;
        } else if (formattedUser.belongsto) {
            groupnames.add(formattedUser.belongsto);
        }

        validUsers.push(formattedUser);
    }

    if (validUsers.length === 0) {
        return result;
    }

    const existingUsersList = await userClient.find({ userid: { $in: userids } }).lean();
    const existingUsersMap = new Map();
    existingUsersList.forEach(user => existingUsersMap.set(String(user.userid), user));

    const tenantIds = Array.from(new Set(validUsers.map(u => String(u.targetTenantId))));
    const existingGroupsList = await groupClient.find({
        name: { $in: Array.from(groupnames).map(name => new RegExp(`^${name}$`, 'i')) },
        tenantId: { $in: tenantIds }
    });
    
    // Create a robust map for case-insensitive lookup: key = tenantId_lowerName
    const existingGroupsMap = new Map();
    existingGroupsList.forEach(g => existingGroupsMap.set(`${g.tenantId.toString()}_${g.name.toLowerCase()}`, g));

    const bulkUserOps = [];
    const groupUpdates = new Map(); // tenantId_lowerName -> group object to save later

    // 2.5 Batch Hash Passwords for NEW users (Parallel processing with concurrency control)
    const newUsersToHash = validUsers.filter(u => !existingUsersMap.has(String(u.userid)));
    const hashedPasswordsMap = new Map();
    const BATCH_SIZE = 20; // bcrypt is CPU intensive, 20 is a safe threshold
    
    for (let i = 0; i < newUsersToHash.length; i += BATCH_SIZE) {
        const batch = newUsersToHash.slice(i, i + BATCH_SIZE);
        const hashes = await Promise.all(
            batch.map(u => hashPassword(String(u.userid)))
        );
        batch.forEach((u, idx) => hashedPasswordsMap.set(String(u.userid), hashes[idx]));
    }

    // 3. Process each valid user
    for (const u of validUsers) {
        const tenantKey = u.targetTenantId.toString();
        const existingUser = existingUsersMap.get(String(u.userid));

        // Group handling logic (if they belong to a group)
        let groupName = u.belongsto;
        let groupKey = groupName ? `${tenantKey}_${groupName.toLowerCase()}` : null;
        let groupObj = groupKey ? (groupUpdates.get(groupKey) || existingGroupsMap.get(groupKey)) : null;

        if (groupName && !groupObj) {
            // Group doesn't exist, schedule for creation
            groupObj = new groupClient({
                tenantId: u.targetTenantId,
                name: groupName,
                members: [],
                admin: null // Will set below if tipper
            });
            groupUpdates.set(groupKey, groupObj);
            existingGroupsMap.set(groupKey, groupObj);
        }

        const isTipper = u.title && u.title.toLowerCase() === 'tipper';
        let finalRole = u.role;

        if (existingUser) {
            // UPSERT LOGIC
            const updateDoc = {
                fullname: u.fullname,
                role: finalRole,
                title: u.title,
                belongsto: groupName
            };
            if (u.phone) updateDoc.phone = u.phone;
            if (u.address) updateDoc.address = u.address;

            // Handle tipper logic for upserted user
            if (groupObj && isTipper) {
                updateDoc.role = 'groupadmin';
                finalRole = 'groupadmin';
                
                if (groupObj.admin && String(groupObj.admin) !== String(existingUser._id)) {
                    // Demote old admin
                    bulkUserOps.push({
                        updateOne: {
                            filter: { _id: groupObj.admin },
                            update: { $set: { role: 'member', title: 'co-tipper' } }
                        }
                    });
                }
                groupObj.admin = existingUser._id;
            }

            bulkUserOps.push({
                updateOne: {
                    filter: { userid: u.userid },
                    update: { $set: updateDoc, $currentDate: { updatedat: true } }
                }
            });

            if (groupObj) {
                // Ensure they are in the members array
                if (!groupObj.members.includes(existingUser._id)) {
                    groupObj.members.push(existingUser._id);
                }
            }

            result.updatedCount++;
        } else {
            // INSERT LOGIC
            const newUser_id = new mongoose.Types.ObjectId();
            
            if (groupObj && isTipper) {
                finalRole = 'groupadmin';
                if (groupObj.admin) {
                    // Demote old admin
                    bulkUserOps.push({
                        updateOne: {
                            filter: { _id: groupObj.admin },
                            update: { $set: { role: 'member', title: 'co-tipper' } }
                        }
                    });
                }
                groupObj.admin = newUser_id;
            }

            const hashedPass = hashedPasswordsMap.get(String(u.userid));

            bulkUserOps.push({
                insertOne: {
                    document: {
                        _id: newUser_id,
                        userid: u.userid,
                        fullname: u.fullname,
                        phone: u.phone,
                        address: u.address,
                        role: finalRole,
                        title: u.title,
                        belongsto: groupName,
                        tenantId: u.targetTenantId,
                        userpass: hashedPass,
                        createdat: new Date(),
                        updatedat: new Date()
                    }
                }
            });

            if (groupObj) {
                groupObj.members.push(newUser_id);
            }

            result.successCount++;
        }
    }

    // 4. Execute Bulk Operations
    if (bulkUserOps.length > 0) {
        await userClient.bulkWrite(bulkUserOps);
    }

    // Save all newly created or updated groups
    const groupSavePromises = [];
    for (const group of groupUpdates.values()) {
        groupSavePromises.push(group.save());
    }
    // Also save existing groups that got their members/admin modified but were already in DB
    for (const group of existingGroupsMap.values()) {
        if (!group.isNew && group.isModified && group.isModified()) {
            groupSavePromises.push(group.save());
        }
    }

    await Promise.all(groupSavePromises);

    return result;
};
