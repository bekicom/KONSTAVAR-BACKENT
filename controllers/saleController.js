const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Product = require("../models/Product");
const FiscalProduct = require("../models/FiscalProduct");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Shop = require("../models/Shop");
const ShopQuickProduct = require("../models/ShopQuickProduct");
const Category = require("../models/Category");
const Client = require("../models/Client");
const User = require("../models/User");
const Shift = require("../models/Shift");
const { requireOpenCashierShift, getOpenCashierShift, resolveCashierShop } = require("../utils/shiftHelper");
const { loadGlobalSetting } = require("../utils/deletionCodeGuard");
const { parsePagination, isPaginatedRequest } = require("../utils/pagination");

const SHOP_WAREHOUSE_CACHE_TTL_MS = 15000;
const shopWarehouseCache = new Map();
const BARCODE_LOOKUP_CACHE_TTL_MS = 10000;
const OFFLINE_CATALOG_CACHE_TTL_MS = 10000;
const SALE_SEARCH_CACHE_TTL_MS = 10000;
const TOP_PRODUCTS_AVAILABLE_CACHE_TTL_MS = 10000;
const TOP_PRODUCTS_CACHE_TTL_MS = 15000;
const barcodeLookupCache = new Map();
const offlineCatalogCache = new Map();
const saleSearchCache = new Map();
const topProductsAvailableCache = new Map();
const topProductsStatsCache = new Map();
const FISCAL_CODE_REGEX = /^\d{17}$/;

const round2 = (value) => Number(Number(value).toFixed(2));
const getSaleInitialPaidAmount = (sale) =>
  round2(Number(sale?.cashAmount || 0) + Number(sale?.cardAmount || 0) + Number(sale?.clickAmount || 0));

const toDate = (value, endOfDay = false) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    if (endOfDay) {
      date.setUTCHours(23, 59, 59, 999);
    } else {
      date.setUTCHours(0, 0, 0, 0);
    }
  }

  return date;
};

const validateAndResolvePayment = (paymentType, cashAmount, cardAmount, clickAmount, totalAmount) => {
  const normalizedType = paymentType || "cash";

  if (!["cash", "card", "click", "mixed"].includes(normalizedType)) {
    throw new Error("Invalid paymentType. Use 'cash', 'card', 'click' or 'mixed'");
  }

  let normalizedCash = Number(cashAmount);
  let normalizedCard = Number(cardAmount);
  let normalizedClick = Number(clickAmount);

  if (!Number.isFinite(normalizedCash)) normalizedCash = 0;
  if (!Number.isFinite(normalizedCard)) normalizedCard = 0;
  if (!Number.isFinite(normalizedClick)) normalizedClick = 0;

  if (normalizedCash < 0 || normalizedCard < 0 || normalizedClick < 0) {
    throw new Error("cashAmount/cardAmount/clickAmount cannot be negative");
  }

  if (normalizedType === "cash") {
    return {
      paymentType: "cash",
      cashAmount: round2(totalAmount),
      cardAmount: 0,
      clickAmount: 0,
    };
  }

  if (normalizedType === "card") {
    return {
      paymentType: "card",
      cashAmount: 0,
      cardAmount: round2(totalAmount),
      clickAmount: 0,
    };
  }

  if (normalizedType === "click") {
    return {
      paymentType: "click",
      cashAmount: 0,
      cardAmount: 0,
      clickAmount: round2(totalAmount),
    };
  }

  normalizedCash = round2(normalizedCash);
  normalizedCard = round2(normalizedCard);
  normalizedClick = round2(normalizedClick);

  if (normalizedCash <= 0) {
    throw new Error("For mixed payment, cashAmount must be positive");
  }

  if (normalizedCard <= 0 && normalizedClick <= 0) {
    throw new Error("For mixed payment, cardAmount or clickAmount must be positive");
  }

  if (round2(normalizedCash + normalizedCard + normalizedClick) !== round2(totalAmount)) {
    throw new Error("For mixed payment, cashAmount + cardAmount + clickAmount must equal totalAmount");
  }

  return {
    paymentType: "mixed",
    cashAmount: normalizedCash,
    cardAmount: normalizedCard,
    clickAmount: normalizedClick,
  };
};

const ensureWarehouseIsActiveShopWarehouse = async (warehouseId, session = null) => {
  let shopQuery = Shop.findOne({ warehouseId, isActive: true });
  if (session) shopQuery = shopQuery.session(session);
  const shop = await shopQuery;

  if (!shop) {
    throw new Error("Sale is allowed only from active shop warehouse");
  }

  let warehouseQuery = Warehouse.findById(warehouseId);
  if (session) warehouseQuery = warehouseQuery.session(session);
  const warehouse = await warehouseQuery;
  if (!warehouse) {
    throw new Error("Warehouse not found");
  }

  return { shop, warehouse };
};

const resolveWarehouseForSale = async (user, requestedWarehouseId, session = null) => {
  // Cashier always sells from assigned shop warehouse.
  // Any incoming warehouseId from cashier request is ignored on purpose.
  if (user?.role === "cashier") {
    if (!user.shopId) {
      throw new Error("Cashier has no assigned shop");
    }

    const shopId = user.shopId?._id || user.shopId;
    if (!mongoose.Types.ObjectId.isValid(shopId)) {
      throw new Error("Invalid user shopId");
    }

    let shopQuery = Shop.findOne({ _id: shopId, isActive: true });
    if (session) shopQuery = shopQuery.session(session);
    const shop = await shopQuery;

    if (!shop) {
      throw new Error("Assigned shop not found or inactive");
    }

    const { warehouse } = await ensureWarehouseIsActiveShopWarehouse(shop.warehouseId, session);
    return warehouse._id;
  }

  if (requestedWarehouseId !== undefined && requestedWarehouseId !== null && requestedWarehouseId !== "") {
    if (!mongoose.Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new Error("Invalid warehouse ID");
    }
    const { warehouse } = await ensureWarehouseIsActiveShopWarehouse(requestedWarehouseId, session);
    return warehouse._id;
  }

  if (user?.shopId) {
    const shopId = user.shopId?._id || user.shopId;
    if (!mongoose.Types.ObjectId.isValid(shopId)) {
      throw new Error("Invalid user shopId");
    }

    let shopQuery = Shop.findOne({ _id: shopId, isActive: true });
    if (session) shopQuery = shopQuery.session(session);
    const shop = await shopQuery;

    if (!shop) {
      throw new Error("Assigned shop not found or inactive");
    }

    const { warehouse } = await ensureWarehouseIsActiveShopWarehouse(shop.warehouseId, session);
    return warehouse._id;
  }

  let activeShopsQuery = Shop.find({ isActive: true }).select("warehouseId");
  if (session) activeShopsQuery = activeShopsQuery.session(session);
  const activeShops = await activeShopsQuery.lean();

  if (activeShops.length === 1) {
    const { warehouse } = await ensureWarehouseIsActiveShopWarehouse(activeShops[0].warehouseId, session);
    return warehouse._id;
  }

  throw new Error("Assign shopId to this user or send warehouseId");
};

