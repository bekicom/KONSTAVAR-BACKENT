const mongoose = require("mongoose");

const supplierReturnItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    inputType: {
      type: String,
      enum: ["unit", "block"],
      required: true,
    },
    inputQuantity: {
      type: Number,
      required: true,
    },
    packageQuantity: {
      type: Number,
      default: null,
    },
    quantity: {
      type: Number,
      required: true,
    },
    unitReturnPrice: {
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

const supplierReturnSchema = new mongoose.Schema(
  {
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    items: [supplierReturnItemSchema],
    totalAmount: {
      type: Number,
      required: true,
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

module.exports = mongoose.model("SupplierReturn", supplierReturnSchema);
