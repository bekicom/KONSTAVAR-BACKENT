const mongoose = require("mongoose");
const Purchase = require("../models/Purchase");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Supplier = require("../models/Supplier");
const Category = require("../models/Category");
const { applyWarehouseScope, ensureWarehouseAccess } = require("../utils/userAccess");

const PURCHASE_PRODUCT_SELECT =
  "name model barcode categoryId baseUnit hasPackage packageQuantity purchasePrice " +
  "blockPurchasePrice sellPrice wholesalePrice miniSellPrice minStockQuantity " +
  "reorderQuantity blockSellPrice isActive";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumberOrNaN = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : Number.NaN;
};

const toBoolean = (value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return Boolean(value);
};

const DEFAULT_SUPPLIER_NAME = "Noma'lum yetkazib beruvchi";

const resolveSupplierForPurchase = async ({ supplierId, supplier, session }) => {
  let resolvedSupplier;

  if (supplierId) {
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      throw new Error("Invalid supplierId");
    }
    resolvedSupplier = await Supplier.findById(supplierId).session(session);
    if (!resolvedSupplier) {
      throw new Error("Supplier not found");
    }
  }

  if (!resolvedSupplier && supplier?.name) {
    if (supplier.phone) {
      resolvedSupplier = await Supplier.findOne({ phone: supplier.phone }).session(session);
    }

    if (!resolvedSupplier) {
      const createdSuppliers = await Supplier.create(
        [
          {
            name: supplier.name,
            phone: supplier.phone,
            address: supplier.address,
            note: supplier.note,
          },
        ],
        { session },
      );
      [resolvedSupplier] = createdSuppliers;
    }
  }

  if (!resolvedSupplier) {
    resolvedSupplier = await Supplier.findOne({ name: DEFAULT_SUPPLIER_NAME }).session(session);

    if (!resolvedSupplier) {
      const createdSuppliers = await Supplier.create(
        [
          {
            name: DEFAULT_SUPPLIER_NAME,
            phone: null,
            address: "",
            note: "Auto-created default supplier for purchases without supplier data",
          },
        ],
        { session },
      );
      [resolvedSupplier] = createdSuppliers;
    }
  }

  return resolvedSupplier;
};

