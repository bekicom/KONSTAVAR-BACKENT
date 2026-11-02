const mongoose = require("mongoose");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");
const Product = require("../models/Product");
const Shop = require("../models/Shop");
const ShopTransfer = require("../models/ShopTransfer");
const ShopQuickProduct = require("../models/ShopQuickProduct");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Purchase = require("../models/Purchase");
const SupplierReturn = require("../models/SupplierReturn");
const ClientPayment = require("../models/ClientPayment");
const InventorySession = require("../models/InventorySession");
const Writeoff = require("../models/Writeoff");
const StockAdjustment = require("../models/StockAdjustment");
const Shift = require("../models/Shift");
const Expense = require("../models/Expense");
const User = require("../models/User");
const { verifyDeletionCodeFromRequest } = require("../utils/deletionCodeGuard");
const { withTransaction } = require("../utils/withTransaction");
const {
  applyWarehouseScope,
  applyWarehouseScopeAny,
  ensureWarehouseAccess,
} = require("../utils/userAccess");

exports.createShop = async (req, res) => {
  try {
    const { name, address } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    if (!address || !String(address).trim()) {
      return res.status(400).json({ message: "address is required" });
    }

    const warehouseName = `${String(name).trim()} - Shop Warehouse`;
    const [createdWarehouse] = await Warehouse.create([
      {
        name: warehouseName,
        address: String(address).trim(),
      },
    ]);

    let shopDoc;

    try {
      [shopDoc] = await Shop.create([
        {
          name: String(name).trim(),
          address: String(address).trim(),
          warehouseId: createdWarehouse._id,
        },
      ]);
    } catch (shopError) {
      await Warehouse.deleteOne({ _id: createdWarehouse._id });
      throw shopError;
    }

    const populatedShop = await Shop.findById(shopDoc._id).populate("warehouseId", "name address");

    return res.status(201).json({
      message: "Shop created successfully",
      shop: populatedShop,
    });
  } catch (error) {
    if (error.message.includes("required") || error.message.includes("already exists")) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getShops = async (req, res) => {
  try {
    // Do'konga yoki omborga biriktirilgan foydalanuvchi faqat o'ziga
    // tegishli do'konlarni ko'radi.
    const shops = await Shop.find(applyWarehouseScope(req.user, {}, "warehouseId"))
      .sort({ createdAt: -1 })
      .populate("warehouseId", "name address isActive");
    return res.json(shops);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getShopById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shop ID" });
    }

    const shop = await Shop.findOne(applyWarehouseScope(req.user, { _id: id }, "warehouseId")).populate(
      "warehouseId",
      "name address isActive",
    );
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    return res.json(shop);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateShop = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shop ID" });
    }

    const shop = await Shop.findById(id);

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    ensureWarehouseAccess(req.user, shop.warehouseId);

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "name cannot be empty" });
      }
      shop.name = String(name).trim();
    }

    if (address !== undefined) {
      if (!String(address).trim()) {
        return res.status(400).json({ message: "address cannot be empty" });
      }
      shop.address = String(address).trim();
    }

    if (isActive !== undefined) {
      shop.isActive = Boolean(isActive);
    }

    await shop.save();

    if (name !== undefined || address !== undefined) {
      await Warehouse.findByIdAndUpdate(
        shop.warehouseId,
        {
          name: `${shop.name} - Shop Warehouse`,
          address: shop.address,
        },
        { new: true },
      );
    }

    const populatedShop = await Shop.findById(shop._id).populate(
      "warehouseId",
      "name address isActive",
    );

    return res.json({
      message: "Shop updated successfully",
      shop: populatedShop,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteShop = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shop ID" });
    }

    const codeCheck = await verifyDeletionCodeFromRequest(req);
    if (!codeCheck.ok) {
      return res
        .status(codeCheck.status)
        .json({ message: codeCheck.message, code: codeCheck.reason });
    }

    {
      const shop = await Shop.findById(id).session(session);
      if (!shop) {
        throw new Error("Shop not found");
      }
      ensureWarehouseAccess(req.user, shop.warehouseId);
      const warehouseId = shop.warehouseId;
      const saleDocs = await Sale.find({ warehouseId }).select("clientId").lean();
      const saleIds = saleDocs.map((row) => row._id);
      const shiftDocs = await Shift.find({ $or: [{ shopId: shop._id }, { warehouseId }] }).select("_id").lean();
      const shiftIds = shiftDocs.map((row) => row._id);

      await ShopTransfer.deleteMany({ $or: [{ shopId: shop._id }, { destinationWarehouseId: warehouseId }] }).session(session);
      await ShopQuickProduct.deleteMany({ shopId: shop._id }).session(session);
      await SaleReturn.deleteMany({ warehouseId }).session(session);
      if (saleIds.length > 0) {
        await SaleReturn.deleteMany({ saleId: { $in: saleIds } }).session(session);
      }
      await Sale.deleteMany({ warehouseId }).session(session);
      await SupplierReturn.deleteMany({ warehouseId }).session(session);
      await ClientPayment.deleteMany({ warehouseId }).session(session);
      await InventorySession.deleteMany({ warehouseId }).session(session);
      await Writeoff.deleteMany({ warehouseId }).session(session);
      await StockAdjustment.deleteMany({ warehouseId }).session(session);
      if (shiftIds.length > 0) {
        await Expense.deleteMany({ shiftId: { $in: shiftIds } }).session(session);
      }
      await Shift.deleteMany({ $or: [{ shopId: shop._id }, { warehouseId }] }).session(session);
      await Purchase.deleteMany({ warehouseId }).session(session);
      await Stock.deleteMany({ warehouseId }).session(session);
      await User.updateMany({ shopId: shop._id }, { $set: { shopId: null } }).session(session);
      await Shop.deleteOne({ _id: shop._id }).session(session);
      await Warehouse.deleteOne({ _id: warehouseId }).session(session);
    }

    return res.json({ message: "Shop deleted successfully" });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }
    if (error.message.includes("Cannot delete shop")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.transferToShop = async (req, res) => {
  try {
    const { id: shopId } = req.params;
    const { sourceWarehouseId, items, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(shopId)) {
      return res.status(400).json({ message: "Invalid shop ID" });
    }

    if (!mongoose.Types.ObjectId.isValid(sourceWarehouseId)) {
      return res.status(400).json({ message: "Invalid sourceWarehouseId" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items required" });
    }

    let transferDoc;

    // Qoldiq ayirish va qo'shish bitta tranzaksiyada bo'lishi kerak — aks
    // holda o'rtada xato chiqsa mahsulot manba ombordan chiqib, do'konga
    // kirmay qoladi.
    await withTransaction(async (session) => {
      const shop = await Shop.findById(shopId).session(session);
      if (!shop) {
        throw new Error("Shop not found");
      }
      if (!shop.isActive) {
        throw new Error("Shop is not active");
      }

      // Mahsulot qabul qiluvchi do'kon foydalanuvchiga tegishli bo'lishi
      // kerak. Manba ombor markaziy ombor bo'lishi mumkin, shuning uchun
      // u cheklanmaydi.
      ensureWarehouseAccess(req.user, shop.warehouseId);

      if (String(sourceWarehouseId) === String(shop.warehouseId)) {
        throw new Error("sourceWarehouseId cannot be shop warehouse");
      }

      const sourceWarehouse = await Warehouse.findById(sourceWarehouseId).session(session);
      if (!sourceWarehouse) {
        throw new Error("Source warehouse not found");
      }

      const destinationWarehouse = await Warehouse.findById(shop.warehouseId).session(session);
      if (!destinationWarehouse) {
        throw new Error("Shop warehouse not found");
      }

      const merged = new Map();

      for (const item of items) {
        const productId = item?.productId;
        const quantity = Number(item?.quantity);

        if (!mongoose.Types.ObjectId.isValid(productId)) {
          throw new Error("Invalid productId in items");
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("quantity must be a positive number");
        }

        const key = String(productId);
        merged.set(key, Number(((merged.get(key) || 0) + quantity).toFixed(6)));
      }

      // Har bir qator uchun alohida so'rov o'rniga bitta `$in`.
      const productIds = [...merged.keys()].map((id) => new mongoose.Types.ObjectId(id));
      const existingCount = await Product.countDocuments({ _id: { $in: productIds } }).session(
        session,
      );
      if (existingCount !== productIds.length) {
        throw new Error("Product not found in items");
      }

      // Avval qoldiqni o'qib tekshiramiz (xato xabari aniq chiqishi uchun).
      const sourceRows = await Stock.find({
        productId: { $in: productIds },
        warehouseId: sourceWarehouseId,
      })
        .session(session)
        .select("productId quantity")
        .lean();
      const sourceByProduct = new Map(sourceRows.map((row) => [String(row.productId), row]));

      for (const [productId, requiredQty] of merged.entries()) {
        const current = sourceByProduct.get(String(productId));
        if (!current || Number(current.quantity) < requiredQty) {
          const err = new Error(
            current
              ? `Insufficient stock in source warehouse (available ${Number(current.quantity)}, requested ${requiredQty})`
              : "Insufficient stock in source warehouse",
          );
          err.statusCode = 409;
          throw err;
        }
      }

      const transferItems = [...merged.entries()].map(([productId, quantity]) => ({
        productId,
        quantity,
      }));

      // Ayirishda `quantity: { $gte }` sharti saqlanadi — ikki transfer bir
      // vaqtda ketsa ham qoldiq manfiyga tushmaydi, tranzaksiya bekor bo'ladi.
      const decrementOps = transferItems.map(({ productId, quantity }) => ({
        updateOne: {
          filter: {
            productId: new mongoose.Types.ObjectId(productId),
            warehouseId: new mongoose.Types.ObjectId(String(sourceWarehouseId)),
            quantity: { $gte: quantity },
          },
          update: { $inc: { quantity: -quantity } },
        },
      }));

      const decrementResult = await Stock.bulkWrite(decrementOps, { session, ordered: false });
      if (decrementResult.matchedCount !== decrementOps.length) {
        const err = new Error(
          "Insufficient stock in source warehouse (concurrent update), please retry",
        );
        err.statusCode = 409;
        throw err;
      }

      const incrementOps = transferItems.map(({ productId, quantity }) => ({
        updateOne: {
          filter: {
            productId: new mongoose.Types.ObjectId(productId),
            warehouseId: new mongoose.Types.ObjectId(String(shop.warehouseId)),
          },
          update: { $inc: { quantity } },
          upsert: true,
        },
      }));

      await Stock.bulkWrite(incrementOps, { session, ordered: false });

      const transfers = await ShopTransfer.create(
        [
          {
            sourceWarehouseId,
            shopId: shop._id,
            destinationWarehouseId: shop.warehouseId,
            items: transferItems,
            note: note || "",
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [transferDoc] = transfers;
    });

    const populatedTransfer = await ShopTransfer.findById(transferDoc._id)
      .populate("sourceWarehouseId", "name")
      .populate("destinationWarehouseId", "name")
      .populate("shopId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode baseUnit");

    return res.status(201).json({
      message: "Products transferred to shop warehouse successfully",
      transfer: populatedTransfer,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("not found") ||
      error.message.includes("Insufficient") ||
      error.message.includes("cannot") ||
      error.message.includes("active")
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getShopTransfers = async (req, res) => {
  try {
    const { sourceWarehouseId, shopId, from, to, limit } = req.query;
    const query = {};

    if (sourceWarehouseId) {
      if (!mongoose.Types.ObjectId.isValid(sourceWarehouseId)) {
        return res.status(400).json({ message: "Invalid sourceWarehouseId query" });
      }
      query.sourceWarehouseId = sourceWarehouseId;
    }

    if (shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: "Invalid shopId query" });
      }
      query.shopId = shopId;
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

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 1000);

    // Cheklangan foydalanuvchi faqat o'z ombori chiqargan yoki o'z omboriga
    // kelgan biriktirishlarni ko'radi.
    const scopedQuery = applyWarehouseScopeAny(req.user, query, [
      "sourceWarehouseId",
      "destinationWarehouseId",
    ]);

    const transfers = await ShopTransfer.find(scopedQuery)
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("sourceWarehouseId", "name")
      .populate("destinationWarehouseId", "name")
      .populate("shopId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode baseUnit");

    return res.json(transfers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
