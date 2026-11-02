const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Shop = require("../models/Shop");

const USER_CACHE_TTL_MS = 15000;
const userCache = new Map();

// Foydalanuvchi do'konga biriktirilgan bo'lsa, o'sha do'konning omborini
// bir marta aniqlab olamiz. Keyin har bir controller `shopWarehouseId` ni
// tayyor holda ishlatadi — qayta so'rov yuborilmaydi.
const attachShopWarehouse = async (user) => {
  if (!user.shopId) {
    user.shopWarehouseId = null;
    return user;
  }

  const shop = await Shop.findById(user.shopId).select("warehouseId isActive").lean();
  user.shopWarehouseId = shop ? shop.warehouseId : null;
  return user;
};

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
      .select("_id fullName phone role shopId warehouseIds allowedMenuKeys isActive")
      .lean();
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    if (user.isActive === false) {
      return res.status(401).json({ message: "Account is disabled", code: "USER_DISABLED" });
    }

    await attachShopWarehouse(user);

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

// Xodim ma'lumotlari (rol, do'kon, ombor, menyu ruxsatlari) o'zgarganda
// cache'ni tozalaymiz, aks holda yangi ruxsatlar 15 sekundgacha ishlamaydi.
module.exports.invalidateUserCache = (userId) => {
  if (userId === undefined) {
    userCache.clear();
    return;
  }
  userCache.delete(String(userId));
};
