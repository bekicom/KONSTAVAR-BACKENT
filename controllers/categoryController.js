const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");

exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const existing = await Category.findOne({ name: name.trim() });
    if (existing) {
      return res.status(409).json({ message: "Category already exists" });
    }

    const category = await Category.create({
      name: name.trim(),
      description,
    });

    res.status(201).json({
      message: "Category created successfully",
      category,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const { search, isActive } = req.query;
    const filter = {};
    if (isActive !== undefined) filter.isActive = String(isActive) === "true";
    if (search) {
      const s = String(search).trim();
      if (s) {
        const escape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escape(s), "i");
        filter.$or = [{ name: regex }, { description: regex }];
      }
    }

    const { paginateQuery } = require("../utils/pagination");
    const result = await paginateQuery({
      Model: Category,
      filter,
      queryParams: req.query,
      defaultSort: { createdAt: -1, _id: -1 },
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

exports.getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    if (name) {
      const existing = await Category.findOne({
        name: name.trim(),
        _id: { $ne: id },
      });
      if (existing) {
        return res.status(409).json({ message: "Category already exists" });
      }
    }

    const category = await Category.findByIdAndUpdate(
      id,
      {
        name: name?.trim(),
        description,
        isActive,
      },
      { new: true, runValidators: true },
    );

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return res.status(400).json({
        message: "Category has products. Reassign products before delete",
      });
    }

    await Category.findByIdAndDelete(id);
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
