const mongoose = require("mongoose");

const shopQuickProductSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

shopQuickProductSchema.index({ shopId: 1, productId: 1 }, { unique: true });
shopQuickProductSchema.index({ shopId: 1, order: 1 });

module.exports = mongoose.model("ShopQuickProduct", shopQuickProductSchema);
