const mongoose = require("mongoose");
const Writeoff = require("../models/Writeoff");
const Warehouse = require("../models/Warehouse");
const Product = require("../models/Product");
const Stock = require("../models/Stock");

exports.createWriteoff = async (req, res) => {
  const session = undefined;

  try {
    const { warehouseId, items, reason, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }
    if (!reason || typeof reason !== "string") {
      return res.status(400).json({ message: "reason is required" });
    }

    let writeoffDoc;

    {
      const warehouse = await Warehouse.findById(warehouseId).session(session);
      if (!warehouse) throw new Error("Warehouse not found");

      const processedItems = [];
      let totalAmount = 0;

      for (const item of items) {
        const { productId, inputType, unitCost } = item;
        const inputQuantity = Number(item?.inputQuantity);

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
        if (!product) throw new Error("Product not found");

        let quantity = 0;
        if (inputType === "block") {
          if (!product.hasPackage || !product.packageQuantity) {
            throw new Error("This product does not support block writeoff");
          }
          quantity = inputQuantity * product.packageQuantity;
        } else {
          quantity = inputQuantity;
        }

        const stock = await Stock.findOne({ productId, warehouseId }).session(session);
        if (!stock) throw new Error("Stock not found for product in this warehouse");
        if (stock.quantity < quantity) throw new Error("Insufficient stock for writeoff");

        const requestedUnitCost = Number(unitCost);
        const normalizedUnitCost = requestedUnitCost > 0 ? requestedUnitCost : Number(product.purchasePrice);
        if (!Number.isFinite(normalizedUnitCost) || normalizedUnitCost <= 0) {
          throw new Error("unitCost must be a positive number");
        }

        const totalCost = Number((normalizedUnitCost * quantity).toFixed(2));
        totalAmount += totalCost;

        stock.quantity -= quantity;
        await stock.save({ session });

        processedItems.push({
          productId: product._id,
          inputType,
          inputQuantity,
          packageQuantity: product.packageQuantity || null,
          quantity,
          unitCost: normalizedUnitCost,
          totalCost,
        });
      }

      const created = await Writeoff.create(
        [
          {
            warehouseId,
            items: processedItems,
            reason: reason.trim(),
            note,
            totalAmount: Number(totalAmount.toFixed(2)),
            createdBy: req.user._id,
          },
        ],
        { session },
      );
      [writeoffDoc] = created;
    }

    res.status(201).json({
      message: "Writeoff created successfully",
      writeoff: writeoffDoc,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("not found") ||
      error.message.includes("Insufficient") ||
      error.message.includes("must")
    ) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getWriteoffs = async (req, res) => {
  try {
    const { warehouseId, reason } = req.query;
    const query = {};

    if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = warehouseId;
    }

    if (reason) {
      query.reason = { $regex: reason, $options: "i" };
    }

    const writeoffs = await Writeoff.find(query)
      .sort({ createdAt: -1 })
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    res.json(writeoffs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getWriteoffById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid writeoff ID" });
    }

    const writeoff = await Writeoff.findById(id)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    if (!writeoff) {
      return res.status(404).json({ message: "Writeoff not found" });
    }

    res.json(writeoff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateWriteoff = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid writeoff ID" });
    }

    const updateData = {};
    if (reason !== undefined) {
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ message: "reason must be a non-empty string" });
      }
      updateData.reason = reason.trim();
    }
    if (note !== undefined) {
      updateData.note = note;
    }

    const writeoff = await Writeoff.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    if (!writeoff) {
      return res.status(404).json({ message: "Writeoff not found" });
    }

    res.json({
      message: "Writeoff updated successfully",
      writeoff,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteWriteoff = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid writeoff ID" });
    }

    {
      const writeoff = await Writeoff.findById(id).session(session);
      if (!writeoff) throw new Error("Writeoff not found");

      for (const item of writeoff.items) {
        await Stock.findOneAndUpdate(
          { productId: item.productId, warehouseId: writeoff.warehouseId },
          { $inc: { quantity: item.quantity } },
          { upsert: true, setDefaultsOnInsert: true, session },
        );
      }

      await Writeoff.findByIdAndDelete(id).session(session);
    }

    res.json({ message: "Writeoff deleted successfully" });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
