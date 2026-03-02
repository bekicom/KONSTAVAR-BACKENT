const mongoose = require("mongoose");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");
const Product = require("../models/Product");
const Shop = require("../models/Shop");
const ShopTransfer = require("../models/ShopTransfer");

exports.createShop = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { name, address } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    if (!address || !String(address).trim()) {
      return res.status(400).json({ message: "address is required" });
    }

    let shopDoc;

    await session.withTransaction(async () => {
      const warehouseName = `${String(name).trim()} - Shop Warehouse`;
      const warehouse = await Warehouse.create(
        [
          {
            name: warehouseName,
            address: String(address).trim(),
          },
        ],
        { session },
      );

      const [createdWarehouse] = warehouse;
      const createdShops = await Shop.create(
        [
          {
            name: String(name).trim(),
            address: String(address).trim(),
            warehouseId: createdWarehouse._id,
          },
        ],
        { session },
      );

      [shopDoc] = createdShops;
    });

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
  } finally {
    await session.endSession();
  }
};

exports.getShops = async (req, res) => {
  try {
    const shops = await Shop.find()
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

    const shop = await Shop.findById(id).populate("warehouseId", "name address isActive");
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
    return res.status(500).json({ message: error.message });
  }
};

exports.deleteShop = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shop ID" });
    }

    await session.withTransaction(async () => {
      const shop = await Shop.findById(id).session(session);
      if (!shop) {
        throw new Error("Shop not found");
      }

      const positiveStockCount = await Stock.countDocuments({
        warehouseId: shop.warehouseId,
        quantity: { $gt: 0 },
      }).session(session);

      if (positiveStockCount > 0) {
        throw new Error("Cannot delete shop. Shop warehouse still has stock");
      }

      await ShopTransfer.deleteMany({ shopId: shop._id }).session(session);
      await Shop.deleteOne({ _id: shop._id }).session(session);
      await Warehouse.deleteOne({ _id: shop.warehouseId }).session(session);
      await Stock.deleteMany({ warehouseId: shop.warehouseId }).session(session);
    });

    return res.json({ message: "Shop deleted successfully" });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }
    if (error.message.includes("Cannot delete shop")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.transferToShop = async (req, res) => {
  const session = await mongoose.startSession();

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

    await session.withTransaction(async () => {
      const shop = await Shop.findById(shopId).session(session);
      if (!shop) {
        throw new Error("Shop not found");
      }
      if (!shop.isActive) {
        throw new Error("Shop is not active");
      }

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

        const productExists = await Product.exists({ _id: productId }).session(session);
        if (!productExists) {
          throw new Error("Product not found in items");
        }

        const key = String(productId);
        merged.set(key, Number(((merged.get(key) || 0) + quantity).toFixed(6)));
      }

      for (const [productId, requiredQty] of merged.entries()) {
        const sourceStock = await Stock.findOne({
          productId,
          warehouseId: sourceWarehouseId,
        }).session(session);

        if (!sourceStock || Number(sourceStock.quantity) < requiredQty) {
          throw new Error("Insufficient stock in source warehouse");
        }
      }

      const transferItems = [];
      for (const [productId, requiredQty] of merged.entries()) {
        await Stock.findOneAndUpdate(
          { productId, warehouseId: sourceWarehouseId },
          { $inc: { quantity: -requiredQty } },
          { session },
        );

        await Stock.findOneAndUpdate(
          { productId, warehouseId: shop.warehouseId },
          { $inc: { quantity: requiredQty } },
          {
            upsert: true,
            setDefaultsOnInsert: true,
            session,
          },
        );

        transferItems.push({
          productId,
          quantity: requiredQty,
        });
      }

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
  } finally {
    await session.endSession();
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

    const transfers = await ShopTransfer.find(query)
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