const resolveShopForSale = async (user, session = null) => {
  const warehouseId = await resolveWarehouseForSale(user, null, session);

  let shopQuery = Shop.findOne({ warehouseId, isActive: true });
  if (session) shopQuery = shopQuery.session(session);
  const shop = await shopQuery;
  if (!shop) {
    throw new Error("Active shop not found for warehouse");
  }

  return { shop, warehouseId };
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const resolveUnitSellPriceByType = (product, priceType, fallbackPrice) => {
  const normalizedType = (priceType || "").trim().toLowerCase();

  if (normalizedType === "mini" && Number(product.miniSellPrice) > 0) {
    return { unitSellPrice: Number(product.miniSellPrice), priceType: "mini" };
  }

  if (normalizedType === "wholesale" && Number(product.wholesalePrice) > 0) {
    return { unitSellPrice: Number(product.wholesalePrice), priceType: "wholesale" };
  }

  if (normalizedType === "retail" && Number(product.sellPrice) > 0) {
    return { unitSellPrice: Number(product.sellPrice), priceType: "retail" };
  }

  if (normalizedType === "custom" || normalizedType === "") {
    return { unitSellPrice: Number(fallbackPrice), priceType: normalizedType || "custom" };
  }

  throw new Error("Invalid priceType. Use 'retail', 'wholesale', 'mini' or 'custom'");
};

const composeFiscalItemsFromCatalog = (totalAmountSom, fiscalProducts) => {
  const totalTiyin = toTiyin(totalAmountSom);
  if (totalTiyin <= 0) {
    throw new Error("Sale totalAmount must be greater than 0");
  }

  const normalized = fiscalProducts
    .map((product) => {
      const classCode = String(product.fiscalClassCode || "").trim();
      const packageCode = String(product.fiscalPackageCode || "").trim();
      const vatPercent = Number(product.fiscalVatPercent || 0);
      const catalogPriceTiyin = toTiyin(product.sellPrice || 0);

      return {
        product,
        classCode,
        packageCode,
        vatPercent,
        catalogPriceTiyin,
      };
    })
    .filter(({ classCode, catalogPriceTiyin }) => {
      return FISCAL_CODE_REGEX.test(classCode) && catalogPriceTiyin > 0;
    })
    .sort((a, b) => b.catalogPriceTiyin - a.catalogPriceTiyin);

  if (normalized.length === 0) {
    const err = new Error("Active fiscal products yo'q");
    err.statusCode = 400;
    throw err;
  }

  let remainingTiyin = totalTiyin;
  const items = [];

  for (const entry of normalized) {
    if (remainingTiyin <= 0) break;

    const quantityWhole = Math.floor(remainingTiyin / entry.catalogPriceTiyin);
    if (quantityWhole <= 0) continue;

    items.push({
      price: entry.catalogPriceTiyin,
      discount: 0,
      barcode: entry.product.barcode || "",
      amount: quantityWhole * 1000,
      vatPercent: entry.vatPercent,
      vat: entry.vatPercent > 0
        ? Math.round((entry.catalogPriceTiyin * quantityWhole * entry.vatPercent) / (100 + entry.vatPercent))
        : 0,
      name: entry.product.name || "",
      classCode: entry.classCode,
      packageCode: entry.packageCode,
      other: 0,
      ownerType: 0,
    });

    remainingTiyin -= quantityWhole * entry.catalogPriceTiyin;
  }

  if (remainingTiyin > 0) {
    const fallback = normalized[0];
    items.push({
      price: remainingTiyin,
      discount: 0,
      barcode: fallback.product.barcode || "",
      amount: 1000,
      vatPercent: fallback.vatPercent,
      vat: fallback.vatPercent > 0
        ? Math.round((remainingTiyin * fallback.vatPercent) / (100 + fallback.vatPercent))
        : 0,
      name: fallback.product.name || "",
      classCode: fallback.classCode,
      packageCode: fallback.packageCode,
      other: 0,
      ownerType: 0,
    });
  }

  return items;
};

const buildReportRange = ({ date, from, to }) => {
  if (date) {
    const start = toDate(date, false);
    const end = toDate(date, true);
    if (!start || !end) {
      throw new Error("Invalid date. Use YYYY-MM-DD");
    }
    return { from: start, to: end };
  }

  const start = from ? toDate(from, false) : null;
  const end = to ? toDate(to, true) : null;

  if ((from && !start) || (to && !end)) {
    throw new Error("Invalid from/to date. Use YYYY-MM-DD or ISO date");
  }

  return {
    from: start || new Date("1970-01-01T00:00:00.000Z"),
    to: end || new Date(),
  };
};

const formatDateTime = (date) => {
  if (!date) return "";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

const formatDateOnly = (date) => {
  if (!date) return "";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

const formatUzDate = (date) => {
  if (!date) return "";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}`;
};

const sanitizeFilePart = (value) =>
  String(value || "KONSTAVAR")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);

const getCachedValue = (cache, key) => {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }
  if (hit) {
    cache.delete(key);
  }
  return null;
};

const setCachedValue = (cache, key, value, ttlMs) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
};

const moneyFormat = '#,##0';
const quantityFormat = '#,##0.###';

const applyThinBorder = (cell) => {
  cell.border = {
    top: { style: "thin", color: { argb: "FFD9E2F3" } },
    left: { style: "thin", color: { argb: "FFD9E2F3" } },
    bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
    right: { style: "thin", color: { argb: "FFD9E2F3" } },
  };
};

const styleHeaderRow = (row) => {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF244062" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    applyThinBorder(cell);
  });
};

const styleDataRow = (row) => {
  row.eachCell((cell) => {
    cell.alignment = { vertical: "middle", wrapText: true };
    applyThinBorder(cell);
  });
};

const styleSheet = (worksheet) => {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.eachRow((row) => {
    row.height = row.number === 1 ? 18 : 15.75;
  });
};

const buildSalesReportQuery = async ({ date, from, to, warehouseId, cashierId, shopId }) => {
  const range = buildReportRange({ date, from, to });
  const query = {
    createdAt: { $gte: range.from, $lte: range.to },
  };

  if (warehouseId) {
    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      throw new Error("Invalid warehouseId query");
    }
    query.warehouseId = new mongoose.Types.ObjectId(warehouseId);
  }

  if (cashierId) {
    if (!mongoose.Types.ObjectId.isValid(cashierId)) {
      throw new Error("Invalid cashierId query");
    }
    query.createdBy = new mongoose.Types.ObjectId(cashierId);
  }

  if (shopId) {
    if (!mongoose.Types.ObjectId.isValid(shopId)) {
      throw new Error("Invalid shopId query");
    }
    const shop = await Shop.findById(shopId).select("warehouseId").lean();
    if (!shop) {
      const err = new Error("Shop not found");
      err.statusCode = 404;
      throw err;
    }
    query.warehouseId = new mongoose.Types.ObjectId(shop.warehouseId);
  }

  return { query, range };
};

exports.createSale = async (req, res) => {
  const { withTransaction } = require("../utils/withTransaction");
  try {
    const {
      warehouseId: requestedWarehouseId,
      items,
      discount = 0,
      paymentType,
      cashAmount,
      cardAmount,
      clickAmount,
      paidAmount,
      clientId,
      client,
      shiftId: requestedShiftId,
      note,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    const normalizedDiscount = Number(discount);
    if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
      return res.status(400).json({ message: "discount must be a non-negative number" });
    }

    const saleDoc = await withTransaction(async (session) => {
      let saleDoc;
      {
      const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId, session);
      await ensureWarehouseIsActiveShopWarehouse(warehouseId, session);
      const normalizedPaymentType = paymentType || "cash";
      let activeShift = null;
      if (req.user?.role === "cashier") {
        if (requestedShiftId) {
          if (!mongoose.Types.ObjectId.isValid(requestedShiftId)) {
            throw new Error("Invalid shiftId");
          }
          const cashierShop = await resolveCashierShop(req.user, session);
          activeShift = await Shift.findById(requestedShiftId).session(session);
          if (!activeShift) {
            throw new Error("Shift not found");
          }
          if (String(activeShift.cashierId) !== String(req.user._id)) {
            throw new Error("Shift does not belong to this cashier");
          }
          if (String(activeShift.shopId) !== String(cashierShop._id)) {
            throw new Error("Shift does not belong to cashier shop");
          }
          if (String(activeShift.warehouseId) !== String(warehouseId)) {
            throw new Error("Shift warehouse does not match sale warehouse");
          }
        } else {
          activeShift = await requireOpenCashierShift(req.user, session);
        }
      }

      let resolvedClient = null;
      if (clientId) {
        if (!mongoose.Types.ObjectId.isValid(clientId)) {
          throw new Error("Invalid clientId");
        }
        resolvedClient = await Client.findById(clientId).session(session);
      }
      if (!resolvedClient && client?.name) {
        if (client.phone) {
          resolvedClient = await Client.findOne({ phone: client.phone }).session(session);
        }
        if (!resolvedClient) {
          const createdClients = await Client.create(
            [
              {
                name: client.name,
                phone: client.phone,
                address: client.address,
                note: client.note,
              },
            ],
            { session },
          );
          [resolvedClient] = createdClients;
        }
      }

      let subtotal = 0;
      const processedItems = [];
      const requiredByProduct = new Map();

      for (const item of items) {
        const { productId } = item;
      const inputType = item.inputType || "unit";
      const inputQuantity = Number(item.inputQuantity);
      let priceType = item.priceType || "custom";

        if (!mongoose.Types.ObjectId.isValid(productId)) {
          throw new Error("Invalid productId");
        }
        if (!["unit", "block"].includes(inputType)) {
          throw new Error("Invalid inputType. Use 'unit' or 'block'");
        }
        if (!Number.isFinite(inputQuantity) || inputQuantity <= 0) {
          throw new Error("inputQuantity must be a positive number");
        }

        const product = await Product.findById(productId).session(session);
        if (!product) {
          throw new Error("Product not found");
        }

        let quantity = 0;
        if (inputType === "block") {
          if (!product.hasPackage || !product.packageQuantity) {
            throw new Error("This product does not support block sale");
          }
          quantity = inputQuantity * product.packageQuantity;
        } else {
          quantity = inputQuantity;
        }

        let unitSellPrice = Number(item.unitSellPrice);
        if (!Number.isFinite(unitSellPrice) || unitSellPrice <= 0) {
          const resolvedByType = resolveUnitSellPriceByType(product, priceType, product.sellPrice);
          unitSellPrice = resolvedByType.unitSellPrice;
          if (resolvedByType.priceType) {
            priceType = resolvedByType.priceType;
          }

          if (
            inputType === "block" &&
            Number(product.blockSellPrice) > 0 &&
            product.packageQuantity > 0 &&
            (priceType === "custom" || priceType === "retail")
          ) {
            unitSellPrice = Number(product.blockSellPrice) / product.packageQuantity;
          }
        }

        if (!Number.isFinite(unitSellPrice) || unitSellPrice <= 0) {
          throw new Error("unitSellPrice must be a positive number or valid priceType must be provided");
        }

        unitSellPrice = round2(unitSellPrice);
        const lineTotal = round2(unitSellPrice * quantity);
        subtotal = round2(subtotal + lineTotal);

        processedItems.push({
          productId: product._id,
          inputType,
          inputQuantity,
          priceType,
          packageQuantity: product.packageQuantity || null,
          quantity,
          unitSellPrice,
          total: lineTotal,
        });

        const key = String(product._id);
        requiredByProduct.set(key, (requiredByProduct.get(key) || 0) + quantity);
      }

      if (normalizedDiscount > subtotal) {
        throw new Error("discount cannot be greater than subtotal");
      }

      const totalAmount = round2(subtotal - normalizedDiscount);
      if (totalAmount <= 0) {
        const err = new Error("totalAmount must be greater than 0");
        err.statusCode = 400;
        throw err;
      }

      const decrementedProductIds = [];
      try {
        for (const [productId, requiredQty] of requiredByProduct.entries()) {
          const updated = await Stock.findOneAndUpdate(
            { productId, warehouseId, quantity: { $gte: requiredQty } },
            { $inc: { quantity: -requiredQty } },
            { new: true, session },
          );
          if (!updated) {
            const current = await Stock.findOne({ productId, warehouseId }).session(session).lean();
            const err = new Error(
              current
                ? `Insufficient stock for one of products (available ${current.quantity}, requested ${requiredQty})`
                : "Stock not found for one of products in this warehouse",
            );
            err.statusCode = 409;
            throw err;
          }
          decrementedProductIds.push({ productId, requiredQty });
        }
      } catch (stockErr) {
        for (const { productId, requiredQty } of decrementedProductIds) {
          await Stock.findOneAndUpdate(
            { productId, warehouseId },
            { $inc: { quantity: requiredQty } },
            { session },
          ).catch(() => {});
        }
        throw stockErr;
      }

      let payment;
      let normalizedPaidAmount = totalAmount;
      let dueAmount = 0;

      if (normalizedPaymentType === "credit") {
        if (!resolvedClient) {
          throw new Error("For credit sale, clientId or client{name,...} is required");
        }

        const hasSplitInput =
          cashAmount !== undefined || cardAmount !== undefined || clickAmount !== undefined;

        let normalizedCash = Number(cashAmount);
        let normalizedCard = Number(cardAmount);
        let normalizedClick = Number(clickAmount);
        if (!Number.isFinite(normalizedCash)) normalizedCash = 0;
        if (!Number.isFinite(normalizedCard)) normalizedCard = 0;
        if (!Number.isFinite(normalizedClick)) normalizedClick = 0;
        if (normalizedCash < 0 || normalizedCard < 0 || normalizedClick < 0) {
          throw new Error("cashAmount/cardAmount/clickAmount cannot be negative");
        }

        normalizedPaidAmount = Number(paidAmount);
        if (!Number.isFinite(normalizedPaidAmount)) {
          normalizedPaidAmount = hasSplitInput
            ? round2(normalizedCash + normalizedCard + normalizedClick)
            : 0;
        }
        normalizedPaidAmount = round2(normalizedPaidAmount);

        if (normalizedPaidAmount < 0) {
          throw new Error("paidAmount cannot be negative");
        }
        if (normalizedPaidAmount > totalAmount) {
          throw new Error("paidAmount cannot be greater than totalAmount");
        }

        if (hasSplitInput) {
          if (round2(normalizedCash + normalizedCard + normalizedClick) !== normalizedPaidAmount) {
            throw new Error("For credit sale, cashAmount + cardAmount + clickAmount must equal paidAmount");
          }
        } else {
          normalizedCash = normalizedPaidAmount;
          normalizedCard = 0;
          normalizedClick = 0;
        }

        dueAmount = round2(totalAmount - normalizedPaidAmount);
        if (dueAmount <= 0) {
          throw new Error("For credit sale, dueAmount must be greater than 0");
        }

        payment = {
          paymentType: "credit",
          cashAmount: round2(normalizedCash),
          cardAmount: round2(normalizedCard),
          clickAmount: round2(normalizedClick),
        };
      } else {
        payment = validateAndResolvePayment(
          normalizedPaymentType,
          cashAmount,
          cardAmount,
          clickAmount,
          totalAmount,
        );
        normalizedPaidAmount = totalAmount;
        dueAmount = 0;
      }

      const createdSales = await Sale.create(
        [
          {
            warehouseId,
            items: processedItems,
            subtotal,
            discount: round2(normalizedDiscount),
            totalAmount,
            paymentType: payment.paymentType,
            cashAmount: payment.cashAmount,
            cardAmount: payment.cardAmount,
            clickAmount: payment.clickAmount,
            paidAmount: normalizedPaidAmount,
            dueAmount,
            shiftId: activeShift ? activeShift._id : null,
            clientId: resolvedClient ? resolvedClient._id : null,
            note,
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [saleDoc] = createdSales;
      }
      return saleDoc;
    });

    res.status(201).json({
      message: "Sale created successfully",
      sale: saleDoc,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("cannot") ||
      error.message.includes("greater than") ||
      error.message.includes("Insufficient") ||
      error.message.includes("not found") ||
      error.message.includes("must")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

/**
 * Offline katalog javobini yig'adi. `page`, `skip` yoki `paginated=true`
 * yuborilsa sahifalangan ko'rinish, aks holda eski to'liq ro'yxat qaytadi.
 */
const buildOfflineCatalogResponse = (catalog, shop, shopWarehouse, query = {}) => {
  const base = {
    shop: { _id: shop._id, name: shop.name },
    warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
    total: catalog.items.length,
    quickProductIds: catalog.quickProductIds,
  };

  if (!isPaginatedRequest(query)) {
    return { ...base, items: catalog.items };
  }

  const { page, limit, skip } = parsePagination(query);
  const items = catalog.items.slice(skip, skip + limit);
  return {
    ...base,
    page,
    limit,
    pages: limit > 0 ? Math.ceil(catalog.items.length / limit) : 0,
    hasMore: skip + items.length < catalog.items.length,
    items,
  };
};

exports.getOfflineSaleCatalog = async (req, res) => {
  try {
    let shop = null;
    let shopWarehouse = null;

    if (req.user?.role === "cashier") {
      const shopId = req.user.shopId?._id || req.user.shopId;
      if (!shopId || !mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: "Cashier has no assigned shop" });
      }

      const cached = shopWarehouseCache.get(String(shopId));
      if (cached && cached.expiresAt > Date.now()) {
        shop = cached.shop;
        shopWarehouse = cached.shopWarehouse;
      } else {
        shop = await Shop.findOne({ _id: shopId, isActive: true })
          .select("_id name warehouseId")
          .lean();

        if (!shop) {
          return res.status(400).json({ message: "Assigned shop not found or inactive" });
        }

        shopWarehouse = await Warehouse.findById(shop.warehouseId)
          .select("_id name")
          .lean();

        if (!shopWarehouse) {
          return res.status(400).json({ message: "Warehouse not found" });
        }

        shopWarehouseCache.set(String(shopId), {
          shop,
          shopWarehouse,
          expiresAt: Date.now() + SHOP_WAREHOUSE_CACHE_TTL_MS,
        });
      }
    } else {
      const resolved = await resolveShopForSale(req.user);
      shop = resolved.shop;
      const ensured = await ensureWarehouseIsActiveShopWarehouse(resolved.warehouseId);
      shopWarehouse = ensured.warehouse;
    }

    const offlineCacheKey = `${String(shop._id)}:${String(shopWarehouse._id)}`;
    const cachedCatalog = getCachedValue(offlineCatalogCache, offlineCacheKey);
    if (cachedCatalog) {
      return res.json(buildOfflineCatalogResponse(cachedCatalog, shop, shopWarehouse, req.query));
    }

    const [stocks, quickRows] = await Promise.all([
      Stock.find({ warehouseId: shopWarehouse._id })
        .select("productId quantity updatedAt")
        .populate({
          path: "productId",
          select:
            "name model barcode baseUnit sellPrice miniSellPrice wholesalePrice blockSellPrice hasPackage packageQuantity isActive",
          match: { isActive: true },
        })
        .sort({ updatedAt: -1 })
        .lean(),
      ShopQuickProduct.find({ shopId: shop._id, isActive: true })
        .sort({ order: 1, createdAt: 1 })
        .select("productId order")
        .lean(),
    ]);

    const quickOrderMap = new Map(
      quickRows
        .filter((row) => row.productId)
        .map((row) => [String(row.productId), Number(row.order || 0)]),
    );

    const items = stocks
      .filter((stock) => stock.productId)
      .map((stock) => {
        const productId = String(stock.productId._id);
        return {
          product: stock.productId,
          stockQuantity: Number(stock.quantity || 0),
          canSell: Number(stock.quantity || 0) > 0,
          isQuick: quickOrderMap.has(productId),
          quickOrder: quickOrderMap.has(productId) ? quickOrderMap.get(productId) : null,
        };
      })
      .sort((a, b) => {
        const quickDiff = Number(b.isQuick) - Number(a.isQuick);
        if (quickDiff !== 0) return quickDiff;
        if (a.isQuick && b.isQuick) {
          return Number(a.quickOrder || 0) - Number(b.quickOrder || 0);
        }
        return String(a.product?.name || "").localeCompare(String(b.product?.name || ""));
      });

    const catalog = {
      items,
      quickProductIds: quickRows
        .filter((row) => row.productId)
        .map((row) => String(row.productId)),
    };

    setCachedValue(offlineCatalogCache, offlineCacheKey, catalog, OFFLINE_CATALOG_CACHE_TTL_MS);

    return res.json(buildOfflineCatalogResponse(catalog, shop, shopWarehouse, req.query));
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("not found") ||
      error.message.includes("allowed")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getSales = async (req, res) => {
  try {
    const { warehouseId, cashierId, paymentType, from, to, limit, shiftId } = req.query;
    const query = {};

    if (req.user?.role === "cashier") {
      let targetShift;
      if (shiftId) {
        if (!mongoose.Types.ObjectId.isValid(shiftId)) {
          return res.status(400).json({ message: "Invalid shiftId query" });
        }
        targetShift = await Shift.findById(shiftId).select("cashierId warehouseId").lean();
        if (!targetShift) {
          return res.status(404).json({ message: "Shift not found" });
        }
        if (String(targetShift.cashierId) !== String(req.user._id)) {
          return res.status(403).json({ message: "You can access only your own shift sales" });
        }
      } else {
        targetShift = await getOpenCashierShift(req.user);
        if (!targetShift) {
          return res.status(400).json({ message: "Open shift required" });
        }
      }
      query.warehouseId = targetShift.warehouseId;
      query.shiftId = targetShift._id;
    } else if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }

      await ensureWarehouseIsActiveShopWarehouse(warehouseId);
      query.warehouseId = new mongoose.Types.ObjectId(warehouseId);
    } else if (req.user?.shopId) {
      const resolvedWarehouseId = await resolveWarehouseForSale(req.user, null);
      query.warehouseId = resolvedWarehouseId;
    } else {
      const activeShops = await Shop.find({ isActive: true }).select("warehouseId").lean();
      const shopWarehouseIds = activeShops.map((s) => s.warehouseId);
      if (shopWarehouseIds.length === 0) {
        return res.json([]);
      }
      query.warehouseId = { $in: shopWarehouseIds };
    }

    if (req.user?.role === "cashier") {
      query.createdBy = req.user._id;
    } else if (cashierId) {
      if (!mongoose.Types.ObjectId.isValid(cashierId)) {
        return res.status(400).json({ message: "Invalid cashierId query" });
      }
      query.createdBy = cashierId;
    }

    if (paymentType) {
      if (!["cash", "card", "click", "mixed", "credit"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid paymentType query" });
      }
      query.paymentType = paymentType;
    }

    // Fiskal holati bo'yicha filtr (POS sotuv tarixida faqat soliqqa
    // yuborilganlarni — fiscalStatus=success — ko'rsatish uchun).
    if (req.query.fiscalStatus) {
      const fiscalStatus = String(req.query.fiscalStatus);
      if (!["success", "failed", "pending"].includes(fiscalStatus)) {
        return res.status(400).json({ message: "Invalid fiscalStatus query" });
      }
      query["fiscal.status"] = fiscalStatus;
    }

    if (shiftId && req.user?.role !== "cashier") {
      if (!mongoose.Types.ObjectId.isValid(shiftId)) {
        return res.status(400).json({ message: "Invalid shiftId query" });
      }
      query.shiftId = shiftId;
    }

    const fromDate = toDate(from, false);
    const toDateValue = toDate(to, true);

    if (from && !fromDate) {
      return res.status(400).json({ message: "Invalid from date. Use YYYY-MM-DD or ISO date" });
    }
    if (to && !toDateValue) {
      return res.status(400).json({ message: "Invalid to date. Use YYYY-MM-DD or ISO date" });
    }
    if (fromDate && toDateValue && fromDate > toDateValue) {
      return res.status(400).json({ message: "'from' cannot be greater than 'to'" });
    }

    if (fromDate || toDateValue) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDateValue) query.createdAt.$lte = toDateValue;
    }

    if (req.query.page === undefined && req.query.skip === undefined && req.query.paginated !== "true") {
      const sales = await Sale.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .populate("warehouseId", "name")
        .populate("clientId", "name phone")
        .populate("createdBy", "fullName role")
        .populate("shiftId", "status openedAt closedAt")
        .populate("items.productId", "name model barcode");

      return res.json(sales);
    }

    const { paginateQuery } = require("../utils/pagination");
    const result = await paginateQuery({
      Model: Sale,
      filter: query,
      queryParams: req.query,
      defaultSort: { createdAt: -1, _id: -1 },
      populate: (q) =>
        q
          .populate("warehouseId", "name")
          .populate("clientId", "name phone")
          .populate("createdBy", "fullName role")
          .populate("shiftId", "status openedAt closedAt")
          .populate("items.productId", "name model barcode"),
    });

    res.json({
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
      hasMore: result.hasMore,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSalesHistory = async (req, res) => {
  try {
    const {
      date,
      from,
      to,
      warehouseId,
      cashierId,
      shopId,
      limit = 50,
      topLimit = 10,
    } = req.query;

    const range = buildReportRange({ date, from, to });
    const query = {
      createdAt: { $gte: range.from, $lte: range.to },
    };

    if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = new mongoose.Types.ObjectId(warehouseId);
    }

    if (cashierId) {
      if (!mongoose.Types.ObjectId.isValid(cashierId)) {
        return res.status(400).json({ message: "Invalid cashierId query" });
      }
      query.createdBy = new mongoose.Types.ObjectId(cashierId);
    }

    if (shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: "Invalid shopId query" });
      }
      const shop = await Shop.findById(shopId).select("warehouseId").lean();
      if (!shop) {
        return res.status(404).json({ message: "Shop not found" });
      }
      query.warehouseId = new mongoose.Types.ObjectId(shop.warehouseId);
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 50;
    }
    normalizedLimit = Math.min(normalizedLimit, 500);

    let normalizedTopLimit = Number(topLimit);
    if (!Number.isInteger(normalizedTopLimit) || normalizedTopLimit <= 0) {
      normalizedTopLimit = 10;
    }
    normalizedTopLimit = Math.min(normalizedTopLimit, 50);

    const [summaryRows, cashierRows, paymentRows, topProductRows, recentSales, allSalesForCashiers] = await Promise.all([
      Sale.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalSalesCount: { $sum: 1 },
            totalSalesAmount: { $sum: "$totalAmount" },
            cashTotal: { $sum: "$cashAmount" },
            cardTotal: { $sum: "$cardAmount" },
            clickTotal: { $sum: "$clickAmount" },
            creditTotal: { $sum: { $cond: [{ $eq: ["$paymentType", "credit"] }, "$dueAmount", 0] } },
            paidAmountTotal: { $sum: "$paidAmount" },
            fiscalTotal: {
              $sum: { $cond: [{ $eq: ["$fiscal.status", "success"] }, "$totalAmount", 0] },
            },
            fiscalCashTotal: {
              $sum: { $cond: [{ $eq: ["$fiscal.status", "success"] }, "$cashAmount", 0] },
            },
            fiscalCardTotal: {
              $sum: { $cond: [{ $eq: ["$fiscal.status", "success"] }, "$cardAmount", 0] },
            },
            fiscalClickTotal: {
              $sum: { $cond: [{ $eq: ["$fiscal.status", "success"] }, "$clickAmount", 0] },
            },
            fiscalCreditTotal: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$fiscal.status", "success"] },
                      { $eq: ["$paymentType", "credit"] },
                    ],
                  },
                  "$dueAmount",
                  0,
                ],
              },
            },
          },
        },
      ]),
      Sale.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$createdBy",
            totalSalesCount: { $sum: 1 },
            totalSalesAmount: { $sum: "$totalAmount" },
            cashTotal: { $sum: "$cashAmount" },
            cardTotal: { $sum: "$cardAmount" },
            clickTotal: { $sum: "$clickAmount" },
            paidAmountTotal: { $sum: "$paidAmount" },
            averageCheck: { $avg: "$totalAmount" },
            lastSaleAt: { $max: "$createdAt" },
          },
        },
        { $sort: { totalSalesAmount: -1, totalSalesCount: -1 } },
      ]),
      Sale.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$paymentType",
            count: { $sum: 1 },
            totalAmount: { $sum: "$totalAmount" },
            cashTotal: { $sum: "$cashAmount" },
            cardTotal: { $sum: "$cardAmount" },
            clickTotal: { $sum: "$clickAmount" },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),
      Sale.aggregate([
        { $match: query },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            soldQuantity: { $sum: "$items.quantity" },
            soldAmount: { $sum: "$items.total" },
            salesCount: { $sum: 1 },
          },
        },
        { $sort: { soldQuantity: -1, soldAmount: -1 } },
        { $limit: normalizedTopLimit },
      ]),
      Sale.find(query)
        .sort({ createdAt: -1 })
        .limit(normalizedLimit)
        .populate("createdBy", "fullName role")
        .populate("warehouseId", "name")
        .populate("shiftId", "status openedAt closedAt")
        .populate("clientId", "name phone")
        .populate("items.productId", "name model barcode miniSellPrice sellPrice wholesalePrice"),
      Sale.find(query)
        .sort({ createdAt: -1 })
        .select(
          "_id warehouseId subtotal discount totalAmount paymentType cashAmount cardAmount clickAmount paidAmount dueAmount note createdBy createdAt"
        )
        .populate({
          path: "createdBy",
          select: "fullName phone role shopId",
          populate: {
            path: "shopId",
            select: "name warehouseId isActive",
            populate: {
              path: "warehouseId",
              select: "name isActive",
            },
          },
        })
        .populate("warehouseId", "name"),
    ]);

    const scopeRows = await Sale.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          warehouseIds: { $addToSet: "$warehouseId" },
          cashierIds: { $addToSet: "$createdBy" },
        },
      },
    ]);

    const summary = summaryRows[0] || {
      totalSalesCount: 0,
      totalSalesAmount: 0,
      cashTotal: 0,
      cardTotal: 0,
      clickTotal: 0,
      creditTotal: 0,
      paidAmountTotal: 0,
      fiscalTotal: 0,
      fiscalCashTotal: 0,
      fiscalCardTotal: 0,
      fiscalClickTotal: 0,
      fiscalCreditTotal: 0,
    };

    const cashierIds = cashierRows.map((row) => row._id).filter(Boolean);
    const cashiers = cashierIds.length
      ? await User.find({ _id: { $in: cashierIds } })
          .select("fullName phone role isActive shopId")
          .populate({
            path: "shopId",
            select: "name warehouseId isActive",
            populate: {
              path: "warehouseId",
              select: "name isActive",
            },
          })
          .lean()
      : [];
    const cashierMap = new Map(cashiers.map((user) => [String(user._id), user]));

    const productIds = topProductRows.map((row) => row._id).filter(Boolean);
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } })
          .select("name model barcode miniSellPrice sellPrice wholesalePrice")
          .lean()
      : [];
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const scope = scopeRows[0] || { warehouseIds: [], cashierIds: [] };
    const distinctWarehouseIds = (scope.warehouseIds || []).filter(Boolean).map((id) => String(id));
    const distinctCashierIds = (scope.cashierIds || []).filter(Boolean).map((id) => String(id));
    const distinctShops = distinctWarehouseIds.length
      ? await Shop.find({ warehouseId: { $in: distinctWarehouseIds } })
          .select("_id name warehouseId isActive")
          .populate("warehouseId", "name")
          .lean()
      : [];
    const distinctWarehouses = distinctWarehouseIds.length
      ? await Warehouse.find({ _id: { $in: distinctWarehouseIds } }).select("_id name isActive").lean()
      : [];
    const distinctCashiers = distinctCashierIds.length
      ? await User.find({ _id: { $in: distinctCashierIds } })
          .select("_id fullName phone role isActive shopId")
          .populate("shopId", "name warehouseId isActive")
          .lean()
      : [];

    const cashierBreakdown = cashierRows.map((row) => {
      const cashier = cashierMap.get(String(row._id));
      const cashierShop = cashier?.shopId || null;
      const totalSalesAmount = round2(row.totalSalesAmount);
      const totalSalesCount = Number(row.totalSalesCount || 0);
      return {
        cashierId: row._id,
        cashierName: cashier?.fullName || null,
        cashierPhone: cashier?.phone || null,
        shopId: cashierShop?._id || null,
        shopName: cashierShop?.name || null,
        warehouseId: cashierShop?.warehouseId || null,
        totalSalesCount,
        totalSalesAmount,
        cashTotal: round2(row.cashTotal),
        cardTotal: round2(row.cardTotal),
        clickTotal: round2(row.clickTotal),
        paidAmountTotal: round2(row.paidAmountTotal),
        averageCheck: round2(row.averageCheck),
        lastSaleAt: row.lastSaleAt,
      };
    });

    const salesByCashierMap = new Map();
    for (const sale of allSalesForCashiers) {
      const cashierId = sale?.createdBy?._id ? String(sale.createdBy._id) : String(sale.createdBy || "");
      if (!cashierId) continue;

      const bucket = salesByCashierMap.get(cashierId) || [];
      bucket.push({
        saleId: sale._id,
        warehouseId: sale?.warehouseId?._id || sale.warehouseId || null,
        warehouseName: sale?.warehouseId?.name || null,
        subtotal: round2(sale.subtotal || 0),
        discount: round2(sale.discount || 0),
        totalAmount: round2(sale.totalAmount || 0),
        paymentType: sale.paymentType || null,
        cashAmount: round2(sale.cashAmount || 0),
        cardAmount: round2(sale.cardAmount || 0),
        clickAmount: round2(sale.clickAmount || 0),
        paidAmount: round2(sale.paidAmount || 0),
        dueAmount: round2(sale.dueAmount || 0),
        note: sale.note || "",
        createdAt: sale.createdAt,
      });
      salesByCashierMap.set(cashierId, bucket);
    }

    const salesByCashier = cashierBreakdown.map((cashier) => ({
      cashierId: cashier.cashierId,
      cashierName: cashier.cashierName,
      cashierPhone: cashier.cashierPhone,
      shopId: cashier.shopId,
      shopName: cashier.shopName,
      warehouseId: cashier.warehouseId,
      totalSalesCount: cashier.totalSalesCount,
      totalSalesAmount: cashier.totalSalesAmount,
      cashTotal: cashier.cashTotal,
      cardTotal: cashier.cardTotal,
      clickTotal: cashier.clickTotal,
      paidAmountTotal: cashier.paidAmountTotal,
      averageCheck: cashier.averageCheck,
      lastSaleAt: cashier.lastSaleAt,
      sales: salesByCashierMap.get(String(cashier.cashierId)) || [],
    }));

    const paymentBreakdown = paymentRows.map((row) => ({
      paymentType: row._id,
      count: Number(row.count || 0),
      totalAmount: round2(row.totalAmount),
      cashTotal: round2(row.cashTotal),
      cardTotal: round2(row.cardTotal),
      clickTotal: round2(row.clickTotal),
    }));

    const topProducts = topProductRows.map((row) => {
      const product = productMap.get(String(row._id));
      return {
        productId: row._id,
        productName: product?.name || null,
        productModel: product?.model || null,
        barcode: product?.barcode || null,
        miniSellPrice: product?.miniSellPrice ?? null,
        sellPrice: product?.sellPrice ?? null,
        wholesalePrice: product?.wholesalePrice ?? null,
        soldQuantity: round2(row.soldQuantity),
        soldAmount: round2(row.soldAmount),
        salesCount: Number(row.salesCount || 0),
      };
    });

    const totalSalesCount = Number(summary.totalSalesCount || 0);
    const totalSalesAmount = round2(summary.totalSalesAmount);

    return res.json({
      filters: {
        date: date || null,
        from: from || null,
        to: to || null,
        warehouseId: warehouseId || null,
        cashierId: cashierId || null,
        shopId: shopId || null,
      },
      summary: {
        totalSalesCount,
        totalSalesAmount,
        cashTotal: round2(summary.cashTotal),
        cardTotal: round2(summary.cardTotal),
        clickTotal: round2(summary.clickTotal),
        creditTotal: round2(summary.creditTotal),
        paidAmountTotal: round2(summary.paidAmountTotal),
        fiscalTotal: round2(summary.fiscalTotal),
        fiscalCashTotal: round2(summary.fiscalCashTotal),
        fiscalCardTotal: round2(summary.fiscalCardTotal),
        fiscalClickTotal: round2(summary.fiscalClickTotal),
        fiscalCreditTotal: round2(summary.fiscalCreditTotal),
        averageCheck: totalSalesCount > 0 ? round2(totalSalesAmount / totalSalesCount) : 0,
      },
      scope: {
        shops: distinctShops,
        warehouses: distinctWarehouses,
        cashiers: distinctCashiers,
      },
      cashierBreakdown,
      salesByCashier,
      paymentBreakdown,
      topProducts,
      recentSales,
    });
  } catch (error) {
    if (error.message.includes("Invalid") || error.message.includes("cannot")) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.exportSalesHistoryExcel = async (req, res) => {
  try {
    const { date, from, to, warehouseId, cashierId, shopId } = req.query;
    const { query, range } = await buildSalesReportQuery({
      date,
      from,
      to,
      warehouseId,
      cashierId,
      shopId,
    });

    const sales = await Sale.find(query)
      .select(
        "warehouseId createdBy clientId items.productId items.quantity items.unitSellPrice " +
          "items.total totalAmount cashAmount cardAmount clickAmount dueAmount paymentType note createdAt",
      )
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const productIds = new Set();
    const categoryIds = new Set();
    const warehouseIds = new Set();
    const cashierIds = new Set();
    const clientIds = new Set();
    for (const sale of sales) {
      if (sale.warehouseId) warehouseIds.add(String(sale.warehouseId));
      if (sale.createdBy) cashierIds.add(String(sale.createdBy));
      if (sale.clientId) clientIds.add(String(sale.clientId));
      for (const item of sale.items || []) {
        if (item.productId) productIds.add(String(item.productId));
      }
    }

    const [products, warehouses, cashiers, clients, stockRows, shopRows] = await Promise.all([
      productIds.size
        ? Product.find({ _id: { $in: [...productIds] } })
            .select("name categoryId")
            .lean()
        : [],
      warehouseIds.size
        ? Warehouse.find({ _id: { $in: [...warehouseIds] } })
            .select("name")
            .lean()
        : [],
      cashierIds.size
        ? User.find({ _id: { $in: [...cashierIds] } })
            .select("fullName")
            .lean()
        : [],
      clientIds.size
        ? Client.find({ _id: { $in: [...clientIds] } })
            .select("name")
            .lean()
        : [],
      productIds.size
        ? Stock.find({
            productId: { $in: [...productIds] },
            warehouseId: { $in: [...warehouseIds] },
          })
            .select("productId warehouseId quantity")
            .lean()
        : [],
      warehouseIds.size
        ? Shop.find({ warehouseId: { $in: [...warehouseIds] } })
            .select("name warehouseId")
            .lean()
        : [],
    ]);

    for (const product of products) {
      if (product?.categoryId) categoryIds.add(String(product.categoryId));
    }

    const categories = categoryIds.size
      ? await Category.find({ _id: { $in: [...categoryIds] } })
          .select("name")
          .lean()
      : [];

    const categoryMap = new Map(categories.map((category) => [String(category._id), category.name]));
    const warehouseMap = new Map(warehouses.map((warehouse) => [String(warehouse._id), warehouse]));
    const cashierMap = new Map(cashiers.map((cashier) => [String(cashier._id), cashier]));
    const clientMap = new Map(clients.map((client) => [String(client._id), client]));
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    const shopByWarehouseMap = new Map(
      shopRows.map((shop) => [String(shop.warehouseId), shop.name]),
    );
    const stockMap = new Map();
    for (const stock of stockRows) {
      const key = `${stock.productId}:${stock.warehouseId}`;
      stockMap.set(key, Number(stock.quantity || 0));
    }

    const summary = {
      totalSalesCount: sales.length,
      totalSalesAmount: 0,
      cashTotal: 0,
      cardTotal: 0,
      clickTotal: 0,
      creditTotal: 0,
    };

    const productSummaryMap = new Map();
    const cashierSummaryMap = new Map();
    const orderRows = [];
    const saleNumberMap = new Map();

    sales.forEach((sale, index) => {
      const saleId = String(sale._id);
      const saleNumber = sales.length - index;
      saleNumberMap.set(saleId, saleNumber);

      summary.totalSalesAmount = round2(summary.totalSalesAmount + Number(sale.totalAmount || 0));
      summary.cashTotal = round2(summary.cashTotal + Number(sale.cashAmount || 0));
      summary.cardTotal = round2(summary.cardTotal + Number(sale.cardAmount || 0));
      summary.clickTotal = round2(summary.clickTotal + Number(sale.clickAmount || 0));
      summary.creditTotal = round2(summary.creditTotal + Number(sale.dueAmount || 0));

      const cashierIdValue = sale.createdBy ? String(sale.createdBy) : "unknown";
      const cashierName = cashierMap.get(cashierIdValue)?.fullName || "Noma'lum";
      const cashierBucket =
        cashierSummaryMap.get(cashierIdValue) || {
          cashierName,
          salesCount: 0,
          totalSalesAmount: 0,
          cashTotal: 0,
          cardTotal: 0,
          clickTotal: 0,
          creditTotal: 0,
        };
      cashierBucket.salesCount += 1;
      cashierBucket.totalSalesAmount = round2(cashierBucket.totalSalesAmount + Number(sale.totalAmount || 0));
      cashierBucket.cashTotal = round2(cashierBucket.cashTotal + Number(sale.cashAmount || 0));
      cashierBucket.cardTotal = round2(cashierBucket.cardTotal + Number(sale.cardAmount || 0));
      cashierBucket.clickTotal = round2(cashierBucket.clickTotal + Number(sale.clickAmount || 0));
      cashierBucket.creditTotal = round2(cashierBucket.creditTotal + Number(sale.dueAmount || 0));
      cashierSummaryMap.set(cashierIdValue, cashierBucket);

      for (const item of sale.items || []) {
        const productDoc = item.productId ? productMap.get(String(item.productId)) : null;
        const productId = item.productId
          ? String(item.productId)
          : `unknown:${productDoc?.name || ""}`;
        const categoryName = productDoc?.categoryId
          ? categoryMap.get(String(productDoc.categoryId)) || ""
          : "";
        const quantity = Number(item.quantity || 0);
        const total = Number(item.total || 0);
        const warehouseKey = String(sale.warehouseId || "");

        const productBucket =
          productSummaryMap.get(productId) || {
            productName: productDoc?.name || "Noma'lum mahsulot",
            categoryName,
            soldQuantity: 0,
            soldAmount: 0,
            salesIds: new Set(),
            currentStock: stockMap.get(`${productId}:${warehouseKey}`),
          };

        productBucket.soldQuantity = round2(productBucket.soldQuantity + quantity);
        productBucket.soldAmount = round2(productBucket.soldAmount + total);
        productBucket.salesIds.add(saleId);
        if (!productBucket.categoryName && categoryName) {
          productBucket.categoryName = categoryName;
        }
        if (productBucket.currentStock === undefined) {
          productBucket.currentStock = stockMap.get(`${productId}:${warehouseKey}`);
        }
        productSummaryMap.set(productId, productBucket);

        orderRows.push({
          date: sale.createdAt,
          saleNumber,
          productName: productDoc?.name || "Noma'lum mahsulot",
          categoryName,
          quantity,
          unitPrice: round2(item.unitSellPrice || 0),
          total: round2(total),
          paymentType: sale.paymentType || "",
          note: sale.note || clientMap.get(String(sale.clientId || ""))?.name || "",
          cashierName,
          saleId,
        });
      }
    });

    const productRows = [...productSummaryMap.values()]
      .map((item, index) => ({
        index: index + 1,
        productName: item.productName,
        categoryName: item.categoryName,
        unitPrice: item.soldQuantity > 0 ? round2(item.soldAmount / item.soldQuantity) : 0,
        soldQuantity: item.soldQuantity,
        soldAmount: item.soldAmount,
        salesCount: item.salesIds.size,
        currentStock: item.currentStock,
      }))
      .sort((a, b) => b.soldAmount - a.soldAmount || b.soldQuantity - a.soldQuantity)
      .map((item, index) => ({ ...item, index: index + 1 }));

    const cashierRows = [...cashierSummaryMap.values()]
      .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount || b.salesCount - a.salesCount)
      .map((item, index) => ({ ...item, index: index + 1 }));

    const firstWarehouse = sales[0]?.warehouseId ? warehouseMap.get(String(sales[0].warehouseId)) : null;
    const warehouseName =
      (warehouseId && firstWarehouse?.name) ||
      (warehouseIds.size === 1
        ? firstWarehouse?.name || [...warehouseIds][0]
        : warehouseIds.size > 1
          ? "Barcha filiallar"
          : "KONSTAVAR");
    const shopName =
      warehouseIds.size === 1
        ? shopByWarehouseMap.get([...warehouseIds][0]) || warehouseName
        : warehouseName;
    const periodLabel = `${formatUzDate(range.from)} - ${formatUzDate(range.to)}`;
    const exportTime = formatDateTime(new Date());

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KONSTAVAR";
    workbook.created = new Date();
    workbook.modified = new Date();

    const titleFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    const lightFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2F8" } };

    const reportSheet = workbook.addWorksheet("Hisobot");
    reportSheet.mergeCells("B1:I2");
    reportSheet.getCell("B1").value = "KONSTAVAR buxgalteriya hisoboti";
    reportSheet.getCell("B1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    reportSheet.getCell("B1").fill = titleFill;
    reportSheet.getCell("B1").alignment = { vertical: "middle", horizontal: "center" };

    const summaryLines = [
      ["Filial", shopName],
      ["Sana", periodLabel],
      ["Кун бошига махсулот сони", ""],
      ["Buyurtmalar soni", summary.totalSalesCount],
      ["Sotilgan mahsulot turlari", productRows.length],
      ["Колган махсулот сони", productRows.reduce((sum, row) => sum + Number(row.currentStock || 0), 0)],
      ["Jami tushum", summary.totalSalesAmount],
      ["Naqd", summary.cashTotal],
      ["Karta", summary.cardTotal],
      ["Click", summary.clickTotal],
      ["Qarz", summary.creditTotal],
      ["Eksport vaqti", exportTime],
    ];

    summaryLines.forEach(([label, value], index) => {
      const rowNumber = index + 3;
      reportSheet.getCell(`B${rowNumber}`).value = label;
      reportSheet.getCell(`C${rowNumber}`).value = value;
      reportSheet.getCell(`B${rowNumber}`).font = { bold: true };
      reportSheet.getCell(`B${rowNumber}`).fill = lightFill;
      reportSheet.getCell(`C${rowNumber}`).fill = lightFill;
      reportSheet.getCell(`C${rowNumber}`).numFmt = typeof value === "number" ? moneyFormat : undefined;
      applyThinBorder(reportSheet.getCell(`B${rowNumber}`));
      applyThinBorder(reportSheet.getCell(`C${rowNumber}`));
    });

    const reportHeaderRow = 17;
    reportSheet.getCell(`A${reportHeaderRow}`).value = "№";
    reportSheet.getCell(`B${reportHeaderRow}`).value = "Mahsulot nomi";
    reportSheet.getCell(`C${reportHeaderRow}`).value = "Кун бошига колдик";
    reportSheet.getCell(`D${reportHeaderRow}`).value = "Kategoriya";
    reportSheet.getCell(`E${reportHeaderRow}`).value = "Narxi";
    reportSheet.getCell(`F${reportHeaderRow}`).value = "Sotilgan soni";
    reportSheet.getCell(`G${reportHeaderRow}`).value = "Jami summa";
    reportSheet.getCell(`H${reportHeaderRow}`).value = "Buyurtma soni";
    reportSheet.getCell(`I${reportHeaderRow}`).value = "Кун якунига колдик";
    styleHeaderRow(reportSheet.getRow(reportHeaderRow));
    reportSheet.getCell("A16").value = "Mahsulotlar bo'yicha sotuv";
    reportSheet.getCell("A16").font = { bold: true, size: 13 };

    productRows.forEach((row, index) => {
      const rowNumber = reportHeaderRow + 1 + index;
      reportSheet.getRow(rowNumber).values = [
        row.index,
        row.productName,
        "",
        row.categoryName,
        row.unitPrice,
        row.soldQuantity,
        row.soldAmount,
        row.salesCount,
        row.currentStock ?? "",
      ];
      reportSheet.getCell(`E${rowNumber}`).numFmt = moneyFormat;
      reportSheet.getCell(`F${rowNumber}`).numFmt = quantityFormat;
      reportSheet.getCell(`G${rowNumber}`).numFmt = moneyFormat;
      reportSheet.getCell(`I${rowNumber}`).numFmt = quantityFormat;
      styleDataRow(reportSheet.getRow(rowNumber));
    });

    reportSheet.columns = [
      { width: 7 },
      { width: 32 },
      { width: 20 },
      { width: 20 },
      { width: 12 },
      { width: 15 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
    ];

    const summarySheet = workbook.addWorksheet("Xulosa");
    [
      ["KONSTAVAR buxgalteriya hisoboti", ""],
      ["Filial", shopName],
      ["Sana", periodLabel],
      ["Buyurtmalar soni", summary.totalSalesCount],
      ["Sotilgan mahsulot turlari", productRows.length],
      ["Jami tushum", summary.totalSalesAmount],
      ["Naqd", summary.cashTotal],
      ["Karta", summary.cardTotal],
      ["Click", summary.clickTotal],
      ["Qarz", summary.creditTotal],
      ["Eksport vaqti", exportTime],
    ].forEach((values, index) => {
      const row = summarySheet.addRow(values);
      if (index === 0) row.font = { bold: true, size: 14 };
      if (typeof values[1] === "number") summarySheet.getCell(`B${index + 1}`).numFmt = moneyFormat;
      styleDataRow(row);
    });
    summarySheet.columns = [{ width: 34 }, { width: 28 }];

    const productsSheet = workbook.addWorksheet("Mahsulotlar");
    productsSheet.addRow(["№", "Mahsulot nomi", "Kategoriya", "Narxi", "Sotilgan soni", "Jami summa", "Buyurtma soni"]);
    styleHeaderRow(productsSheet.getRow(1));
    productRows.forEach((row) => {
      const sheetRow = productsSheet.addRow([
        row.index,
        row.productName,
        row.categoryName,
        row.unitPrice,
        row.soldQuantity,
        row.soldAmount,
        row.salesCount,
      ]);
      sheetRow.getCell(4).numFmt = moneyFormat;
      sheetRow.getCell(5).numFmt = quantityFormat;
      sheetRow.getCell(6).numFmt = moneyFormat;
      styleDataRow(sheetRow);
    });
    productsSheet.columns = [
      { width: 7 },
      { width: 34 },
      { width: 22 },
      { width: 15 },
      { width: 15 },
      { width: 17 },
      { width: 15 },
    ];

    const ordersSheet = workbook.addWorksheet("Buyurtmalar");
    ordersSheet.addRow([
      "№",
      "Sana",
      "Sotuv raqami",
      "Mahsulot",
      "Kategoriya",
      "Soni",
      "Narxi",
      "Jami",
      "To'lov turi",
      "Izoh",
      "Kassir",
      "Sotuv ID",
    ]);
    styleHeaderRow(ordersSheet.getRow(1));
    orderRows.forEach((row, index) => {
      const sheetRow = ordersSheet.addRow([
        index + 1,
        formatDateTime(row.date),
        row.saleNumber,
        row.productName,
        row.categoryName,
        row.quantity,
        row.unitPrice,
        row.total,
        row.paymentType,
        row.note,
        row.cashierName,
        row.saleId,
      ]);
      sheetRow.getCell(6).numFmt = quantityFormat;
      sheetRow.getCell(7).numFmt = moneyFormat;
      sheetRow.getCell(8).numFmt = moneyFormat;
      styleDataRow(sheetRow);
    });
    ordersSheet.columns = [
      { width: 7 },
      { width: 19 },
      { width: 14 },
      { width: 34 },
      { width: 22 },
      { width: 11 },
      { width: 15 },
      { width: 17 },
      { width: 13 },
      { width: 18 },
      { width: 22 },
      { width: 28 },
    ];

    const cashiersSheet = workbook.addWorksheet("Kassirlar");
    cashiersSheet.addRow(["№", "Kassir", "Buyurtmalar", "Savdo", "Naqd", "Karta", "Click", "Qarz"]);
    styleHeaderRow(cashiersSheet.getRow(1));
    cashierRows.forEach((row) => {
      const sheetRow = cashiersSheet.addRow([
        row.index,
        row.cashierName,
        row.salesCount,
        row.totalSalesAmount,
        row.cashTotal,
        row.cardTotal,
        row.clickTotal,
        row.creditTotal,
      ]);
      [4, 5, 6, 7, 8].forEach((column) => {
        sheetRow.getCell(column).numFmt = moneyFormat;
      });
      styleDataRow(sheetRow);
    });
    cashiersSheet.columns = [
      { width: 7 },
      { width: 26 },
      { width: 15 },
      { width: 17 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
    ];

    [reportSheet, summarySheet, productsSheet, ordersSheet, cashiersSheet].forEach(styleSheet);

    const fileFrom = formatDateOnly(range.from);
    const fileTo = formatDateOnly(range.to);
    const fileName = `${sanitizeFilePart(shopName)}_${fileFrom}_${fileTo}_hisobot.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.message.includes("Invalid") || error.message.includes("cannot")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    const sale = await Sale.findById(id)
      .populate("warehouseId", "name")
      .populate("clientId", "name phone address")
      .populate("createdBy", "fullName role")
      .populate("shiftId", "status openedAt closedAt")
      .populate("items.productId", "name model barcode baseUnit");

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const shop = await Shop.findOne({
      warehouseId: sale.warehouseId?._id || sale.warehouseId,
      isActive: true,
    })
      .select("_id")
      .lean();
    if (!shop) {
      return res.status(404).json({ message: "Sale not found" });
    }

    res.json(sale);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSaleProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { warehouseId: requestedWarehouseId } = req.query;

    const normalizedBarcode = String(barcode || "").trim();
    if (!normalizedBarcode) {
      return res.status(400).json({ message: "barcode is required" });
    }

    let warehouseId;
    let shopWarehouse;
    let barcodeCacheKey;

    if (req.user?.role === "cashier") {
      const shopId = req.user.shopId?._id || req.user.shopId;
      if (!shopId || !mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: "Cashier has no assigned shop" });
      }

      barcodeCacheKey = `cashier:${String(shopId)}:${normalizedBarcode}`;
      const cachedLookup = getCachedValue(barcodeLookupCache, barcodeCacheKey);
      if (cachedLookup) {
        return res.status(cachedLookup.statusCode).json(cachedLookup.body);
      }

      const cachedShopWarehouse = shopWarehouseCache.get(String(shopId));
      if (cachedShopWarehouse && cachedShopWarehouse.expiresAt > Date.now()) {
        warehouseId = String(cachedShopWarehouse.shopWarehouse._id);
        shopWarehouse = cachedShopWarehouse.shopWarehouse;
      } else {
        const shop = await Shop.findOne({ _id: shopId, isActive: true })
          .select("_id warehouseId")
          .lean();
        if (!shop) {
          return res.status(400).json({ message: "Assigned shop not found or inactive" });
        }

        shopWarehouse = await Warehouse.findById(shop.warehouseId)
          .select("_id name")
          .lean();
        if (!shopWarehouse) {
          return res.status(400).json({ message: "Warehouse not found" });
        }

        shopWarehouseCache.set(String(shopId), {
          shop,
          shopWarehouse,
          expiresAt: Date.now() + SHOP_WAREHOUSE_CACHE_TTL_MS,
        });
        warehouseId = String(shopWarehouse._id);
      }
    } else {
      warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId);
      const ensuredWarehouse = await ensureWarehouseIsActiveShopWarehouse(warehouseId);
      shopWarehouse = ensuredWarehouse.warehouse;
      barcodeCacheKey = `${String(shopWarehouse._id)}:${normalizedBarcode}`;
      const cachedLookup = getCachedValue(barcodeLookupCache, barcodeCacheKey);
      if (cachedLookup) {
        return res.status(cachedLookup.statusCode).json(cachedLookup.body);
      }
    }


    const product = await Product.findOne({ barcode: normalizedBarcode, isActive: true })
      .select(
        "name model barcode baseUnit categoryId hasPackage packageQuantity sellPrice miniSellPrice wholesalePrice blockSellPrice",
      )
      .lean();

    if (!product) {
      const notFoundResponse = { message: "Product not found by barcode" };
      setCachedValue(
        barcodeLookupCache,
        barcodeCacheKey,
        { statusCode: 404, body: notFoundResponse },
        BARCODE_LOOKUP_CACHE_TTL_MS,
      );
      return res.status(404).json(notFoundResponse);
    }

    const [stock, category] = await Promise.all([
      Stock.findOne({
        productId: product._id,
        warehouseId,
      })
        .select("quantity sellPrice wholesalePrice miniSellPrice")
        .lean(),
      product.categoryId
        ? Category.findById(product.categoryId).select("name").lean()
        : Promise.resolve(null),
    ]);

    if (!stock) {
      const stockNotFoundResponse = { message: "Product not found in shop warehouse" };
      setCachedValue(
        barcodeLookupCache,
        barcodeCacheKey,
        { statusCode: 404, body: stockNotFoundResponse },
        BARCODE_LOOKUP_CACHE_TTL_MS,
      );
      return res.status(404).json(stockNotFoundResponse);
    }

    const response = {
      product: {
        ...product,
        categoryId: category ? { _id: category._id, name: category.name } : null,
        sellPrice:
          stock.sellPrice !== undefined && stock.sellPrice !== null
            ? Number(stock.sellPrice)
            : Number(product.sellPrice || 0),
        wholesalePrice:
          stock.wholesalePrice !== undefined && stock.wholesalePrice !== null
            ? Number(stock.wholesalePrice)
            : Number(product.wholesalePrice || 0),
        miniSellPrice:
          stock.miniSellPrice !== undefined && stock.miniSellPrice !== null
            ? Number(stock.miniSellPrice)
            : Number(product.miniSellPrice || 0),
      },
      warehouse: {
        _id: shopWarehouse._id,
        name: shopWarehouse.name,
      },
      stockQuantity: Number(stock.quantity || 0),
      canSell: Number(stock.quantity || 0) > 0,
    };

    setCachedValue(
      barcodeLookupCache,
      barcodeCacheKey,
      { statusCode: 200, body: response },
      BARCODE_LOOKUP_CACHE_TTL_MS,
    );

    return res.json(response);
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("inactive") ||
      error.message.includes("allowed")
    ) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.searchSaleProducts = async (req, res) => {
  try {
    const { q, warehouseId: requestedWarehouseId, limit } = req.query;

    const queryText = String(q || "").trim();
    if (!queryText) {
      return res.status(400).json({ message: "q query is required" });
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 20;
    }
    normalizedLimit = Math.min(normalizedLimit, 100);

    const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId);
    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(warehouseId);
    const searchCacheKey = `${String(shopWarehouse._id)}:${queryText.toLowerCase()}:${normalizedLimit}`;
    const cachedSearch = getCachedValue(saleSearchCache, searchCacheKey);
    if (cachedSearch) {
      return res.json(cachedSearch);
    }

    const searchRegex = new RegExp(escapeRegex(queryText), "i");

    const matchedProducts = await Product.find({
      isActive: true,
      $or: [{ name: searchRegex }, { model: searchRegex }],
    })
      .select(
        "name model barcode baseUnit hasPackage packageQuantity sellPrice miniSellPrice wholesalePrice blockSellPrice categoryId",
      )
      .populate({
        path: "categoryId",
        select: "name",
      })
      .limit(normalizedLimit * 3)
      .lean();

    if (matchedProducts.length === 0) {
      const emptyResponse = {
        warehouse: {
          _id: shopWarehouse._id,
          name: shopWarehouse.name,
        },
        total: 0,
        items: [],
      };
      setCachedValue(saleSearchCache, searchCacheKey, emptyResponse, SALE_SEARCH_CACHE_TTL_MS);
      return res.json(emptyResponse);
    }

    const matchedProductIds = matchedProducts.map((product) => product._id);
    const stocks = await Stock.find({
      warehouseId,
      quantity: { $gt: 0 },
      productId: { $in: matchedProductIds },
    })
      .select("productId quantity")
      .lean();

    const productMap = new Map(matchedProducts.map((product) => [String(product._id), product]));

    const items = stocks
      .map((stock) => ({
        product: productMap.get(String(stock.productId)),
        stockQuantity: Number(stock.quantity || 0),
        canSell: Number(stock.quantity || 0) > 0,
      }))
      .filter((row) => row.product)
      .slice(0, normalizedLimit)
      .sort((a, b) => String(a.product?.name || "").localeCompare(String(b.product?.name || "")));

    const response = {
      warehouse: {
        _id: shopWarehouse._id,
        name: shopWarehouse.name,
      },
      total: items.length,
      items,
    };

    setCachedValue(saleSearchCache, searchCacheKey, response, SALE_SEARCH_CACHE_TTL_MS);

    return res.json(response);
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("inactive") ||
      error.message.includes("allowed") ||
      error.message.includes("Assign shopId")
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getTopSaleProductsStats = async (req, res) => {
  try {
    const { days, limit } = req.query;

    let normalizedDays = Number(days);
    if (!Number.isInteger(normalizedDays) || normalizedDays <= 0) {
      normalizedDays = 30;
    }
    normalizedDays = Math.min(normalizedDays, 365);

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 20;
    }
    normalizedLimit = Math.min(normalizedLimit, 100);

    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(
      await resolveWarehouseForSale(req.user, null),
    );

    const statsCacheKey = `${String(shopWarehouse._id)}:${normalizedDays}:${normalizedLimit}`;
    const cachedStats = getCachedValue(topProductsStatsCache, statsCacheKey);
    if (cachedStats) {
      return res.json(cachedStats);
    }

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - normalizedDays);

    const top = await Sale.aggregate([
      {
        $match: {
          warehouseId: new mongoose.Types.ObjectId(shopWarehouse._id),
          createdAt: { $gte: fromDate },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          soldQuantity: { $sum: "$items.quantity" },
          soldAmount: { $sum: "$items.total" },
          salesCount: { $sum: 1 },
        },
      },
      { $sort: { soldQuantity: -1, soldAmount: -1 } },
      { $limit: normalizedLimit },
    ]);

    if (top.length === 0) {
      return res.json({
        warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
        periodDays: normalizedDays,
        total: 0,
        items: [],
      });
    }

    const productIds = top.map((x) => x._id);
    const [products, stocks] = await Promise.all([
      Product.find({ _id: { $in: productIds }, isActive: true })
        .select("name model barcode baseUnit sellPrice miniSellPrice wholesalePrice blockSellPrice hasPackage packageQuantity")
        .lean(),
      Stock.find({ warehouseId: shopWarehouse._id, productId: { $in: productIds } })
        .select("productId quantity")
        .lean(),
    ]);

    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const stockMap = new Map(stocks.map((s) => [String(s.productId), Number(s.quantity || 0)]));

    const items = top
      .map((row) => {
        const product = productMap.get(String(row._id));
        if (!product) return null;
        return {
          product,
          soldQuantity: Number(row.soldQuantity || 0),
          soldAmount: round2(row.soldAmount || 0),
          salesCount: Number(row.salesCount || 0),
          stockQuantity: stockMap.get(String(row._id)) || 0,
        };
      })
      .filter(Boolean);

    const response = {
      warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
      periodDays: normalizedDays,
      total: items.length,
      items,
    };

    setCachedValue(topProductsStatsCache, statsCacheKey, response, TOP_PRODUCTS_CACHE_TTL_MS);

    return res.json(response);
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("not found") ||
      error.message.includes("allowed")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getTopProductsAvailable = async (req, res) => {
  try {
    const { q, limit } = req.query;

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 500);

    const warehouseId = await resolveWarehouseForSale(req.user, null);
    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(warehouseId);

    const search = String(q || "").trim();
    const searchRegex = search ? new RegExp(escapeRegex(search), "i") : null;
    const availableCacheKey = `${String(shopWarehouse._id)}:${search.toLowerCase()}:${normalizedLimit}`;
    const cachedAvailable = getCachedValue(topProductsAvailableCache, availableCacheKey);
    if (cachedAvailable) {
      return res.json(cachedAvailable);
    }
    const productQuery = { isActive: true };
    if (searchRegex) {
      productQuery.$or = [{ name: searchRegex }, { model: searchRegex }, { barcode: searchRegex }];
    }

    const matchedProducts = await Product.find(productQuery)
      .select(
        "name model barcode baseUnit sellPrice miniSellPrice wholesalePrice blockSellPrice hasPackage packageQuantity",
      )
      .sort({ updatedAt: -1 })
      .limit(normalizedLimit * 3)
      .lean();

    if (matchedProducts.length === 0) {
      const emptyResponse = {
        warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
        total: 0,
        items: [],
      };
      setCachedValue(
        topProductsAvailableCache,
        availableCacheKey,
        emptyResponse,
        TOP_PRODUCTS_AVAILABLE_CACHE_TTL_MS,
      );
      return res.json(emptyResponse);
    }

    const matchedProductIds = matchedProducts.map((product) => product._id);
    const stocks = await Stock.find({
      warehouseId: shopWarehouse._id,
      productId: { $in: matchedProductIds },
    })
      .select("productId quantity updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    const productMap = new Map(matchedProducts.map((product) => [String(product._id), product]));

    const items = stocks
      .map((stock) => ({
        product: productMap.get(String(stock.productId)),
        stockQuantity: Number(stock.quantity || 0),
        canSell: Number(stock.quantity || 0) > 0,
      }))
      .filter((row) => row.product)
      .slice(0, normalizedLimit);

    const response = {
      warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
      total: items.length,
      items,
    };

    setCachedValue(
      topProductsAvailableCache,
      availableCacheKey,
      response,
      TOP_PRODUCTS_AVAILABLE_CACHE_TTL_MS,
    );

    return res.json(response);
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("not found") ||
      error.message.includes("allowed")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.setQuickSaleProducts = async (req, res) => {
  const session = undefined;

  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds)) {
      return res.status(400).json({ message: "productIds must be an array" });
    }

    const deduped = [];
    const seen = new Set();
    for (const id of productIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid productId in productIds" });
      }
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(key);
      }
    }

    if (deduped.length > 50) {
      return res.status(400).json({ message: "Maximum 50 quick products allowed" });
    }

    let shopId;
    let warehouseId;

    {
      const resolved = await resolveShopForSale(req.user, session);
      shopId = resolved.shop._id;
      warehouseId = resolved.warehouseId;

      const existingProducts = await Product.find({ _id: { $in: deduped }, isActive: true })
        .select("_id")
        .session(session)
        .lean();
      if (existingProducts.length !== deduped.length) {
        throw new Error("Some productIds are invalid or inactive");
      }

      // Quick ro'yxat mahsulot tanlovini saqlaydi, ombordagi qoldiqni emas.
      // Stock hujjati hali yaratilmagan mahsulot ham ro'yxatda turishi mumkin;
      // GET endpoint bunday mahsulotni stockQuantity=0, canSell=false qaytaradi.

      await ShopQuickProduct.deleteMany({ shopId }).session(session);

      if (deduped.length > 0) {
        const docs = deduped.map((productId, index) => ({
          shopId,
          productId,
          order: index,
          isActive: true,
          createdBy: req.user._id,
        }));
        await ShopQuickProduct.insertMany(docs, { session });
      }
    }

    return res.json({
      message: "Quick sale products updated successfully",
      warehouseId,
      total: deduped.length,
      productIds: deduped,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("Maximum") ||
      error.message.includes("inactive") ||
      error.message.includes("Assign shopId")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getQuickSaleProducts = async (req, res) => {
  try {
    const { shop, warehouseId } = await resolveShopForSale(req.user);
    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(warehouseId);

    const quickRows = await ShopQuickProduct.find({ shopId: shop._id, isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .populate(
        "productId",
        "name model barcode baseUnit sellPrice miniSellPrice wholesalePrice blockSellPrice hasPackage packageQuantity isActive",
      )
      .lean();

    const productIds = quickRows
      .map((r) => r.productId?._id)
      .filter(Boolean)
      .map((id) => String(id));

    const stocks = await Stock.find({
      warehouseId: shopWarehouse._id,
      productId: { $in: productIds },
    })
      .select("productId quantity")
      .lean();
    const stockMap = new Map(stocks.map((s) => [String(s.productId), Number(s.quantity || 0)]));

    const items = quickRows
      .filter((r) => r.productId && r.productId.isActive)
      .map((row) => ({
        product: row.productId,
        stockQuantity: stockMap.get(String(row.productId._id)) || 0,
        canSell: (stockMap.get(String(row.productId._id)) || 0) > 0,
      }));

    return res.json({
      shop: { _id: shop._id, name: shop.name },
      warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
      total: items.length,
      items,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("not found") ||
      error.message.includes("allowed")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.searchSaleHistoryByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { warehouseId: requestedWarehouseId, limit } = req.query;

    const normalizedBarcode = String(barcode || "").trim();
    if (!normalizedBarcode) {
      return res.status(400).json({ message: "barcode is required" });
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 20;
    }
    normalizedLimit = Math.min(normalizedLimit, 100);

    const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId);
    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(warehouseId);

    const product = await Product.findOne({ barcode: normalizedBarcode }).lean();
    if (!product) {
      return res.status(404).json({ message: "Product not found by barcode" });
    }

    const sales = await Sale.find({
      warehouseId,
      "items.productId": product._id,
    })
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("createdBy", "fullName role")
      .lean();

    const matches = [];
    for (const sale of sales) {
      for (const item of sale.items || []) {
        if (String(item.productId) !== String(product._id)) continue;

        const soldQty = Number(item.quantity || 0);
        const returnedQty = Number(item.returnedQuantity || 0);
        const availableQty = Number((soldQty - returnedQty).toFixed(6));
        if (availableQty <= 0) continue;

        matches.push({
          saleId: sale._id,
          saleDate: sale.createdAt,
          paymentType: sale.paymentType,
          soldQuantity: soldQty,
          returnedQuantity: returnedQty,
          availableReturnQuantity: availableQty,
          unitSellPrice: Number(item.unitSellPrice || 0),
          cashier: sale.createdBy || null,
        });
      }
    }

    return res.json({
      product: {
        _id: product._id,
        name: product.name,
        model: product.model,
        barcode: product.barcode,
      },
      warehouse: {
        _id: shopWarehouse._id,
        name: shopWarehouse.name,
      },
      total: matches.length,
      sales: matches,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("inactive") ||
      error.message.includes("allowed") ||
      error.message.includes("Assign shopId")
    ) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.createSaleReturn = async (req, res) => {
  const session = undefined;

  try {
    const {
      saleId,
      items,
      refundType = "cash",
      cashAmount,
      cardAmount,
      clickAmount,
      reason,
      warehouseId: requestedWarehouseId,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(saleId)) {
      return res.status(400).json({ message: "Invalid saleId" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items required" });
    }

    let returnDoc;

    {
      const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId, session);
      await ensureWarehouseIsActiveShopWarehouse(warehouseId, session);
      const activeShift = req.user?.role === "cashier" ? await requireOpenCashierShift(req.user, session) : null;

      const sale = await Sale.findById(saleId).session(session);
      if (!sale) {
        throw new Error("Sale not found");
      }
      if (String(sale.warehouseId) !== String(warehouseId)) {
        throw new Error("Sale does not belong to this shop warehouse");
      }

      const mergedItems = new Map();
      for (const incoming of items) {
        const productId = incoming?.productId;
        const returnQuantity = Number(incoming?.returnQuantity);

        if (!mongoose.Types.ObjectId.isValid(productId)) {
          throw new Error("Invalid productId in items");
        }
        if (!Number.isFinite(returnQuantity) || returnQuantity <= 0) {
          throw new Error("returnQuantity must be a positive number");
        }

        const key = String(productId);
        mergedItems.set(key, Number(((mergedItems.get(key) || 0) + returnQuantity).toFixed(6)));
      }

      let subtotal = 0;
      const processedItems = [];

      for (const [productId, requestedQty] of mergedItems.entries()) {
        const saleItem = (sale.items || []).find((it) => String(it.productId) === productId);
        if (!saleItem) {
          throw new Error("Product not found in selected sale");
        }

        const soldQty = Number(saleItem.quantity || 0);
        const alreadyReturnedQty = Number(saleItem.returnedQuantity || 0);
        const remainingQty = Number((soldQty - alreadyReturnedQty).toFixed(6));

        if (requestedQty > remainingQty) {
          throw new Error("Return quantity exceeds remaining quantity");
        }

        saleItem.returnedQuantity = Number((alreadyReturnedQty + requestedQty).toFixed(6));

        const unitSellPrice = Number(saleItem.unitSellPrice || 0);
        const lineTotal = round2(unitSellPrice * requestedQty);
        subtotal = round2(subtotal + lineTotal);

        await Stock.findOneAndUpdate(
          { productId, warehouseId },
          { $inc: { quantity: requestedQty } },
          { upsert: true, setDefaultsOnInsert: true, session },
        );

        processedItems.push({
          productId,
          returnQuantity: requestedQty,
          unitSellPrice,
          total: lineTotal,
        });
      }

      if (subtotal <= 0) {
        throw new Error("subtotal must be greater than 0");
      }

      const refund = validateAndResolvePayment(
        refundType,
        cashAmount,
        cardAmount,
        clickAmount,
        subtotal,
      );

      await sale.save({ session });

      const createdReturns = await SaleReturn.create(
        [
          {
            saleId: sale._id,
            warehouseId,
            items: processedItems,
            subtotal,
            refundType: refund.paymentType,
            cashAmount: refund.cashAmount,
            cardAmount: refund.cardAmount,
            clickAmount: refund.clickAmount,
            reason: reason || "",
            createdBy: req.user._id,
            shiftId: activeShift ? activeShift._id : null,
          },
        ],
        { session },
      );

      [returnDoc] = createdReturns;
    }

    const populated = await SaleReturn.findById(returnDoc._id)
      .populate("saleId", "createdAt paymentType totalAmount")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("shiftId", "status openedAt closedAt")
      .populate("items.productId", "name model barcode baseUnit");

    return res.status(201).json({
      message: "Sale return created successfully",
      saleReturn: populated,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("exceeds") ||
      error.message.includes("not found") ||
      error.message.includes("does not belong") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("allowed") ||
      error.message.includes("subtotal")
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getSaleReturnsBySaleId = async (req, res) => {
  try {
    const { id } = req.params;
    const { warehouseId: requestedWarehouseId, limit } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId);
    const returns = await SaleReturn.find({ saleId: id, warehouseId })
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("saleId", "createdAt paymentType totalAmount")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode baseUnit");

    return res.json(returns);
  } catch (error) {
    if (error.message.includes("Invalid") || error.message.includes("Assign shopId")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteSale = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    {
      const sale = await Sale.findById(id).session(session);
      if (!sale) {
        throw new Error("Sale not found");
      }

      const manualCreditPayments = round2(Number(sale.paidAmount || 0) - getSaleInitialPaidAmount(sale));
      if (sale.paymentType === "credit" && manualCreditPayments > 0) {
        throw new Error("Cannot delete credit sale with client payments applied");
      }

      const saleReturns = await SaleReturn.find({ saleId: sale._id }).session(session);
      const returnedByProduct = new Map();

      for (const saleReturn of saleReturns) {
        for (const item of saleReturn.items || []) {
          const key = String(item.productId);
          returnedByProduct.set(
            key,
            round2((returnedByProduct.get(key) || 0) + Number(item.returnQuantity || 0)),
          );
        }
      }

      for (const item of sale.items) {
        const restoredQuantity = round2(
          Number(item.quantity || 0) - (returnedByProduct.get(String(item.productId)) || 0),
        );

        if (restoredQuantity < 0) {
          throw new Error("Sale return quantity is invalid for this sale");
        }

        if (restoredQuantity === 0) {
          continue;
        }

        await Stock.findOneAndUpdate(
          { productId: item.productId, warehouseId: sale.warehouseId },
          { $inc: { quantity: restoredQuantity } },
          { upsert: true, setDefaultsOnInsert: true, session },
        );
      }

      if (saleReturns.length > 0) {
        await SaleReturn.deleteMany({ saleId: sale._id }).session(session);
      }

      await Sale.findByIdAndDelete(id).session(session);
    }

    res.json({ message: "Sale deleted successfully" });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }

    if (error.message.includes("Cannot delete") || error.message.includes("invalid")) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

// ───────────────────────── FISKAL (Soliq/OFD — E-POS) ─────────────────────────
//
// Flow: Flutter savdoni yaratadi -> bu endpointdan tayyor E-POS payload oladi ->
// payloadga lokal E-POS token qo'shadi -> kassa kompyuterining lokal E-POSiga
// (http://127.0.0.1:3448/uzpos) yuboradi -> javobni POST /sales/:id/fiscal orqali
// shu yerga saqlaydi. Backend tokenni qaytarmaydi.

const toTiyin = (som) => Math.round(Number(som || 0) * 100);

// Sotuvga tegishli warehouse kassirning do'koniga mosligini tekshiradi.
const assertSaleAccess = async (user, sale) => {
  if (user?.role !== "cashier") return;
  const allowedWarehouseId = await resolveWarehouseForSale(user, null);
  if (String(sale.warehouseId?._id || sale.warehouseId) !== String(allowedWarehouseId)) {
    const err = new Error("Sale does not belong to your shop warehouse");
    err.statusCode = 403;
    throw err;
  }
};

// GET /sales/:id/fiscal/payload — tayyor E-POS payloadni qaytaradi (tokensiz).
exports.getFiscalPayload = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    const sale = await Sale.findById(id).populate("createdBy", "fullName").lean();

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    await assertSaleAccess(req.user, sale);

    const setting = await loadGlobalSetting();
    const fiscal = setting.fiscal || {};

    const staffName =
      (fiscal.staffName && String(fiscal.staffName).trim()) ||
      sale.createdBy?.fullName ||
      "Kassir";
    const printerSize = Number(fiscal.printerSize) > 0 ? Number(fiscal.printerSize) : 58;

    const fiscalProducts = await FiscalProduct.find({ isActive: true })
      .select("name barcode sellPrice fiscalClassCode fiscalPackageCode fiscalVatPercent isActive")
      .lean();

    const items = composeFiscalItemsFromCatalog(sale.totalAmount, fiscalProducts);

    const receivedCash = toTiyin(sale.cashAmount || 0);
    const receivedCard = toTiyin(
      Number(sale.cardAmount || 0) + Number(sale.clickAmount || 0),
    );

    return res.json({
      method: "sale",
      saleId: String(sale._id),
      fiscalEnabled: Boolean(fiscal.enabled),
      alreadyFiscalized: sale.fiscal?.status === "success",
      payload: {
        companyName: fiscal.companyName || "",
        companyAddress: fiscal.companyAddress || "",
        companyINN: fiscal.companyINN || "",
        staffName,
        printerSize,
        companyPhoneNumber: fiscal.companyPhoneNumber || "",
        params: {
          items,
          receivedCash,
          receivedCard,
        },
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (
      error.message.includes("Invalid") ||
      error.message.includes("Assign shopId") ||
      error.message.includes("allowed") ||
      error.message.includes("not found")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

// POST /sales/:id/fiscal — E-POSdan kelgan fiskal natijani saqlaydi.
exports.saveFiscalResult = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    const {
      status,
      method,
      terminalId,
      receiptSeq,
      dateTime,
      fiscalSign,
      qrCodeUrl,
      paycheck,
      errorMessage,
      rawResponse,
    } = req.body || {};

    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (!["success", "failed"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "status must be 'success' or 'failed'" });
    }

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    await assertSaleAccess(req.user, sale);

    sale.fiscal = {
      status: normalizedStatus,
      method: method || "sale",
      terminalId: terminalId ? String(terminalId) : "",
      receiptSeq: receiptSeq != null ? String(receiptSeq) : "",
      dateTime: dateTime ? String(dateTime) : "",
      fiscalSign: fiscalSign ? String(fiscalSign) : "",
      qrCodeUrl: qrCodeUrl ? String(qrCodeUrl) : "",
      paycheck: paycheck ?? null,
      errorMessage: normalizedStatus === "failed" ? String(errorMessage || "E-POS xatosi") : "",
      rawResponse: rawResponse ?? null,
      submittedAt: new Date(),
    };

    await sale.save();

    return res.json({
      message:
        normalizedStatus === "success" ? "Fiskal natija saqlandi" : "Fiskal xatolik saqlandi",
      fiscal: sale.fiscal,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};
