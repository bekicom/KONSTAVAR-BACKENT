const mongoose = require("mongoose");

// Dashboard menyu kalitlari. Bu ro'yxat Flutter'dagi `DashboardMenuKey`
// enum'i bilan bir xil bo'lishi SHART — aks holda admin tanlagan menyular
// `normalizeAllowedMenuKeys` ichida jimgina tashlab yuboriladi va xodim
// hamma bo'limni ko'rib qolaveradi.
// `pos` faqat kassa (sotuv) ilovasida bor, admin ilovasida menyu emas.
const DASHBOARD_MENU_KEYS = [
  "overview",
  "pos",
  "salesHistory",
  "sales",
  "shops",
  "warehouses",
  "cashiers",
  "suppliers",
  "clients",
  "categories",
  "stocks",
  "productAnalytics",
  "inventories",
  "expenses",
  "salaries",
  "writeoffs",
  "returns",
  "transfers",
  "fiscalProducts",
  "settings",
];

// Har bir rol uchun ruxsat etilgan menyular — Flutter'dagi
// `dashboardMenuItems[].allowedRoles` bilan bir xil.
const DEFAULT_MENUS_BY_ROLE = {
  admin: DASHBOARD_MENU_KEYS,
  warehouse: [
    "overview",
    "sales",
    "shops",
    "warehouses",
    "suppliers",
    "categories",
    "stocks",
    "productAnalytics",
    "inventories",
    "expenses",
    "salaries",
    "writeoffs",
    "returns",
    "transfers",
    "settings",
  ],
  cashier: ["overview", "pos", "clients", "stocks", "expenses", "salaries", "returns"],
  bugalter: ["fiscalProducts"],
};

// Do'kon biriktirilishi mumkin bo'lgan rollar. `warehouse` omborlar bilan
// cheklanadi, shuning uchun unga do'kon biriktirilmaydi.
const SHOP_ASSIGNABLE_ROLES = ["admin", "cashier", "bugalter"];

// Do'kon biriktirilishi majburiy bo'lgan rollar.
const SHOP_REQUIRED_ROLES = ["cashier"];

const normalizeObjectIdList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
};

const extractId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

/**
 * Foydalanuvchi ko'ra oladigan ombor ID'lari.
 *
 *   null   — cheklov yo'q (do'konga biriktirilmagan admin/buxgalter)
 *   [...]  — faqat shu omborlar
 *   []     — hech narsa (biriktirish majburiy, lekin ma'lumot yo'q)
 *
 * `shopWarehouseId` ni `authMiddleware` tayyorlab beradi.
 */
const getScopeWarehouseIds = (user) => {
  const ids = new Set();

  const shopWarehouseId = extractId(user?.shopWarehouseId);
  if (shopWarehouseId) {
    ids.add(shopWarehouseId);
  }

  if (user?.role === "warehouse") {
    for (const id of normalizeObjectIdList(user.warehouseIds || [])) {
      ids.add(id);
    }
  }

  if (ids.size > 0) {
    return [...ids];
  }

  // Omborchida ombor, kassirda do'kon biriktirilishi majburiy. Agar
  // shunday bo'lmasa — ma'lumot buzilgan, hammasini ko'rsatmaymiz.
  if (user?.role === "warehouse" || user?.role === "cashier") {
    return [];
  }

  return null;
};

const isScopedUser = (user) => getScopeWarehouseIds(user) !== null;

// Cache kaliti va javob maydonlari uchun — hech qachon `null` qaytarmaydi.
const getAssignedWarehouseIds = (user) => getScopeWarehouseIds(user) || [];

const ensureWarehouseAccess = (user, warehouseId) => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return;
  }

  if (!scope.includes(extractId(warehouseId))) {
    const error = new Error("Access denied for this warehouse");
    error.statusCode = 403;
    throw error;
  }
};

/**
 * Mongo filtriga ombor cheklovini qo'shadi. `field` — hujjatdagi ombor
 * maydoni nomi (`Warehouse` kolleksiyasi uchun `_id`, `Shop` uchun
 * `warehouseId`).
 */
const applyWarehouseScope = (user, query, field = "warehouseId") => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return query;
  }

  return {
    ...query,
    [field]: { $in: scope },
  };
};

/**
 * Filtrda ombor allaqachon ko'rsatilgan bo'lsa (query parametridan kelgan),
 * unga ruxsat borligini tekshiradi; ko'rsatilmagan bo'lsa — cheklovni
 * qo'yadi. Hisobot endpointlari uchun.
 */
