const mongoose = require("mongoose");
const Salary = require("../models/Salary");
const User = require("../models/User");

const round2 = (value) => Number(Number(value || 0).toFixed(2));

const buildEmployeeQuery = (req, query, employeeId) => {
  if (req.user?.role === "cashier") {
    query.employeeId = req.user._id;
    return;
  }

  if (employeeId) {
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      throw new Error("Invalid employeeId query");
    }
    query.employeeId = employeeId;
  }
};

const ensureSalaryAccess = (req, salary) => {
  if (req.user?.role === "admin") {
    return true;
  }

  const createdById = salary.createdBy?._id || salary.createdBy;
  if (String(createdById) === String(req.user._id)) {
    return true;
  }

  const employeeId = salary.employeeId?._id || salary.employeeId;
  if (String(employeeId) === String(req.user._id)) {
    return true;
  }

  throw new Error("You can access only your own salary record");
};

exports.getEmployees = async (req, res) => {
  try {
    const { q, role, isActive, limit } = req.query;
    const query = {};

    if (role) {
      const roles = String(role)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const allowedRoles = roles.filter((item) => ["admin", "warehouse", "cashier"].includes(item));
      if (allowedRoles.length === 0) {
        return res.status(400).json({ message: "Invalid role query" });
      }
      query.role = { $in: allowedRoles };
    } else {
      query.role = { $in: ["warehouse", "cashier", "admin"] };
    }

    if (isActive !== undefined) {
      query.isActive = String(isActive) === "true";
    }

    if (q) {
      const regex = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ fullName: regex }, { phone: regex }];
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 100;
    }
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const employees = await User.find(query, { password: 0 })
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .populate("shopId", "name warehouseId isActive");

    return res.json(employees);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.createSalary = async (req, res) => {
  try {
    const { employeeId, amount, note = "", salaryDate, paidForMonth = "" } = req.body;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: "Invalid employeeId" });
    }

    const employee = await User.findById(employeeId).select("fullName role isActive");
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (!employee.isActive) {
      return res.status(400).json({ message: "Employee is inactive" });
    }

    const normalizedAmount = round2(amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const salary = await Salary.create({
      employeeId,
      amount: normalizedAmount,
      note,
      salaryDate: salaryDate ? new Date(salaryDate) : new Date(),
      paidForMonth: paidForMonth ? String(paidForMonth).trim() : "",
      createdBy: req.user._id,
      createdByName: req.user.fullName,
      createdByRole: req.user.role,
    });

    const populated = await Salary.findById(salary._id)
      .populate("employeeId", "fullName phone role isActive shopId")
      .populate("createdBy", "fullName role");

    return res.status(201).json({
      message: "Salary created successfully",
      salary: populated,
    });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("not found") ||
      error.message.includes("inactive")
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getSalaries = async (req, res) => {
  try {
    const { employeeId, createdBy, paidForMonth, from, to, minAmount, maxAmount, limit } = req.query;
    const query = {};

    if (req.user?.role === "cashier") {
      query.employeeId = req.user._id;
    } else {
      buildEmployeeQuery(req, query, employeeId);
    }

    if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(createdBy)) {
        return res.status(400).json({ message: "Invalid createdBy query" });
      }
      query.createdBy = createdBy;
    }

    if (paidForMonth) {
      query.paidForMonth = String(paidForMonth).trim();
    }

    if (from || to) {
      query.salaryDate = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "Invalid from date" });
        }
        query.salaryDate.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "Invalid to date" });
        }
        query.salaryDate.$lte = toDate;
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

    const salaries = await Salary.find(query)
      .sort({ salaryDate: -1, createdAt: -1 })
      .limit(normalizedLimit)
      .populate("employeeId", "fullName phone role isActive shopId")
      .populate("createdBy", "fullName role");

    return res.json(salaries);
  } catch (error) {
    if (error.message.includes("Invalid role query")) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.getSalaryById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid salary ID" });
    }

    const salary = await Salary.findById(id)
      .populate("employeeId", "fullName phone role isActive shopId")
      .populate("createdBy", "fullName role");

    if (!salary) {
      return res.status(404).json({ message: "Salary not found" });
    }

    ensureSalaryAccess(req, salary);

    return res.json(salary);
  } catch (error) {
    if (error.message.includes("own salary record")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.updateSalary = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, amount, note, salaryDate, paidForMonth } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid salary ID" });
    }

    const salary = await Salary.findById(id);
    if (!salary) {
      return res.status(404).json({ message: "Salary not found" });
    }

    ensureSalaryAccess(req, salary);

    const updateData = {};

    if (employeeId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return res.status(400).json({ message: "Invalid employeeId" });
      }
      const employee = await User.findById(employeeId).select("isActive");
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }
      if (!employee.isActive) {
        return res.status(400).json({ message: "Employee is inactive" });
      }
      updateData.employeeId = employeeId;
    }

    if (amount !== undefined) {
      const normalizedAmount = round2(amount);
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
        return res.status(400).json({ message: "amount must be a positive number" });
      }
      updateData.amount = normalizedAmount;
    }

    if (note !== undefined) {
      updateData.note = note;
    }

    if (salaryDate !== undefined) {
      const parsedDate = new Date(salaryDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid salaryDate" });
      }
      updateData.salaryDate = parsedDate;
    }

    if (paidForMonth !== undefined) {
      updateData.paidForMonth = paidForMonth ? String(paidForMonth).trim() : "";
    }

    const updatedSalary = await Salary.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("employeeId", "fullName phone role isActive shopId")
      .populate("createdBy", "fullName role");

    return res.json({
      message: "Salary updated successfully",
      salary: updatedSalary,
    });
  } catch (error) {
    if (error.message.includes("own salary record")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};

exports.deleteSalary = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid salary ID" });
    }

    const salary = await Salary.findById(id);
    if (!salary) {
      return res.status(404).json({ message: "Salary not found" });
    }

    ensureSalaryAccess(req, salary);

    await Salary.findByIdAndDelete(id);

    return res.json({ message: "Salary deleted successfully" });
  } catch (error) {
    if (error.message.includes("own salary record")) {
      return res.status(403).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message });
  }
};
