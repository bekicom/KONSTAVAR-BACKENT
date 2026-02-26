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


// Admin create (faqat 1 marta)
router.post("/create-admin", authController.createAdmin);

// Login
router.post("/login", authController.login);

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
  roleMiddleware("warehouse"),
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

module.exports = router;
