const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Shop = require("../models/Shop");

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

    const effectiveRole = role || existingUser.role;
    if (shopId !== undefined) {
      if (shopId === null || shopId === "") {
        updateData.shopId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(shopId)) {
          return res.status(400).json({ message: "Invalid shopId" });
        }
        const shop = await Shop.findById(shopId).lean();
        if (!shop) {
          return res.status(404).json({ message: "Shop not found" });
        }
        updateData.shopId = shop._id;
      }
    }

    if (effectiveRole === "cashier") {
      const finalShopId = updateData.shopId !== undefined ? updateData.shopId : existingUser.shopId;
      if (!finalShopId) {
        return res.status(400).json({ message: "shopId is required for cashier" });
      }
    } else {
      updateData.shopId = null;
    }

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
