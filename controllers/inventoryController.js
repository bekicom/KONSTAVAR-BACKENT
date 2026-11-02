const mongoose = require("mongoose");
const InventorySession = require("../models/InventorySession");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");
const Product = require("../models/Product");
const StockAdjustment = require("../models/StockAdjustment");
const { applyWarehouseScope, ensureWarehouseAccess } = require("../utils/userAccess");
const { withTransaction } = require("../utils/withTransaction");
const { sendError } = require("../utils/sendError");

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

    ensureWarehouseAccess(req.user, warehouseId);

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
    sendError(res, error);
  }
};

exports.getInventorySessions = async (req, res) => {
  try {
    const { warehouseId, status } = req.query;
    const query = {};

    if (warehouseId) {
      ensureWarehouseAccess(req.user, warehouseId);
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

    const sessions = await InventorySession.find(applyWarehouseScope(req.user, query))
      .sort({ createdAt: -1 })
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("postedBy", "fullName role")
      .populate("cancelledBy", "fullName role");

    res.json(sessions);
  } catch (error) {
    sendError(res, error);
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

    ensureWarehouseAccess(req.user, session.warehouseId);

    res.json(session);
  } catch (error) {
    sendError(res, error);
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

    const seenProductIds = new Set();
    for (const incoming of items) {
      const productId = String(incoming?.productId || "");
      if (seenProductIds.has(productId)) {
        return res.status(400).json({ message: "Duplicate productId in items is not allowed" });
      }
      seenProductIds.add(productId);
    }

    const session = await InventorySession.findById(id);
    if (!session) {
      return res.status(404).json({ message: "Inventory session not found" });
    }

    ensureWarehouseAccess(req.user, session.warehouseId);

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
    sendError(res, error);
  }
};

exports.postInventorySession = async (req, res) => {
  try {
    const { id } = req.params;
    const { autoFillUncounted = false } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid inventory session ID" });
    }

    const responseSessionId = await withTransaction(async (dbSession) => {
      const inventory = await InventorySession.findById(id).session(dbSession);
      if (!inventory) throw new Error("Inventory session not found");
      if (inventory.status !== "draft") throw new Error("Only draft session can be posted");
      ensureWarehouseAccess(req.user, inventory.warehouseId);

      // Preload product costs once for cost-basis snapshot.
      const productIds = inventory.items.map((it) => it.productId);
      const products = await Product.find({ _id: { $in: productIds } })
        .session(dbSession)
        .select("purchasePrice")
        .lean();
      const costByProduct = new Map(
        products.map((p) => [String(p._id), Number(p.purchasePrice) || 0]),
      );
      const liveStocks = await Stock.find({
        productId: { $in: productIds },
        warehouseId: inventory.warehouseId,
      })
        .session(dbSession)
        .select("productId quantity")
        .lean();
      const liveQtyByProduct = new Map(
        liveStocks.map((stock) => [String(stock.productId), Number(stock.quantity) || 0]),
      );

      const adjustmentDocs = [];
      const stockOps = [];

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

        // Re-read the live stock snapshot once per session instead of making
        // a separate query for every item.
        const liveQty = liveQtyByProduct.get(String(item.productId)) || 0;

        item.systemQty = liveQty;
        const delta = Number((item.countedQty - liveQty).toFixed(2));
        item.difference = delta;

        stockOps.push({
          updateOne: {
            filter: { productId: item.productId, warehouseId: inventory.warehouseId },
            update: { $set: { quantity: item.countedQty } },
            upsert: true,
          },
        });

        if (delta !== 0) {
          const unitCost = costByProduct.get(String(item.productId)) || 0;
          const totalCost = Number((delta * unitCost).toFixed(2));
          adjustmentDocs.push({
            productId: item.productId,
            warehouseId: inventory.warehouseId,
            delta,
            systemQty: liveQty,
            countedQty: item.countedQty,
            unitCost,
            totalCost,
            reason: "inventory",
            sourceModel: "InventorySession",
            sourceId: inventory._id,
            note: item.reason || "",
            createdBy: req.user._id,
          });
        }
      }

      if (stockOps.length > 0) {
        await Stock.bulkWrite(stockOps, { session: dbSession, ordered: true });
      }

      if (adjustmentDocs.length > 0) {
        await StockAdjustment.insertMany(adjustmentDocs, {
          session: dbSession,
          ordered: true,
        });
      }

      inventory.summary = buildSummary(inventory.items);
      inventory.status = "posted";
      inventory.postedAt = new Date();
      inventory.postedBy = req.user._id;
      await inventory.save({ session: dbSession });

      return inventory._id;
    });

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

    sendError(res, error);
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

    ensureWarehouseAccess(req.user, session.warehouseId);

    if (session.status !== "draft") {
      return res.status(400).json({ message: "Only draft session can be cancelled" });
    }

    session.status = "cancelled";
    session.cancelledAt = new Date();
    session.cancelledBy = req.user._id;
    await session.save();

    res.json({ message: "Inventory session cancelled successfully", session });
  } catch (error) {
    sendError(res, error);
  }
};
