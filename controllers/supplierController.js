const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const Purchase = require("../models/Purchase");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierReturn = require("../models/SupplierReturn");

exports.createSupplier = async (req, res) => {
  try {
    const { name, phone, address, note } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Supplier name is required" });
    }

    if (phone) {
      const existing = await Supplier.findOne({ phone });
      if (existing) {
        return res.status(409).json({ message: "Supplier phone already exists" });
      }
    }

    const supplier = await Supplier.create({
      name,
      phone,
      address,
      note,
    });

    res.status(201).json({
      message: "Supplier created successfully",
      supplier,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ createdAt: -1 });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    res.json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, address, note, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }

    if (phone) {
      const existing = await Supplier.findOne({ phone, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ message: "Supplier phone already exists" });
      }
    }

    const supplier = await Supplier.findByIdAndUpdate(
      id,
      {
        name,
        phone,
        address,
        note,
        isActive,
      },
      { new: true, runValidators: true },
    );

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    res.json({
      message: "Supplier updated successfully",
      supplier,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const [purchaseCount, paymentCount, returnCount] = await Promise.all([
      Purchase.countDocuments({ supplierId: id }),
      SupplierPayment.countDocuments({ supplierId: id }),
      SupplierReturn.countDocuments({ supplierId: id }),
    ]);

    if (purchaseCount > 0 || paymentCount > 0 || returnCount > 0) {
      return res.status(400).json({
        message:
          "Supplier has purchase/payment/return history. Use update (isActive=false) instead of delete",
      });
    }

    await Supplier.findByIdAndDelete(id);
    res.json({ message: "Supplier deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addSupplierPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentDate, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }

    const supplier = await Supplier.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const payment = await SupplierPayment.create({
      supplierId: id,
      amount,
      paymentDate: paymentDate || new Date(),
      note,
      createdBy: req.user._id,
    });

    res.status(201).json({
      message: "Supplier payment saved successfully",
      payment,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierPayments = async (req, res) => {
  try {
    const { supplierId } = req.query;
    const query = {};

    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({ message: "Invalid supplierId query" });
      }
      query.supplierId = supplierId;
    }

    const payments = await SupplierPayment.find(query)
      .sort({ paymentDate: -1, createdAt: -1 })
      .populate("supplierId", "name phone")
      .populate("createdBy", "fullName role")
      .lean();

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await SupplierPayment.findById(paymentId)
      .populate("supplierId", "name phone address")
      .populate("createdBy", "fullName role");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSupplierPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, paymentDate, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const payment = await SupplierPayment.findByIdAndUpdate(
      paymentId,
      {
        amount,
        paymentDate,
        note,
      },
      { new: true, runValidators: true },
    )
      .populate("supplierId", "name phone")
      .populate("createdBy", "fullName role");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json({
      message: "Supplier payment updated successfully",
      payment,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplierPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await SupplierPayment.findByIdAndDelete(paymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json({ message: "Supplier payment deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierLedger = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid supplier ID" });
    }

    const supplier = await Supplier.findById(id).lean();
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    const supplierObjectId = new mongoose.Types.ObjectId(id);

    const [purchaseStats] = await Purchase.aggregate([
      { $match: { supplierId: supplierObjectId } },
      {
        $group: {
          _id: null,
          totalPurchased: { $sum: "$totalAmount" },
          totalPaidAtPurchase: { $sum: "$paidAmount" },
          totalDueFromPurchases: { $sum: "$dueAmount" },
          purchaseCount: { $sum: 1 },
        },
      },
    ]);

    const [paymentStats] = await SupplierPayment.aggregate([
      { $match: { supplierId: supplierObjectId } },
      {
        $group: {
          _id: null,
          totalManualPayments: { $sum: "$amount" },
          paymentCount: { $sum: 1 },
        },
      },
    ]);

    const [returnStats] = await SupplierReturn.aggregate([
      { $match: { supplierId: supplierObjectId } },
      {
        $group: {
          _id: null,
          totalReturned: { $sum: "$totalAmount" },
          returnCount: { $sum: 1 },
        },
      },
    ]);

    const totalPurchased = purchaseStats?.totalPurchased || 0;
    const totalPaidAtPurchase = purchaseStats?.totalPaidAtPurchase || 0;
    const totalManualPayments = paymentStats?.totalManualPayments || 0;
    const totalReturned = returnStats?.totalReturned || 0;
    const totalPaid = totalPaidAtPurchase + totalManualPayments;
    const outstandingDebt = Number((totalPurchased - totalPaid - totalReturned).toFixed(2));

    const purchases = await Purchase.find({ supplierId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode")
      .lean();

    const payments = await SupplierPayment.find({ supplierId: id })
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(100)
      .populate("createdBy", "fullName role")
      .lean();

    const returns = await SupplierReturn.find({ supplierId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .populate("items.productId", "name model barcode")
      .lean();

    res.json({
      supplier,
      summary: {
        totalPurchased,
        totalPaidAtPurchase,
        totalManualPayments,
        totalReturned,
        totalPaid,
        outstandingDebt,
        purchaseCount: purchaseStats?.purchaseCount || 0,
        paymentCount: paymentStats?.paymentCount || 0,
        returnCount: returnStats?.returnCount || 0,
      },
      purchases,
      payments,
      returns,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
