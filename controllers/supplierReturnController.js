const mongoose = require("mongoose");
const SupplierReturn = require("../models/SupplierReturn");
const Supplier = require("../models/Supplier");
const Warehouse = require("../models/Warehouse");
const Product = require("../models/Product");
const Stock = require("../models/Stock");

exports.createSupplierReturn = async (req, res) => {
  const session = undefined;

  try {
    const { warehouseId, supplierId, items, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }
    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    let returnDoc;

    {
      const [warehouse, supplier] = await Promise.all([
        Warehouse.findById(warehouseId).session(session),
        Supplier.findById(supplierId).session(session),
      ]);

      if (!warehouse) throw new Error("Warehouse not found");
      if (!supplier) throw new Error("Supplier not found");

      let totalAmount = 0;
      const processedItems = [];

      for (const item of items) {
        const { productId, inputType, unitReturnPrice } = item;
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
            throw new Error("This product does not support block return");
          }
          quantity = inputQuantity * product.packageQuantity;
        } else {
          quantity = inputQuantity;
        }

        const stock = await Stock.findOne({ productId, warehouseId }).session(session);
        if (!stock) throw new Error("Stock not found for product in this warehouse");
        if (stock.quantity < quantity) {
          throw new Error("Insufficient stock for return");
        }

        const requestedUnitReturnPrice = Number(unitReturnPrice);
        const normalizedUnitReturnPrice = requestedUnitReturnPrice > 0
          ? requestedUnitReturnPrice
          : Number(product.purchasePrice);

        if (!Number.isFinite(normalizedUnitReturnPrice) || normalizedUnitReturnPrice <= 0) {
          throw new Error("unitReturnPrice must be a positive number");
        }

        const lineTotal = Number((quantity * normalizedUnitReturnPrice).toFixed(2));
        totalAmount += lineTotal;

        stock.quantity -= quantity;
        await stock.save({ session });

        processedItems.push({
          productId: product._id,
          inputType,
          inputQuantity,
          packageQuantity: product.packageQuantity || null,
          quantity,
          unitReturnPrice: normalizedUnitReturnPrice,
          total: lineTotal,
        });
      }

      const created = await SupplierReturn.create(
        [
          {
            warehouseId,
            supplierId,
            items: processedItems,
            totalAmount: Number(totalAmount.toFixed(2)),
            note,
            createdBy: req.user._id,
          },
        ],
        { session },
      );

      [returnDoc] = created;
    }

    res.status(201).json({
      message: "Supplier return created successfully",
      supplierReturn: returnDoc,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("Insufficient") ||
      error.message.includes("not found") ||
      error.message.includes("must")
    ) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierReturns = async (req, res) => {
  try {
    const { supplierId, warehouseId } = req.query;
    const query = {};

    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ message: "Invalid supplierId query" });
      }
      query.supplierId = supplierId;
    }
    if (warehouseId) {
      if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouseId query" });
      }
      query.warehouseId = warehouseId;
    }

    const supplierReturns = await SupplierReturn.find(query)
      .sort({ createdAt: -1 })
      .populate("supplierId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    res.json(supplierReturns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierReturnById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier return ID" });
    }

    const supplierReturn = await SupplierReturn.findById(id)
      .populate("supplierId", "name phone address")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode");

    if (!supplierReturn) {
      return res.status(404).json({ message: "Supplier return not found" });
    }

    res.json(supplierReturn);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplierReturn = async (req, res) => {
  const session = undefined;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier return ID" });
    }

    {
      const supplierReturn = await SupplierReturn.findById(id).session(session);
      if (!supplierReturn) throw new Error("Supplier return not found");

      for (const item of supplierReturn.items) {
        await Stock.findOneAndUpdate(
          { productId: item.productId, warehouseId: supplierReturn.warehouseId },
          { $inc: { quantity: item.quantity } },
          { upsert: true, setDefaultsOnInsert: true, session },
        );
      }

      await SupplierReturn.findByIdAndDelete(id).session(session);
    }

    res.json({ message: "Supplier return deleted successfully" });
  } catch (error) {
    if (error.message.includes("not found")) {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: error.message });
  }
};
