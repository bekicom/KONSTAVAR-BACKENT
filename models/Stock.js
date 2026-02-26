const mongoose = require("mongoose");

const stockSchema = new mongoose.Schema(
  {
    // Qaysi mahsulot
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // Qaysi ombor
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    // Ombordagi miqdor (har doim baseUnit bo‘yicha, ya'ni dona/kg/litr)
    quantity: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true },
);

// 🔥 Bir product bir warehouse’da faqat 1 marta bo‘lishi kerak
stockSchema.index({ productId: 1, warehouseId: 1 }, { unique: true });

module.exports = mongoose.model("Stock", stockSchema);
