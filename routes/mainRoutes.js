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


// Admin create (faqat 1 marta)
router.post("/create-admin", authController.createAdmin);

// Login
router.post("/login", authController.login);

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

module.exports = router;
