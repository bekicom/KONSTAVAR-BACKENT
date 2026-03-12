const mongoose = require("mongoose");
const Client = require("../models/Client");
const ClientPayment = require("../models/ClientPayment");
const Sale = require("../models/Sale");
const Shop = require("../models/Shop");
const Warehouse = require("../models/Warehouse");

const round2 = (value) => Number(Number(value).toFixed(2));

const resolveWarehouseForClient = async (user, requestedWarehouseId) => {
  if (user?.role === "cashier") {
    if (!user.shopId) throw new Error("Cashier has no assigned shop");
    const shopId = user.shopId?._id || user.shopId;
    if (!mongoose.Types.ObjectId.isValid(shopId)) throw new Error("Invalid user shopId");

    const shop = await Shop.findOne({ _id: shopId, isActive: true }).lean();
    if (!shop) throw new Error("Assigned shop not found or inactive");
    return shop.warehouseId;
  }

  if (requestedWarehouseId) {
    if (!mongoose.Types.ObjectId.isValid(requestedWarehouseId)) {
      throw new Error("Invalid warehouseId");
    }
    const shop = await Shop.findOne({ warehouseId: requestedWarehouseId, isActive: true }).lean();
    if (!shop) throw new Error("Warehouse is not an active shop warehouse");
    return requestedWarehouseId;
  }

  if (user?.shopId) {
    const shopId = user.shopId?._id || user.shopId;
    if (mongoose.Types.ObjectId.isValid(shopId)) {
      const shop = await Shop.findOne({ _id: shopId, isActive: true }).lean();
      if (shop) return shop.warehouseId;
    }
  }

  const activeShops = await Shop.find({ isActive: true }).select("warehouseId").lean();
  if (activeShops.length === 1) return activeShops[0].warehouseId;

  throw new Error("Send warehouseId or assign shopId to user");
};

const resolvePaymentSplit = (paymentType, amount, cashAmount, cardAmount, clickAmount) => {
  const total = round2(Number(amount));
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("amount must be a positive number");
  }

  const type = paymentType || "cash";
  if (!["cash", "card", "click", "mixed"].includes(type)) {
    throw new Error("Invalid paymentType. Use 'cash', 'card', 'click' or 'mixed'");
  }

  let cash = Number(cashAmount);
  let card = Number(cardAmount);
  let click = Number(clickAmount);
  if (!Number.isFinite(cash)) cash = 0;
  if (!Number.isFinite(card)) card = 0;
  if (!Number.isFinite(click)) click = 0;

  if (cash < 0 || card < 0 || click < 0) {
    throw new Error("cashAmount/cardAmount/clickAmount cannot be negative");
  }

  if (type === "cash") return { paymentType: "cash", cashAmount: total, cardAmount: 0, clickAmount: 0 };
  if (type === "card") return { paymentType: "card", cashAmount: 0, cardAmount: total, clickAmount: 0 };
  if (type === "click") return { paymentType: "click", cashAmount: 0, cardAmount: 0, clickAmount: total };

  cash = round2(cash);
  card = round2(card);
  click = round2(click);
  if (cash <= 0) throw new Error("For mixed payment, cashAmount must be positive");
  if (card <= 0 && click <= 0) throw new Error("For mixed payment, cardAmount or clickAmount must be positive");
  if (round2(cash + card + click) !== total) {
    throw new Error("For mixed payment, cashAmount + cardAmount + clickAmount must equal amount");
  }
  return { paymentType: "mixed", cashAmount: cash, cardAmount: card, clickAmount: click };
};