const restrictWarehouseFilter = (user, query, field = "warehouseId") => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return query;
  }

  const requested = query[field];
  const isSingleValue =
    requested !== undefined &&
    requested !== null &&
    !(typeof requested === "object" && !(requested instanceof mongoose.Types.ObjectId));

  if (isSingleValue) {
    ensureWarehouseAccess(user, requested);
    return query;
  }

  return { ...query, [field]: { $in: scope } };
};

/**
 * `$or` bilan bir nechta ombor maydoni bo'yicha cheklash (masalan
 * `ShopTransfer`: manba yoki qabul qiluvchi ombor).
 */
const applyWarehouseScopeAny = (user, query, fields) => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return query;
  }

  const scopeOr = fields.map((field) => ({ [field]: { $in: scope } }));
  if (!query.$and) {
    return { ...query, $and: [{ $or: scopeOr }] };
  }

  return { ...query, $and: [...query.$and, { $or: scopeOr }] };
};

/** Aggregate pipeline uchun `$match` bosqichi (cheklov bo'lmasa — bo'sh). */
const warehouseScopeStages = (user, field = "warehouseId") => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return [];
  }

  return [
    {
      $match: {
        [field]: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) },
      },
    },
  ];
};

const warehouseScopeStagesAny = (user, fields) => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return [];
  }

  const ids = scope.map((id) => new mongoose.Types.ObjectId(id));
  return [{ $match: { $or: fields.map((field) => ({ [field]: { $in: ids } })) } }];
};

/**
 * `Shift` yoki `Expense` kabi do'kon smenasiga bog'langan hujjatlar uchun
 * ruxsat etilgan smena ID'lari. `null` — cheklov yo'q.
 */
const resolveScopeShiftIds = async (user) => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return null;
  }

  const Shift = require("../models/Shift");
  const shifts = await Shift.find({ warehouseId: { $in: scope } })
    .select("_id")
    .lean();
  return shifts.map((shift) => shift._id);
};

/**
 * `Expense` kabi faqat `shiftId` orqali do'konga bog'lanadigan hujjatlar
 * uchun cheklov. Smenasiz (admin/omborchi kiritgan) yozuvlardan faqat
 * foydalanuvchining o'zi kiritganlari ko'rinadi.
 */
const applyShiftScope = async (user, query) => {
  const scopeShiftIds = await resolveScopeShiftIds(user);
  if (scopeShiftIds === null) {
    return query;
  }

  const or = [{ createdBy: user._id }];
  if (scopeShiftIds.length > 0) {
    or.push({ shiftId: { $in: scopeShiftIds } });
  }

  if (!query.$and) {
    return { ...query, $and: [{ $or: or }] };
  }

  return { ...query, $and: [...query.$and, { $or: or }] };
};

/**
 * `User` kolleksiyasi uchun cheklov: do'konga biriktirilgan foydalanuvchi
 * faqat o'z do'koni xodimlarini va o'zini ko'radi; omborchi faqat o'zi bilan
 * ombor kesishadigan xodimlarni ko'radi.
 */
const applyEmployeeScope = (user, query) => {
  const scope = getScopeWarehouseIds(user);
  if (scope === null) {
    return query;
  }

  const or = [{ _id: user._id }, { warehouseIds: { $in: scope } }];

  const shopId = extractId(user?.shopId);
  if (shopId) {
    or.push({ shopId });
  }

  if (!query.$and) {
    return { ...query, $and: [{ $or: or }] };
  }

  return { ...query, $and: [...query.$and, { $or: or }] };
};

const normalizeAllowedMenuKeys = (role, allowedMenuKeys) => {
  const allowedForRole = new Set(DEFAULT_MENUS_BY_ROLE[role] || []);
  const incoming = Array.isArray(allowedMenuKeys)
    ? [...new Set(allowedMenuKeys.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];

  if (incoming.length === 0) {
    return [...allowedForRole];
  }

  const filtered = incoming.filter((key) => allowedForRole.has(key));

  // Yuborilgan kalitlarning hammasi noto'g'ri bo'lsa, bo'sh massiv
  // saqlamaymiz: bo'sh massiv frontendda "hammasiga ruxsat" degani.
  return filtered.length > 0 ? filtered : [...allowedForRole];
};

module.exports = {
  DASHBOARD_MENU_KEYS,
  DEFAULT_MENUS_BY_ROLE,
  SHOP_ASSIGNABLE_ROLES,
  SHOP_REQUIRED_ROLES,
  normalizeObjectIdList,
  getScopeWarehouseIds,
  isScopedUser,
  getAssignedWarehouseIds,
  ensureWarehouseAccess,
  applyWarehouseScope,
  applyWarehouseScopeAny,
  restrictWarehouseFilter,
  warehouseScopeStages,
  warehouseScopeStagesAny,
  resolveScopeShiftIds,
  applyShiftScope,
  applyEmployeeScope,
  normalizeAllowedMenuKeys,
};
