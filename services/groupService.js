const groupClient = require('../models/group');
const userClient = require('../models/users');
const { hashPassword } = require('../middlewares/auth');
const AppError = require('../utils/AppError');
const { emitGroupCreated, emitGroupUpdated, emitGroupDeleted, emitUserUpdated } = require('../utils/socketEmit');

exports.getAllGroups = async (tenantId) => {
    const query = tenantId ? { tenantId } : {};
    return await groupClient.find(query);
};

exports.getGroupById = async (groupId) => {
    const group = await groupClient.findById(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }
    return group;
};

exports.createGroup = async (tenantId, name, adminId, userDetails) => {
    const existingGroup = await groupClient.findOne({ tenantId, name });
    if (existingGroup) {
        throw new AppError('Group with this name already exists.', 400);
    }

    let existingUser = null;
    if (userDetails) {
        existingUser = await userClient.findOne({
            $or: [
                { fullname: userDetails.fullname },
                { phone: userDetails.phone },
                { userid: userDetails.userid }
            ]
        });
        if (existingUser) {
            throw new AppError("User with the same fullname, phone, or userid already exists.", 400);
        }
    }

    let groupAdmin;
    let createdUser = null;

    if (adminId) {
        const adminUser = await userClient.findById(adminId);
        if (!adminUser) {
            throw new AppError('Invalid admin ID. User not found.', 400);
        }
        groupAdmin = adminId;
        createdUser = adminUser;
        adminUser.belongsto = name;
        if (adminUser.role === 'member') {
            adminUser.role = 'groupadmin';
        }
        await adminUser.save();
    } else if (userDetails) {
        const hashedPass = await hashPassword(String(userDetails.userid));
        const newUserPayload = {
            ...userDetails,
            belongsto: name,
            role: 'groupadmin',
            title: 'tipper',
            userpass: hashedPass,
        };
        createdUser = await userClient.create(newUserPayload);
        groupAdmin = createdUser._id;
    } else {
        throw new AppError('Either adminId or userDetails must be provided.', 400);
    }

    const createGroup = {
        tenantId,
        name,
        admin: String(groupAdmin),
        members: [String(groupAdmin)],
    };

    const newGroup = await groupClient.create(createGroup);

    emitGroupCreated(newGroup);
    if (createdUser) {
        emitUserUpdated(createdUser);
    }

    return {
        group: newGroup,
        ...(createdUser && { user: createdUser }),
    };
};

exports.updateGroup = async (caller, groupId, name) => {
    const group = await groupClient.findById(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (caller.role === 'groupadmin' && group.admin.toString() !== caller._id.toString()) {
        throw new AppError('Access denied. You can only update your own group.', 403);
    }

    group.name = name || group.name;
    await group.save();

    emitGroupUpdated(group);

    return group;
};

exports.deleteGroup = async (groupId) => {
    const group = await groupClient.findByIdAndDelete(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (group.admin) {
        const oldAdminUser = await userClient.findById(group.admin);
        if (oldAdminUser && oldAdminUser.role === 'groupadmin') {
            oldAdminUser.role = 'member';
            await oldAdminUser.save();
        }
    }

    await userClient.updateMany(
        { belongsto: group.name },
        { $set: { belongsto: '' } }
    );
    
    emitGroupDeleted(group.tenantId, groupId);
};

exports.transferRole = async (caller, groupId, newAdminId) => {
    const group = await groupClient.findById(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (caller.role === 'groupadmin' && group.admin.toString() !== caller._id.toString()) {
        throw new AppError('Access denied. You can only transfer admin for your own group.', 403);
    }

    const newAdminUser = await userClient.findById(newAdminId);
    if (!newAdminUser) {
        throw new AppError('Invalid new admin ID. User not found.', 400);
    }

    if (newAdminUser.role === 'member') {
        newAdminUser.role = 'groupadmin';
        await newAdminUser.save();
    }

    const oldAdminUser = await userClient.findById(group.admin);
    if (oldAdminUser && oldAdminUser.role === 'groupadmin') {
        oldAdminUser.role = 'member';
        await oldAdminUser.save();
    }

    group.admin = newAdminId;
    await group.save();

    emitGroupUpdated(group);
    emitUserUpdated(newAdminUser);
    if (oldAdminUser) {
        emitUserUpdated(oldAdminUser);
    }

    return group;
};

exports.addMember = async (caller, groupId, userId) => {
    const group = await groupClient.findById(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (caller.role === 'groupadmin' && group.admin.toString() !== caller._id.toString()) {
        throw new AppError('You can only add members to your own group.', 403);
    }

    if (group.members.includes(userId)) {
        throw new AppError('User is already a member of this group.', 400);
    }

    const user = await userClient.findById(userId);
    if (!user) {
        throw new AppError('User not found.', 400);
    }

    if (group.admin && user.role === 'groupadmin') {
        throw new AppError('Cannot assign groupadmin if the group already has one.', 400);
    }

    group.members.push(userId);
    user.belongsto = group.name;
    await user.save();
    await group.save();

    emitGroupUpdated(group);
    emitUserUpdated(user);

    return group;
};

exports.transferMember = async (caller, groupId, userId, newGroupId) => {
    if (caller.role === 'groupadmin') {
        const sourceGroup = await groupClient.findById(groupId);
        if (!sourceGroup || sourceGroup.admin.toString() !== caller._id.toString()) {
            throw new AppError('You can only transfer members from your own group.', 403);
        }
    }

    const group = await groupClient.findById(groupId);
    const newGroup = await groupClient.findById(newGroupId);
    const user = await userClient.findById(userId);

    if (!group || !newGroup) {
        throw new AppError('Group not found.', 404);
    }

    if (!user || !group.members.includes(userId)) {
        throw new AppError('User is not a member of this group.', 400);
    }

    group.members = group.members.filter(member => member.toString() !== userId);
    await group.save();

    newGroup.members.push(userId);
    user.belongsto = newGroup.name;
    await user.save();
    await newGroup.save();

    emitGroupUpdated(group);
    emitGroupUpdated(newGroup);
    emitUserUpdated(user);

    return newGroup;
};

exports.removeMember = async (caller, groupId, userId) => {
    const group = await groupClient.findById(groupId);
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (caller.role === 'groupadmin' && group.admin.toString() !== caller._id.toString()) {
        throw new AppError('You can only remove members from your own group.', 403);
    }

    const user = await userClient.findById(userId);
    if (!user || !group.members.includes(userId)) {
        throw new AppError('User is not a member of this group.', 400);
    }

    group.members = group.members.filter(member => member.toString() !== userId);
    user.belongsto = '';
    await user.save();
    await group.save();

    emitGroupUpdated(group);
    emitUserUpdated(user);
};

exports.leaveGroup = async (caller, userId) => {
    if (caller._id.toString() !== userId) {
        throw new AppError('You can only leave a group for yourself.', 403);
    }

    if (!caller.belongsto) {
        throw new AppError('You are not in any group.', 400);
    }

    const group = await groupClient.findOne({ name: caller.belongsto });
    if (!group) {
        throw new AppError('Group not found.', 404);
    }

    if (group.admin.toString() === caller._id.toString()) {
        throw new AppError('You must transfer admin rights before leaving the group.', 400);
    }

    group.members = group.members.filter(member => member.toString() !== userId);
    await group.save();

    caller.belongsto = '';
    await caller.save();

    emitGroupUpdated(group);
    emitUserUpdated(caller);
};
