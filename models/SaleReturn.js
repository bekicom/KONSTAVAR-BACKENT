const mongoose = require("mongoose");

const saleReturnItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    returnQuantity: {
      type: Number,
      required: true,
      min: 0.000001,
    },
    unitSellPrice: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const saleReturnSchema = new mongoose.Schema(
  {
    saleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    items: {
      type: [saleReturnItemSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "items required",
      },
    },
    subtotal: {
      type: Number,
      required: true,
    },
    refundType: {
      type: String,
      enum: ["cash", "card", "click", "mixed"],
      required: true,
    },
    cashAmount: {
      type: Number,
      default: 0,
    },
    cardAmount: {
      type: Number,
      default: 0,
    },
    clickAmount: {
      type: Number,
      default: 0,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
  },
  { timestamps: true },
);

saleReturnSchema.index({ saleId: 1, createdAt: -1 });
saleReturnSchema.index({ warehouseId: 1, createdAt: -1 });
saleReturnSchema.index({ createdBy: 1, createdAt: -1 });
saleReturnSchema.index({ shiftId: 1, createdAt: -1 });

module.exports = mongoose.model("SaleReturn", saleReturnSchema);
