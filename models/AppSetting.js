const mongoose = require("mongoose");

// Butun tizim uchun yagona (singleton) sozlamalar hujjati.
// `key: "global"` bo'yicha bitta hujjat saqlanadi.
const appSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "global",
    },

    // Do'kon va omborni o'chirish uchun maxfiy kod (hash holatida).
    // null bo'lsa — kod o'rnatilmagan, o'chirishda kod talab qilinmaydi.
    deletionCodeHash: {
      type: String,
      default: null,
    },
    deletionCodeUpdatedAt: {
      type: Date,
      default: null,
    },
    deletionCodeUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // To'liq sotuv hisobotini ochish uchun maxfiy kod (hash holatida).
    // Kassa ilovasida tarixni "to'liq" rejimga o'tkazish uchun kassir kiritadi.
    // null bo'lsa — kod o'rnatilmagan (to'liq hisobot ochib bo'lmaydi).
    reportCodeHash: {
      type: String,
      default: null,
    },
    reportCodeUpdatedAt: {
      type: Date,
      default: null,
    },
    reportCodeUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ───── Fiskal (Soliq/OFD — E-POS) kompaniya sozlamalari ─────
    // Bu ma'lumotlar fiskal payloadga qo'shiladi. E-POS token Flutter
    // kassa kompyuterida lokal saqlanadi (backendda saqlanmaydi).
    fiscal: {
      // Fiskal rejimi yoqilganmi (Flutter shu bo'yicha qaror qabul qiladi)
      enabled: { type: Boolean, default: false },
      companyName: { type: String, trim: true, default: "" },
      companyAddress: { type: String, trim: true, default: "" },
      companyINN: { type: String, trim: true, default: "" },
      companyPhoneNumber: { type: String, trim: true, default: "" },
      // Chekdagi kassir nomi (bo'sh bo'lsa — sotuvchi foydalanuvchi nomi)
      staffName: { type: String, trim: true, default: "" },
      // Chek printer kengligi (58 yoki 80 mm)
      printerSize: { type: Number, default: 58 },
      updatedAt: { type: Date, default: null },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AppSetting", appSettingSchema);