const processPurchaseItems = async ({ items, warehouseId, session }) => {
  let totalAmount = 0;
  const processedItems = [];

  for (const item of items) {
    let {
      productId,
      name,
      model,
      categoryId,
      categoryName,
      category,
      barcode,
      baseUnit,
      hasPackage,
      packageQuantity,
      purchasePrice,
      blockPurchasePrice,
      sellPrice,
      sellPriceStrategy,
      wholesalePrice,
      miniSellPrice,
      minStockQuantity,
      reorderQuantity,
      blockSellPrice,
      inputType,
    } = item;
    const inputQuantity = toNumberOrNaN(item?.inputQuantity);
    const normalizedPackageQuantity = toNumberOrNaN(packageQuantity);
    const normalizedPurchasePrice = toNumberOrNaN(purchasePrice);
    const normalizedBlockPurchasePrice = toNumberOrNaN(blockPurchasePrice);
    const normalizedSellPrice = toNumberOrNaN(sellPrice);
    const normalizedWholesalePrice = toNumberOrNaN(wholesalePrice);
    const normalizedMiniSellPrice = toNumberOrNaN(miniSellPrice);
    const normalizedMinStockQuantity = toNumberOrNaN(minStockQuantity);
    const normalizedReorderQuantity = toNumberOrNaN(reorderQuantity);
    const normalizedBlockSellPrice = toNumberOrNaN(blockSellPrice);
    const normalizedBaseUnit =
      item.baseUnit === undefined ? null : String(baseUnit || "").trim().toLowerCase();

    if (
      normalizedBaseUnit !== null &&
      !["dona", "kg", "litr"].includes(normalizedBaseUnit)
    ) {
      throw new Error("Invalid baseUnit. Use 'dona', 'kg' or 'litr'");
    }

    let resolvedCategoryId = null;
    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid categoryId");
      }
      const categoryExists = await Category.findById(categoryId).session(session);
      if (!categoryExists) {
        throw new Error("Category not found");
      }
      resolvedCategoryId = categoryExists._id;
    } else {
      const incomingCategoryName = (category?.name || categoryName || "").trim();
      if (incomingCategoryName) {
        let foundCategory = await Category.findOne({ name: incomingCategoryName }).session(session);

        if (!foundCategory) {
          const createdCategories = await Category.create(
            [
              {
                name: incomingCategoryName,
                description: category?.description || "",
              },
            ],
            { session },
          );
          [foundCategory] = createdCategories;
        }

        resolvedCategoryId = foundCategory._id;
      }
    }

    if (!["unit", "block"].includes(inputType)) {
      throw new Error("Invalid inputType. Use 'unit' or 'block'");
    }

    if (!Number.isFinite(inputQuantity) || inputQuantity <= 0) {
      throw new Error("inputQuantity must be a positive number");
    }

    let product;

    if (productId) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        throw new Error("Invalid productId");
      }
      product = await Product.findById(productId).session(session);
    }

    if (!product && barcode) {
      product = await Product.findOne({ barcode }).session(session);
    }

    if (!product) {
      if (!name || !sellPrice) {
        throw new Error("New product requires at least name and sellPrice");
      }

      hasPackage = toBoolean(hasPackage);
      if (
        hasPackage &&
        (!Number.isFinite(normalizedPackageQuantity) || normalizedPackageQuantity <= 0)
      ) {
        throw new Error("packageQuantity must be positive when hasPackage=true");
      }

      if (hasPackage && normalizedBlockPurchasePrice > 0) {
        purchasePrice = normalizedBlockPurchasePrice / normalizedPackageQuantity;
      } else {
        purchasePrice = normalizedPurchasePrice;
      }

      if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
        throw new Error("purchasePrice must be a positive number");
      }

      const createdProducts = await Product.create(
        [
          {
            name,
            model,
            categoryId: resolvedCategoryId,
            barcode,
            baseUnit: normalizedBaseUnit || "dona",
            hasPackage,
            packageQuantity: hasPackage ? normalizedPackageQuantity : null,
            purchasePrice,
            blockPurchasePrice:
              hasPackage && normalizedBlockPurchasePrice > 0 ? normalizedBlockPurchasePrice : null,
            sellPrice: normalizedSellPrice,
            wholesalePrice:
              Number.isFinite(normalizedWholesalePrice) && normalizedWholesalePrice > 0
                ? normalizedWholesalePrice
                : null,
            miniSellPrice:
              Number.isFinite(normalizedMiniSellPrice) && normalizedMiniSellPrice > 0
                ? normalizedMiniSellPrice
                : null,
            minStockQuantity:
              Number.isFinite(normalizedMinStockQuantity) && normalizedMinStockQuantity >= 0
                ? normalizedMinStockQuantity
                : null,
            reorderQuantity:
              Number.isFinite(normalizedReorderQuantity) && normalizedReorderQuantity > 0
                ? normalizedReorderQuantity
                : null,
            blockSellPrice:
              Number.isFinite(normalizedBlockSellPrice) && normalizedBlockSellPrice > 0
                ? normalizedBlockSellPrice
                : null,
          },
        ],
        { session },
      );
      [product] = createdProducts;
    }

    if (item.name !== undefined) {
      const normalizedName = String(name || "").trim();
      if (!normalizedName) {
        throw new Error("Product name is required");
      }
      product.name = normalizedName;
    }

    if (item.model !== undefined) {
      product.model = model == null ? "" : String(model).trim();
    }

    if (item.barcode !== undefined) {
      const normalizedBarcode = String(barcode || "").trim();
      if (normalizedBarcode) {
        product.barcode = normalizedBarcode;
      }
    }

    if (item.baseUnit !== undefined) {
      product.baseUnit = normalizedBaseUnit;
    }

    if (item.hasPackage !== undefined) {
      product.hasPackage = toBoolean(hasPackage);
    }

    if (product.hasPackage) {
      const nextPackageQuantity = Number.isFinite(normalizedPackageQuantity)
        ? normalizedPackageQuantity
        : Number(product.packageQuantity);
      if (!Number.isFinite(nextPackageQuantity) || nextPackageQuantity <= 0) {
        throw new Error("packageQuantity must be positive when hasPackage=true");
      }
      product.packageQuantity = nextPackageQuantity;
    } else {
      product.packageQuantity = null;
      product.blockPurchasePrice = null;
      product.blockSellPrice = null;
    }

    if (resolvedCategoryId) {
      product.categoryId = resolvedCategoryId;
    }

    let quantity = 0;

    if (inputType === "block") {
      if (!product.hasPackage || !product.packageQuantity) {
        throw new Error("This product does not support block purchase");
      }
      quantity = inputQuantity * product.packageQuantity;
    }

    if (inputType === "unit") {
      quantity = inputQuantity;
    }

    const currentStock = await Stock.findOne({
      productId: product._id,
      warehouseId,
    }).session(session);
    const previousQuantity = currentStock ? currentStock.quantity : 0;

    const strategy = sellPriceStrategy || "old";
    if (!["old", "new", "average"].includes(strategy)) {
      throw new Error("Invalid sellPriceStrategy. Use 'old', 'new' or 'average'");
    }

    if (!product.isNew) {
      const hasIncomingSellPrice =
        Number.isFinite(normalizedSellPrice) && normalizedSellPrice > 0;

      if (strategy !== "old" && !hasIncomingSellPrice) {
        throw new Error("sellPrice must be a positive number when strategy is new/average");
      }

      if (hasIncomingSellPrice) {
        if (strategy === "average" && previousQuantity > 0) {
          const weightedSellPrice =
            (product.sellPrice * previousQuantity + normalizedSellPrice * quantity) /
            (previousQuantity + quantity);
          product.sellPrice = Number(weightedSellPrice.toFixed(2));
        } else {
          product.sellPrice = normalizedSellPrice;
        }
      }
    }

    if (Number.isFinite(normalizedWholesalePrice) && normalizedWholesalePrice > 0) {
      product.wholesalePrice = normalizedWholesalePrice;
    }
    if (Number.isFinite(normalizedMiniSellPrice) && normalizedMiniSellPrice > 0) {
      product.miniSellPrice = normalizedMiniSellPrice;
    }
    if (Number.isFinite(normalizedMinStockQuantity) && normalizedMinStockQuantity >= 0) {
      product.minStockQuantity = normalizedMinStockQuantity;
    }
    if (Number.isFinite(normalizedReorderQuantity) && normalizedReorderQuantity > 0) {
      product.reorderQuantity = normalizedReorderQuantity;
    }
    if (Number.isFinite(normalizedBlockSellPrice) && normalizedBlockSellPrice > 0) {
      product.blockSellPrice = normalizedBlockSellPrice;
    }

    let unitPurchasePrice = Number(purchasePrice);
    if (!Number.isFinite(unitPurchasePrice) || unitPurchasePrice <= 0) {
      const blockPrice = normalizedBlockPurchasePrice;
      if (
        Number.isFinite(blockPrice) &&
        blockPrice > 0 &&
        product.hasPackage &&
        product.packageQuantity > 0
      ) {
        unitPurchasePrice = blockPrice / product.packageQuantity;
      } else {
        unitPurchasePrice = product.purchasePrice;
      }
    }

    if (!Number.isFinite(unitPurchasePrice) || unitPurchasePrice <= 0) {
      throw new Error("Valid purchase price is required");
    }

    product.purchasePrice = Number(unitPurchasePrice.toFixed(2));
    if (product.hasPackage && product.packageQuantity > 0) {
      if (Number.isFinite(normalizedBlockPurchasePrice) && normalizedBlockPurchasePrice > 0) {
        product.blockPurchasePrice = Number(normalizedBlockPurchasePrice.toFixed(2));
      } else {
        product.blockPurchasePrice = Number(
          (product.purchasePrice * product.packageQuantity).toFixed(2),
        );
      }
    }
    await product.save({ session });

    const total = quantity * unitPurchasePrice;
    totalAmount += total;

        await Stock.findOneAndUpdate(
          {
            productId: product._id,
            warehouseId,
          },
          {
            $inc: { quantity },
            $set: {
              sellPrice: Number(product.sellPrice || 0),
              wholesalePrice:
                product.wholesalePrice !== undefined && product.wholesalePrice !== null
                  ? Number(product.wholesalePrice)
                  : null,
              miniSellPrice:
                product.miniSellPrice !== undefined && product.miniSellPrice !== null
                  ? Number(product.miniSellPrice)
                  : null,
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        session,
      },
    );

    processedItems.push({
      productId: product._id,
      inputType,
      inputQuantity,
      packageQuantity: product.packageQuantity || null,
      quantity,
      unitPurchasePrice,
      total,
    });
  }

  return {
    processedItems,
    totalAmount: Number(totalAmount.toFixed(2)),
  };
};

