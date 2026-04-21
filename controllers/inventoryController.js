const mongoose = require("mongoose");
const InventorySession = require("../models/InventorySession");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");
const Product = require("../models/Product");

const buildSummary = (items) => {
  let countedItems = 0;
  let matchedItems = 0;
  let surplusItems = 0;
  let shortageItems = 0;
  let systemQtyTotal = 0;
  let countedQtyTotal = 0;
  let netDifference = 0;

  for (const item of items) {
    const systemQty = Number(item.systemQty) || 0;
    systemQtyTotal += systemQty;

    if (item.countedQty === null || item.countedQty === undefined) {
      continue;
    }

    const countedQty = Number(item.countedQty) || 0;
    const difference =
      item.difference !== null && item.difference !== undefined
        ? Number(item.difference)
        : countedQty - systemQty;

    countedItems += 1;
    countedQtyTotal += countedQty;
    netDifference += difference;

    if (difference === 0) matchedItems += 1;
    if (difference > 0) surplusItems += 1;
    if (difference < 0) shortageItems += 1;
  }

  return {
    totalItems: items.length,
    countedItems,
    matchedItems,
    surplusItems,
    shortageItems,
    systemQtyTotal: Number(systemQtyTotal.toFixed(2)),
    countedQtyTotal: Number(countedQtyTotal.toFixed(2)),
    netDifference: Number(netDifference.toFixed(2)),
  };
};

exports.createInventorySession = async (req, res) => {
  try {
    const { warehouseId, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(warehouseId).lean();
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const existingDraft = await InventorySession.findOne({
      warehouseId,
      status: "draft",
    }).lean();

    if (existingDraft) {
      return res.status(409).json({
        message: "This warehouse already has active draft inventory session",
        sessionId: existingDraft._id,
      });
    }

    const stocks = await Stock.find({ warehouseId })
      .select("productId quantity")
      .lean();

    const items = stocks.map((stock) => ({
      productId: stock.productId,
      systemQty: Number(stock.quantity) || 0,
      countedQty: null,
      difference: null,
      reason: "",
      countedAt: null,
    }));

    const summary = buildSummary(items);

    const session = await InventorySession.create({
      warehouseId,
      note,
      items,
      summary,
      createdBy: req.user._id,
    });

    const populated = await InventorySession.findById(session._id)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate({
        path: "items.productId",
        select: "name model barcode baseUnit categoryId",
        populate: { path: "categoryId", select: "name" },
      });

    res.status(201).json({
      message: "Inventory session created successfully",
      session: populated,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getInventorySessions = async (req, res) => {
  try {
    const { warehouseId, status } = req.query;
    const query = {};

    if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = warehouseId;
    }

    if (status) {
      if (!["draft", "posted", "cancelled"].includes(status)) {
        return res.status(400).json({ message: "Invalid status query" });
      }
      query.status = status;
    }

    const sessions = await InventorySession.find(query)
      .sort({ createdAt: -1 })
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("postedBy", "fullName role")
      .populate("cancelledBy", "fullName role");

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getInventorySessionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid inventory session ID" });
    }

    const session = await InventorySession.findById(id)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("postedBy", "fullName role")
      .populate("cancelledBy", "fullName role")
      .populate({
        path: "items.productId",
        select: "name model barcode baseUnit categoryId",
        populate: { path: "categoryId", select: "name" },
      });

    if (!session) {
      return res.status(404).json({ message: "Inventory session not found" });
    }

    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateInventoryCount = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid inventory session ID" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items[] is required" });
    }

    const session = await InventorySession.findById(id);
    if (!session) {
      return res.status(404).json({ message: "Inventory session not found" });
    }

    if (session.status !== "draft") {
      return res.status(400).json({ message: "Only draft session can be edited" });
    }

    const map = new Map(session.items.map((item) => [String(item.productId), item]));

    for (const incoming of items) {
      const { productId, countedQty, reason } = incoming;
      const normalizedCountedQty = Number(countedQty);

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: "Invalid productId in items" });
      }

      if (!Number.isFinite(normalizedCountedQty) || normalizedCountedQty < 0) {
        return res.status(400).json({ message: "countedQty must be a non-negative number" });
      }

      let item = map.get(String(productId));

      if (!item) {
        const productExists = await Product.exists({ _id: productId });
        if (!productExists) {
          return res.status(404).json({ message: `Product not found: ${productId}` });
        }

        item = {
          productId,
          systemQty: 0,
          countedQty: null,
          difference: null,
          reason: "",
          countedAt: null,
        };
        session.items.push(item);
        map.set(String(productId), item);
      }

      item.countedQty = normalizedCountedQty;
      item.difference = Number((item.countedQty - item.systemQty).toFixed(2));
      item.reason = typeof reason === "string" ? reason.trim() : item.reason || "";
      item.countedAt = new Date();
    }

    session.summary = buildSummary(session.items);
    await session.save();

    const populated = await InventorySession.findById(session._id)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate({
        path: "items.productId",
        select: "name model barcode baseUnit categoryId",
        populate: { path: "categoryId", select: "name" },
      });

    res.json({
      message: "Inventory counts updated successfully",
      session: populated,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.postInventorySession = async (req, res) => {
  const dbSession = undefined;

  try {
    const { id } = req.params;
    const { autoFillUncounted = true } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid inventory session ID" });
    }

    let responseSessionId = null;

    {
      const inventory = await InventorySession.findById(id).session(dbSession);
      if (!inventory) throw new Error("Inventory session not found");
      if (inventory.status !== "draft") throw new Error("Only draft session can be posted");

      for (const item of inventory.items) {
        if (item.countedQty === null || item.countedQty === undefined) {
          if (autoFillUncounted) {
            item.countedQty = Number(item.systemQty) || 0;
            item.difference = 0;
            item.countedAt = item.countedAt || new Date();
          } else {
            throw new Error("All items must be counted before posting");
          }
        }

        if (!Number.isFinite(item.countedQty) || item.countedQty < 0) {
          throw new Error("countedQty must be a non-negative number");
        }

        item.difference = Number((item.countedQty - item.systemQty).toFixed(2));

        await Stock.findOneAndUpdate(
          {
            productId: item.productId,
            warehouseId: inventory.warehouseId,
          },
          { quantity: item.countedQty },
          {
            upsert: true,
            setDefaultsOnInsert: true,
            session: dbSession,
          },
        );
      }

      inventory.summary = buildSummary(inventory.items);
      inventory.status = "posted";
      inventory.postedAt = new Date();
      inventory.postedBy = req.user._id;
      await inventory.save({ session: dbSession });

      responseSessionId = inventory._id;
    }

    const posted = await InventorySession.findById(responseSessionId)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("postedBy", "fullName role")
      .populate({
        path: "items.productId",
        select: "name model barcode baseUnit categoryId",
        populate: { path: "categoryId", select: "name" },
      });

    res.json({
      message: "Inventory session posted successfully",
      session: posted,
    });
  } catch (error) {
    if (
      error.message.includes("not found") ||
      error.message.includes("Only draft") ||
      error.message.includes("must be counted") ||
      error.message.includes("non-negative")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.cancelInventorySession = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid inventory session ID" });
    }

    const session = await InventorySession.findById(id);
    if (!session) {
      return res.status(404).json({ message: "Inventory session not found" });
    }

    if (session.status !== "draft") {
      return res.status(400).json({ message: "Only draft session can be cancelled" });
    }

    session.status = "cancelled";
    session.cancelledAt = new Date();
    session.cancelledBy = req.user._id;
    await session.save();

    res.json({ message: "Inventory session cancelled successfully", session });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
