const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const userClient = require('../models/users')
require('dotenv').config()
const { isAtLeast } = require('./validateUtils');
const { setContext } = require('./requestContext');
const logger = require('../utils/logger');


// Hash password function
const hashPassword = async (plainPassword) => {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
    return hashedPassword;
  } catch (err) {
    logger.error('Error hashing password:', err);
    throw err;
  }
};

const validatePassword = async (enteredPassword, hashedPassword) => {
  return await bcrypt.compare(enteredPassword, hashedPassword);
};

/**
 * Generate a multi-tenant JWT token.
 * Payload includes sub (user _id), userid, tenantId, and role.
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      sub: user._id.toString(),
      userid: user.userid,
      tenantId: user.tenantId ? user.tenantId.toString() : null,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * Extract and verify JWT token from Authorization header.
 * Returns the decoded payload or null.
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1].trim();
};

/**
 * Middleware: Requires superadmin or admin role.
 * Populates req.user with the full user document.
 */
const authAdmin = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: "Authorization token is required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Ensure userid is always queried as a String to match the schema type
    const userid = String(decoded.userid);

    const user = await userClient.findOne({ userid });

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    if (!isAtLeast(user.role, 'admin')) {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    req.user = user;
    setContext('userId', user._id.toString());
    if (user.tenantId) setContext('tenantId', user.tenantId.toString());
    next();

  } catch (error) {
    logger.error("Admin auth error:", error);
    return res.status(403).json({ message: "Invalid token." });
  }
};

/**
 * Middleware: Requires superadmin, admin, or groupadmin role.
 * Populates req.user with the full user document.
 */
const authGroup = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: "Authorization token is required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userid = String(decoded.userid);

    const user = await userClient.findOne({ userid });

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    if (!isAtLeast(user.role, 'groupadmin')) {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    req.user = user;
    setContext('userId', user._id.toString());
    if (user.tenantId) setContext('tenantId', user.tenantId.toString());
    next();

  } catch (error) {
    logger.error("Group auth error:", error);
    return res.status(403).json({ message: "Invalid token." });
  }
};

/**
 * Middleware: Verifies JWT and populates req.user with full user document.
 * Any authenticated user passes (no role restriction).
 * Also sets req.decodedToken with raw JWT claims for downstream middleware.
 */
const verifyToken = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Token is required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userid = String(decoded.userid);

    const user = await userClient.findOne({ userid })
      .select('-attendence');

    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }

    req.user = user;
    req.userId = userid; // backward compat
    req.decodedToken = decoded; // raw JWT claims for resolveTenant
    setContext('userId', user._id.toString());
    if (user.tenantId) setContext('tenantId', user.tenantId.toString());
    next();
  } catch (error) {
    logger.error("Token verification failed:", error);
    return res.status(403).json({ error: "Invalid token." });
  }
};


module.exports = {
  hashPassword,
  validatePassword,
  generateToken,
  authAdmin,
  authGroup,
  verifyToken
};
