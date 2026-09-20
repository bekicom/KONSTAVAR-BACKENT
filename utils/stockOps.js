const mongoose = require("mongoose");
const Stock = require("../models/Stock");

const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.isValidObjectId(value)) return new mongoose.Types.ObjectId(String(value));
  throw new Error("Invalid ObjectId");
};

const round = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
};

const decrementStockAtomic = async ({ productId, warehouseId, quantity, session }) => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const err = new Error("quantity must be a positive number");
    err.statusCode = 400;
    throw err;
  }

  const filter = {
    productId: toObjectId(productId),
    warehouseId: toObjectId(warehouseId),
    quantity: { $gte: quantity },
  };

  const updated = await Stock.findOneAndUpdate(
    filter,
    { $inc: { quantity: -quantity } },
    { new: true, session },
  );

  if (!updated) {
    const exists = await Stock.findOne({ productId, warehouseId }).session(session).lean();
    const err = new Error(
      exists
        ? `Insufficient stock (available ${exists.quantity}, requested ${quantity})`
        : "Stock record not found for this product in the given warehouse",
    );
    err.statusCode = 409;
    err.code = exists ? "STOCK_INSUFFICIENT" : "STOCK_NOT_FOUND";
    throw err;
  }

  return updated;
};

const incrementStockAtomic = async ({ productId, warehouseId, quantity, session }) => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const err = new Error("quantity must be a positive number");
    err.statusCode = 400;
    throw err;
  }

  const updated = await Stock.findOneAndUpdate(
    { productId: toObjectId(productId), warehouseId: toObjectId(warehouseId) },
    { $inc: { quantity } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session },
  );

  return updated;
};

const adjustStockToTarget = async ({ productId, warehouseId, expectedQuantity, targetQuantity, session }) => {
  const filter = {
    productId: toObjectId(productId),
    warehouseId: toObjectId(warehouseId),
    quantity: expectedQuantity,
  };

  const updated = await Stock.findOneAndUpdate(
    filter,
    { $set: { quantity: targetQuantity } },
    { new: true, session },
  );

  if (!updated) {
    const current = await Stock.findOne({ productId, warehouseId }).session(session).lean();
    const err = new Error(
      current
        ? `Stock changed during inventory (expected ${expectedQuantity}, found ${current.quantity})`
        : "Stock record disappeared during inventory",
    );
    err.statusCode = 409;
    err.code = "STOCK_DRIFT";
    throw err;
  }

  return updated;
};

module.exports = {
  decrementStockAtomic,
  incrementStockAtomic,
  adjustStockToTarget,
  round,
};
