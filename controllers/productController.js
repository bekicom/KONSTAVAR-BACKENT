const Product = require("../models/Product");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Stock = require("../models/Stock");
const Purchase = require("../models/Purchase");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const SupplierReturn = require("../models/SupplierReturn");
const Writeoff = require("../models/Writeoff");
const InventorySession = require("../models/InventorySession");
const ShopQuickProduct = require("../models/ShopQuickProduct");
const ShopTransfer = require("../models/ShopTransfer");
const { ensureWarehouseAccess, getAssignedWarehouseIds } = require("../utils/userAccess");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FISCAL_CODE_REGEX = /^\d{17}$/;

const mapFiscalAliases = (item) => {
  const plain = typeof item?.toObject === "function"
    ? item.toObject({ depopulate: false, virtuals: false, getters: false })
    : item;

  if (!plain) return plain;

  return {
    ...plain,
    price: Number(plain.sellPrice || 0),
    classCode: plain.fiscalClassCode || "",
    packageCode: plain.fiscalPackageCode || "",
    vatPercent: Number(plain.fiscalVatPercent || 0),
  };
};

const normalizeFiscalPayload = (body, payload) => {
  if (!body || !payload) return;

  if (Object.prototype.hasOwnProperty.call(body, "classCode")) {
    payload.fiscalClassCode = String(body.classCode ?? "").trim();
    delete payload.classCode;
  }

  if (Object.prototype.hasOwnProperty.call(body, "packageCode")) {
    payload.fiscalPackageCode = String(body.packageCode ?? "").trim();
    delete payload.packageCode;
  }

  if (Object.prototype.hasOwnProperty.call(body, "vatPercent")) {
    const parsedVatPercent = Number(body.vatPercent);
    payload.fiscalVatPercent = Number.isFinite(parsedVatPercent) && parsedVatPercent >= 0 ? parsedVatPercent : 0;
    delete payload.vatPercent;
  }
};

const resolveFiscalProduct = async (idOrCode) => {
  const normalized = String(idOrCode || "").trim();
  if (!normalized) return null;

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    const byId = await Product.findById(normalized).populate("categoryId", "name");
    if (byId) return byId;
  }

  return Product.findOne({ fiscalClassCode: normalized }).populate("categoryId", "name");
};

const resolveCategoryId = async ({ categoryId, categoryName, category }) => {
  if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      throw new Error("Invalid category ID");
    }

    const categoryExists = await Category.findById(categoryId).select("_id");
    if (!categoryExists) {
      throw new Error("Category not found");
    }

    return categoryExists._id;
  }

  const incomingCategoryName = String(category?.name || categoryName || "").trim();
  if (!incomingCategoryName) {
    return null;
  }

  let existingCategory = await Category.findOne({ name: incomingCategoryName }).select("_id");
  if (!existingCategory) {
    existingCategory = await Category.create({
      name: incomingCategoryName,
      description: category?.description || "",
    });
  }

  return existingCategory._id;
};

