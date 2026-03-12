const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Product = require("../models/Product");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Shop = require("../models/Shop");
const ShopQuickProduct = require("../models/ShopQuickProduct");
const Client = require("../models/Client");

const round2 = (value) => Number(Number(value).toFixed(2));

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

exports.createSale = async (req, res) => {
  const session = await mongoose.startSession();

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
      note,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    const normalizedDiscount = Number(discount);
    if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
      return res.status(400).json({ message: "discount must be a non-negative number" });
    }

    let saleDoc;

    await session.withTransaction(async () => {
      const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId, session);
      await ensureWarehouseIsActiveShopWarehouse(warehouseId, session);
      const normalizedPaymentType = paymentType || "cash";

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
          if (inputType === "block" && Number(product.blockSellPrice) > 0 && product.packageQuantity > 0) {
            unitSellPrice = Number(product.blockSellPrice) / product.packageQuantity;
          } else {
            unitSellPrice = Number(product.sellPrice);
          }
        }

        if (!Number.isFinite(unitSellPrice) || unitSellPrice <= 0) {
          throw new Error("unitSellPrice must be a positive number");
        }

        unitSellPrice = round2(unitSellPrice);
        const lineTotal = round2(unitSellPrice * quantity);
        subtotal = round2(subtotal + lineTotal);

        processedItems.push({
          productId: product._id,
          inputType,
          inputQuantity,
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
        throw new Error("totalAmount must be greater than 0");
      }

      for (const [productId, requiredQty] of requiredByProduct.entries()) {
        const stock = await Stock.findOne({ productId, warehouseId }).session(session);
        if (!stock) {
          throw new Error("Stock not found for one of products in this warehouse");
        }
        if (Number(stock.quantity) < requiredQty) {
          throw new Error("Insufficient stock for one of products");
        }
      }

      for (const [productId, requiredQty] of requiredByProduct.entries()) {
        await Stock.findOneAndUpdate(
          { productId, warehouseId },
          { $inc: { quantity: -requiredQty } },
          { session },
        );
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
            clientId: resolvedClient ? resolvedClient._id : null,
            note,
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [saleDoc] = createdSales;
    });

    res.status(201).json({
      message: "Sale created successfully",
      sale: saleDoc,
    });
  } catch (error) {
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
  } finally {
    await session.endSession();
  }
};

exports.getSales = async (req, res) => {
  try {
    const { warehouseId, cashierId, paymentType, from, to, limit } = req.query;
    const query = {};

    if (req.user?.role === "cashier") {
      const resolvedWarehouseId = await resolveWarehouseForSale(req.user, null);
      query.warehouseId = resolvedWarehouseId;
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

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const sales = await Sale.find(query)
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("warehouseId", "name")
      .populate("clientId", "name phone")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    res.json(sales);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId);
    const { warehouse: shopWarehouse } = await ensureWarehouseIsActiveShopWarehouse(warehouseId);

    const product = await Product.findOne({ barcode: normalizedBarcode })
      .populate("categoryId", "name")
      .lean();

    if (!product) {
      return res.status(404).json({ message: "Product not found by barcode" });
    }

    const stock = await Stock.findOne({
      productId: product._id,
      warehouseId,
    }).lean();

    if (!stock) {
      return res.status(404).json({ message: "Product not found in shop warehouse" });
    }

    return res.json({
      product,
      warehouse: {
        _id: shopWarehouse._id,
        name: shopWarehouse.name,
      },
      stockQuantity: Number(stock.quantity || 0),
      canSell: Number(stock.quantity || 0) > 0,
    });
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

    const searchRegex = new RegExp(escapeRegex(queryText), "i");

    const stocks = await Stock.find({
      warehouseId,
      quantity: { $gt: 0 },
    })
      .populate({
        path: "productId",
        select:
          "name model barcode baseUnit hasPackage packageQuantity sellPrice wholesalePrice blockSellPrice isActive categoryId",
        match: {
          isActive: true,
          $or: [{ name: searchRegex }, { model: searchRegex }],
        },
        populate: {
          path: "categoryId",
          select: "name",
        },
      })
      .lean();

    const items = stocks
      .filter((s) => s.productId)
      .slice(0, normalizedLimit)
      .map((s) => ({
        product: s.productId,
        stockQuantity: Number(s.quantity || 0),
        canSell: Number(s.quantity || 0) > 0,
      }));

    return res.json({
      warehouse: {
        _id: shopWarehouse._id,
        name: shopWarehouse.name,
      },
      total: items.length,
      items,
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
        .select("name model barcode baseUnit sellPrice wholesalePrice blockSellPrice hasPackage packageQuantity")
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

    return res.json({
      warehouse: { _id: shopWarehouse._id, name: shopWarehouse.name },
      periodDays: normalizedDays,
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

    const stocks = await Stock.find({ warehouseId: shopWarehouse._id })
      .populate({
        path: "productId",
        select:
          "name model barcode baseUnit sellPrice wholesalePrice blockSellPrice hasPackage packageQuantity isActive",
        match: searchRegex
          ? {
              isActive: true,
              $or: [{ name: searchRegex }, { model: searchRegex }, { barcode: searchRegex }],
            }
          : { isActive: true },
      })
      .sort({ updatedAt: -1 })
      .lean();

    const items = stocks
      .filter((s) => s.productId)
      .slice(0, normalizedLimit)
      .map((s) => ({
        product: s.productId,
        stockQuantity: Number(s.quantity || 0),
        canSell: Number(s.quantity || 0) > 0,
      }));

    return res.json({
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

exports.setQuickSaleProducts = async (req, res) => {
  const session = await mongoose.startSession();

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

    await session.withTransaction(async () => {
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

      if (deduped.length > 0) {
        const existingStocks = await Stock.find({
          warehouseId,
          productId: { $in: deduped },
        })
          .select("productId")
          .session(session)
          .lean();
        if (existingStocks.length !== deduped.length) {
          throw new Error("Some productIds are not found in this warehouse stock");
        }
      }

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
    });

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
  } finally {
    await session.endSession();
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
        "name model barcode baseUnit sellPrice wholesalePrice blockSellPrice hasPackage packageQuantity isActive",
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
  const session = await mongoose.startSession();

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

    await session.withTransaction(async () => {
      const warehouseId = await resolveWarehouseForSale(req.user, requestedWarehouseId, session);
      await ensureWarehouseIsActiveShopWarehouse(warehouseId, session);

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
          },
        ],
        { session },
      );

      [returnDoc] = createdReturns;
    });

    const populated = await SaleReturn.findById(returnDoc._id)
      .populate("saleId", "createdAt paymentType totalAmount")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
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
  } finally {
    await session.endSession();
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
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid sale ID" });
    }

    await session.withTransaction(async () => {
      const sale = await Sale.findById(id).session(session);
      if (!sale) {
        throw new Error("Sale not found");
      }

      for (const item of sale.items) {
        await Stock.findOneAndUpdate(
          { productId: item.productId, warehouseId: sale.warehouseId },
          { $inc: { quantity: item.quantity } },
          { upsert: true, setDefaultsOnInsert: true, session },
        );
      }

      await Sale.findByIdAndDelete(id).session(session);
    });

    res.json({ message: "Sale deleted successfully" });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};
