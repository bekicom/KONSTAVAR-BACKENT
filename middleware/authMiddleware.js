const jwt = require("jsonwebtoken");
const User = require("../models/User");

const USER_CACHE_TTL_MS = 15000;
const userCache = new Map();

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = header.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const cached = userCache.get(String(decoded.id));
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      return next();
    }

    const user = await User.findById(decoded.id)
      .select("_id fullName phone role shopId warehouseId isActive")
      .lean();
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (user.isActive === false) {
      return res.status(401).json({ message: "Account is disabled", code: "USER_DISABLED" });
    }

    userCache.set(String(decoded.id), {
      user,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    });

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
  }
};
