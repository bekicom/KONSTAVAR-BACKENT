const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8090/api";
const suffix = String(Date.now());

const state = {
  adminToken: null,
  cashierToken: null,
  ids: {},
};

const stepResults = [];

const log = (message) => {
  console.log(message);
};

const remember = (key, value) => {
  state.ids[key] = value;
  return value;
};

const getId = (key) => {
  if (!state.ids[key]) {
    throw new Error(`Missing required id: ${key}`);
  }
  return state.ids[key];
};

const request = async (method, path, { token, body, expect, query } = {}) => {
  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (expect && response.status !== expect) {
    throw new Error(
      `${method} ${path} expected ${expect} but got ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  if (!expect && !response.ok) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  return { status: response.status, data };
};

const step = async (name, fn) => {
  const startedAt = Date.now();
  log(`\n[STEP] ${name}`);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    stepResults.push({ name, ok: true, durationMs });
    log(`[OK] ${name} (${durationMs}ms)`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    stepResults.push({ name, ok: false, durationMs, error: error.message });
    log(`[FAIL] ${name} (${durationMs}ms)`);
    throw error;
  }
};

const auth = {
  async createAdmin() {
    const body = {
      fullName: "System Admin",
      phone: `99890${suffix.slice(-7)}`,
      password: "Admin123!",
    };

    const response = await request("POST", "/create-admin", { body });
    remember("adminPhone", body.phone);
    remember("adminPassword", body.password);
    remember("adminId", response.data.admin._id);
  },

  async loginAdmin() {
    const response = await request("POST", "/login", {
      body: {
        phone: getId("adminPhone"),
        password: getId("adminPassword"),
      },
    });
    state.adminToken = response.data.token;
  },

  async loginCashier() {
    const response = await request("POST", "/login", {
      body: {
        phone: getId("cashierPhone"),
        password: getId("cashierPassword"),
      },
    });
    state.cashierToken = response.data.token;
  },
};

const createProductPayload = (index, categoryId, overrides = {}) => ({
  name: `Product ${index} ${suffix}`,
  model: `M-${index}`,
  categoryId,
  barcode: `P${suffix}${String(index).padStart(2, "0")}`,
  baseUnit: "dona",
  hasPackage: index % 4 === 0,
  packageQuantity: index % 4 === 0 ? 12 : null,
  purchasePrice: 1000 + index * 50,
  blockPurchasePrice: index % 4 === 0 ? (1000 + index * 50) * 12 : null,
  sellPrice: 1400 + index * 70,
  wholesalePrice: 1300 + index * 60,
  blockSellPrice: index % 4 === 0 ? (1400 + index * 70) * 12 : null,
  ...overrides,
});

const main = async () => {
  await step("Create admin", async () => {
    try {
      await auth.createAdmin();
    } catch (error) {
      if (!error.message.includes("Admin already exists")) {
        throw error;
      }
      throw new Error("Database is not empty or admin already exists. Expected empty database.");
    }
  });

  await step("Login admin", async () => {
    await auth.loginAdmin();
  });

  await step("Create temporary shop", async () => {
    const response = await request("POST", "/shops", {
      token: state.adminToken,
      body: {
        name: `Temp Shop ${suffix}`,
        address: "Temporary address",
      },
      expect: 201,
    });
    remember("tempShopId", response.data.shop._id);
    remember("tempShopWarehouseId", response.data.shop.warehouseId._id);
  });

  await step("Read and update temporary shop", async () => {
    await request("GET", "/shops", { token: state.adminToken, expect: 200 });
    await request("GET", `/shops/${getId("tempShopId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/shops/${getId("tempShopId")}`, {
      token: state.adminToken,
      body: { address: "Temporary address updated" },
      expect: 200,
    });
  });

  await step("Delete temporary shop", async () => {
    await request("DELETE", `/shops/${getId("tempShopId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create main shop", async () => {
    const response = await request("POST", "/shops", {
      token: state.adminToken,
      body: {
        name: `Main Shop ${suffix}`,
        address: "Main shop address",
      },
      expect: 201,
    });
    remember("mainShopId", response.data.shop._id);
    remember("mainShopWarehouseId", response.data.shop.warehouseId._id);
  });

  await step("Read and update main shop", async () => {
    await request("GET", "/shops", { token: state.adminToken, expect: 200 });
    await request("GET", `/shops/${getId("mainShopId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/shops/${getId("mainShopId")}`, {
      token: state.adminToken,
      body: { address: "Main shop address updated" },
      expect: 200,
    });
  });

  await step("Create central and blank warehouses", async () => {
    const central = await request("POST", "/warehouses/create", {
      token: state.adminToken,
      body: {
        name: `Central Warehouse ${suffix}`,
        address: "Central warehouse address",
      },
      expect: 201,
    });
    const blank = await request("POST", "/warehouses/create", {
      token: state.adminToken,
      body: {
        name: `Blank Warehouse ${suffix}`,
        address: "Blank warehouse address",
      },
      expect: 201,
    });
    remember("centralWarehouseId", central.data.warehouse._id);
    remember("blankWarehouseId", blank.data.warehouse._id);
  });

  await step("Read and update blank warehouse", async () => {
    await request("GET", "/warehouses/getall", { token: state.adminToken, expect: 200 });
    await request("GET", `/warehouses/${getId("blankWarehouseId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/warehouses/${getId("blankWarehouseId")}`, {
      token: state.adminToken,
      body: { address: "Blank warehouse address updated" },
      expect: 200,
    });
  });

  await step("Create categories", async () => {
    const mainCategories = [];
    for (const categoryName of ["Electronics", "Tools", "Home"]) {
      const response = await request("POST", "/categories", {
        token: state.adminToken,
        body: {
          name: `${categoryName} ${suffix}`,
          description: `${categoryName} description`,
        },
        expect: 201,
      });
      mainCategories.push(response.data.category._id);
    }

    const tempCategory = await request("POST", "/categories", {
      token: state.adminToken,
      body: {
        name: `Temp Category ${suffix}`,
        description: "Temporary category",
      },
      expect: 201,
    });

    remember("mainCategoryIds", mainCategories);
    remember("tempCategoryId", tempCategory.data.category._id);
  });

  await step("Read and update categories", async () => {
    await request("GET", "/categories", { token: state.adminToken, expect: 200 });
    await request("GET", `/categories/${getId("tempCategoryId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/categories/${getId("tempCategoryId")}`, {
      token: state.adminToken,
      body: {
        description: "Temporary category updated",
      },
      expect: 200,
    });
  });

  await step("Create temporary product and stock", async () => {
    const product = await request("POST", "/products", {
      token: state.adminToken,
      body: createProductPayload(99, getId("tempCategoryId"), {
        name: `Temp Product ${suffix}`,
        model: "TMP",
        barcode: `TMP${suffix}`,
      }),
      expect: 201,
    });
    remember("tempProductId", product.data.product._id);
    remember("tempProductBarcode", product.data.product.barcode);

    await request("GET", "/products", { token: state.adminToken, expect: 200 });
    await request("GET", `/products/get/${getId("tempProductId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/products/${getId("tempProductId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/products/barcode/${getId("tempProductBarcode")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/products/${getId("tempProductId")}`, {
      token: state.adminToken,
      body: { sellPrice: 1999 },
      expect: 200,
    });

    const stock = await request("POST", "/stocks", {
      token: state.adminToken,
      body: {
        productId: getId("tempProductId"),
        warehouseId: getId("blankWarehouseId"),
        quantity: "5",
      },
      expect: 201,
    });
    remember("tempStockId", stock.data.stock._id);
  });

  await step("Read update and delete temporary stock", async () => {
    await request("GET", "/stocks", { token: state.adminToken, expect: 200 });
    await request("GET", `/stocks/${getId("tempStockId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/${getId("blankWarehouseId")}/stock`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/stocks/${getId("tempStockId")}`, {
      token: state.adminToken,
      body: { quantity: "7" },
      expect: 200,
    });
    await request("DELETE", `/stocks/${getId("tempStockId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Delete temporary product category and blank warehouse", async () => {
    await request("DELETE", `/products/${getId("tempProductId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("DELETE", `/categories/${getId("tempCategoryId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("DELETE", `/warehouses/${getId("blankWarehouseId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create main products", async () => {
    const categoryIds = getId("mainCategoryIds");
    const productIds = [];
    const productBarcodes = [];

    for (let i = 1; i <= 20; i += 1) {
      const response = await request("POST", "/products", {
        token: state.adminToken,
        body: createProductPayload(i, categoryIds[(i - 1) % categoryIds.length]),
        expect: 201,
      });
      productIds.push(response.data.product._id);
      productBarcodes.push(response.data.product.barcode);
    }

    remember("mainProductIds", productIds);
    remember("mainProductBarcodes", productBarcodes);
  });

  await step("Update one main product", async () => {
    await request("PUT", `/products/${getId("mainProductIds")[0]}`, {
      token: state.adminToken,
      body: { sellPrice: 2500, wholesalePrice: 2300 },
      expect: 200,
    });
  });

  await step("Create suppliers and read/update them", async () => {
    const mainSupplier = await request("POST", "/suppliers", {
      token: state.adminToken,
      body: {
        name: `Main Supplier ${suffix}`,
        phone: `99891${suffix.slice(-7)}`,
        address: "Main supplier address",
        note: "Main supplier note",
      },
      expect: 201,
    });
    const tempSupplier = await request("POST", "/suppliers", {
      token: state.adminToken,
      body: {
        name: `Temp Supplier ${suffix}`,
        phone: `99893${suffix.slice(-7)}`,
        address: "Temp supplier address",
      },
      expect: 201,
    });

    remember("mainSupplierId", mainSupplier.data.supplier._id);
    remember("tempSupplierId", tempSupplier.data.supplier._id);

    await request("GET", "/suppliers", { token: state.adminToken, expect: 200 });
    await request("GET", `/suppliers/${getId("mainSupplierId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/suppliers/${getId("mainSupplierId")}`, {
      token: state.adminToken,
      body: { note: "Main supplier updated note" },
      expect: 200,
    });
  });

  await step("Delete temporary supplier", async () => {
    await request("DELETE", `/suppliers/${getId("tempSupplierId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create and manage temporary supplier payment", async () => {
    const payment = await request("POST", `/suppliers/${getId("mainSupplierId")}/payments`, {
      token: state.adminToken,
      body: {
        amount: "5000",
        note: "Temporary supplier payment",
      },
      expect: 201,
    });
    remember("tempSupplierPaymentId", payment.data.payment._id);

    await request("GET", "/supplier-payments", {
      token: state.adminToken,
      expect: 200,
      query: { supplierId: getId("mainSupplierId") },
    });
    await request("GET", `/supplier-payments/${getId("tempSupplierPaymentId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/supplier-payments/${getId("tempSupplierPaymentId")}`, {
      token: state.adminToken,
      body: { amount: "6000", note: "Temporary supplier payment updated" },
      expect: 200,
    });
    await request("DELETE", `/supplier-payments/${getId("tempSupplierPaymentId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create temporary purchase and delete it", async () => {
    const response = await request("POST", "/purchase", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        supplierId: getId("mainSupplierId"),
        paymentType: "cash",
        items: [
          {
            productId: getId("mainProductIds")[0],
            inputType: "unit",
            inputQuantity: "5",
            purchasePrice: "900",
          },
        ],
      },
      expect: 201,
    });
    remember("tempPurchaseId", response.data.purchase._id);

    await request("GET", "/purchases", {
      token: state.adminToken,
      expect: 200,
      query: { warehouseId: getId("centralWarehouseId") },
    });
    await request("GET", `/purchases/${getId("tempPurchaseId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/purchases/${getId("tempPurchaseId")}`, {
      token: state.adminToken,
      body: { paymentType: "cash" },
      expect: 200,
    });
    await request("DELETE", `/purchases/${getId("tempPurchaseId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create main cash and credit purchases", async () => {
    const productIds = getId("mainProductIds");
    const packagedProductIndexes = new Set([3, 7, 11, 15, 19]);

    const cashItems = productIds.slice(0, 10).map((productId, index) => {
      const globalIndex = index;
      const useBlock = packagedProductIndexes.has(globalIndex);
      return {
        productId,
        inputType: useBlock ? "block" : "unit",
        inputQuantity: useBlock ? "5" : String(40 + index * 5),
        purchasePrice: String(1000 + index * 30),
        sellPrice: String(1600 + index * 50),
        wholesalePrice: String(1500 + index * 40),
        blockPurchasePrice: useBlock ? String((1000 + index * 30) * 12) : undefined,
        blockSellPrice: useBlock ? String((1600 + index * 50) * 12) : undefined,
        sellPriceStrategy: "average",
      };
    });

    const creditItems = productIds.slice(10, 20).map((productId, index) => {
      const globalIndex = index + 10;
      const useBlock = packagedProductIndexes.has(globalIndex);
      return {
        productId,
        inputType: useBlock ? "block" : "unit",
        inputQuantity: useBlock ? "4" : String(45 + index * 5),
        purchasePrice: String(1100 + index * 25),
        sellPrice: String(1700 + index * 45),
        wholesalePrice: String(1600 + index * 35),
        blockPurchasePrice: useBlock ? String((1100 + index * 25) * 12) : undefined,
        blockSellPrice: useBlock ? String((1700 + index * 45) * 12) : undefined,
        sellPriceStrategy: "new",
      };
    });

    const cashPurchase = await request("POST", "/purchase", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        supplierId: getId("mainSupplierId"),
        paymentType: "cash",
        items: cashItems,
      },
      expect: 201,
    });

    const creditPurchase = await request("POST", "/purchase", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        supplierId: getId("mainSupplierId"),
        paymentType: "credit",
        paidAmount: "250000",
        items: creditItems,
      },
      expect: 201,
    });

    remember("mainCashPurchaseId", cashPurchase.data.purchase._id);
    remember("mainCreditPurchaseId", creditPurchase.data.purchase._id);
  });

  await step("Update main credit purchase and supplier ledger", async () => {
    await request("PUT", `/purchases/${getId("mainCreditPurchaseId")}`, {
      token: state.adminToken,
      body: {
        paidAmount: 300000,
      },
      expect: 200,
    });
    await request("GET", `/suppliers/${getId("mainSupplierId")}/ledger`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/suppliers/${getId("mainSupplierId")}/act-sverka`, {
      token: state.adminToken,
      expect: 200,
      query: {
        warehouseId: getId("centralWarehouseId"),
        paymentType: "credit",
        limit: 50,
      },
    });
  });

  await step("Create main supplier debt payment", async () => {
    const payment = await request("POST", `/suppliers/${getId("mainSupplierId")}/payments`, {
      token: state.adminToken,
      body: {
        amount: 120000,
        note: "Main supplier debt payment",
      },
      expect: 201,
    });
    remember("mainSupplierPaymentId", payment.data.payment._id);
  });

  await step("Create users and manage temporary user", async () => {
    const cashierPhone = `99895${suffix.slice(-7)}`;
    const cashierPassword = "Cashier123!";
    const cashier = await request("POST", "/create-user", {
      token: state.adminToken,
      body: {
        fullName: "Main Cashier",
        phone: cashierPhone,
        password: cashierPassword,
        role: "cashier",
        shopId: getId("mainShopId"),
      },
      expect: 201,
    });

    const tempUser = await request("POST", "/create-user", {
      token: state.adminToken,
      body: {
        fullName: "Temp Warehouse User",
        phone: `99897${suffix.slice(-7)}`,
        password: "Warehouse123!",
        role: "warehouse",
      },
      expect: 201,
    });

    remember("cashierId", cashier.data.user._id);
    remember("cashierPhone", cashierPhone);
    remember("cashierPassword", cashierPassword);
    remember("tempUserId", tempUser.data.user._id);

    await request("GET", "/users", { token: state.adminToken, expect: 200 });
    await request("GET", `/users/${getId("tempUserId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/users/${getId("tempUserId")}`, {
      token: state.adminToken,
      body: { fullName: "Temp Warehouse User Updated", isActive: true },
      expect: 200,
    });
    await request("DELETE", `/users/${getId("tempUserId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Login cashier", async () => {
    await auth.loginCashier();
  });

  await step("Create and update client", async () => {
    const client = await request("POST", "/clients", {
      token: state.adminToken,
      body: {
        name: `Main Client ${suffix}`,
        phone: `99899${suffix.slice(-7)}`,
        address: "Client address",
        note: "Client note",
      },
      expect: 201,
    });

    remember("mainClientId", client.data.client._id);

    await request("GET", "/clients", {
      token: state.adminToken,
      expect: 200,
      query: { q: "Main Client" },
    });
    await request("GET", `/clients/${getId("mainClientId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/clients/${getId("mainClientId")}`, {
      token: state.adminToken,
      body: { note: "Client note updated" },
      expect: 200,
    });
  });

  await step("Transfer products from central warehouse to shop", async () => {
    const transfer = await request("POST", `/shops/${getId("mainShopId")}/transfers`, {
      token: state.adminToken,
      body: {
        sourceWarehouseId: getId("centralWarehouseId"),
        note: "Initial shop transfer",
        items: getId("mainProductIds").slice(0, 12).map((productId, index) => ({
          productId,
          quantity: index < 6 ? 40 : 25,
        })),
      },
      expect: 201,
    });
    remember("mainTransferId", transfer.data.transfer._id);
    await request("GET", "/shops/transfers", {
      token: state.adminToken,
      expect: 200,
      query: { shopId: getId("mainShopId") },
    });
  });

  await step("Start cashier shift", async () => {
    const response = await request("POST", "/shifts/start", {
      token: state.cashierToken,
      body: {
        openingCash: 100000,
        note: "E2E shift",
      },
      expect: 201,
    });
    remember("mainShiftId", response.data.shift._id);

    await request("GET", "/shifts/current", {
      token: state.cashierToken,
      expect: 200,
    });
  });

  await step("Run sale helper endpoints before sales", async () => {
    const firstBarcode = getId("mainProductBarcodes")[0];
    await request("GET", `/sales/barcode/${firstBarcode}`, {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/search-products", {
      token: state.cashierToken,
      expect: 200,
      query: { q: "Product 1" },
    });
    await request("PUT", "/sales/quick-products", {
      token: state.cashierToken,
      body: { productIds: getId("mainProductIds").slice(0, 6) },
      expect: 200,
    });
    await request("GET", "/sales/quick-products", {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/top-products", {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/top-products/stats", {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/top-products/available", {
      token: state.cashierToken,
      expect: 200,
      query: { q: "Product" },
    });
  });

  await step("Create temporary cash sale and delete it", async () => {
    const tempSale = await request("POST", "/sales", {
      token: state.cashierToken,
      body: {
        items: [
          {
            productId: getId("mainProductIds")[0],
            inputType: "unit",
            inputQuantity: 2,
          },
        ],
        paymentType: "cash",
      },
      expect: 201,
    });
    remember("tempSaleId", tempSale.data.sale._id);
    await request("GET", `/sales/${getId("tempSaleId")}`, {
      token: state.cashierToken,
      expect: 200,
    });
    await request("DELETE", `/sales/${getId("tempSaleId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create main credit and mixed sales", async () => {
    const creditSale = await request("POST", "/sales", {
      token: state.cashierToken,
      body: {
        clientId: getId("mainClientId"),
        paymentType: "credit",
        paidAmount: 15000,
        cashAmount: 10000,
        cardAmount: 5000,
        items: [
          { productId: getId("mainProductIds")[0], inputType: "unit", inputQuantity: 5 },
          { productId: getId("mainProductIds")[1], inputType: "unit", inputQuantity: 4 },
          { productId: getId("mainProductIds")[2], inputType: "unit", inputQuantity: 3 },
        ],
        note: "Credit sale",
      },
      expect: 201,
    });

    const mixedSale = await request("POST", "/sales", {
      token: state.cashierToken,
      body: {
        paymentType: "mixed",
        cashAmount: 5000,
        cardAmount: 6000,
        clickAmount: 6000,
        items: [
          { productId: getId("mainProductIds")[3], inputType: "unit", inputQuantity: 4, unitSellPrice: 1500 },
          { productId: getId("mainProductIds")[4], inputType: "unit", inputQuantity: 4, unitSellPrice: 1500 },
          { productId: getId("mainProductIds")[5], inputType: "unit", inputQuantity: 4, unitSellPrice: 1250 },
        ],
        note: "Mixed sale",
      },
      expect: 201,
    });

    remember("mainCreditSaleId", creditSale.data.sale._id);
    remember("mainMixedSaleId", mixedSale.data.sale._id);
  });

  await step("Read sale data and helper endpoints after sales", async () => {
    await request("GET", "/sales", {
      token: state.cashierToken,
      expect: 200,
      query: { limit: 50 },
    });
    await request("GET", `/sales/${getId("mainCreditSaleId")}`, {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", `/sales/returns/search-barcode/${getId("mainProductBarcodes")[0]}`, {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/top-products/stats", {
      token: state.cashierToken,
      expect: 200,
      query: { days: 30, limit: 10 },
    });
    await request("GET", "/sales/top-products/available", {
      token: state.cashierToken,
      expect: 200,
    });
    await request("GET", "/sales/quick-products", {
      token: state.cashierToken,
      expect: 200,
    });
  });

  await step("Create sale return and read it", async () => {
    const saleReturn = await request("POST", "/sales/returns", {
      token: state.cashierToken,
      body: {
        saleId: getId("mainCreditSaleId"),
        refundType: "cash",
        items: [
          {
            productId: getId("mainProductIds")[0],
            returnQuantity: 1,
          },
        ],
        reason: "Customer return",
      },
      expect: 201,
    });
    remember("saleReturnId", saleReturn.data.saleReturn._id);

    await request("GET", `/sales/${getId("mainCreditSaleId")}/returns`, {
      token: state.cashierToken,
      expect: 200,
    });
  });

  await step("Pay client debt and read client ledger", async () => {
    const ledgerBeforePayment = await request("GET", `/clients/${getId("mainClientId")}/ledger`, {
      token: state.cashierToken,
      expect: 200,
      query: { warehouseId: getId("mainShopWarehouseId") },
    });
    const outstandingDebt = Number(
      ledgerBeforePayment.data?.summary?.outstandingDebt || 0,
    );
    const paymentAmount = Math.max(1, Math.min(outstandingDebt, 1000));

    const payment = await request("POST", `/clients/${getId("mainClientId")}/payments`, {
      token: state.cashierToken,
      body: {
        warehouseId: getId("mainShopWarehouseId"),
        amount: paymentAmount,
        paymentType: "cash",
        note: "Client debt payment",
      },
      expect: 201,
    });
    remember("clientPaymentId", payment.data.payment._id);

    await request("GET", "/client-payments", {
      token: state.cashierToken,
      expect: 200,
      query: { clientId: getId("mainClientId"), warehouseId: getId("mainShopWarehouseId") },
    });
    await request("GET", `/clients/${getId("mainClientId")}/ledger`, {
      token: state.cashierToken,
      expect: 200,
      query: { warehouseId: getId("mainShopWarehouseId") },
    });
  });

  await step("Create and delete temporary supplier return", async () => {
    const supplierReturn = await request("POST", "/supplier-returns", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        supplierId: getId("mainSupplierId"),
        note: "Temporary supplier return",
        items: [
          {
            productId: getId("mainProductIds")[10],
            inputType: "unit",
            inputQuantity: "2",
          },
        ],
      },
      expect: 201,
    });
    remember("tempSupplierReturnId", supplierReturn.data.supplierReturn._id);

    await request("GET", "/supplier-returns", {
      token: state.adminToken,
      expect: 200,
      query: { supplierId: getId("mainSupplierId") },
    });
    await request("GET", `/supplier-returns/${getId("tempSupplierReturnId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("DELETE", `/supplier-returns/${getId("tempSupplierReturnId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create update and delete temporary writeoff", async () => {
    const writeoff = await request("POST", "/writeoffs", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        reason: "Broken goods",
        note: "Temporary writeoff",
        items: [
          {
            productId: getId("mainProductIds")[11],
            inputType: "unit",
            inputQuantity: "3",
          },
        ],
      },
      expect: 201,
    });
    remember("tempWriteoffId", writeoff.data.writeoff._id);

    await request("GET", "/writeoffs", {
      token: state.adminToken,
      expect: 200,
      query: { warehouseId: getId("centralWarehouseId") },
    });
    await request("GET", `/writeoffs/${getId("tempWriteoffId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/writeoffs/${getId("tempWriteoffId")}`, {
      token: state.adminToken,
      body: { reason: "Broken goods updated", note: "Temporary writeoff updated" },
      expect: 200,
    });
    await request("DELETE", `/writeoffs/${getId("tempWriteoffId")}`, {
      token: state.adminToken,
      expect: 200,
    });
  });

  await step("Create cancel and post inventory sessions", async () => {
    const cancelSession = await request("POST", "/inventories/sessions", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        note: "Session to cancel",
      },
      expect: 201,
    });
    remember("cancelInventorySessionId", cancelSession.data.session._id);

    await request("GET", "/inventories/sessions", {
      token: state.adminToken,
      expect: 200,
      query: { warehouseId: getId("centralWarehouseId") },
    });
    await request("GET", `/inventories/sessions/${getId("cancelInventorySessionId")}`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("PUT", `/inventories/sessions/${getId("cancelInventorySessionId")}/count`, {
      token: state.adminToken,
      body: {
        items: [
          {
            productId: getId("mainProductIds")[0],
            countedQty: "97",
            reason: "Recounted",
          },
        ],
      },
      expect: 200,
    });
    await request("POST", `/inventories/sessions/${getId("cancelInventorySessionId")}/cancel`, {
      token: state.adminToken,
      expect: 200,
    });

    const postSession = await request("POST", "/inventories/sessions", {
      token: state.adminToken,
      body: {
        warehouseId: getId("centralWarehouseId"),
        note: "Session to post",
      },
      expect: 201,
    });
    remember("postInventorySessionId", postSession.data.session._id);
    await request("PUT", `/inventories/sessions/${getId("postInventorySessionId")}/count`, {
      token: state.adminToken,
      body: {
        items: [
          {
            productId: getId("mainProductIds")[1],
            countedQty: "111",
            reason: "Adjusted",
          },
        ],
      },
      expect: 200,
    });
    await request("POST", `/inventories/sessions/${getId("postInventorySessionId")}/post`, {
      token: state.adminToken,
      body: { autoFillUncounted: true },
      expect: 200,
    });
  });

  await step("Final stock and supplier checks", async () => {
    await request("GET", `/${getId("centralWarehouseId")}/stock`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/${getId("mainShopWarehouseId")}/stock`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/suppliers/${getId("mainSupplierId")}/ledger`, {
      token: state.adminToken,
      expect: 200,
    });
    await request("GET", `/suppliers/${getId("mainSupplierId")}/act-sverka`, {
      token: state.adminToken,
      expect: 200,
      query: { limit: 100 },
    });
  });

  const failed = stepResults.filter((result) => !result.ok);
  log("\n==== SUMMARY ====");
  log(`Total steps: ${stepResults.length}`);
  log(`Failed steps: ${failed.length}`);
  if (failed.length === 0) {
    log("All scripted endpoints completed successfully.");
  } else {
    for (const failure of failed) {
      log(`- ${failure.name}: ${failure.error}`);
    }
  }
};

main().catch((error) => {
  console.error("\nE2E run failed:");
  console.error(error.message);
  console.error("\nCompleted steps:");
  for (const result of stepResults) {
    console.error(`- ${result.ok ? "OK" : "FAIL"} ${result.name}`);
  }
  process.exit(1);
});
