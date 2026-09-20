const mongoose = require("mongoose");

const DASHBOARD_MENU_KEYS = [
  "overview",
  "pos",
  "salesHistory",
  "sales",
  "shops",
  "warehouses",
  "cashiers",
  "suppliers",
  "categories",
  "stocks",
  "inventories",
  "expenses",
  "salaries",
  "writeoffs",
  "returns",
  "transfers",
  "settings",
];

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
    "inventories",
    "expenses",
    "salaries",
    "writeoffs",
    "returns",
    "transfers",
    "settings",
  ],
  cashier: ["overview", "pos", "stocks", "expenses", "salaries", "returns"],
};

const normalizeObjectIdList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
};

const getAssignedWarehouseIds = (user) => {
  if (user?.role !== "warehouse") {
    return [];
  }

  return normalizeObjectIdList(user.warehouseIds || []);
};

const ensureWarehouseAccess = (user, warehouseId) => {
  if (user?.role !== "warehouse") {
    return;
  }

  const allowedWarehouseIds = getAssignedWarehouseIds(user);
  if (!allowedWarehouseIds.includes(String(warehouseId))) {
    const error = new Error("Access denied for this warehouse");
    error.statusCode = 403;
    throw error;
  }
};

const applyWarehouseScope = (user, query, field = "warehouseId") => {
  if (user?.role !== "warehouse") {
    return query;
  }

  return {
    ...query,
    [field]: { $in: getAssignedWarehouseIds(user) },
  };
};

const normalizeAllowedMenuKeys = (role, allowedMenuKeys) => {
  const allowedForRole = new Set(DEFAULT_MENUS_BY_ROLE[role] || []);
  const incoming = Array.isArray(allowedMenuKeys)
    ? [...new Set(allowedMenuKeys.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];

  if (incoming.length === 0) {
    return [...allowedForRole];
  }

  return incoming.filter((key) => allowedForRole.has(key));
};

module.exports = {
  DASHBOARD_MENU_KEYS,
  DEFAULT_MENUS_BY_ROLE,
  normalizeObjectIdList,
  getAssignedWarehouseIds,
  ensureWarehouseAccess,
  applyWarehouseScope,
  normalizeAllowedMenuKeys,
};
