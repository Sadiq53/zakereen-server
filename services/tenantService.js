const Tenant = require('../models/tenant');
const User = require('../models/users');
const AppError = require('../utils/AppError');
const { hashPassword } = require('../middlewares/auth');

/**
 * Create a new tenant.
 */
exports.createTenant = async (data) => {
    const { name, slug, address, contactEmail, contactPhone, maxUsers, settings } = data;

    const existing = await Tenant.findOne({ slug });
    if (existing) {
        throw new AppError('A tenant with this slug already exists.', 409);
    }

    const tenant = new Tenant({
        name,
        slug,
        address: address || '',
        contactEmail: contactEmail || '',
        contactPhone: contactPhone || '',
        maxUsers: maxUsers || 500,
        settings: settings || {},
        status: 'pending_setup',
    });

    await tenant.save();
    return tenant;
};

/**
 * Assign a coordinator (superadmin) to a tenant.
 * Creates the user if they don't exist, or promotes an existing user.
 */
exports.assignCoordinator = async (tenantId, coordinatorData) => {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    const { userid, fullname, phone, email, address } = coordinatorData;

    let user = await User.findOne({ userid });

    if (user) {
        // If the user is a rootadmin, we don't modify their role or tenantId, 
        // they can still be linked as the coordinator.
        if (user.role !== 'rootadmin') {
            user.role = 'superadmin';
        }
        user.tenantId = tenantId;
        user.updatedat = new Date();
        await user.save();
    } else {
        // Create new coordinator user
        const hashedPass = await hashPassword(userid);
        user = new User({
            tenantId,
            userid,
            fullname: fullname || '',
            phone: phone || '',
            email: email || '',
            address: address || '',
            role: 'superadmin',
            userpass: hashedPass,
            createdat: new Date(),
            updatedat: new Date(),
        });
        await user.save();
    }

    // Link coordinator to tenant and activate
    tenant.coordinator = user._id;
    tenant.status = 'active';
    await tenant.save();

    return { tenant, coordinator: user };
};

/**
 * List all tenants with optional status filter.
 */
exports.listTenants = async (statusFilter) => {
    const query = statusFilter ? { status: statusFilter } : { status: { $ne: 'deleted' } };
    return await Tenant.find(query).populate('coordinator', 'fullname userid email').sort({ createdAt: -1 }).lean();
};

/**
 * Get a single tenant by ID.
 */
exports.getTenantById = async (id) => {
    const tenant = await Tenant.findById(id).populate('coordinator', 'fullname userid email').lean();
    if (!tenant) throw new AppError('Tenant not found.', 404);
    return tenant;
};

/**
 * Update tenant details.
 */
exports.updateTenant = async (id, data) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    const allowedFields = ['name', 'address', 'contactEmail', 'contactPhone', 'maxUsers', 'settings'];
    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            tenant[field] = data[field];
        }
    }

    await tenant.save();
    return tenant;
};

/**
 * Suspend a tenant.
 */
exports.suspendTenant = async (id, reason) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);
    if (tenant.status === 'suspended') throw new AppError('Tenant is already suspended.', 400);

    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    tenant.suspendReason = reason || '';
    await tenant.save();
    return tenant;
};

/**
 * Reactivate a suspended tenant.
 */
exports.reactivateTenant = async (id) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);
    if (tenant.status !== 'suspended' && tenant.status !== 'archived') {
        throw new AppError('Tenant is not suspended or archived.', 400);
    }

    tenant.status = 'active';
    tenant.suspendedAt = null;
    tenant.suspendReason = '';
    await tenant.save();
    return tenant;
};

/**
 * Soft-delete a tenant.
 */
exports.deleteTenant = async (id) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) throw new AppError('Tenant not found.', 404);

    tenant.status = 'deleted';
    tenant.deletedAt = new Date();
    await tenant.save();
    return tenant;
};

/**
 * Get tenant stats (user count, occasion count, etc.)
 */
exports.getTenantStats = async (tenantId) => {
    const [userCount, occasionCount, attendanceCount] = await Promise.all([
        User.countDocuments({ tenantId }),
        require('../models/occassion').countDocuments({ tenantId }),
        require('../models/attendance').countDocuments({ tenantId }),
    ]);

    return { userCount, occasionCount, attendanceCount };
};

/**
 * Get global platform stats (cross-tenant).
 */
exports.getGlobalStats = async () => {
    const [tenantCounts, totalUsers, totalOccasions] = await Promise.all([
        Tenant.aggregate([
            { $match: { status: { $ne: 'deleted' } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        User.countDocuments({ role: { $ne: 'rootadmin' } }),
        require('../models/occassion').countDocuments(),
    ]);

    const tenants = tenantCounts.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
    }, {});

    return {
        tenants,
        totalTenants: Object.values(tenants).reduce((a, b) => a + b, 0),
        totalUsers,
        totalOccasions,
    };
};
