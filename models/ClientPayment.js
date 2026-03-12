const mongoose = require("mongoose");

const clientPaymentSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["cash", "card", "click", "mixed"],
      default: "cash",
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
    paymentDate: {
      type: Date,
      default: Date.now,
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

clientPaymentSchema.index({ clientId: 1, paymentDate: -1 });
clientPaymentSchema.index({ warehouseId: 1, paymentDate: -1 });

module.exports = mongoose.model("ClientPayment", clientPaymentSchema);
