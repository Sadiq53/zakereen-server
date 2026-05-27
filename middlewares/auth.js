const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const userClient = require('../models/users')
require('dotenv').config()


// Hash password function
const hashPassword = async (plainPassword) => {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
    return hashedPassword;
  } catch (err) {
    console.error('Error hashing password:', err);
    throw err;
  }
};

const validatePassword = async (enteredPassword, hashedPassword) => {
  return await bcrypt.compare(enteredPassword, hashedPassword);
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

    if (!["superadmin", "admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error("Admin auth error:", error);
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

    if (!["superadmin", "admin", "groupadmin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied. Admin privileges required." });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error("Group auth error:", error);
    return res.status(403).json({ message: "Invalid token." });
  }
};

/**
 * Middleware: Verifies JWT and populates req.user with full user document.
 * Any authenticated user passes (no role restriction).
 * This replaces the old verifyToken that only set req.userId.
 */
const verifyToken = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Token is required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userid = String(decoded.userid);

    const user = await userClient.findOne({ userid });

    if (!user) {
      return res.status(401).json({ error: "User not found." });
    }

    req.user = user;
    req.userId = userid; // backward compat
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(403).json({ error: "Invalid token." });
  }
};


module.exports = {
  hashPassword,
  validatePassword,
  authAdmin,
  authGroup,
  verifyToken
};
