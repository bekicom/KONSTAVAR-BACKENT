const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["admin", "warehouse", "cashier", "bugalter"],
      required: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
    },
    warehouseIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Warehouse",
      },
    ],
    allowedMenuKeys: [
      {
        type: String,
        trim: true,
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
