const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // Mahsulot nomi
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Model
    model: {
      type: String,
      trim: true,
    },

    // Kategoriya
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },

    // Barcode (agar user bermasa auto generate)
    barcode: {
      type: String,
      unique: true,
      trim: true,
    },

    // Asosiy birlik (stock har doim shu birlikda yuradi)
    baseUnit: {
      type: String,
      enum: ["dona", "kg", "litr"],
      default: "dona",
    },

    // Blok / pack bor yoki yo‘q
    hasPackage: {
      type: Boolean,
      default: false,
    },

    // 1 blok ichida nechta dona
    packageQuantity: {
      type: Number,
      default: null,
    },

    // Kelgan narx (1 dona uchun saqlanadi)
    purchasePrice: {
      type: Number,
      required: true,
    },

    // Agar blok narx bilan kiritsa
    blockPurchasePrice: {
      type: Number,
      default: null,
    },

    // 1 dona sotish narxi
    sellPrice: {
      type: Number,
      required: true,
    },

    // 1 dona uchun optom narx
    wholesalePrice: {
      type: Number,
      default: null,
    },

    // 1 dona uchun mini narx
    miniSellPrice: {
      type: Number,
      default: null,
    },

    // Omborda qolsa ogohlantirish beriladigan minimal miqdor
    minStockQuantity: {
      type: Number,
      default: null,
    },

    // Qolgan stock shu darajaga tushganda tavsiya etiladigan buyurtma miqdori
    reorderQuantity: {
      type: Number,
      default: null,
    },

    // 1 blok sotish narxi
    blockSellPrice: {
      type: Number,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Barcode auto generate
productSchema.pre("save", async function () {
  if (!this.barcode) {
    this.barcode = Date.now().toString();
  }

  // Block narxdan dona narxni hisoblash
  if (this.hasPackage && this.blockPurchasePrice && this.packageQuantity) {
    this.purchasePrice = this.blockPurchasePrice / this.packageQuantity;
  }
});

module.exports = mongoose.model("Product", productSchema);
