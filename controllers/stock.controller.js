const mongoose = require("mongoose");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Product = require("../models/Product");
const { applyWarehouseScope, ensureWarehouseAccess, getAssignedWarehouseIds } = require("../utils/userAccess");
const { parsePagination, parseSort, isPaginatedRequest } = require("../utils/pagination");

const STOCK_LIST_CACHE_TTL_MS = 10000;
// Qidiruv endpointi paginationsiz ishlaydi, shuning uchun natija soni cheklanadi.
const STOCK_SEARCH_DEFAULT_LIMIT = 50;
const STOCK_SEARCH_MAX_LIMIT = 200;
const STOCK_SEARCH_PRODUCT_SCAN_LIMIT = 1000;
const stockListCache = new Map();
const STOCK_SELECT_FIELDS =
  "productId warehouseId quantity sellPrice wholesalePrice miniSellPrice updatedAt createdAt";
const PRODUCT_SELECT_FIELDS =
  "name model barcode baseUnit sellPrice wholesalePrice miniSellPrice minStockQuantity reorderQuantity";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getCachedStockList = (key) => {
  const cached = stockListCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    stockListCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedStockList = (key, value) => {
  stockListCache.set(key, {
    value,
    expiresAt: Date.now() + STOCK_LIST_CACHE_TTL_MS,
  });
};

const invalidateStockListCache = () => {
  stockListCache.clear();
};

const hydrateStocks = async (stockRows) => {
  if (!Array.isArray(stockRows) || stockRows.length === 0) {
    return [];
  }

  const productIds = [
    ...new Set(stockRows.map((row) => String(row.productId || "")).filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  const warehouseIds = [
    ...new Set(
      stockRows.map((row) => String(row.warehouseId || "")).filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];

  const [products, warehouses] = await Promise.all([
    Product.find({ _id: { $in: productIds } })
      .select(PRODUCT_SELECT_FIELDS)
      .lean(),
    Warehouse.find({ _id: { $in: warehouseIds } })
      .select("name")
      .lean(),
  ]);

  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const warehouseMap = new Map(warehouses.map((warehouse) => [String(warehouse._id), warehouse]));

  return stockRows.map((row) => ({
    ...row,
    productId: productMap.get(String(row.productId)) || null,
    warehouseId: warehouseMap.get(String(row.warehouseId)) || null,
  }));
};

exports.createStock = async (req, res) => {
  try {
    const { productId, warehouseId, quantity } = req.body;
    const normalizedQuantity = Number(quantity);

    ensureWarehouseAccess(req.user, warehouseId);

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid productId or warehouseId" });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
      return res.status(400).json({ message: "quantity must be a non-negative number" });
    }

    const [product, warehouse] = await Promise.all([
      Product.findById(productId),
      Warehouse.findById(warehouseId),
    ]);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const existing = await Stock.findOne({ productId, warehouseId });
    if (existing) {
      return res.status(409).json({ message: "Stock already exists for this product in warehouse" });
    }

    const stock = await Stock.create({
      productId,
      warehouseId,
      quantity: normalizedQuantity,
      sellPrice: Number(product.sellPrice || 0),
      wholesalePrice:
        product.wholesalePrice !== undefined && product.wholesalePrice !== null
          ? Number(product.wholesalePrice)
          : null,
      miniSellPrice:
        product.miniSellPrice !== undefined && product.miniSellPrice !== null
          ? Number(product.miniSellPrice)
          : null,
    });
    invalidateStockListCache();
    res.status(201).json({ message: "Stock created successfully", stock });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const normalizeStockDoc = (stock) => {
  const obj = typeof stock.toObject === "function" ? stock.toObject() : stock;
  const product = obj.productId || {};
  const quantity = Number(obj.quantity || 0);
  const minStockQuantity = Number(product.minStockQuantity);
  return {
    ...obj,
    isLowStock:
      Number.isFinite(minStockQuantity) && minStockQuantity >= 0
        ? quantity <= minStockQuantity
        : false,
    lowStockThreshold:
      Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
    sellPrice:
      obj.sellPrice !== undefined && obj.sellPrice !== null
        ? Number(obj.sellPrice)
        : Number(product.sellPrice || 0),
    wholesalePrice:
      obj.wholesalePrice !== undefined && obj.wholesalePrice !== null
        ? Number(obj.wholesalePrice)
        : Number(product.wholesalePrice || 0),
    miniSellPrice:
      obj.miniSellPrice !== undefined && obj.miniSellPrice !== null
        ? Number(obj.miniSellPrice)
        : Number(product.miniSellPrice || 0),
  };
};

exports.getStocks = async (req, res) => {
  try {
    const stockQuery = applyWarehouseScope(req.user, {});
    const searchText = String(req.query.q || req.query.search || "").trim();

    // Optional warehouseId narrow filter on top of scope.
    if (req.query.warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      stockQuery.warehouseId = new mongoose.Types.ObjectId(req.query.warehouseId);
    }

    if (searchText) {
      const searchRegex = new RegExp(escapeRegex(searchText), "i");
      const matchedProductIds = await Product.find({
        $or: [{ name: searchRegex }, { model: searchRegex }, { barcode: searchRegex }],
      })
        .select("_id")
        .lean();

      if (matchedProductIds.length === 0) {
        if (isPaginatedRequest(req.query)) {
          const { page, limit } = parsePagination(req.query);
          return res.json({
            items: [],
            total: 0,
            page,
            limit,
            pages: 0,
            hasMore: false,
          });
        }

        return res.json([]);
      }

      stockQuery.productId = { $in: matchedProductIds.map((row) => row._id) };
    }

    const cacheKey = JSON.stringify({
      role: req.user?.role || "guest",
      userId: String(req.user?._id || ""),
      warehouseIds: getAssignedWarehouseIds(req.user),
      warehouseId: req.query.warehouseId || null,
      q: searchText || null,
      page: req.query.page || null,
      skip: req.query.skip || null,
      limit: req.query.limit || null,
      sort: req.query.sort || null,
      paginated: req.query.paginated === "true",
    });
    const cachedResponse = getCachedStockList(cacheKey);
    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    if (isPaginatedRequest(req.query)) {
      const { page, limit, skip } = parsePagination(req.query);
      const sort = parseSort(req.query.sort, { updatedAt: -1, _id: -1 });

      const [stockRows, total] = await Promise.all([
        Stock.find(stockQuery)
          .select(STOCK_SELECT_FIELDS)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Stock.countDocuments(stockQuery),
      ]);
      const items = await hydrateStocks(stockRows);
      const pages = limit > 0 ? Math.ceil(total / limit) : 0;
      const response = {
        items: items.map(normalizeStockDoc),
        total,
        page,
        limit,
        pages,
        hasMore: skip + items.length < total,
      };

      setCachedStockList(cacheKey, response);
      return res.json(response);
    }

    const stocks = await Stock.find(stockQuery)
      .select(STOCK_SELECT_FIELDS)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(2000)
      .lean();
    const hydratedStocks = await hydrateStocks(stocks);

    const response = hydratedStocks.map(normalizeStockDoc);
    setCachedStockList(cacheKey, response);
    res.json(response);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/stocks/search
 *
 * Barcode va nom bo'yicha qidiruv. Paginationsiz - to'g'ridan-to'g'ri massiv
 * qaytaradi, lekin javob og'irlashmasligi uchun natija soni cheklangan
 * (`limit`, default 50, maksimum 200).
 *
 *   ?barcode=4780123456789   - aniq barcode
 *   ?name=sement             - nom bo'yicha (qismiy, katta-kichik harf farqsiz)
 *   ?q=sement                - nom, model yoki barcode bo'yicha
 *   ?warehouseId=...         - ombor bo'yicha toraytirish
 */
exports.searchStocks = async (req, res) => {
  try {
    const rawQuery = String(req.query.q ?? req.query.search ?? "").trim();
    const barcode = String(req.query.barcode ?? "").trim();
    const name = String(req.query.name ?? "").trim();

    if (!rawQuery && !barcode && !name) {
      return res.status(400).json({
        message: "q, barcode yoki name parametrlaridan kamida bittasi kerak",
      });
    }

    const parsedLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(STOCK_SEARCH_MAX_LIMIT, Math.floor(parsedLimit))
        : STOCK_SEARCH_DEFAULT_LIMIT;

    const stockQuery = applyWarehouseScope(req.user, {});

    if (req.query.warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      stockQuery.warehouseId = new mongoose.Types.ObjectId(req.query.warehouseId);
    }

    const conditions = [];
    if (barcode) {
      conditions.push({ barcode });
    }
    if (name) {
      conditions.push({ name: new RegExp(escapeRegex(name), "i") });
    }
    if (rawQuery) {
      const searchRegex = new RegExp(escapeRegex(rawQuery), "i");
      conditions.push({
        $or: [{ name: searchRegex }, { model: searchRegex }, { barcode: searchRegex }],
      });
    }

    const matchedProducts = await Product.find(
      conditions.length === 1 ? conditions[0] : { $and: conditions },
    )
      .select("_id")
      .limit(STOCK_SEARCH_PRODUCT_SCAN_LIMIT)
      .lean();

    if (matchedProducts.length === 0) {
      return res.json([]);
    }

    stockQuery.productId = { $in: matchedProducts.map((row) => row._id) };

    const stockRows = await Stock.find(stockQuery)
      .select(STOCK_SELECT_FIELDS)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    const hydrated = await hydrateStocks(stockRows);
    return res.json(hydrated.map(normalizeStockDoc));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getStockById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid stock ID" });
    }

    const stock = await Stock.findById(id)
      .populate(
        "productId",
        "name model barcode baseUnit sellPrice wholesalePrice miniSellPrice minStockQuantity reorderQuantity",
      )
      .populate("warehouseId", "name");

    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    ensureWarehouseAccess(req.user, stock.warehouseId);

    const product = stock.productId || {};
    const quantity = Number(stock.quantity || 0);
    const minStockQuantity = Number(product.minStockQuantity);
    res.json({
      ...stock.toObject(),
      isLowStock:
        Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? quantity <= minStockQuantity : false,
      lowStockThreshold: Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
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
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      quantity,
      sellPrice,
      wholesalePrice,
      miniSellPrice,
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid stock ID" });
    }

    const existingStock = await Stock.findById(id).select("warehouseId productId");
    if (!existingStock) {
      return res.status(404).json({ message: "Stock not found" });
    }
    ensureWarehouseAccess(req.user, existingStock.warehouseId);

    const stockUpdate = {};
    const productUpdate = {};

    if (quantity !== undefined) {
      const normalizedQuantity = Number(quantity);
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
        return res.status(400).json({ message: "quantity must be a non-negative number" });
      }
      stockUpdate.quantity = normalizedQuantity;
    }

    if (sellPrice !== undefined) {
      const normalizedSellPrice = Number(sellPrice);
      if (!Number.isFinite(normalizedSellPrice) || normalizedSellPrice < 0) {
        return res.status(400).json({ message: "sellPrice must be a non-negative number" });
      }
      stockUpdate.sellPrice = normalizedSellPrice;
      productUpdate.sellPrice = normalizedSellPrice;
    }

    if (wholesalePrice !== undefined) {
      const normalizedWholesalePrice = Number(wholesalePrice);
      if (!Number.isFinite(normalizedWholesalePrice) || normalizedWholesalePrice < 0) {
        return res.status(400).json({ message: "wholesalePrice must be a non-negative number" });
      }
      stockUpdate.wholesalePrice = normalizedWholesalePrice;
      productUpdate.wholesalePrice = normalizedWholesalePrice;
    }

    if (miniSellPrice !== undefined) {
      const normalizedMiniSellPrice = Number(miniSellPrice);
      if (!Number.isFinite(normalizedMiniSellPrice) || normalizedMiniSellPrice < 0) {
        return res.status(400).json({ message: "miniSellPrice must be a non-negative number" });
      }
      stockUpdate.miniSellPrice = normalizedMiniSellPrice;
      productUpdate.miniSellPrice = normalizedMiniSellPrice;
    }

    if (Object.keys(stockUpdate).length === 0) {
      return res.status(400).json({
        message: "At least one of quantity, sellPrice, wholesalePrice or miniSellPrice is required",
      });
    }

    if (Object.keys(productUpdate).length > 0) {
      await Product.findByIdAndUpdate(existingStock.productId, productUpdate, {
        new: true,
        runValidators: true,
      });
    }

    const stock = await Stock.findByIdAndUpdate(id, stockUpdate, { new: true, runValidators: true })
      .populate(
        "productId",
        "name model barcode baseUnit sellPrice wholesalePrice miniSellPrice minStockQuantity reorderQuantity",
      )
      .populate("warehouseId", "name");

    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    invalidateStockListCache();
    res.json({ message: "Stock updated successfully", stock: normalizeStockDoc(stock) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteStock = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid stock ID" });
    }

    const existingStock = await Stock.findById(id).select("warehouseId");
    if (!existingStock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    ensureWarehouseAccess(req.user, existingStock.warehouseId);

    const stock = await Stock.findByIdAndDelete(id);

    invalidateStockListCache();
    res.json({ message: "Stock deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getWarehouseStock = async (req, res) => {
  try {
    const { warehouseId } = req.params;

    ensureWarehouseAccess(req.user, warehouseId);

    // ID validate
    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid warehouse ID",
      });
    }

    // Warehouse mavjudligini tekshirish
    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Warehouse not found",
      });
    }

    // Stocklarni olish
    const stocks = await Stock.find({ warehouseId })
      .populate({
        path: "productId",
        select:
          "name model barcode baseUnit categoryId minStockQuantity reorderQuantity sellPrice wholesalePrice miniSellPrice",
        populate: {
          path: "categoryId",
          select: "name description isActive",
        },
      })
      .lean();

    // 🔹 "Uxlab qolgan" (dormant) mahsulotlarni yashirish:
    // qoldiq 60 kundan ko'proq 0 da turgan (qayta kirim qilinmagan) mahsulot
    // ombor ro'yxatida ko'rinmaydi. `?includeDormant=true` bilan ko'rsatish mumkin.
    // Stock hujjati faqat qoldiq o'zgarganda yangilanadi, shu sababli `updatedAt`
    // mahsulot oxirgi marta qachon harakatlanganini (0 ga tushganini) bildiradi.
    const DORMANT_DAYS = 60;
    const dormantCutoff = new Date(
      Date.now() - DORMANT_DAYS * 24 * 60 * 60 * 1000,
    );
    const includeDormant = String(req.query.includeDormant) === "true";
    const isDormant = (stock) =>
      Number(stock.quantity || 0) <= 0 &&
      stock.updatedAt &&
      new Date(stock.updatedAt) < dormantCutoff;

    const visibleStocks = includeDormant
      ? stocks
      : stocks.filter((stock) => !isDormant(stock));

    const rows = visibleStocks.map((stock) => {
      const quantity = Number(stock.quantity || 0);
      const minStockQuantity = Number(stock.productId?.minStockQuantity);
      return {
        ...stock,
        isLowStock:
          Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? quantity <= minStockQuantity : false,
        lowStockThreshold: Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
        sellPrice:
          stock.sellPrice !== undefined && stock.sellPrice !== null
            ? Number(stock.sellPrice)
            : Number(stock.productId?.sellPrice || 0),
        wholesalePrice:
          stock.wholesalePrice !== undefined && stock.wholesalePrice !== null
            ? Number(stock.wholesalePrice)
            : Number(stock.productId?.wholesalePrice || 0),
        miniSellPrice:
          stock.miniSellPrice !== undefined && stock.miniSellPrice !== null
            ? Number(stock.miniSellPrice)
            : Number(stock.productId?.miniSellPrice || 0),
      };
    });

    const basePayload = {
      success: true,
      warehouse: {
        _id: warehouse._id,
        name: warehouse.name,
      },
      totalProducts: rows.length,
      dormantHidden: stocks.length - visibleStocks.length,
      dormantDays: DORMANT_DAYS,
    };

    if (isPaginatedRequest(req.query)) {
      const { page, limit, skip } = parsePagination(req.query);
      const data = rows.slice(skip, skip + limit);
      return res.status(200).json({
        ...basePayload,
        total: rows.length,
        page,
        limit,
        pages: limit > 0 ? Math.ceil(rows.length / limit) : 0,
        hasMore: skip + data.length < rows.length,
        data,
      });
    }

    return res.status(200).json({ ...basePayload, data: rows });
  } catch (error) {
    console.error("Get warehouse stock error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
