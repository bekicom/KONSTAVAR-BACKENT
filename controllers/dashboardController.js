const mongoose = require("mongoose");
const Warehouse = require("../models/Warehouse");
const Shop = require("../models/Shop");
const Stock = require("../models/Stock");
const Sale = require("../models/Sale");
const SaleReturn = require("../models/SaleReturn");
const Purchase = require("../models/Purchase");
const SupplierReturn = require("../models/SupplierReturn");
const SupplierPayment = require("../models/SupplierPayment");
const ClientPayment = require("../models/ClientPayment");
const Writeoff = require("../models/Writeoff");
const InventorySession = require("../models/InventorySession");
const ShopTransfer = require("../models/ShopTransfer");
const Client = require("../models/Client");
const Supplier = require("../models/Supplier");

const round2 = (value) => Number(Number(value || 0).toFixed(2));
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfToday = () => {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
};

const toStartOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const toEndOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const resolveDashboardRange = (query) => {
  if (query.date) {
    const from = toStartOfDay(query.date);
    const to = toEndOfDay(query.date);
    if (!from || !to) {
      throw new Error("Invalid date. Use YYYY-MM-DD");
    }
    return {
      from,
      to,
      mode: "date",
      label: String(query.date),
    };
  }

  if (query.from || query.to) {
    const from = query.from ? toStartOfDay(query.from) : startOfToday();
    const to = query.to ? toEndOfDay(query.to) : endOfToday();

    if ((query.from && !from) || (query.to && !to)) {
      throw new Error("Invalid from/to date. Use YYYY-MM-DD");
    }
    if (from > to) {
      throw new Error("'from' cannot be greater than 'to'");
    }

    return {
      from,
      to,
      mode: "range",
      label: `${from.toISOString()} - ${to.toISOString()}`,
    };
  }

  return {
    from: startOfToday(),
    to: endOfToday(),
    mode: "today",
    label: "today",
  };
};

const toNumberMap = (rows, field = "total") =>
  new Map(rows.map((row) => [String(row._id), Number(row[field] || 0)]));

const toStatsMap = (rows) => {
  const map = new Map();
  for (const row of rows) {
    map.set(String(row._id), row);
  }
  return map;
};

