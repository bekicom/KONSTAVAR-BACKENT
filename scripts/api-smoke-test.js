const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8090/api";
const adminPhone = process.env.ADMIN_PHONE || "+998901234567";
const adminPassword = process.env.ADMIN_PASSWORD || "0000";
const suffix = Date.now().toString();

const state = {
  token: null,
  shop: null,
  warehouseId: null,
  categoryId: null,
  fiscalProductId: null,
  packageProductId: null,
  purchaseId: null,
};

const log = (message) => console.log(message);

const request = async (method, path, { token, body, expect } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (expect && response.status !== expect) {
    throw new Error(
      `${method} ${path} expected ${expect} but got ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  if (!expect && !response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(data)}`);
  }

  return { status: response.status, data };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const step = async (name, fn) => {
  const startedAt = Date.now();
  log(`\n[STEP] ${name}`);
  await fn();
  log(`[OK] ${name} (${Date.now() - startedAt}ms)`);
};

const main = async () => {
  await step("Health route", async () => {
    const response = await request("GET", "/health", { expect: 200 });
    assert(response.data?.ok === true, "Health response should contain ok=true");
  });

  await step("404 fallback", async () => {
    const response = await request("GET", "/__smoke_missing_route__", { expect: 404 });
    assert(response.data?.message === "Route not found", "404 message mismatch");
    assert(response.data?.method === "GET", "404 method mismatch");
    assert(
      String(response.data?.path || "").includes("/__smoke_missing_route__"),
      "404 path mismatch",
    );
  });

  await step("Admin login", async () => {
    const response = await request("POST", "/login", {
      body: { phone: adminPhone, password: adminPassword },
      expect: 200,
    });
    assert(response.data?.token, "Admin token missing");
    state.token = response.data.token;
  });

  await step("Dashboard and sales history", async () => {
    const dashboard = await request("GET", "/dashboard", {
      token: state.token,
      expect: 200,
    });
    assert(dashboard.data?.overview, "Dashboard overview missing");
    assert(
      Object.prototype.hasOwnProperty.call(dashboard.data.overview, "currentPurchaseValue"),
      "Dashboard currentPurchaseValue missing",
    );
    assert(
      Object.prototype.hasOwnProperty.call(dashboard.data.overview, "currentRetailValue"),
      "Dashboard currentRetailValue missing",
    );

    const history = await request("GET", "/sales/history", {
      token: state.token,
      expect: 200,
    });
    assert(history.data?.summary, "Sales history summary missing");
    for (const key of [
      "fiscalTotal",
      "fiscalCashTotal",
      "fiscalCardTotal",
      "fiscalClickTotal",
      "fiscalCreditTotal",
    ]) {
      assert(Object.prototype.hasOwnProperty.call(history.data.summary, key), `${key} missing`);
    }
  });

  await step("Load warehouse", async () => {
    const shops = await request("GET", "/shops", {
      token: state.token,
      expect: 200,
    });
    const firstShop = Array.isArray(shops.data) ? shops.data[0] : shops.data?.items?.[0];
    assert(firstShop?._id, "No shop found for smoke test");
    assert(firstShop?.warehouseId?._id, "Shop warehouseId missing");
    state.shop = firstShop;
    state.warehouseId = firstShop.warehouseId._id;
  });

  await step("Create category", async () => {
    const response = await request("POST", "/categories", {
      token: state.token,
      body: { name: `Smoke Category ${suffix}` },
      expect: 201,
    });
    assert(response.data?.category?._id, "Category creation failed");
    state.categoryId = response.data.category._id;
  });

  await step("Fiscal product CRUD", async () => {
    const createResponse = await request("POST", "/fiscal-products", {
      token: state.token,
      body: {
        name: `Fiscal Smoke ${suffix}`,
        model: "MXIK",
        categoryId: state.categoryId,
        barcode: `FS${suffix}`,
        baseUnit: "dona",
        purchasePrice: 7000,
        price: 9800,
        classCode: "04820008001000000",
        packageCode: "",
        vatPercent: 0,
        hasPackage: false,
      },
      expect: 201,
    });

    assert(createResponse.data?.product?._id, "Fiscal product create failed");
    state.fiscalProductId = createResponse.data.product._id;

    await request("GET", `/fiscal-products/${state.fiscalProductId}`, {
      token: state.token,
      expect: 200,
    });

    const updateResponse = await request(
      "PUT",
      `/fiscal-products/${createResponse.data.product.classCode}`,
      {
        token: state.token,
        body: {
          price: 11000,
          packageCode: "PKG-SMOKE",
          vatPercent: 0,
        },
        expect: 200,
      },
    );

    assert(updateResponse.data?.product?.price === 11000, "Fiscal product price not updated");

    const deleteResponse = await request("DELETE", `/fiscal-products/${state.fiscalProductId}`, {
      token: state.token,
      expect: 200,
    });
    assert(
      deleteResponse.data?.message === "Fiscal product deleted successfully",
      "Fiscal product delete failed",
    );
  });

  await step("Package purchase create/update sync", async () => {
    const productResponse = await request("POST", "/products", {
      token: state.token,
      body: {
        name: `Package Smoke ${suffix}`,
        model: "PK",
        categoryId: state.categoryId,
        barcode: `PK${suffix}`,
        baseUnit: "dona",
        hasPackage: true,
        packageQuantity: 12,
        purchasePrice: 1000,
        blockPurchasePrice: 12000,
        sellPrice: 1500,
        blockSellPrice: 18000,
      },
      expect: 201,
    });

    state.packageProductId = productResponse.data?.product?._id;
    assert(state.packageProductId, "Package product create failed");

    const createPurchase = await request("POST", "/purchase", {
      token: state.token,
      body: {
        warehouseId: state.warehouseId,
        paymentType: "cash",
        supplier: {
          name: `Smoke Supplier ${suffix}`,
          phone: null,
          address: "",
        },
        items: [
          {
            productId: state.packageProductId,
            inputType: "block",
            inputQuantity: 2,
            blockPurchasePrice: 12000,
            sellPrice: 1500,
            blockSellPrice: 18000,
          },
        ],
      },
      expect: 201,
    });

    state.purchaseId = createPurchase.data?.purchase?._id;
    assert(state.purchaseId, "Purchase create failed");

    const updatePurchase = await request("PUT", `/purchases/${state.purchaseId}`, {
      token: state.token,
      body: {
        items: [
          {
            productId: state.packageProductId,
            inputType: "block",
            inputQuantity: 3,
            blockPurchasePrice: 18000,
            sellPrice: 1700,
            blockSellPrice: 20400,
          },
        ],
      },
      expect: 200,
    });

    assert(updatePurchase.data?.purchase?._id, "Purchase update failed");

    const updatedProduct = await request("GET", `/products/${state.packageProductId}`, {
      token: state.token,
      expect: 200,
    });

    assert(updatedProduct.data?.purchasePrice === 1500, "purchasePrice sync failed");
    assert(updatedProduct.data?.blockPurchasePrice === 18000, "blockPurchasePrice sync failed");
  });

  log("\nSmoke test completed successfully.");
};

main().catch((error) => {
  console.error("\nSmoke test failed:");
  console.error(error.message);
  process.exit(1);
});
