const mongoose = require("mongoose");

const inventoryItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    systemQty: {
      type: Number,
      required: true,
      default: 0,
    },
    countedQty: {
      type: Number,
      default: null,
    },
    difference: {
      type: Number,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    countedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const inventorySessionSchema = new mongoose.Schema(
  {
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "posted", "cancelled"],
      default: "draft",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    items: [inventoryItemSchema],
    summary: {
      totalItems: { type: Number, default: 0 },
      countedItems: { type: Number, default: 0 },
      matchedItems: { type: Number, default: 0 },
      surplusItems: { type: Number, default: 0 },
      shortageItems: { type: Number, default: 0 },
      systemQtyTotal: { type: Number, default: 0 },
      countedQtyTotal: { type: Number, default: 0 },
      netDifference: { type: Number, default: 0 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    postedAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

inventorySessionSchema.index({ warehouseId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("InventorySession", inventorySessionSchema);
