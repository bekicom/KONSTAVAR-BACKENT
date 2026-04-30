const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: {
      type: String,
      required: true,
      trim: true,
    },
    createdByRole: {
      type: String,
      enum: ["admin", "warehouse", "cashier"],
      required: true,
    },
  },
  { timestamps: true },
);

expenseSchema.index({ createdAt: -1 });
expenseSchema.index({ shiftId: 1, createdAt: -1 });
expenseSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model("Expense", expenseSchema);
