const Product = require("../models/Product");
const mongoose = require("mongoose");
const Category = require("../models/Category");

// 🔹 CREATE
exports.createProduct = async (req, res) => {
  try {
    const { categoryId } = req.body;

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const categoryExists = await Category.exists({ _id: categoryId });
      if (!categoryExists) {
        return res.status(404).json({ message: "Category not found" });
      }
    }

    const product = await Product.create(req.body);

    res.status(201).json({
      message: "Product created successfully",
      product,
    });
  } catch (error) {
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

// 🔹 UPDATE
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId } = req.body;

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }
      const categoryExists = await Category.exists({ _id: categoryId });
      if (!categoryExists) {
        return res.status(404).json({ message: "Category not found" });
      }
    }

    const product = await Product.findByIdAndUpdate(id, req.body, {
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
    res.status(500).json({ message: error.message });
  }
};

// 🔹 DELETE
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
