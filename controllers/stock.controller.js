const mongoose = require("mongoose");
const Stock = require("../models/Stock");
const Warehouse = require("../models/Warehouse");
const Product = require("../models/Product");

exports.createStock = async (req, res) => {
  try {
    const { productId, warehouseId, quantity } = req.body;
    const normalizedQuantity = Number(quantity);

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

    const stock = await Stock.create({ productId, warehouseId, quantity: normalizedQuantity });
    res.status(201).json({ message: "Stock created successfully", stock });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getStocks = async (req, res) => {
  try {
    const stocks = await Stock.find()
      .sort({ createdAt: -1 })
      .populate(
        "productId",
        "name model barcode baseUnit sellPrice wholesalePrice miniSellPrice minStockQuantity reorderQuantity",
      )
      .populate("warehouseId", "name");

    const normalized = stocks.map((stock) => {
      const product = stock.productId || {};
      const quantity = Number(stock.quantity || 0);
      const minStockQuantity = Number(product.minStockQuantity);
      return {
        ...stock.toObject(),
        isLowStock:
          Number.isFinite(minStockQuantity) && minStockQuantity >= 0
            ? quantity <= minStockQuantity
            : false,
        lowStockThreshold: Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
      };
    });

    res.json(normalized);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    const product = stock.productId || {};
    const quantity = Number(stock.quantity || 0);
    const minStockQuantity = Number(product.minStockQuantity);
    res.json({
      ...stock.toObject(),
      isLowStock:
        Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? quantity <= minStockQuantity : false,
      lowStockThreshold: Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    const normalizedQuantity = Number(quantity);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid stock ID" });
    }

    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
      return res.status(400).json({ message: "quantity must be a non-negative number" });
    }

    const stock = await Stock.findByIdAndUpdate(
      id,
      { quantity: normalizedQuantity },
      { new: true, runValidators: true },
    )
      .populate("productId", "name model barcode baseUnit")
      .populate("warehouseId", "name");

    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    res.json({ message: "Stock updated successfully", stock });
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

    const stock = await Stock.findByIdAndDelete(id);
    if (!stock) {
      return res.status(404).json({ message: "Stock not found" });
    }

    res.json({ message: "Stock deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getWarehouseStock = async (req, res) => {
  try {
    const { warehouseId } = req.params;

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
        select: "name model barcode baseUnit categoryId minStockQuantity reorderQuantity",
        populate: {
          path: "categoryId",
          select: "name description isActive",
        },
      })
      .lean();

    return res.status(200).json({
      success: true,
      warehouse: {
        _id: warehouse._id,
        name: warehouse.name,
      },
      totalProducts: stocks.length,
      data: stocks.map((stock) => {
        const quantity = Number(stock.quantity || 0);
        const minStockQuantity = Number(stock.productId?.minStockQuantity);
        return {
          ...stock,
          isLowStock:
            Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? quantity <= minStockQuantity : false,
          lowStockThreshold: Number.isFinite(minStockQuantity) && minStockQuantity >= 0 ? minStockQuantity : null,
        };
      }),
    });
  } catch (error) {
    console.error("Get warehouse stock error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
