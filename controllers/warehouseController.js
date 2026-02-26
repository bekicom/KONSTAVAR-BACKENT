const Warehouse = require("../models/Warehouse");

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

    const warehouse = await Warehouse.findByIdAndDelete(id);

    if (!warehouse) {
      return res.status(404).json({ message: "Warehouse not found" });
    }

    res.json({
      message: "Warehouse deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
