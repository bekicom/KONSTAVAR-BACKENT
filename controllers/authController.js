const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Shop = require("../models/Shop");
const { getOpenCashierShift } = require("../utils/shiftHelper");
const {
  normalizeObjectIdList,
  normalizeAllowedMenuKeys,
  SHOP_ASSIGNABLE_ROLES,
  SHOP_REQUIRED_ROLES,
} = require("../utils/userAccess");

const CREATABLE_ROLES = ["admin", "warehouse", "cashier", "bugalter"];

// 🔹 ADMIN CREATE (faqat 1 marta)
exports.createAdmin = async (req, res) => {
  try {
    const { fullName, phone, password } = req.body;

    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists" });
    }

    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ message: "Phone already used" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await User.create({
      fullName,
      phone,
      password: hashedPassword,
      role: "admin",
      // Bosh admin: do'kon biriktirilmagan, hamma menyu ochiq.
      shopId: null,
      allowedMenuKeys: normalizeAllowedMenuKeys("admin", []),
    });

    res.status(201).json({
      message: "Admin created successfully",
      admin,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 LOGIN
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ phone })
      .populate("shopId", "name warehouseId isActive")
      .populate("warehouseIds", "name address isActive");
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "User is inactive" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    const activeShift = user.role === "cashier" ? await getOpenCashierShift(user) : null;

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        shopId: user.shopId?._id || null,
        shopWarehouseId: user.shopId?.warehouseId || null,
        warehouseIds: (user.warehouseIds || []).map((item) => item?._id || item),
        allowedMenuKeys: Array.isArray(user.allowedMenuKeys) ? user.allowedMenuKeys : [],
      },
      activeShift: activeShift
        ? {
            id: activeShift._id,
            status: activeShift.status,
            openedAt: activeShift.openedAt,
            shopId: activeShift.shopId,
            warehouseId: activeShift.warehouseId,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 USER CREATE (Admin warehouse/cashier yaratadi)
exports.createUser = async (req, res) => {
  try {
    const { fullName, phone, password, role, shopId, warehouseIds, allowedMenuKeys } = req.body;

    if (!CREATABLE_ROLES.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    let resolvedShopId = null;
    let resolvedWarehouseIds = [];

    if (role === "warehouse") {
      resolvedWarehouseIds = normalizeObjectIdList(warehouseIds);
      if (resolvedWarehouseIds.length === 0) {
        return res.status(400).json({ message: "warehouseIds is required for warehouse user" });
      }
    } else if (SHOP_ASSIGNABLE_ROLES.includes(role)) {
      // Do'kon biriktirilsa — foydalanuvchi faqat o'sha do'konni ko'radi.
      // Kassirda majburiy, admin/buxgalterda ixtiyoriy (bo'sh bo'lsa —
      // hamma do'konni ko'radigan bosh foydalanuvchi).
      const rawShopId =
        shopId === undefined || shopId === null || String(shopId).trim() === ""
          ? null
          : String(shopId).trim();

      if (!rawShopId) {
        if (SHOP_REQUIRED_ROLES.includes(role)) {
          return res.status(400).json({ message: "shopId is required for cashier" });
        }
      } else {
        if (!mongoose.Types.ObjectId.isValid(rawShopId)) {
          return res.status(400).json({ message: "Invalid shopId" });
        }

        const shop = await Shop.findOne({ _id: rawShopId, isActive: true }).lean();
        if (!shop) {
          return res.status(400).json({ message: "Invalid or inactive shopId" });
        }
        resolvedShopId = shop._id;
      }
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ message: "Phone already used" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      fullName,
      phone,
      password: hashedPassword,
      role,
      shopId: resolvedShopId,
      warehouseIds: resolvedWarehouseIds,
      allowedMenuKeys: normalizeAllowedMenuKeys(role, allowedMenuKeys),
    });

    const safeUser = await User.findById(user._id, { password: 0 })
      .populate("shopId", "name warehouseId isActive")
      .populate("warehouseIds", "name address isActive")
      .lean();

    res.status(201).json({
      message: "User created successfully",
      user: safeUser,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
