const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const warehouseC = require("../controllers/warehouseController");
const productController = require("../controllers/productController");
const purchaseController = require("../controllers/purchaseController");
const stockController = require("../controllers/stock.controller");
const supplierController = require("../controllers/supplierController");
const userController = require("../controllers/userController");
const supplierReturnController = require("../controllers/supplierReturnController");
const writeoffController = require("../controllers/writeoffController");
const categoryController = require("../controllers/categoryController");
const inventoryController = require("../controllers/inventoryController");
const saleController = require("../controllers/saleController");
const shopController = require("../controllers/shopController");
const clientController = require("../controllers/clientController");
const dashboardController = require("../controllers/dashboardController");
const shiftController = require("../controllers/shiftController");
const expenseController = require("../controllers/expenseController");
const salaryController = require("../controllers/salaryController");
const appSettingsController = require("../controllers/appSettingsController");
const fiscalProductController = require("../controllers/fiscalProductController");


// Admin create (faqat 1 marta)
router.post("/create-admin", authController.createAdmin);

// Login
router.post("/login", authController.login);

router.get("/me", authMiddleware, userController.getMe);

router.put("/me", authMiddleware, userController.updateMe);

router.put("/me/password", authMiddleware, userController.updateMyPassword);

router.get(
  "/shifts/current",
  authMiddleware,
  roleMiddleware("cashier"),
  shiftController.getCurrentShift,
);

router.post(
  "/shifts/start",
  authMiddleware,
  roleMiddleware("cashier"),
  shiftController.startShift,
);

router.post(
  "/shifts/close",
  authMiddleware,
  roleMiddleware("cashier"),
  shiftController.closeCurrentShift,
);

router.post(
  "/shifts/:id/close",
  authMiddleware,
  roleMiddleware("cashier", "admin"),
  shiftController.closeShift,
);

router.get(
  "/shifts",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  shiftController.getShifts,
);

router.get(
  "/shifts/:id",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  shiftController.getShiftById,
);

router.post(
  "/expenses",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  expenseController.createExpense,
);

router.get(
  "/expenses",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  expenseController.getExpenses,
);

router.get(
  "/expenses/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  expenseController.getExpenseById,
);

router.put(
  "/expenses/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  expenseController.updateExpense,
);

router.delete(
  "/expenses/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  expenseController.deleteExpense,
);

router.get(
  "/employees",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  salaryController.getEmployees,
);

router.post(
  "/salaries",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  salaryController.createSalary,
);

router.get(
  "/salaries",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  salaryController.getSalaries,
);

router.get(
  "/salaries/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  salaryController.getSalaryById,
);

router.put(
  "/salaries/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  salaryController.updateSalary,
);

router.delete(
  "/salaries/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  salaryController.deleteSalary,
);

router.get(
  "/dashboard",
  authMiddleware,
  roleMiddleware("admin"),
  dashboardController.getDashboard,
);

// CREATE
router.post(
  "/warehouses/create",
  authMiddleware,
  roleMiddleware("admin"),
  warehouseC.createWarehouse,
);

// GET ALL
router.get("/warehouses/getall", authMiddleware, warehouseC.getWarehouses);

// GET BY ID
router.get("/warehouses/:id", authMiddleware, warehouseC.getWarehouseById);

// UPDATE
router.put(
  "/warehouses/:id",
  authMiddleware,
  roleMiddleware("admin"),
  warehouseC.updateWarehouse,
);

// DELETE
router.delete(
  "/warehouses/:id",
  authMiddleware,
  roleMiddleware("admin"),
  warehouseC.deleteWarehouse,
);
router.get(
  "/:warehouseId/stock",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  stockController.getWarehouseStock,
);

// Admin warehouse/cashier yaratadi
router.post(
  "/create-user",
  authMiddleware,
  roleMiddleware("admin"),
  authController.createUser,
);

router.get(
  "/users",
  authMiddleware,
  roleMiddleware("admin"),
  userController.getUsers,
);

router.get(
  "/users/:id",
  authMiddleware,
  roleMiddleware("admin"),
  userController.getUserById,
);

router.put(
  "/users/:id",
  authMiddleware,
  roleMiddleware("admin"),
  userController.updateUser,
);

router.delete(
  "/users/:id",
  authMiddleware,
  roleMiddleware("admin"),
  userController.deleteUser,
);

router.post(
  "/clients",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.createClient,
);

router.get(
  "/clients",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.getClients,
);

router.get(
  "/clients/:id",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.getClientById,
);

router.put(
  "/clients/:id",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.updateClient,
);

router.post(
  "/clients/:id/payments",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.addClientPayment,
);

router.get(
  "/client-payments",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.getClientPayments,
);

router.get(
  "/clients/:id/ledger",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  clientController.getClientLedger,
);

router.post(
  "/suppliers",
  authMiddleware,
  roleMiddleware("admin"),
  supplierController.createSupplier,
);

router.get(
  "/suppliers",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSuppliers,
);

