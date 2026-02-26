const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    // Qaysi mahsulot
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    // User qanday kiritdi (block yoki unit)
    inputType: {
      type: String,
      enum: ["unit", "block"],
      required: true,
    },

    // User kiritgan miqdor (masalan 2 blok yoki 10 dona)
    inputQuantity: {
      type: Number,
      required: true,
    },

    // Product ichidagi dona soni (productdan olinadi)
    packageQuantity: {
      type: Number,
      default: null,
    },

    // Hisoblangan real miqdor (har doim dona)
    quantity: {
      type: Number,
      required: true,
    },

    // 1 dona kelgan narx
    unitPurchasePrice: {
      type: Number,
      required: true,
    },

    // Umumiy summa (quantity × unitPurchasePrice)
    total: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema(
  {
    // Qaysi omborga kirdi
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    // Ichidagi mahsulotlar
    items: [purchaseItemSchema],

    // Qaysi yetkazib beruvchidan keldi
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },

    // Umumiy summa
    totalAmount: {
      type: Number,
      required: true,
    },

    // To'lov turi: naqd yoki qarz
    paymentType: {
      type: String,
      enum: ["cash", "credit"],
      default: "cash",
    },

    // Kiritish paytida qancha berildi
    paidAmount: {
      type: Number,
      default: 0,
    },

    // Qancha qarz qoldi
    dueAmount: {
      type: Number,
      default: 0,
    },

    // Kim kiritdi (omborchi)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Purchase", purchaseSchema);
