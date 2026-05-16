const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Shop = require("../models/Shop");

const serializeUser = (user) => {
  if (!user) return null;

  const raw = typeof user.toObject === "function" ? user.toObject() : user;
  const { password, ...safeUser } = raw;
  return safeUser;
};

const resolveShopIdForRole = async ({
  role,
  shopId,
  existingUser,
}) => {
  const updateData = {};
  const effectiveRole = role || existingUser.role;

  if (shopId !== undefined) {
    if (shopId === null || shopId === "") {
      updateData.shopId = null;
    } else {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        const error = new Error("Invalid shopId");
        error.statusCode = 400;
        throw error;
      }
      const shop = await Shop.findById(shopId).lean();
      if (!shop) {
        const error = new Error("Shop not found");
        error.statusCode = 404;
        throw error;
      }
      updateData.shopId = shop._id;
    }
  }

  if (effectiveRole === "cashier") {
    const finalShopId = updateData.shopId !== undefined ? updateData.shopId : existingUser.shopId;
    if (!finalShopId) {
      const error = new Error("shopId is required for cashier");
      error.statusCode = 400;
      throw error;
    }
  } else {
    updateData.shopId = null;
  }

  return updateData;
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 })
      .sort({ createdAt: -1 })
      .populate("shopId", "name warehouseId isActive");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id, { password: 0 }).populate(
      "shopId",
      "name warehouseId isActive",
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, role, isActive, password, shopId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    if (role && !["admin", "warehouse", "cashier"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    if (phone) {
      const existing = await User.findOne({ phone, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ message: "Phone already used" });
      }
    }

    const updateData = {
      fullName,
      phone,
      role,
      isActive,
    };

    const existingUser = await User.findById(id).select("role shopId");
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    Object.assign(
      updateData,
      await resolveShopIdForRole({ role, shopId, existingUser }),
    );

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      select: "-password",
    }).populate("shopId", "name warehouseId isActive");

    res.json({
      message: "User updated successfully",
      user,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id, { password: 0 }).populate(
      "shopId",
      "name warehouseId isActive",
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user: serializeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    const id = req.user._id;

    if (phone) {
      const existing = await User.findOne({ phone, _id: { $ne: id } }).lean();
      if (existing) {
        return res.status(409).json({ message: "Phone already used" });
      }
    }

    const updateData = {};
    if (fullName !== undefined) {
      updateData.fullName = fullName;
    }
    if (phone !== undefined) {
      updateData.phone = phone;
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
      select: "-password",
    }).populate("shopId", "name warehouseId isActive");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile updated successfully",
      user: serializeUser(user),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "currentPassword and newPassword are required",
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters long",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (String(req.user._id) === String(user._id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    await User.findByIdAndDelete(id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
