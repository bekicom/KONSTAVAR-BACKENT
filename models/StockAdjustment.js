const mongoose = require("mongoose");

/**
 * Immutable audit row for every stock movement that does not have a dedicated
 * model (sale / purchase / writeoff / supplier return). The inventarizatsiya
 * "post" step writes one row per item so surplus and deficit have a value,
 * a reason and a back-reference.
 */
const stockAdjustmentSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    // Positive = surplus credit, negative = deficit debit.
    delta: { type: Number, required: true },

    // Snapshot of the system quantity at the moment of the adjustment.
    systemQty: { type: Number, required: true },
    countedQty: { type: Number, required: true },

    // Money impact = delta * unitCost. unitCost is the product cost basis at
    // post time (purchasePrice). Stored so reports can be replayed.
    unitCost: { type: Number, required: true, default: 0 },
    totalCost: { type: Number, required: true, default: 0 },

    reason: { type: String, enum: ["inventory", "manual", "transfer"], required: true },
    sourceModel: { type: String, required: true }, // e.g. "InventorySession"
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    note: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

stockAdjustmentSchema.index({ warehouseId: 1, createdAt: -1 });
stockAdjustmentSchema.index({ productId: 1, createdAt: -1 });
stockAdjustmentSchema.index({ sourceModel: 1, sourceId: 1 });

module.exports = mongoose.model("StockAdjustment", stockAdjustmentSchema);
