const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    cashierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
    openedAt: {
      type: Date,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    openingCash: {
      type: Number,
      default: 0,
    },
    closingCash: {
      type: Number,
      default: null,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    closeNote: {
      type: String,
      trim: true,
      default: "",
    },
    summary: {
      salesCount: { type: Number, default: 0 },
      salesTotal: { type: Number, default: 0 },
      returnsCount: { type: Number, default: 0 },
      returnsTotal: { type: Number, default: 0 },
      expensesCount: { type: Number, default: 0 },
      expensesTotal: { type: Number, default: 0 },
      netTotal: { type: Number, default: 0 },
      netAfterExpenses: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

shiftSchema.index({ cashierId: 1, status: 1, openedAt: -1 });
shiftSchema.index({ shopId: 1, status: 1, openedAt: -1 });
shiftSchema.index({ warehouseId: 1, status: 1, openedAt: -1 });

module.exports = mongoose.model("Shift", shiftSchema);
