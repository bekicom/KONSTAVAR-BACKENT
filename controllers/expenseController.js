const mongoose = require("mongoose");
const Expense = require("../models/Expense");
const Shift = require("../models/Shift");
const { requireOpenCashierShift } = require("../utils/shiftHelper");

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const ensureExpenseOwnership = (req, expense) => {
  if (req.user?.role === "admin") {
    return true;
  }

  const createdById = expense.createdBy?._id || expense.createdBy;
  if (String(createdById) !== String(req.user._id)) {
    throw new Error("You can access only your own expense");
  }

  return true;
};

const resolveShiftForExpense = async (req, shiftId) => {
  if (req.user?.role === "cashier") {
    const activeShift = await requireOpenCashierShift(req.user);
    return activeShift;
  }

  if (!shiftId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(shiftId)) {
    throw new Error("Invalid shiftId");
  }

  const shift = await Shift.findById(shiftId);
  if (!shift) {
    throw new Error("Shift not found");
  }

  return shift;
};

exports.createExpense = async (req, res) => {
  try {
    const { amount, reason, note = "", shiftId } = req.body;

    const normalizedAmount = round2(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ message: "reason is required" });
    }

    const shift = await resolveShiftForExpense(req, shiftId);

    if (req.user?.role === "cashier" && shiftId && String(shiftId) !== String(shift._id)) {
      return res.status(400).json({ message: "Cashier can create expense only in current open shift" });
    }

    const [createdExpense] = await Expense.create([
      {
        amount: normalizedAmount,
        reason: reason.trim(),
        note,
        shiftId: shift ? shift._id : null,
        createdBy: req.user._id,
        createdByName: req.user.fullName,
        createdByRole: req.user.role,
      },
    ]);

    const populated = await Expense.findById(createdExpense._id)
      .populate("shiftId", "status openedAt closedAt shopId warehouseId cashierId")
      .populate("createdBy", "fullName role");

    return res.status(201).json({
      message: "Expense created successfully",
      expense: populated,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("not found") ||
      error.message.includes("own open shift")
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const { shiftId, createdBy, reason, from, to, minAmount, maxAmount, limit } = req.query;
    const query = {};

    if (req.user?.role === "cashier") {
      query.createdBy = req.user._id;
    } else if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(createdBy)) {
        return res.status(400).json({ message: "Invalid createdBy query" });
      }
      query.createdBy = createdBy;
    }

    if (shiftId) {
      if (!mongoose.Types.ObjectId.isValid(shiftId)) {
        return res.status(400).json({ message: "Invalid shiftId query" });
      }
      query.shiftId = shiftId;
    }

    if (reason) {
      query.reason = { $regex: String(reason).trim(), $options: "i" };
    }

    if (from || to) {
      query.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "Invalid from date" });
        }
        query.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "Invalid to date" });
        }
        query.createdAt.$lte = toDate;
      }
    }

    if (minAmount !== undefined || maxAmount !== undefined) {
      query.amount = {};
      if (minAmount !== undefined) {
        const normalizedMin = Number(minAmount);
        if (!Number.isFinite(normalizedMin)) {
          return res.status(400).json({ message: "Invalid minAmount query" });
        }
        query.amount.$gte = normalizedMin;
      }
      if (maxAmount !== undefined) {
        const normalizedMax = Number(maxAmount);
        if (!Number.isFinite(normalizedMax)) {
          return res.status(400).json({ message: "Invalid maxAmount query" });
        }
        query.amount.$lte = normalizedMax;
      }
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const expenses = await Expense.find(query)
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("shiftId", "status openedAt closedAt shopId warehouseId cashierId")
      .populate("createdBy", "fullName role");

    return res.json(expenses);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid expense ID" });
    }

    const expense = await Expense.findById(id)
      .populate("shiftId", "status openedAt closedAt shopId warehouseId cashierId")
      .populate("createdBy", "fullName role");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    ensureExpenseOwnership(req, expense);

    return res.json(expense);
  } catch (error) {
    if (error.message.includes("own expense") || error.message.includes("Access denied")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, note, shiftId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid expense ID" });
    }

    const expense = await Expense.findById(id);
    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    ensureExpenseOwnership(req, expense);

    const updateData = {};

    if (amount !== undefined) {
      const normalizedAmount = round2(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        return res.status(400).json({ message: "amount must be a positive number" });
      }
      updateData.amount = normalizedAmount;
    }

    if (reason !== undefined) {
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        return res.status(400).json({ message: "reason must be a non-empty string" });
      }
      updateData.reason = reason.trim();
    }

    if (note !== undefined) {
      updateData.note = note;
    }

    if (shiftId !== undefined) {
      if (req.user?.role === "cashier") {
        return res.status(403).json({ message: "Cashier cannot change shiftId" });
      }

      if (shiftId === null || shiftId === "") {
        updateData.shiftId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(shiftId)) {
          return res.status(400).json({ message: "Invalid shiftId" });
        }
        const shift = await Shift.findById(shiftId);
        if (!shift) {
          return res.status(400).json({ message: "Shift not found" });
        }
        updateData.shiftId = shift._id;
      }
    }

    const updatedExpense = await Expense.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("shiftId", "status openedAt closedAt shopId warehouseId cashierId")
      .populate("createdBy", "fullName role");

    return res.json({
      message: "Expense updated successfully",
      expense: updatedExpense,
    });
  } catch (error) {
    if (error.message.includes("own expense")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid expense ID" });
    }

    const expense = await Expense.findById(id);
    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    ensureExpenseOwnership(req, expense);

    await Expense.findByIdAndDelete(id);

    return res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    if (error.message.includes("own expense")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};
