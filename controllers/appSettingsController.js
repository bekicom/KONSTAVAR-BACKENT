const bcrypt = require("bcryptjs");
const { loadGlobalSetting } = require("../utils/deletionCodeGuard");

// Faqat kodning o'rnatilgan-yo'qligini qaytaradi (kodning o'zini emas).
exports.getSecuritySettings = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();
    return res.json({
      deletionCodeSet: Boolean(setting.deletionCodeHash),
      deletionCodeUpdatedAt: setting.deletionCodeUpdatedAt,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// O'chirish kodini o'rnatadi yoki o'zgartiradi.
// Kod allaqachon mavjud bo'lsa — `currentCode` to'g'ri bo'lishi shart.
exports.setDeletionCode = async (req, res) => {
  try {
    const { currentCode, newCode } = req.body || {};
    const next = (newCode || "").toString().trim();

    if (next.length < 4) {
      return res.status(400).json({
        message: "Yangi kod kamida 4 ta belgidan iborat bo'lishi kerak",
      });
    }

    const setting = await loadGlobalSetting();

    if (setting.deletionCodeHash) {
      const current = (currentCode || "").toString().trim();
      if (!current) {
        return res
          .status(400)
          .json({ message: "Joriy o'chirish kodini kiriting" });
      }
      const match = await bcrypt.compare(current, setting.deletionCodeHash);
      if (!match) {
        return res
          .status(400)
          .json({ message: "Joriy o'chirish kodi noto'g'ri" });
      }
    }

    setting.deletionCodeHash = await bcrypt.hash(next, 10);
    setting.deletionCodeUpdatedAt = new Date();
    setting.deletionCodeUpdatedBy = (req.user && req.user._id) || null;
    await setting.save();

    return res.json({
      message: "O'chirish kodi saqlandi",
      deletionCodeSet: true,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ───── To'liq hisobot kodi (report code) ─────

// Kodning o'rnatilgan-yo'qligini qaytaradi (kodning o'zini emas) — admin uchun.
exports.getReportCodeStatus = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();
    return res.json({
      reportCodeSet: Boolean(setting.reportCodeHash),
      reportCodeUpdatedAt: setting.reportCodeUpdatedAt,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Hisobot kodini o'rnatadi yoki o'zgartiradi (faqat admin).
// Kod allaqachon mavjud bo'lsa — `currentCode` to'g'ri bo'lishi shart.
exports.setReportCode = async (req, res) => {
  try {
    const { currentCode, newCode } = req.body || {};
    const next = (newCode || "").toString().trim();

    if (next.length < 4) {
      return res.status(400).json({
        message: "Yangi kod kamida 4 ta belgidan iborat bo'lishi kerak",
      });
    }

    const setting = await loadGlobalSetting();

    if (setting.reportCodeHash) {
      const current = (currentCode || "").toString().trim();
      if (!current) {
        return res.status(400).json({ message: "Joriy hisobot kodini kiriting" });
      }
      const match = await bcrypt.compare(current, setting.reportCodeHash);
      if (!match) {
        return res.status(400).json({ message: "Joriy hisobot kodi noto'g'ri" });
      }
    }

    setting.reportCodeHash = await bcrypt.hash(next, 10);
    setting.reportCodeUpdatedAt = new Date();
    setting.reportCodeUpdatedBy = (req.user && req.user._id) || null;
    await setting.save();

    return res.json({ message: "Hisobot kodi saqlandi", reportCodeSet: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Hisobot kodini olib tashlaydi (joriy kod tasdiqlangandan keyin) — admin.
exports.disableReportCode = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();

    if (!setting.reportCodeHash) {
      return res.json({ message: "Hisobot kodi o'rnatilmagan", reportCodeSet: false });
    }

    const current = ((req.body && req.body.currentCode) || "").toString().trim();
    if (!current) {
      return res.status(400).json({ message: "Joriy hisobot kodini kiriting" });
    }

    const match = await bcrypt.compare(current, setting.reportCodeHash);
    if (!match) {
      return res.status(400).json({ message: "Joriy hisobot kodi noto'g'ri" });
    }

    setting.reportCodeHash = null;
    setting.reportCodeUpdatedAt = new Date();
    setting.reportCodeUpdatedBy = (req.user && req.user._id) || null;
    await setting.save();

    return res.json({ message: "Hisobot kodi o'chirildi", reportCodeSet: false });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Hisobot kodini tekshiradi (kassir ham chaqira oladi) — to'liq hisobotni
// ochishdan oldin. Kod o'rnatilmagan bo'lsa — NOT_SET qaytaradi.
exports.verifyReportCode = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();
    if (!setting.reportCodeHash) {
      return res.status(400).json({
        ok: false,
        reason: "NOT_SET",
        message: "Hisobot kodi o'rnatilmagan. Administrator bilan bog'laning.",
      });
    }

    const code = ((req.body && req.body.code) || "").toString().trim();
    if (!code) {
      return res.status(400).json({ ok: false, message: "Kodni kiriting" });
    }

    const match = await bcrypt.compare(code, setting.reportCodeHash);
    if (!match) {
      return res.status(401).json({ ok: false, message: "Kod noto'g'ri" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Fiskal sozlamalarni JSON ko'rinishida qaytaradi (Flutter uchun qulay).
const serializeFiscalSettings = (setting) => {
  const fiscal = setting.fiscal || {};
  return {
    enabled: Boolean(fiscal.enabled),
    companyName: fiscal.companyName || "",
    companyAddress: fiscal.companyAddress || "",
    companyINN: fiscal.companyINN || "",
    companyPhoneNumber: fiscal.companyPhoneNumber || "",
    staffName: fiscal.staffName || "",
    printerSize: Number(fiscal.printerSize) > 0 ? Number(fiscal.printerSize) : 58,
    updatedAt: fiscal.updatedAt || null,
  };
};

// Fiskal (Soliq/OFD) kompaniya sozlamalarini qaytaradi.
exports.getFiscalSettings = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();
    return res.json(serializeFiscalSettings(setting));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Fiskal kompaniya sozlamalarini yangilaydi (faqat admin).
exports.updateFiscalSettings = async (req, res) => {
  try {
    const body = req.body || {};
    const setting = await loadGlobalSetting();
    if (!setting.fiscal) setting.fiscal = {};

    if (body.enabled !== undefined) {
      setting.fiscal.enabled = Boolean(body.enabled);
    }
    if (body.companyName !== undefined) {
      setting.fiscal.companyName = String(body.companyName || "").trim();
    }
    if (body.companyAddress !== undefined) {
      setting.fiscal.companyAddress = String(body.companyAddress || "").trim();
    }
    if (body.companyINN !== undefined) {
      setting.fiscal.companyINN = String(body.companyINN || "").trim();
    }
    if (body.companyPhoneNumber !== undefined) {
      setting.fiscal.companyPhoneNumber = String(body.companyPhoneNumber || "").trim();
    }
    if (body.staffName !== undefined) {
      setting.fiscal.staffName = String(body.staffName || "").trim();
    }
    if (body.printerSize !== undefined) {
      const size = Number(body.printerSize);
      if (!Number.isFinite(size) || size <= 0) {
        return res.status(400).json({ message: "printerSize must be a positive number" });
      }
      setting.fiscal.printerSize = size;
    }

    setting.fiscal.updatedAt = new Date();
    setting.fiscal.updatedBy = (req.user && req.user._id) || null;
    setting.markModified("fiscal");
    await setting.save();

    return res.json({
      message: "Fiskal sozlamalar saqlandi",
      fiscal: serializeFiscalSettings(setting),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// O'chirish kodini olib tashlaydi (joriy kod tasdiqlangandan keyin).
exports.disableDeletionCode = async (req, res) => {
  try {
    const setting = await loadGlobalSetting();

    if (!setting.deletionCodeHash) {
      return res.json({
        message: "O'chirish kodi o'rnatilmagan",
        deletionCodeSet: false,
      });
    }

    const current = ((req.body && req.body.currentCode) || "")
      .toString()
      .trim();
    if (!current) {
      return res
        .status(400)
        .json({ message: "Joriy o'chirish kodini kiriting" });
    }

    const match = await bcrypt.compare(current, setting.deletionCodeHash);
    if (!match) {
      return res
        .status(400)
        .json({ message: "Joriy o'chirish kodi noto'g'ri" });
    }

    setting.deletionCodeHash = null;
    setting.deletionCodeUpdatedAt = new Date();
    setting.deletionCodeUpdatedBy = (req.user && req.user._id) || null;
    await setting.save();

    return res.json({
      message: "O'chirish kodi o'chirildi",
      deletionCodeSet: false,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