router.get(
  "/suppliers/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSupplierById,
);

router.put(
  "/suppliers/:id",
  authMiddleware,
  roleMiddleware("admin"),
  supplierController.updateSupplier,
);

router.delete(
  "/suppliers/:id",
  authMiddleware,
  roleMiddleware("admin"),
  supplierController.deleteSupplier,
);

router.post(
  "/suppliers/:id/payments",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.addSupplierPayment,
);

router.get(
  "/supplier-payments",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSupplierPayments,
);

router.get(
  "/supplier-payments/:paymentId",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSupplierPaymentById,
);

router.put(
  "/supplier-payments/:paymentId",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.updateSupplierPayment,
);

router.delete(
  "/supplier-payments/:paymentId",
  authMiddleware,
  roleMiddleware("admin"),
  supplierController.deleteSupplierPayment,
);

router.post(
  "/supplier-returns",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierReturnController.createSupplierReturn,
);

router.get(
  "/supplier-returns",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierReturnController.getSupplierReturns,
);

router.get(
  "/supplier-returns/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierReturnController.getSupplierReturnById,
);

router.delete(
  "/supplier-returns/:id",
  authMiddleware,
  roleMiddleware("admin"),
  supplierReturnController.deleteSupplierReturn,
);

router.post(
  "/writeoffs",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  writeoffController.createWriteoff,
);

router.get(
  "/writeoffs",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  writeoffController.getWriteoffs,
);

router.get(
  "/writeoffs/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  writeoffController.getWriteoffById,
);

router.put(
  "/writeoffs/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  writeoffController.updateWriteoff,
);

router.delete(
  "/writeoffs/:id",
  authMiddleware,
  roleMiddleware("admin"),
  writeoffController.deleteWriteoff,
);

router.get(
  "/suppliers/:id/ledger",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSupplierLedger,
);

router.get(
  "/suppliers/:id/act-sverka",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  supplierController.getSupplierActSverka,
);

router.post(
  "/categories",
  authMiddleware,
  roleMiddleware("admin"),
  categoryController.createCategory,
);

router.get(
  "/categories",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  categoryController.getCategories,
);

router.get(
  "/categories/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  categoryController.getCategoryById,
);

router.put(
  "/categories/:id",
  authMiddleware,
  roleMiddleware("admin"),
  categoryController.updateCategory,
);

router.delete(
  "/categories/:id",
  authMiddleware,
  roleMiddleware("admin"),
  categoryController.deleteCategory,
);

// CREATE
router.post(
  "/products",
  authMiddleware,
  roleMiddleware("admin"),
  productController.createProduct
);

// Diqqat: bu GET'lar avval tokensiz ochiq edi — mahsulot kelgan narxi
// (purchasePrice) va sotish narxlari internetdan ko'rinardi.
router.get(
  "/fiscal-products",
  authMiddleware,
  roleMiddleware("admin", "bugalter"),
  fiscalProductController.getFiscalProducts
);

router.get(
  "/fiscal-products/:id",
  authMiddleware,
  roleMiddleware("admin", "bugalter"),
  fiscalProductController.getFiscalProductById
);

router.post(
  "/fiscal-products",
  authMiddleware,
  roleMiddleware("admin", "bugalter"),
  fiscalProductController.saveFiscalProduct
);

router.put(
  "/fiscal-products/:id",
  authMiddleware,
  roleMiddleware("admin", "bugalter"),
  fiscalProductController.saveFiscalProduct
);

router.delete(
  "/fiscal-products/:id",
  authMiddleware,
  roleMiddleware("admin", "bugalter"),
  fiscalProductController.deleteFiscalProduct
);

// GET ALL
router.get(
  "/products",
  authMiddleware,
  productController.getProducts
);

router.get(
  "/products/barcode/:barcode",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  productController.getProductByBarcode
);

// GET BY ID
router.get(
  "/products/get/:id",
  authMiddleware,
  productController.getProductById
);

// GET BY ID
router.get(
  "/products/:id",
  authMiddleware,
  productController.getProductById
);

// UPDATE
router.put(
  "/products/:id",
  authMiddleware,
  roleMiddleware("admin"),
  productController.updateProduct
);

// DELETE
router.delete(
  "/products/:id",
  authMiddleware,
  roleMiddleware("admin"),
  productController.deleteProduct
);

router.post(
  "/purchase",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  purchaseController.createPurchase,
);

router.get(
  "/purchases",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  purchaseController.getPurchases,
);

router.get(
  "/purchases/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  purchaseController.getPurchaseById,
);

router.put(
  "/purchases/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  purchaseController.updatePurchase,
);

router.delete(
  "/purchases/:id",
  authMiddleware,
  roleMiddleware("admin"),
  purchaseController.deletePurchase,
);

router.post(
  "/stocks",
  authMiddleware,
  roleMiddleware("admin"),
  stockController.createStock,
);

router.get(
  "/stocks",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  stockController.getStocks,
);

