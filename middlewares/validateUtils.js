const allowedTypes = [
    "dua",
    "ilteja",
    "madeh",
    "manqabat",
    "manzumaat",
    "munajaat",
    "naat",
    "nasheed",
    "nasihat",
    "noha",
    "qasida",
    "risa",
    "salam"
]

// Role hierarchy: higher number = higher privilege
const ROLE_HIERARCHY = {
    rootadmin: 5,
    superadmin: 4,
    admin: 3,
    groupadmin: 2,
    member: 1,
};

// All valid roles in the system
const ALL_ROLES = Object.keys(ROLE_HIERARCHY);

// Roles that can manage users/groups (excludes member)
const allowedRoles = [
    'rootadmin',
    'superadmin',
    'admin',
    'groupadmin',
];

// Roles that can manage groups (same as allowedRoles — admin-level and above)
const roles_for_group = [
    'rootadmin',
    'superadmin',
    'admin',
    'groupadmin',
]

/**
 * Check if an actor role can manage/modify a target role.
 * A role can only manage strictly lower-ranked roles.
 * e.g. admin (3) can manage groupadmin (2) and member (1), but not admin (3) or superadmin (4).
 */
const canManageRole = (actorRole, targetRole) => {
    const actorLevel = ROLE_HIERARCHY[actorRole] || 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] || 0;
    return actorLevel > targetLevel;
};

/**
 * Check if a role is at least the given minimum role level.
 * e.g. isAtLeast('admin', 'groupadmin') => true (admin >= groupadmin)
 */
const isAtLeast = (role, minimumRole) => {
    const roleLevel = ROLE_HIERARCHY[role] || 0;
    const minLevel = ROLE_HIERARCHY[minimumRole] || 0;
    return roleLevel >= minLevel;
};

module.exports = {
    allowedTypes,
    allowedRoles,
    roles_for_group,
    ROLE_HIERARCHY,
    ALL_ROLES,
    canManageRole,
    isAtLeast,
}