exports.getDashboard = async (req, res) => {
  try {
    const lowStockThreshold = DEFAULT_LOW_STOCK_THRESHOLD;
    const period = resolveDashboardRange(req.query);

    const [
      warehouses,
      shops,
      stockSummaryRows,
      overviewRows,
      todaySalesRows,
      todayPurchaseRows,
      todaySaleReturnRows,
      todayWriteoffRows,
      todayClientPaymentRows,
      todayShopTransferRows,
      todayNewClientRows,
      clientDebtRows,
      purchaseDueRows,
      inventoryRows,
      lowStockRows,
      topClientDebtRows,
      purchaseDebtBySupplierRows,
      supplierPaymentBySupplierRows,
      supplierReturnBySupplierRows,
    ] = await Promise.all([
      Warehouse.find().sort({ createdAt: -1 }).lean(),
      Shop.find().populate("warehouseId", "name address isActive").lean(),
      Stock.aggregate([
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
          },
        },
        {
          $unwind: {
            path: "$product",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$warehouseId",
            stockUnits: { $sum: { $ifNull: ["$quantity", 0] } },
            stockProductsCount: { $sum: 1 },
            lowStockProducts: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gt: ["$quantity", 0] },
                      { $lte: ["$quantity", lowStockThreshold] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            outOfStockProducts: {
              $sum: {
                $cond: [{ $lte: ["$quantity", 0] }, 1, 0],
              },
            },
            estimatedCost: {
              $sum: {
                $multiply: [{ $ifNull: ["$quantity", 0] }, { $ifNull: ["$product.purchasePrice", 0] }],
              },
            },
            estimatedRetail: {
              $sum: {
                $multiply: [{ $ifNull: ["$quantity", 0] }, { $ifNull: ["$product.sellPrice", 0] }],
              },
            },
          },
        },
      ]),
      Promise.all([
        Sale.aggregate([
          {
            $group: {
              _id: null,
              totalSales: { $sum: "$totalAmount" },
              totalSalesCount: { $sum: 1 },
              totalSalesDue: { $sum: "$dueAmount" },
            },
          },
        ]),
        Purchase.aggregate([
          {
            $group: {
              _id: null,
              totalPurchases: { $sum: "$totalAmount" },
              totalPurchasesCount: { $sum: 1 },
              totalPurchaseDueRecorded: { $sum: "$dueAmount" },
            },
          },
        ]),
        SaleReturn.aggregate([
          {
            $group: {
              _id: null,
              totalSaleReturns: { $sum: "$subtotal" },
              totalSaleReturnsCount: { $sum: 1 },
            },
          },
        ]),
        SupplierReturn.aggregate([
          {
            $group: {
              _id: null,
              totalSupplierReturns: { $sum: "$totalAmount" },
              totalSupplierReturnsCount: { $sum: 1 },
            },
          },
        ]),
        Writeoff.aggregate([
          {
            $group: {
              _id: null,
              totalWriteoffs: { $sum: "$totalAmount" },
              totalWriteoffsCount: { $sum: 1 },
            },
          },
        ]),
        ClientPayment.aggregate([
          {
            $group: {
              _id: null,
              totalClientPayments: { $sum: "$amount" },
            },
          },
        ]),
        SupplierPayment.aggregate([
          {
            $group: {
              _id: null,
              totalSupplierPayments: { $sum: "$amount" },
            },
          },
        ]),
        Stock.aggregate([
          {
            $lookup: {
              from: "products",
              localField: "productId",
              foreignField: "_id",
              as: "product",
            },
          },
          {
            $unwind: {
              path: "$product",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $group: {
              _id: null,
              stockUnits: { $sum: { $ifNull: ["$quantity", 0] } },
              stockEstimatedCost: {
                $sum: {
                  $multiply: [{ $ifNull: ["$quantity", 0] }, { $ifNull: ["$product.purchasePrice", 0] }],
                },
              },
              stockEstimatedRetail: {
                $sum: {
                  $multiply: [{ $ifNull: ["$quantity", 0] }, { $ifNull: ["$product.sellPrice", 0] }],
                },
              },
            },
          },
        ]),
      ]),
      Sale.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$totalAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Purchase.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$totalAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      SaleReturn.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$subtotal" },
            count: { $sum: 1 },
          },
        },
      ]),
      Writeoff.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$totalAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
      ClientPayment.aggregate([
        { $match: { paymentDate: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      ShopTransfer.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: "$destinationWarehouseId",
            count: { $sum: 1 },
            quantity: { $sum: { $sum: "$items.quantity" } },
          },
        },
      ]),
      Client.aggregate([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
          },
        },
      ]),
      Sale.aggregate([
        { $match: { dueAmount: { $gt: 0 } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$dueAmount" },
          },
        },
      ]),
      Purchase.aggregate([
        { $match: { dueAmount: { $gt: 0 } } },
        {
          $group: {
            _id: "$warehouseId",
            total: { $sum: "$dueAmount" },
          },
        },
      ]),
      InventorySession.aggregate([
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$warehouseId",
            status: { $first: "$status" },
            createdAt: { $first: "$createdAt" },
            postedAt: { $first: "$postedAt" },
            summary: { $first: "$summary" },
          },
        },
      ]),
      Stock.aggregate([
        { $match: { quantity: { $lte: lowStockThreshold } } },
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
          },
        },
        {
          $lookup: {
            from: "warehouses",
            localField: "warehouseId",
            foreignField: "_id",
            as: "warehouse",
          },
        },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        { $unwind: { path: "$warehouse", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            quantity: 1,
            warehouseId: 1,
            productId: 1,
            productName: "$product.name",
            productModel: "$product.model",
            barcode: "$product.barcode",
            baseUnit: "$product.baseUnit",
            warehouseName: "$warehouse.name",
          },
        },
        { $sort: { quantity: 1, updatedAt: -1 } },
        { $limit: 20 },
      ]),
      Sale.aggregate([
        { $match: { dueAmount: { $gt: 0 }, clientId: { $ne: null } } },
        {
          $group: {
            _id: "$clientId",
            totalDebt: { $sum: "$dueAmount" },
            salesCount: { $sum: 1 },
            lastSaleAt: { $max: "$createdAt" },
          },
        },
        { $sort: { totalDebt: -1, lastSaleAt: -1 } },
        { $limit: 10 },
      ]),
      Purchase.aggregate([
        { $group: { _id: "$supplierId", totalDueRecorded: { $sum: "$dueAmount" } } },
      ]),
      SupplierPayment.aggregate([
        { $group: { _id: "$supplierId", totalPaid: { $sum: "$amount" } } },
      ]),
      SupplierReturn.aggregate([
        { $group: { _id: "$supplierId", totalReturned: { $sum: "$totalAmount" } } },
      ]),
    ]);

    const [
      saleOverview = {},
      purchaseOverview = {},
      saleReturnOverview = {},
      supplierReturnOverview = {},
      writeoffOverview = {},
      clientPaymentOverview = {},
      supplierPaymentOverview = {},
      stockOverview = {},
    ] = overviewRows.map((rows) => rows[0] || {});

    const shopByWarehouseId = new Map(
      shops.map((shop) => [String(shop.warehouseId?._id || shop.warehouseId), shop]),
    );

    const stockSummaryMap = toStatsMap(stockSummaryRows);
    const todaySalesMap = toStatsMap(todaySalesRows);
    const todayPurchaseMap = toStatsMap(todayPurchaseRows);
    const todaySaleReturnMap = toStatsMap(todaySaleReturnRows);
    const todayWriteoffMap = toStatsMap(todayWriteoffRows);
    const todayClientPaymentMap = toStatsMap(todayClientPaymentRows);
    const todayTransferMap = toStatsMap(todayShopTransferRows);
    const clientDebtMap = toNumberMap(clientDebtRows);
    const purchaseDueMap = toNumberMap(purchaseDueRows);
    const inventoryMap = toStatsMap(inventoryRows);

    const warehouseItems = warehouses.map((warehouse) => {
      const key = String(warehouse._id);
      const stock = stockSummaryMap.get(key) || {};
      const salesToday = todaySalesMap.get(key) || {};
      const purchasesToday = todayPurchaseMap.get(key) || {};
      const saleReturnsToday = todaySaleReturnMap.get(key) || {};
      const writeoffsToday = todayWriteoffMap.get(key) || {};
      const clientPaymentsToday = todayClientPaymentMap.get(key) || {};
      const transfersToday = todayTransferMap.get(key) || {};
      const inventory = inventoryMap.get(key) || {};
      const shop = shopByWarehouseId.get(key) || null;

      return {
        warehouseId: warehouse._id,
        name: warehouse.name,
        isActive: warehouse.isActive,
        isShopWarehouse: Boolean(shop),
        stockUnits: round2(stock.stockUnits),
        lowStockProducts: Number(stock.lowStockProducts || 0),
        outOfStockProducts: Number(stock.outOfStockProducts || 0),
        stockValue: round2(stock.estimatedRetail),
        periodSalesTotal: round2(salesToday.total),
        periodPurchaseTotal: round2(purchasesToday.total),
        clientDebtTotal: round2(clientDebtMap.get(key)),
        purchaseDueRecorded: round2(purchaseDueMap.get(key)),
        lastInventoryStatus: inventory._id ? inventory.status : null,
      };
    });

    const clientIds = topClientDebtRows.map((row) => row._id).filter(Boolean);
    const clients = clientIds.length
      ? await Client.find({ _id: { $in: clientIds } }).select("name phone").lean()
      : [];
    const clientMap = new Map(clients.map((client) => [String(client._id), client]));

    const supplierIds = Array.from(
      new Set([
        ...purchaseDebtBySupplierRows.map((row) => String(row._id)),
        ...supplierPaymentBySupplierRows.map((row) => String(row._id)),
        ...supplierReturnBySupplierRows.map((row) => String(row._id)),
      ]),
    )
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));

    const suppliers = supplierIds.length
      ? await Supplier.find({ _id: { $in: supplierIds } }).select("name phone isActive").lean()
      : [];
    const supplierMap = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
    const supplierPaidMap = toNumberMap(supplierPaymentBySupplierRows, "totalPaid");
    const supplierReturnedMap = toNumberMap(supplierReturnBySupplierRows, "totalReturned");

    const topSupplierDebts = purchaseDebtBySupplierRows
      .map((row) => {
        const supplierId = String(row._id);
        const totalDueRecorded = Number(row.totalDueRecorded || 0);
        const totalPaid = Number(supplierPaidMap.get(supplierId) || 0);
        const totalReturned = Number(supplierReturnedMap.get(supplierId) || 0);
        const outstandingDebt = round2(totalDueRecorded - totalPaid - totalReturned);
        return {
          supplierId: row._id,
          supplierName: supplierMap.get(supplierId)?.name || null,
          outstandingDebt,
        };
      })
      .filter((row) => row.outstandingDebt > 0)
      .sort((a, b) => b.outstandingDebt - a.outstandingDebt)
      .slice(0, 3);

    const totalSupplierDebt = round2(
      topSupplierDebts.reduce((sum, item) => sum + Number(item.outstandingDebt || 0), 0) +
        purchaseDebtBySupplierRows
          .filter((row) => !topSupplierDebts.find((item) => String(item.supplierId) === String(row._id)))
          .reduce((sum, row) => {
            const supplierId = String(row._id);
            const outstandingDebt =
              Number(row.totalDueRecorded || 0) -
              Number(supplierPaidMap.get(supplierId) || 0) -
              Number(supplierReturnedMap.get(supplierId) || 0);
            return outstandingDebt > 0 ? sum + outstandingDebt : sum;
          }, 0),
    );

    const topClientDebts = topClientDebtRows.map((row) => ({
      clientId: row._id,
      clientName: clientMap.get(String(row._id))?.name || null,
      outstandingDebt: round2(row.totalDebt),
    })).slice(0, 3);

    const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive).length;
    const activeShops = shops.filter((shop) => shop.isActive).length;
    const overview = {
      totalSales: round2(saleOverview.totalSales),
      totalPurchases: round2(purchaseOverview.totalPurchases),
      stockValue: round2(stockOverview.stockEstimatedRetail),
      clientDebt: round2(saleOverview.totalSalesDue),
      supplierDebt: totalSupplierDebt,
      warehouses: activeWarehouses,
      shops: activeShops,
    };

    const periodSummary = {
      from: period.from,
      to: period.to,
      totalSales: round2(todaySalesRows.reduce((sum, row) => sum + Number(row.total || 0), 0)),
      totalPurchases: round2(todayPurchaseRows.reduce((sum, row) => sum + Number(row.total || 0), 0)),
      totalSaleReturns: round2(todaySaleReturnRows.reduce((sum, row) => sum + Number(row.total || 0), 0)),
      totalWriteoffs: round2(todayWriteoffRows.reduce((sum, row) => sum + Number(row.total || 0), 0)),
      totalClientPayments: round2(
        todayClientPaymentRows.reduce((sum, row) => sum + Number(row.total || 0), 0),
      ),
      totalTransfers: todayShopTransferRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
      newClientsCount: Number(todayNewClientRows[0]?.count || 0),
    };

    const stockSummary = {
      totalUnits: round2(stockOverview.stockUnits),
      totalValue: round2(stockOverview.stockEstimatedRetail),
      lowStockProductsCount: lowStockRows.filter((row) => Number(row.quantity || 0) > 0).length,
      outOfStockProductsCount: lowStockRows.filter((row) => Number(row.quantity || 0) <= 0).length,
    };

    const debtSummary = {
      clients: {
        total: round2(saleOverview.totalSalesDue),
        top: topClientDebts,
      },
      suppliers: {
        total: totalSupplierDebt,
        top: topSupplierDebts,
      },
    };

    const shopSummary = {
      total: shops.length,
      active: activeShops,
      inactive: shops.length - activeShops,
    };

    const warehouseSummary = warehouseItems.map((item) => ({
      warehouseId: item.warehouseId,
      name: item.name,
      stockUnits: item.stockUnits,
      lowStockProducts: item.lowStockProducts,
      outOfStockProducts: item.outOfStockProducts,
      stockValue: item.stockValue,
      sales: item.periodSalesTotal,
      purchases: item.periodPurchaseTotal,
      clientDebtTotal: item.clientDebtTotal,
      supplierDebtTotal: item.purchaseDueRecorded,
    })).sort((a, b) => b.sales - a.sales);

    return res.json({
      generatedAt: new Date(),
      filters: {
        date: req.query.date || null,
        from: req.query.from || null,
        to: req.query.to || null,
      },
      overview,
      period: periodSummary,
      stock: stockSummary,
      shops: shopSummary,
      debts: debtSummary,
      warehouses: warehouseSummary,
    });
  } catch (error) {
    if (error.message.includes("Invalid date") || error.message.includes("'from' cannot")) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: error.message });
  }
};