// 🔹 CREATE
exports.createProduct = async (req, res) => {
  try {
    const resolvedCategoryId = await resolveCategoryId(req.body);
    const payload = { ...req.body, categoryId: resolvedCategoryId };
    normalizeFiscalPayload(req.body, payload);
    delete payload.categoryName;
    delete payload.category;

    const product = await Product.create(payload);

    res.status(201).json({
      message: "Product created successfully",
      product: mapFiscalAliases(product),
    });
  } catch (error) {
    if (error.message.includes("Invalid category ID")) {
      return res.status(400).json({ message: error.message });
    }
    if (error.message.includes("Category not found")) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// 🔹 GET ALL
exports.getProducts = async (req, res) => {
  try {
    const { categoryId, search, isActive } = req.query;
    const query = {};

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID query" });
      }
      query.categoryId = categoryId;
    }

    if (isActive !== undefined) {
      query.isActive = String(isActive) === "true";
    }

    if (search) {
      const s = String(search).trim();
      if (s.length > 0) {
        const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escape(s), "i");
        query.$or = [
          { name: regex },
          { model: regex },
          { barcode: regex },
        ];
      }
    }

    const { paginateQuery } = require("../utils/pagination");
    const result = await paginateQuery({
      Model: Product,
      filter: query,
      queryParams: req.query,
      defaultSort: { createdAt: -1, _id: -1 },
      populate: (q) => q.populate("categoryId", "name"),
    });

    if (req.query.page === undefined && req.query.skip === undefined && req.query.paginated !== "true") {
      return res.json(result.items.map(mapFiscalAliases));
    }

    res.json({
      items: result.items.map(mapFiscalAliases),
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

// 🔹 GET FISCAL PRODUCTS
exports.getFiscalProducts = async (req, res) => {
  try {
    const { categoryId, search, isActive } = req.query;
    const query = {};

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID query" });
      }
      query.categoryId = categoryId;
    }

    if (isActive !== undefined) {
      query.isActive = String(isActive) === "true";
    } else {
      query.isActive = true;
    }

    // Oldingi xulq: fiscal ro'yxatda faqat MXIK (class code) bor mahsulotlar chiqadi
    query.fiscalClassCode = { $exists: true, $ne: "" };

    if (search) {
      const s = String(search).trim();
      if (s.length > 0) {
        const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escape(s), "i");
        query.$or = [
          { name: regex },
          { model: regex },
          { barcode: regex },
          { fiscalClassCode: regex },
        ];
      }
    }

    const { paginateQuery } = require("../utils/pagination");
    const result = await paginateQuery({
      Model: Product,
      filter: query,
      queryParams: req.query,
      defaultSort: { name: 1, createdAt: -1, _id: -1 },
      populate: (q) => q.populate("categoryId", "name"),
      project: (q) =>
        q.select(
          "name model barcode baseUnit hasPackage packageQuantity purchasePrice sellPrice wholesalePrice miniSellPrice blockSellPrice fiscalClassCode fiscalPackageCode fiscalVatPercent isActive categoryId",
        ),
    });

    if (req.query.page === undefined && req.query.skip === undefined && req.query.paginated !== "true") {
      return res.json(result.items.map(mapFiscalAliases));
    }

    res.json({
      items: result.items.map(mapFiscalAliases),
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

exports.getFiscalProductById = async (req, res) => {
  try {
    const product = await resolveFiscalProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Fiscal product not found" });
    }

    return res.json(mapFiscalAliases(product));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 🔹 SAVE FISCAL PRODUCT DATA
exports.saveFiscalProduct = async (req, res) => {
  try {
    const {
      productId,
      id,
      classCode,
      packageCode,
      vatPercent,
      price,
      sellPrice,
      fiscalClassCode,
      fiscalPackageCode,
      fiscalVatPercent,
    } = req.body || {};

    const payload = {};
    const incomingClassCode = classCode ?? fiscalClassCode;

    if (incomingClassCode !== undefined) {
      payload.fiscalClassCode = String(incomingClassCode ?? "").trim();
      if (!FISCAL_CODE_REGEX.test(payload.fiscalClassCode)) {
        return res.status(400).json({
          message: "classCode aynan 17 ta raqam bo'lishi kerak",
        });
      }
    }

    if (packageCode !== undefined || fiscalPackageCode !== undefined) {
      payload.fiscalPackageCode = String(packageCode ?? fiscalPackageCode ?? "").trim();
    }

    if (vatPercent !== undefined || fiscalVatPercent !== undefined) {
      const parsedVatPercent = Number(vatPercent ?? fiscalVatPercent);
      if (!Number.isFinite(parsedVatPercent) || parsedVatPercent < 0) {
        return res.status(400).json({ message: "vatPercent must be a valid non-negative number" });
      }
      payload.fiscalVatPercent = parsedVatPercent;
    }

    if (price !== undefined || sellPrice !== undefined) {
      const parsedPrice = Number(price ?? sellPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ message: "price must be greater than 0" });
      }
      payload.sellPrice = parsedPrice;
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        message: "At least one of classCode, packageCode, vatPercent or price is required",
      });
    }

    const targetProductId = productId || id || req.params?.id;
    if (!targetProductId) {
      const resolvedCategoryId = await resolveCategoryId(req.body);
      const createPayload = { ...req.body, ...payload, categoryId: resolvedCategoryId };

      delete createPayload.id;
      delete createPayload.productId;
      delete createPayload.classCode;
      delete createPayload.packageCode;
      delete createPayload.vatPercent;
      delete createPayload.price;
      delete createPayload.categoryName;
      delete createPayload.category;

      if (!String(createPayload.name || "").trim()) {
        return res.status(400).json({ message: "name is required" });
      }

      if (!payload.fiscalClassCode) {
        return res.status(400).json({ message: "classCode is required" });
      }

      if (!payload.sellPrice || payload.sellPrice <= 0) {
        return res.status(400).json({ message: "price must be greater than 0" });
      }

      if (
        createPayload.barcode &&
        (await Product.exists({ barcode: String(createPayload.barcode).trim() }))
      ) {
        return res.status(409).json({ message: "barcode already exists" });
      }

      const duplicate = await Product.findOne({
        fiscalClassCode: payload.fiscalClassCode,
      }).select("_id");
      if (duplicate) {
        return res.status(409).json({ message: "classCode already exists" });
      }

      if (!Number.isFinite(Number(createPayload.purchasePrice)) || Number(createPayload.purchasePrice) <= 0) {
        createPayload.purchasePrice = payload.sellPrice;
      }

      const product = await Product.create(createPayload);

      return res.status(201).json({
        message: "Fiscal product created successfully",
        product: mapFiscalAliases(product),
      });
    }

    const existing = await resolveFiscalProduct(targetProductId);
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (payload.fiscalClassCode) {
      const duplicate = await Product.findOne({
        fiscalClassCode: payload.fiscalClassCode,
        _id: { $ne: existing._id },
      }).select("_id");
      if (duplicate) {
        return res.status(409).json({ message: "classCode already exists" });
      }
    }

    const product = await Product.findByIdAndUpdate(existing._id, payload, {
      new: true,
      runValidators: true,
    }).populate("categoryId", "name");

    return res.status(200).json({
      message: "Fiscal product saved successfully",
      product: mapFiscalAliases(product),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteFiscalProduct = async (req, res) => {
  try {
    const product = await resolveFiscalProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Fiscal product not found" });
    }

    product.fiscalClassCode = "";
    product.fiscalPackageCode = "";
    product.fiscalVatPercent = 0;
    await product.save();

    return res.json({ message: "Fiscal product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 🔹 GET BY ID
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findById(id).populate("categoryId", "name");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(mapFiscalAliases(product));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 GET BY BARCODE OR NAME (optional: warehouse stock)
exports.getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { warehouseId } = req.query;

    const searchTerm = String(barcode || "").trim();
    if (!searchTerm) {
      return res.status(400).json({ message: "search term is required" });
    }

    const normalizedSearch = searchTerm.toLowerCase();
    const exactNameRegex = new RegExp(`^${escapeRegex(searchTerm)}$`, "i");
    const startsWithNameRegex = new RegExp(`^${escapeRegex(searchTerm)}`, "i");
    const containsNameRegex = new RegExp(escapeRegex(searchTerm), "i");

    const product = await Product.findOne({
      isActive: true,
      $or: [
        { barcode: searchTerm },
        { name: exactNameRegex },
        { name: startsWithNameRegex },
        { name: containsNameRegex },
      ],
    })
      .sort({ name: 1, createdAt: -1 })
      .populate("categoryId", "name")
      .lean();

    if (!product) {
      return res
        .status(404)
        .json({ message: "Product not found by barcode or name" });
    }

    const exactBarcodeMatch = product.barcode === searchTerm;
    const exactNameMatch = String(product.name || "").toLowerCase() === normalizedSearch;
    const startsWithNameMatch = String(product.name || "").toLowerCase().startsWith(normalizedSearch);

    const matchedBy = exactBarcodeMatch
      ? "barcode"
      : exactNameMatch
        ? "name_exact"
        : startsWithNameMatch
          ? "name_prefix"
          : "name_partial";

    const responseProduct = {
      ...mapFiscalAliases(product),
      matchedBy,
    };

    if (warehouseId) {
      ensureWarehouseAccess(req.user, warehouseId);

      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }

      const stock = await Stock.findOne({
        productId: product._id,
        warehouseId,
      })
        .populate("warehouseId", "name")
        .lean();

      return res.json({
        product: responseProduct,
        stock: {
          totalQuantity: Number(stock?.quantity || 0),
          byWarehouse: stock
            ? [
                {
                  warehouseId: stock.warehouseId?._id || warehouseId,
                  warehouseName: stock.warehouseId?.name || null,
                  quantity: Number(stock.quantity || 0),
                },
              ]
            : [],
        },
      });
    }

    const stockQuery = { productId: product._id };
    const allowedWarehouseIds = getAssignedWarehouseIds(req.user);
    if (req.user?.role === "warehouse") {
      stockQuery.warehouseId = { $in: allowedWarehouseIds };
    }

    const stocks = await Stock.find(stockQuery)
      .populate("warehouseId", "name")
      .lean();

    const totalQuantity = stocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

    res.json({
      product: responseProduct,
      stock: {
        totalQuantity: Number(totalQuantity.toFixed(2)),
        byWarehouse: stocks.map((s) => ({
          warehouseId: s.warehouseId?._id || null,
          warehouseName: s.warehouseId?.name || null,
          quantity: Number(s.quantity || 0),
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 UPDATE
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const payload = { ...req.body };
    normalizeFiscalPayload(req.body, payload);
    if (
      Object.prototype.hasOwnProperty.call(req.body, "categoryId") ||
      Object.prototype.hasOwnProperty.call(req.body, "categoryName") ||
      Object.prototype.hasOwnProperty.call(req.body, "category")
    ) {
      payload.categoryId = await resolveCategoryId(req.body);
    }
    delete payload.categoryName;
    delete payload.category;

    const product = await Product.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    }).populate("categoryId", "name");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      message: "Product updated successfully",
      product: mapFiscalAliases(product),
    });
  } catch (error) {
    if (error.message.includes("Invalid category ID")) {
      return res.status(400).json({ message: error.message });
    }
    if (error.message.includes("Category not found")) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

// 🔹 DELETE
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const references = await Promise.all([
      Stock.exists({ productId: id, quantity: { $gt: 0 } }),
      Purchase.exists({ "items.productId": id }),
      Sale.exists({ "items.productId": id }),
      SaleReturn.exists({ "items.productId": id }),
      SupplierReturn.exists({ "items.productId": id }),
      Writeoff.exists({ "items.productId": id }),
      InventorySession.exists({ "items.productId": id }),
      ShopQuickProduct.exists({ productId: id }),
      ShopTransfer.exists({ "items.productId": id }),
    ]);

    if (references.some(Boolean)) {
      return res.status(400).json({
        message: "Product has stock or history. Set isActive=false instead of delete",
      });
    }

    await Product.findByIdAndDelete(id);

    res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
