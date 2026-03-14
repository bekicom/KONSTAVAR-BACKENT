const mongoose = require("mongoose");
const Warehouse = require("../models/Warehouse");
const Stock = require("../models/Stock");
const Purchase = require("../models/Purchase");
const SupplierReturn = require("../models/SupplierReturn");
const Writeoff = require("../models/Writeoff");
const InventorySession = require("../models/InventorySession");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const ClientPayment = require("../models/ClientPayment");
const ShopTransfer = require("../models/ShopTransfer");
const Shop = require("../models/Shop");

// 🔹 CREATE
exports.createWarehouse = async (req, res) => {
  try {
    const { name, address } = req.body;

    const existing = await Warehouse.findOne({ name });
    if (existing) {
      return res.status(400).json({ message: "Warehouse already exists" });
    }

    const warehouse = await Warehouse.create({
      name,
      address,
    });

    res.status(201).json({
      message: "Warehouse created successfully",
      warehouse,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 GET ALL
exports.getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });
    res.json(warehouses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 GET BY ID
exports.getWarehouseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(id);
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 UPDATE
exports.updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    res.json({
      message: "Warehouse updated successfully",
      warehouse,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 DELETE
exports.deleteWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid warehouse ID" });
    }

    const warehouse = await Warehouse.findById(id);
    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    const references = await Promise.all([
      Stock.exists({ warehouseId: id, quantity: { $gt: 0 } }),
      Purchase.exists({ warehouseId: id }),
      SupplierReturn.exists({ warehouseId: id }),
      Writeoff.exists({ warehouseId: id }),
      InventorySession.exists({ warehouseId: id }),
      Sale.exists({ warehouseId: id }),
      SaleReturn.exists({ warehouseId: id }),
      ClientPayment.exists({ warehouseId: id }),
      ShopTransfer.exists({
        $or: [{ sourceWarehouseId: id }, { destinationWarehouseId: id }],
      }),
      Shop.exists({ warehouseId: id }),
    ]);

    if (references.some(Boolean)) {
      return res.status(400).json({
        message: "Warehouse has stock, shop link or history. It cannot be deleted",
      });
    }

    await Warehouse.findByIdAndDelete(id);

    res.json({
      message: "Warehouse deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
