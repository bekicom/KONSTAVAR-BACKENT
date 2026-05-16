const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Shop = require("../models/Shop");
const { getOpenCashierShift } = require("../utils/shiftHelper");

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

    const user = await User.findOne({ phone }).populate("shopId", "name warehouseId isActive");
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
    const { fullName, phone, password, role, shopId } = req.body;

    if (!["warehouse", "cashier"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    let resolvedShopId = null;
    if (role === "cashier") {
      if (!shopId) {
        return res.status(400).json({ message: "shopId is required for cashier" });
      }

      const shop = await Shop.findOne({ _id: shopId, isActive: true }).lean();
      if (!shop) {
        return res.status(400).json({ message: "Invalid or inactive shopId for cashier" });
      }
      resolvedShopId = shop._id;
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
    });

    // 🔥 Passwordni chiqarib tashlaymiz
    const { password: _, ...safeUser } = user.toObject();

    res.status(201).json({
      message: "User created successfully",
      user: safeUser,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
