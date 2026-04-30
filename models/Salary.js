const mongoose = require("mongoose");

const salarySchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    salaryDate: {
      type: Date,
      default: Date.now,
    },
    paidForMonth: {
      type: String,
      trim: true,
      default: "",
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

salarySchema.index({ employeeId: 1, salaryDate: -1 });
salarySchema.index({ createdBy: 1, salaryDate: -1 });
salarySchema.index({ paidForMonth: 1, salaryDate: -1 });

module.exports = mongoose.model("Salary", salarySchema);
