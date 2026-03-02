const mongoose = require("mongoose");

const shopTransferItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.000001,
    },
  },
  { _id: false },
);

const shopTransferSchema = new mongoose.Schema(
  {
    sourceWarehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    destinationWarehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    items: {
      type: [shopTransferItemSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "items must contain at least one item",
      },
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

shopTransferSchema.index({ createdAt: -1 });
shopTransferSchema.index({ sourceWarehouseId: 1, createdAt: -1 });
shopTransferSchema.index({ shopId: 1, createdAt: -1 });

module.exports = mongoose.model("ShopTransfer", shopTransferSchema);