exports.createClient = async (req, res) => {
  try {
    const { name, phone, address, note } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Client name is required" });
    }

    if (phone) {
      const exists = await Client.findOne({ phone: String(phone).trim() }).lean();
      if (exists) return res.status(409).json({ message: "Client phone already exists" });
    }

    const client = await Client.create({
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : undefined,
      address,
      note,
    });

    return res.status(201).json({ message: "Client created successfully", client });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getClients = async (req, res) => {
  try {
    const { q, isActive, limit } = req.query;
    const query = {};

    if (isActive !== undefined) query.isActive = String(isActive) === "true";
    if (q) {
      const regex = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: regex }, { phone: regex }];
    }

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) normalizedLimit = 100;
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const clients = await Client.find(query).sort({ createdAt: -1 }).limit(normalizedLimit);
    return res.json(clients);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }
    const client = await Client.findById(id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(client);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, address, note, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    if (phone) {
      const existing = await Client.findOne({ phone, _id: { $ne: id } }).lean();
      if (existing) return res.status(409).json({ message: "Client phone already exists" });
    }

    const client = await Client.findByIdAndUpdate(
      id,
      { name, phone, address, note, isActive },
      { new: true, runValidators: true },
    );
    if (!client) return res.status(404).json({ message: "Client not found" });

    return res.json({ message: "Client updated successfully", client });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.addClientPayment = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { amount, paymentType, cashAmount, cardAmount, clickAmount, paymentDate, note, warehouseId } =
      req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    const resolvedWarehouseId = await resolveWarehouseForClient(req.user, warehouseId);
    const split = resolvePaymentSplit(paymentType, amount, cashAmount, cardAmount, clickAmount);

    let paymentDoc;
    await session.withTransaction(async () => {
      const client = await Client.findById(id).session(session);
      if (!client) throw new Error("Client not found");

      const dueSales = await Sale.find({
        clientId: id,
        warehouseId: resolvedWarehouseId,
        dueAmount: { $gt: 0 },
      })
        .sort({ createdAt: 1 })
        .session(session);

      const totalDebt = dueSales.reduce((sum, s) => sum + Number(s.dueAmount || 0), 0);
      if (totalDebt <= 0) throw new Error("Client has no outstanding debt");
      if (split.cashAmount + split.cardAmount + split.clickAmount > round2(totalDebt)) {
        throw new Error("Payment amount cannot be greater than outstanding debt");
      }

      let remaining = round2(split.cashAmount + split.cardAmount + split.clickAmount);
      for (const sale of dueSales) {
        if (remaining <= 0) break;
        const due = round2(sale.dueAmount || 0);
        const pay = Math.min(due, remaining);
        sale.dueAmount = round2(due - pay);
        sale.paidAmount = round2((sale.paidAmount || 0) + pay);
        await sale.save({ session });
        remaining = round2(remaining - pay);
      }

      const createdPayments = await ClientPayment.create(
        [
          {
            clientId: id,
            warehouseId: resolvedWarehouseId,
            amount: round2(split.cashAmount + split.cardAmount + split.clickAmount),
            paymentType: split.paymentType,
            cashAmount: split.cashAmount,
            cardAmount: split.cardAmount,
            clickAmount: split.clickAmount,
            paymentDate: paymentDate || new Date(),
            note,
            createdBy: req.user._id,
          },
        ],
        { session },
      );
      [paymentDoc] = createdPayments;
    });

    const populated = await ClientPayment.findById(paymentDoc._id)
      .populate("clientId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role");

    return res.status(201).json({ message: "Client payment saved successfully", payment: populated });
  } catch (error) {
    if (
      error.message.includes("Invalid") ||
      error.message.includes("required") ||
      error.message.includes("positive") ||
      error.message.includes("cannot") ||
      error.message.includes("outstanding") ||
      error.message.includes("not found")
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.getClientPayments = async (req, res) => {
  try {
    const { clientId, warehouseId, limit } = req.query;
    const query = {};

    if (clientId) {
      if (!mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json({ message: "Invalid clientId query" });
      }
      query.clientId = clientId;
    }

    const resolvedWarehouseId = await resolveWarehouseForClient(req.user, warehouseId);
    query.warehouseId = resolvedWarehouseId;

    let normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) normalizedLimit = 100;
    normalizedLimit = Math.min(normalizedLimit, 1000);

    const payments = await ClientPayment.find(query)
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(normalizedLimit)
      .populate("clientId", "name phone")
      .populate("warehouseId", "name")
      .populate("createdBy", "fullName role")
      .lean();

    return res.json(payments);
  } catch (error) {
    if (error.message.includes("Invalid") || error.message.includes("Send warehouseId")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};

exports.getClientLedger = async (req, res) => {
  try {
    const { id } = req.params;
    const { warehouseId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid client ID" });
    }

    const resolvedWarehouseId = await resolveWarehouseForClient(req.user, warehouseId);
    const client = await Client.findById(id).lean();
    if (!client) return res.status(404).json({ message: "Client not found" });

    const [sales, payments] = await Promise.all([
      Sale.find({ clientId: id, warehouseId: resolvedWarehouseId })
        .sort({ createdAt: -1 })
        .populate("createdBy", "fullName role")
        .populate("items.productId", "name model barcode")
        .lean(),
      ClientPayment.find({ clientId: id, warehouseId: resolvedWarehouseId })
        .sort({ paymentDate: -1, createdAt: -1 })
        .populate("createdBy", "fullName role")
        .lean(),
    ]);

    const totalSales = round2(sales.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0));
    const totalPaidAtSale = round2(sales.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0));
    const totalDue = round2(sales.reduce((sum, s) => sum + Number(s.dueAmount || 0), 0));
    const totalManualPayments = round2(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));

    return res.json({
      client,
      summary: {
        totalSales,
        totalPaidAtSale,
        totalManualPayments,
        outstandingDebt: totalDue,
      },
      sales,
      payments,
    });
  } catch (error) {
    if (error.message.includes("Invalid") || error.message.includes("Send warehouseId")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};
