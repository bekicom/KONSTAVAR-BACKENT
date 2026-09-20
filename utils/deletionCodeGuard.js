const bcrypt = require("bcryptjs");
const AppSetting = require("../models/AppSetting");

// Global sozlamalar hujjatini yuklaydi (bo'lmasa yaratadi).
async function loadGlobalSetting() {
  let setting = await AppSetting.findOne({ key: "global" });
  if (!setting) {
    setting = await AppSetting.create({ key: "global" });
  }
  return setting;
}

// So'rovdagi `deletionCode` ni o'rnatilgan kod bilan tekshiradi.
// Kod o'rnatilmagan bo'lsa — cheklov yo'q ({ ok: true }).
// Aks holda kod kiritilishi va to'g'ri bo'lishi shart.
async function verifyDeletionCodeFromRequest(req) {
  const setting = await AppSetting.findOne({ key: "global" });
  const hash = setting && setting.deletionCodeHash;

  if (!hash) {
    return { ok: true };
  }

  const code = ((req.body && req.body.deletionCode) || "").toString().trim();
  if (!code) {
    return {
      ok: false,
      status: 400,
      message: "O'chirish kodi kiritilishi shart",
      reason: "DELETION_CODE_REQUIRED",
    };
  }

  const match = await bcrypt.compare(code, hash);
  if (!match) {
    return {
      ok: false,
      status: 400,
      message: "O'chirish kodi noto'g'ri",
      reason: "DELETION_CODE_INVALID",
    };
  }

  return { ok: true };
}

module.exports = { loadGlobalSetting, verifyDeletionCodeFromRequest };
