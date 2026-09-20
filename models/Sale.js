const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
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
      default: "unit",
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
    returnedQuantity: {
      type: Number,
      default: 0,
    },
    unitSellPrice: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    priceType: {
      type: String,
      enum: ["retail", "wholesale", "mini", "custom"],
      default: "custom",
    },
  },
  { _id: false },
);

// Soliq/OFD (E-POS) fiscal natijasi. Flutter kassa kompyuteridan
// lokal E-POSga yuborib, javobni shu yerga saqlaydi.
const saleFiscalSchema = new mongoose.Schema(
  {
    // pending — hali yuborilmagan, success — fiskal o'tdi, failed — xatolik
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    method: {
      type: String,
      default: "sale",
    },
    terminalId: { type: String, default: "" },
    receiptSeq: { type: String, default: "" },
    dateTime: { type: String, default: "" },
    fiscalSign: { type: String, default: "" },
    qrCodeUrl: { type: String, default: "" },
    // E-POS qaytaradigan to'liq chek matni (ba'zan bo'ladi)
    paycheck: { type: mongoose.Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: "" },
    // E-POSning to'liq xom javobi (debug/audit uchun)
    rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    submittedAt: { type: Date, default: null },
  },
  { _id: false },
);

const saleSchema = new mongoose.Schema(
  {
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    items: [saleItemSchema],
    subtotal: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    paymentType: {
      type: String,
      enum: ["cash", "card", "click", "mixed", "credit"],
      required: true,
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
    paidAmount: {
      type: Number,
      default: 0,
    },
    dueAmount: {
      type: Number,
      default: 0,
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    // Soliq/OFD fiskal natijasi (E-POS orqali). null — hali fiskal qilinmagan.
    fiscal: {
      type: saleFiscalSchema,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

saleSchema.index({ createdAt: -1, _id: -1 });
saleSchema.index({ warehouseId: 1, createdAt: -1, _id: -1 });
saleSchema.index({ createdBy: 1, createdAt: -1, _id: -1 });
saleSchema.index({ shiftId: 1, createdAt: -1 });

module.exports = mongoose.model("Sale", saleSchema);