exports.createPurchase = async (req, res) => {
  const session = undefined;

  try {
    const { warehouseId, items, supplierId, supplier, paymentType, paidAmount } = req.body;

    ensureWarehouseAccess(req.user, warehouseId);

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(warehouseId).lean();
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    const normalizedPaymentType = paymentType || "cash";
    if (!["cash", "credit"].includes(normalizedPaymentType)) {
      return res.status(400).json({ message: "Invalid paymentType. Use 'cash' or 'credit'" });
    }

    let purchaseDoc;

    {
      const resolvedSupplier = await resolveSupplierForPurchase({ supplierId, supplier, session });
      const { processedItems, totalAmount } = await processPurchaseItems({
        items,
        warehouseId,
        session,
      });

      let normalizedPaidAmount = Number(paidAmount);

      if (!Number.isFinite(normalizedPaidAmount)) {
        normalizedPaidAmount = normalizedPaymentType === "cash" ? totalAmount : 0;
      }

      if (normalizedPaidAmount < 0) {
        throw new Error("paidAmount cannot be negative");
      }

      if (normalizedPaidAmount > totalAmount) {
        throw new Error("paidAmount cannot be greater than totalAmount");
      }

      if (normalizedPaymentType === "cash") {
        normalizedPaidAmount = totalAmount;
      }

      const dueAmount = Number((totalAmount - normalizedPaidAmount).toFixed(2));

      const purchases = await Purchase.create(
        [
          {
            warehouseId,
            supplierId: resolvedSupplier._id,
            items: processedItems,
            totalAmount,
            paymentType: normalizedPaymentType,
            paidAmount: Number(normalizedPaidAmount.toFixed(2)),
            dueAmount,
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [purchaseDoc] = purchases;
    }

    res.status(201).json({
      message: "Purchase created successfully",
      purchase: purchaseDoc,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("must") ||
      error.message.includes("cannot")
    ) {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        message: "Duplicate key error. Product barcode or supplier phone must be unique",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.getPurchases = async (req, res) => {
  try {
    const { supplierId, warehouseId, paymentType, from, to } = req.query;
    const searchText = String(req.query.q || req.query.search || "").trim();
    const query = {};

    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ message: "Invalid supplierId query" });
      }
      query.supplierId = supplierId;
    }

    if (warehouseId) {
      ensureWarehouseAccess(req.user, warehouseId);
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = warehouseId;
    }

    if (paymentType) {
      if (!["cash", "credit"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid paymentType query" });
      }
      query.paymentType = paymentType;
    }

    if (from || to) {
      query.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "Invalid from date" });
        }
        query.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "Invalid to date" });
        }
        query.createdAt.$lte = toDate;
      }
    }

    if (searchText) {
      const searchRegex = new RegExp(escapeRegex(searchText), "i");
      const [matchedSuppliers, matchedProducts] = await Promise.all([
        Supplier.find({
          $or: [{ name: searchRegex }, { phone: searchRegex }, { address: searchRegex }],
        })
          .select("_id")
          .lean(),
        Product.find({
          $or: [{ name: searchRegex }, { model: searchRegex }, { barcode: searchRegex }],
        })
          .select("_id")
          .lean(),
      ]);

      const supplierIds = matchedSuppliers.map((row) => row._id);
      const productIds = matchedProducts.map((row) => row._id);

      if (supplierIds.length === 0 && productIds.length === 0) {
        if (
          req.query.page !== undefined ||
          req.query.skip !== undefined ||
          req.query.paginated === "true"
        ) {
          const normalizedLimit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
          const normalizedPage = Math.max(Number(req.query.page) || 1, 1);
          return res.json({
            items: [],
            total: 0,
            page: normalizedPage,
            limit: normalizedLimit,
            pages: 0,
            hasMore: false,
          });
        }

        return res.json([]);
      }

      query.$or = [];
      if (supplierIds.length > 0) {
        query.$or.push({ supplierId: { $in: supplierIds } });
      }
      if (productIds.length > 0) {
        query.$or.push({ "items.productId": { $in: productIds } });
      }
    }

    const scoped = applyWarehouseScope(req.user, query);
    const { paginateQuery } = require("../utils/pagination");
    const result = await paginateQuery({
      Model: Purchase,
      filter: scoped,
      queryParams: req.query,
      defaultSort: { createdAt: -1, _id: -1 },
      populate: (q) =>
        q
          .populate("supplierId", "name phone")
          .populate("warehouseId", "name")
          .populate("createdBy", "fullName role")
          .populate("items.productId", PURCHASE_PRODUCT_SELECT),
    });

    if (req.query.page === undefined && req.query.skip === undefined && req.query.paginated !== "true") {
      return res.json(result.items);
    }

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

