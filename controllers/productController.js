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
    delete payload.categoryName;
    delete payload.category;

    const product = await Product.create(payload);

    res.status(201).json({
      message: "Product created successfully",
      product,
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
    const { categoryId } = req.query;
    const query = {};

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID query" });
      }
      query.categoryId = categoryId;
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate("categoryId", "name");

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 GET BY BARCODE (optional: warehouse stock)
exports.getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    const { warehouseId } = req.query;

    const normalizedBarcode = String(barcode || "").trim();
    if (!normalizedBarcode) {
      return res.status(400).json({ message: "barcode is required" });
    }

    const product = await Product.findOne({ barcode: normalizedBarcode })
      .populate("categoryId", "name")
      .lean();

    if (!product) {
      return res.status(404).json({ message: "Product not found by barcode" });
    }

    if (warehouseId) {
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
        product,
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

    const stocks = await Stock.find({ productId: product._id })
      .populate("warehouseId", "name")
      .lean();

    const totalQuantity = stocks.reduce((sum, s) => sum + Number(s.quantity || 0), 0);

    res.json({
      product,
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
      product,
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
