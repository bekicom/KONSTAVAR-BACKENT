const mongoose = require("mongoose");
const Shift = require("../models/Shift");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Expense = require("../models/Expense");
const { resolveCashierShop, getOpenCashierShift } = require("../utils/shiftHelper");

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const ensureCashierOwnership = (req, shift) => {
  if (req.user?.role === "admin") {
    return true;
  }

  if (req.user?.role !== "cashier") {
    throw new Error("Access denied");
  }

  const shiftCashierId = shift.cashierId?._id || shift.cashierId;
  if (String(shiftCashierId) !== String(req.user._id)) {
    throw new Error("You can access only your own shift");
  }

  return true;
};

exports.startShift = async (req, res) => {
  try {
    const { openingCash = 0, note = "" } = req.body;

    const shop = await resolveCashierShop(req.user);
    const warehouseId = shop.warehouseId;
    const normalizedOpeningCash = Number(openingCash);

    if (!Number.isFinite(normalizedOpeningCash) || normalizedOpeningCash < 0) {
      return res.status(400).json({ message: "openingCash must be a non-negative number" });
    }

    const existingShift = await Shift.findOne({
      cashierId: req.user._id,
      shopId: shop._id,
      status: "open",
    })
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role");

    if (existingShift) {
      return res.status(200).json({
        message: "Shift already open",
        shift: existingShift,
      });
    }

    const shift = await Shift.create({
      shopId: shop._id,
      warehouseId,
      cashierId: req.user._id,
      openedBy: req.user._id,
      openingCash: normalizedOpeningCash,
      note,
    });

    const populated = await Shift.findById(shift._id)
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role")
      .populate("openedBy", "fullName role");

    res.status(201).json({
      message: "Shift started successfully",
      shift: populated,
    });
  } catch (error) {
    if (
      error.message.includes("required") ||
      error.message.includes("must") ||
      error.message.includes("assigned") ||
      error.message.includes("inactive")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.closeShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { closingCash = null, closeNote = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shift ID" });
    }

    const shift = await Shift.findById(id);
    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    ensureCashierOwnership(req, shift);

    if (shift.status !== "open") {
      return res.status(400).json({ message: "Shift already closed" });
    }

    const [sales, returns, expenses] = await Promise.all([
      Sale.find({ shiftId: shift._id }).select(
        "totalAmount paymentType cashAmount cardAmount clickAmount paidAmount dueAmount createdAt",
      ),
      SaleReturn.find({ shiftId: shift._id }).select("subtotal refundType createdAt"),
      Expense.find({ shiftId: shift._id }).select("amount reason createdAt"),
    ]);

    const salesTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
    );
    const cashSalesTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.cashAmount || 0), 0),
    );
    const cardSalesTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.cardAmount || 0), 0),
    );
    const clickSalesTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.clickAmount || 0), 0),
    );
    const paidAmountTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.paidAmount || 0), 0),
    );
    const dueAmountTotal = round2(
      sales.reduce((sum, sale) => sum + Number(sale.dueAmount || 0), 0),
    );
    const returnsTotal = round2(
      returns.reduce((sum, saleReturn) => sum + Number(saleReturn.subtotal || 0), 0),
    );
    const expensesTotal = round2(
      expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    );

    shift.status = "closed";
    shift.closedAt = new Date();
    shift.closedBy = req.user._id;
    shift.closingCash =
      closingCash === null || closingCash === undefined || closingCash === ""
        ? null
        : Number(closingCash);
    shift.closeNote = closeNote || "";
    shift.summary = {
      salesCount: sales.length,
      salesTotal,
      returnsCount: returns.length,
      returnsTotal,
      expensesCount: expenses.length,
      expensesTotal,
      cashSalesTotal,
      cardSalesTotal,
      clickSalesTotal,
      paidAmountTotal,
      dueAmountTotal,
      netTotal: round2(salesTotal - returnsTotal),
      netAfterExpenses: round2(salesTotal - returnsTotal - expensesTotal),
      expectedCashInDrawer: round2(
        Number(shift.openingCash || 0) + cashSalesTotal - returnsTotal - expensesTotal,
      ),
    };

    await shift.save();

    const populated = await Shift.findById(shift._id)
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role")
      .populate("openedBy", "fullName role")
      .populate("closedBy", "fullName role");

    res.json({
      message: "Shift closed successfully",
      shift: populated,
      summary: shift.summary,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("assigned") ||
      error.message.includes("own shift") ||
      error.message.includes("closed")
    ) {
      return res.status(400).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};

exports.getCurrentShift = async (req, res) => {
  try {
    const shift = await getOpenCashierShift(req.user);
    if (!shift) {
      return res.json({ shift: null });
    }

    const populated = await Shift.findById(shift._id)
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role")
      .populate("openedBy", "fullName role")
      .populate("closedBy", "fullName role");

    res.json({ shift: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getShifts = async (req, res) => {
  try {
    const { cashierId, shopId, status, from, to, limit } = req.query;
    const query = {};

    if (req.user?.role === "cashier") {
      query.cashierId = req.user._id;
    } else if (cashierId) {
      if (!mongoose.Types.ObjectId.isValid(cashierId)) {
        return res.status(400).json({ message: "Invalid cashierId query" });
      }
      query.cashierId = cashierId;
    }

    if (shopId) {
      if (!mongoose.Types.ObjectId.isValid(shopId)) {
        return res.status(400).json({ message: "Invalid shopId query" });
      }
      query.shopId = shopId;
    }

    if (status) {
      if (!["open", "closed"].includes(status)) {
        return res.status(400).json({ message: "Invalid status query" });
      }
      query.status = status;
    }

    if (from || to) {
      query.openedAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "Invalid from date" });
        }
        query.openedAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "Invalid to date" });
        }
        query.openedAt.$lte = toDate;
      }
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 50;
    }
    normalizedLimit = Math.min(normalizedLimit, 200);

    const shifts = await Shift.find(query)
      .sort({ openedAt: -1 })
      .limit(normalizedLimit)
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role")
      .populate("openedBy", "fullName role")
      .populate("closedBy", "fullName role");

    res.json(shifts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getShiftById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid shift ID" });
    }

    const shift = await Shift.findById(id)
      .populate("shopId", "name warehouseId")
      .populate("warehouseId", "name")
      .populate("cashierId", "fullName role")
      .populate("openedBy", "fullName role")
      .populate("closedBy", "fullName role");

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    ensureCashierOwnership(req, shift);

    const [sales, returns, expenses] = await Promise.all([
      Sale.find({ shiftId: shift._id })
        .sort({ createdAt: -1 })
        .populate("createdBy", "fullName role")
        .populate("warehouseId", "name")
        .populate("clientId", "name phone")
        .populate("items.productId", "name model barcode"),
      SaleReturn.find({ shiftId: shift._id })
        .sort({ createdAt: -1 })
        .populate("createdBy", "fullName role")
        .populate("warehouseId", "name")
        .populate("saleId", "createdAt totalAmount paymentType")
        .populate("items.productId", "name model barcode"),
      Expense.find({ shiftId: shift._id })
        .sort({ createdAt: -1 })
        .populate("createdBy", "fullName role"),
    ]);

    res.json({
      shift,
      sales,
      returns,
      expenses,
      summary: {
        salesCount: sales.length,
        salesTotal: round2(sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0)),
        returnsCount: returns.length,
        returnsTotal: round2(returns.reduce((sum, saleReturn) => sum + Number(saleReturn.subtotal || 0), 0)),
        expensesCount: expenses.length,
        expensesTotal: round2(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
        netTotal: round2(
          sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0) -
            returns.reduce((sum, saleReturn) => sum + Number(saleReturn.subtotal || 0), 0),
        ),
        netAfterExpenses: round2(
          sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0) -
            returns.reduce((sum, saleReturn) => sum + Number(saleReturn.subtotal || 0), 0) -
            expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
        ),
      },
    });
  } catch (error) {
    if (error.message.includes("own shift") || error.message.includes("Access denied")) {
      return res.status(403).json({ message: error.message });
    }

    res.status(500).json({ message: error.message });
  }
};