exports.getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    const purchase = await Purchase.findById(id)
      .populate("supplierId", "name phone address")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", PURCHASE_PRODUCT_SELECT);

    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    ensureWarehouseAccess(req.user, purchase.warehouseId);

    res.json(purchase);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updatePurchase = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    const { supplierId, supplier, paymentType, paidAmount, items } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    const purchase = await Purchase.findById(id);
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    ensureWarehouseAccess(req.user, purchase.warehouseId);

    if (supplierId !== undefined || supplier !== undefined) {
      const resolvedSupplier = await resolveSupplierForPurchase({ supplierId, supplier, session });
      purchase.supplierId = resolvedSupplier._id;
    }

    if (paymentType !== undefined) {
      if (!["cash", "credit"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid paymentType. Use 'cash' or 'credit'" });
      }
      purchase.paymentType = paymentType;
    }

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items required" });
      }

      for (const item of purchase.items) {
        const stock = await Stock.findOne({
          productId: item.productId,
          warehouseId: purchase.warehouseId,
        }).session(session);

        if (!stock || stock.quantity < item.quantity) {
          return res.status(400).json({
            message: "Cannot update purchase. Some quantity already sold/moved",
          });
        }
      }

      for (const item of purchase.items) {
        await Stock.findOneAndUpdate(
          {
            productId: item.productId,
            warehouseId: purchase.warehouseId,
          },
          {
            $inc: { quantity: -item.quantity },
          },
          { session },
        );
      }

      const { processedItems, totalAmount } = await processPurchaseItems({
        items,
        warehouseId: purchase.warehouseId,
        session,
      });

      purchase.items = processedItems;
      purchase.totalAmount = totalAmount;
    }

    let normalizedPaidAmount =
      paidAmount !== undefined ? Number(paidAmount) : Number(purchase.paidAmount);
    if (!Number.isFinite(normalizedPaidAmount) || normalizedPaidAmount < 0) {
      return res.status(400).json({ message: "paidAmount must be a non-negative number" });
    }

    if (purchase.paymentType === "cash") {
      normalizedPaidAmount = purchase.totalAmount;
    }

    if (normalizedPaidAmount > purchase.totalAmount) {
      return res.status(400).json({ message: "paidAmount cannot be greater than totalAmount" });
    }

    purchase.paidAmount = Number(normalizedPaidAmount.toFixed(2));
    purchase.dueAmount = Number((purchase.totalAmount - purchase.paidAmount).toFixed(2));

    await purchase.save();

    const updated = await Purchase.findById(purchase._id)
      .populate("supplierId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", PURCHASE_PRODUCT_SELECT);

    const affectedProductIds = updated.items.map((item) => item.productId?._id || item.productId).filter(Boolean);
    const affectedStocks = await Stock.find({
      warehouseId: purchase.warehouseId,
      productId: { $in: affectedProductIds },
    }).select("productId quantity sellPrice wholesalePrice miniSellPrice");

    res.json({
      message: "Purchase updated successfully",
      purchase: updated,
      refresh: {
        warehouseId: purchase.warehouseId,
        affectedStocks,
      },
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("must") ||
      error.message.includes("cannot")
    ) {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: "Product barcode must be unique" });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.deletePurchase = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid purchase ID" });
    }

    {
      const purchase = await Purchase.findById(id).session(session);
      if (!purchase) {
        throw new Error("Purchase not found");
      }
      ensureWarehouseAccess(req.user, purchase.warehouseId);

      for (const item of purchase.items) {
        const stock = await Stock.findOne({
          productId: item.productId,
          warehouseId: purchase.warehouseId,
        }).session(session);

        if (!stock) {
          throw new Error("Stock not found for one of purchase items");
        }

        if (stock.quantity < item.quantity) {
          throw new Error("Cannot delete purchase. Some quantity already sold/moved");
        }
      }

      for (const item of purchase.items) {
        await Stock.findOneAndUpdate(
          {
            productId: item.productId,
            warehouseId: purchase.warehouseId,
          },
          {
            $inc: { quantity: -item.quantity },
          },
          { session },
        );
      }

      await Purchase.findByIdAndDelete(id).session(session);
    }

    res.json({ message: "Purchase deleted successfully" });
  } catch (error) {
    if (error.message === "Purchase not found") {
      return res.status(404).json({ message: error.message });
    }

    if (
      error.message.includes("Cannot delete purchase") ||
      error.message.includes("Stock not found")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};