// Diqqat: bu "/stocks/:id" dan oldin turishi shart, aks holda "search" id deb qabul qilinadi.
router.get(
  "/stocks/search",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  stockController.searchStocks,
);

router.get(
  "/stocks/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  stockController.getStockById,
);

router.put(
  "/stocks/:id",
  authMiddleware,
  roleMiddleware("admin"),
  stockController.updateStock,
);

router.delete(
  "/stocks/:id",
  authMiddleware,
  roleMiddleware("admin"),
  stockController.deleteStock,
);

router.post(
  "/shops",
  authMiddleware,
  roleMiddleware("admin"),
  shopController.createShop,
);

router.get(
  "/shops",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  shopController.getShops,
);

router.get(
  "/shops/transfers",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  shopController.getShopTransfers,
);

router.get(
  "/shops/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse", "cashier"),
  shopController.getShopById,
);

router.put(
  "/shops/:id",
  authMiddleware,
  roleMiddleware("admin"),
  shopController.updateShop,
);

router.delete(
  "/shops/:id",
  authMiddleware,
  roleMiddleware("admin"),
  shopController.deleteShop,
);

router.post(
  "/shops/:id/transfers",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  shopController.transferToShop,
);

router.post(
  "/sales",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.createSale,
);

router.get(
  "/sales",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getSales,
);

router.get(
  "/sales/history",
  authMiddleware,
  roleMiddleware("admin"),
  saleController.getSalesHistory,
);

router.get(
  "/sales/history/excel",
  authMiddleware,
  roleMiddleware("admin"),
  saleController.exportSalesHistoryExcel,
);

router.get(
  "/sales/barcode/:barcode",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getSaleProductByBarcode,
);

router.get(
  "/sales/search-products",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.searchSaleProducts,
);

router.get(
  "/sales/top-products",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getQuickSaleProducts,
);

router.get(
  "/sales/top-products/stats",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getTopSaleProductsStats,
);

router.get(
  "/sales/top-products/available",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getTopProductsAvailable,
);

router.get(
  "/sales/offline-catalog",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getOfflineSaleCatalog,
);

router.get(
  "/sales/quick-products",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getQuickSaleProducts,
);

router.put(
  "/sales/quick-products",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.setQuickSaleProducts,
);

router.get(
  "/sales/returns/search-barcode/:barcode",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.searchSaleHistoryByBarcode,
);

router.post(
  "/sales/returns",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.createSaleReturn,
);

router.get(
  "/sales/:id/returns",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getSaleReturnsBySaleId,
);

// 🔹 Fiskal (Soliq/OFD — E-POS) — tayyor payload olish va natijani saqlash
router.get(
  "/sales/:id/fiscal/payload",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getFiscalPayload,
);

router.post(
  "/sales/:id/fiscal",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.saveFiscalResult,
);

router.get(
  "/sales/:id",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  saleController.getSaleById,
);

router.delete(
  "/sales/:id",
  authMiddleware,
  roleMiddleware("admin"),
  saleController.deleteSale,
);

router.post(
  "/inventories/sessions",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.createInventorySession,
);

router.get(
  "/inventories/sessions",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.getInventorySessions,
);

router.get(
  "/inventories/sessions/:id",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.getInventorySessionById,
);

router.put(
  "/inventories/sessions/:id/count",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.updateInventoryCount,
);

router.post(
  "/inventories/sessions/:id/post",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.postInventorySession,
);

router.post(
  "/inventories/sessions/:id/cancel",
  authMiddleware,
  roleMiddleware("admin", "warehouse"),
  inventoryController.cancelInventorySession,
);

// 🔹 Tizim xavfsizlik sozlamalari (faqat admin) — do'kon/ombor o'chirish kodi
router.get(
  "/app-settings/security",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.getSecuritySettings,
);

router.put(
  "/app-settings/deletion-code",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.setDeletionCode,
);

router.delete(
  "/app-settings/deletion-code",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.disableDeletionCode,
);

// 🔹 To'liq sotuv hisoboti kodi (report code)
router.get(
  "/app-settings/report-code",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.getReportCodeStatus,
);

router.put(
  "/app-settings/report-code",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.setReportCode,
);

router.delete(
  "/app-settings/report-code",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.disableReportCode,
);

// Kodni tekshirish — kassir ham chaqira oladi (to'liq hisobotni ochish uchun)
router.post(
  "/app-settings/report-code/verify",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  appSettingsController.verifyReportCode,
);

// 🔹 Fiskal (Soliq/OFD — E-POS) kompaniya sozlamalari
// GET — kassir ham o'qiy oladi (fiscal.enabled, printerSize va h.k.)
router.get(
  "/app-settings/fiscal",
  authMiddleware,
  roleMiddleware("admin", "cashier"),
  appSettingsController.getFiscalSettings,
);

router.put(
  "/app-settings/fiscal",
  authMiddleware,
  roleMiddleware("admin"),
  appSettingsController.updateFiscalSettings,
);

module.exports = router;
