/**
 * Do'kon bo'yicha cheklash (scope) va menyu ruxsatlari testi.
 *
 * `scripts/e2e-full-run.js` dan KEYIN ishga tushiriladi — u yaratgan admin,
 * do'kon, qoldiq va sotuvlar ustida ishlaydi.
 *
 *   BASE_URL=http://127.0.0.1:8090/api ADMIN_PHONE=998901234567  *     node scripts/scope-smoke-test.js
 *
 * `ADMIN_PHONE` berilmasa, `/create-admin` yaratgan admin telefoni
 * `MONGO_URI` dan topiladi.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:8099/api";
const resolveAdminPhone = async () => {
  if (process.env.ADMIN_PHONE) {
    return process.env.ADMIN_PHONE;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("ADMIN_PHONE yoki MONGO_URI berilishi kerak");
  }

  const mongoose = require("mongoose");
  const User = require("../models/User");
  await mongoose.connect(mongoUri);
  const admin = await User.findOne({ role: "admin", shopId: null })
    .select("phone")
    .sort({ createdAt: 1 })
    .lean();
  await mongoose.disconnect();

  if (!admin) {
    throw new Error("Bosh admin topilmadi");
  }
  return admin.phone;
};
const ADMIN_PASSWORD = "Admin123!";
const suffix = String(Date.now()).slice(-7);

let failures = 0;

const req = async (method, path, { token, body, query } = {}) => {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
};

const check = (label, ok, extra = "") => {
  if (ok) {
    console.log(`  [OK]   ${label}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${label} ${extra}`);
  }
};

const main = async () => {
  // 1. Bosh admin bilan kirish
  const adminPhone = await resolveAdminPhone();
  const login = await req("POST", "/login", { body: { phone: adminPhone, password: ADMIN_PASSWORD } });
  if (login.status !== 200) throw new Error("admin login failed: " + JSON.stringify(login.data));
  const bossToken = login.data.token;
  console.log("\n== 1. Bosh admin (do'konsiz) ==");
  check("login shopId bo'sh", !login.data.user.shopId, JSON.stringify(login.data.user.shopId));
  // Eski bosh admin `allowedMenuKeys` siz yaratilgan bo'lishi mumkin —
  // bo'sh ro'yxat "hammasiga ruxsat" degani.
  const bossMenus = login.data.user.allowedMenuKeys;
  check(
    "allowedMenuKeys: bo'sh (= hammasi) yoki 20 ta",
    bossMenus.length === 0 || bossMenus.length === 20,
    `got ${bossMenus.length}`,
  );

  // 2. Ikkinchi do'kon yaratamiz, endi 2 ta do'kon bor
  const shop2 = await req("POST", "/shops", {
    token: bossToken,
    body: { name: `Scope Shop ${suffix}`, address: "Scope addr" },
  });
  if (shop2.status !== 201) throw new Error("shop create failed: " + JSON.stringify(shop2.data));
  const shop2Id = shop2.data.shop._id;

  const allShops = await req("GET", "/shops", { token: bossToken });
  console.log("\n== 2. Do'konlar ro'yxati ==");
  check("bosh admin hamma do'konni ko'radi (>=2)", allShops.data.length >= 2, `got ${allShops.data.length}`);
  const totalShops = allShops.data.length;
  const shop1Id = allShops.data.find((s) => String(s._id) !== String(shop2Id))._id;

  // 3. Do'kon 2 ga biriktirilgan admin ("boshqaruvchi") yaratamiz,
  //    faqat 3 ta menyu bilan.
  const picked = ["overview", "shops", "stocks"];
  const scopedAdmin = await req("POST", "/create-user", {
    token: bossToken,
    body: {
      fullName: "Shop Scoped Admin",
      phone: `99893${suffix}`,
      password: "Admin123!",
      role: "admin",
      shopId: shop2Id,
      allowedMenuKeys: picked,
    },
  });
  console.log("\n== 3. Do'konga biriktirilgan admin yaratish ==");
  check("admin rolini yaratish mumkin", scopedAdmin.status === 201, JSON.stringify(scopedAdmin.data));
  check(
    "shopId saqlandi",
    String(scopedAdmin.data?.user?.shopId?._id || scopedAdmin.data?.user?.shopId) === String(shop2Id),
    JSON.stringify(scopedAdmin.data?.user?.shopId),
  );
  check(
    "tanlangan 3 menyu saqlandi",
    JSON.stringify((scopedAdmin.data?.user?.allowedMenuKeys || []).sort()) === JSON.stringify([...picked].sort()),
    JSON.stringify(scopedAdmin.data?.user?.allowedMenuKeys),
  );

  // 4. Shu admin bilan kirib, nimani ko'rishini tekshiramiz
  const scopedLogin = await req("POST", "/login", {
    body: { phone: `99893${suffix}`, password: "Admin123!" },
  });
  const scopedToken = scopedLogin.data.token;
  console.log("\n== 4. Biriktirilgan admin nimani ko'radi ==");
  check("login allowedMenuKeys = 3", scopedLogin.data.user.allowedMenuKeys.length === 3, JSON.stringify(scopedLogin.data.user.allowedMenuKeys));
  check("login shopWarehouseId bor", Boolean(scopedLogin.data.user.shopWarehouseId));

  const scopedShops = await req("GET", "/shops", { token: scopedToken });
  check(
    `do'konlar: 1 ta (bosh adminda ${totalShops})`,
    Array.isArray(scopedShops.data) && scopedShops.data.length === 1,
    JSON.stringify(scopedShops.data?.length),
  );
  check(
    "ko'rinayotgan do'kon — o'ziga biriktirilgani",
    String(scopedShops.data?.[0]?._id) === String(shop2Id),
  );

  const otherShop = await req("GET", `/shops/${shop1Id}`, { token: scopedToken });
  check("boshqa do'kon detali 404", otherShop.status === 404, `got ${otherShop.status}`);

  const scopedWarehouses = await req("GET", "/warehouses/getall", { token: scopedToken });
  const bossWarehouses = await req("GET", "/warehouses/getall", { token: bossToken });
  check(
    `omborlar: 1 ta (bosh adminda ${bossWarehouses.data.length})`,
    scopedWarehouses.data.length === 1,
    JSON.stringify(scopedWarehouses.data.length),
  );

  const scopedStocks = await req("GET", "/stocks", { token: scopedToken, query: { page: 1, limit: 100 } });
  const bossStocks = await req("GET", "/stocks", { token: bossToken, query: { page: 1, limit: 100 } });
  check(
    `qoldiq: o'z ombori bilan cheklangan (${scopedStocks.data.total} < ${bossStocks.data.total})`,
    scopedStocks.data.total < bossStocks.data.total,
  );
  check(
    "qoldiqdagi hamma yozuv o'z omborida",
    (scopedStocks.data.items || []).every(
      (row) => String(row.warehouseId?._id || row.warehouseId) === String(scopedLogin.data.user.shopWarehouseId),
    ),
  );

  const scopedSales = await req("GET", "/sales/history", { token: scopedToken });
  const bossSales = await req("GET", "/sales/history", { token: bossToken });
  check(
    `sotuv hisoboti cheklangan (${scopedSales.data?.summary?.totalSalesCount} < ${bossSales.data?.summary?.totalSalesCount})`,
    Number(scopedSales.data?.summary?.totalSalesCount ?? -1) <
      Number(bossSales.data?.summary?.totalSalesCount ?? 0),
  );
  check(
    `sotuv summasi cheklangan (${scopedSales.data?.summary?.totalSalesAmount} < ${bossSales.data?.summary?.totalSalesAmount})`,
    Number(scopedSales.data?.summary?.totalSalesAmount ?? -1) <
      Number(bossSales.data?.summary?.totalSalesAmount ?? 0),
  );

  const scopedShifts = await req("GET", "/shifts", { token: scopedToken, query: { page: 1, limit: 50 } });
  const bossShifts = await req("GET", "/shifts", { token: bossToken, query: { page: 1, limit: 50 } });
  check(
    `smenalar cheklangan (${scopedShifts.data.total} < ${bossShifts.data.total})`,
    scopedShifts.data.total < bossShifts.data.total,
  );

  const scopedUsers = await req("GET", "/users", { token: scopedToken, query: { page: 1, limit: 50 } });
  const bossUsers = await req("GET", "/users", { token: bossToken, query: { page: 1, limit: 50 } });
  check(
    `xodimlar cheklangan (${scopedUsers.data.total} < ${bossUsers.data.total})`,
    scopedUsers.data.total < bossUsers.data.total,
  );

  const scopedDash = await req("GET", "/dashboard", { token: scopedToken });
  const bossDash = await req("GET", "/dashboard", { token: bossToken });
  check("dashboard ishlaydi", scopedDash.status === 200, JSON.stringify(scopedDash.data).slice(0, 200));
  check(
    `dashboard omborlar: 1 ta (bosh adminda ${(bossDash.data?.warehouses || []).length})`,
    (scopedDash.data?.warehouses || []).length === 1,
    JSON.stringify((scopedDash.data?.warehouses || []).length),
  );
  check(
    `dashboard do'kon soni: 1 (bosh adminda ${bossDash.data?.shops?.total})`,
    scopedDash.data?.shops?.total === 1,
    JSON.stringify(scopedDash.data?.shops),
  );
  check(
    `dashboard overview.shops: 1 (bosh adminda ${bossDash.data?.overview?.shops})`,
    scopedDash.data?.overview?.shops === 1,
    JSON.stringify(scopedDash.data?.overview?.shops),
  );
  check(
    `dashboard savdosi cheklangan (${scopedDash.data?.overview?.totalSales} < ${bossDash.data?.overview?.totalSales})`,
    Number(scopedDash.data?.overview?.totalSales || 0) < Number(bossDash.data?.overview?.totalSales || 0),
  );

  // 4b. Boshqa do'kon/omborga ataylab murojaat — 403
  console.log("\n== 4b. Begona do'kon/omborga urinish ==");
  const shop1 = allShops.data.find((s) => String(s._id) === String(shop1Id));
  const otherWarehouseId = shop1.warehouseId?._id || shop1.warehouseId;

  const forcedReport = await req("GET", "/sales/history", {
    token: scopedToken,
    query: { warehouseId: otherWarehouseId },
  });
  check("begona ombor bilan hisobot 403", forcedReport.status === 403, `got ${forcedReport.status}`);

  const forcedWarehouse = await req("GET", `/warehouses/${otherWarehouseId}`, { token: scopedToken });
  check("begona ombor detali 403", forcedWarehouse.status === 403, `got ${forcedWarehouse.status}`);

  const forcedShopUpdate = await req("PUT", `/shops/${shop1Id}`, {
    token: scopedToken,
    body: { name: "Hacked Shop" },
  });
  check("begona do'konni tahrirlash 403", forcedShopUpdate.status === 403, `got ${forcedShopUpdate.status}`);

  const forcedStocks = await req("GET", "/stocks", {
    token: scopedToken,
    query: { warehouseId: otherWarehouseId, page: 1, limit: 10 },
  });
  check(
    "begona ombor qoldig'i bo'sh yoki 403",
    forcedStocks.status === 403 || (forcedStocks.data?.items || []).length === 0,
    `got ${forcedStocks.status} / ${(forcedStocks.data?.items || []).length}`,
  );

  // 5. /me yangi ruxsatlarni qaytaradimi
  console.log("\n== 5. Ruxsat o'zgarishi /me orqali ==");
  const scopedId = scopedAdmin.data.user._id;
  await req("PUT", `/users/${scopedId}`, {
    token: bossToken,
    body: {
      fullName: "Shop Scoped Admin",
      phone: `99893${suffix}`,
      role: "admin",
      isActive: true,
      shopId: shop2Id,
      allowedMenuKeys: ["overview"],
    },
  });
  const me = await req("GET", "/me", { token: scopedToken });
  check("/me 200", me.status === 200, JSON.stringify(me.data).slice(0, 200));
  check(
    "/me yangi menyu ro'yxatini qaytaradi (1 ta)",
    (me.data?.user?.allowedMenuKeys || []).length === 1,
    JSON.stringify(me.data?.user?.allowedMenuKeys),
  );
  check("/me shopWarehouseId beradi", Boolean(me.data?.user?.shopWarehouseId));

  // 6. Do'kon biriktirishni olib tashlash
  console.log("\n== 6. Biriktirishni olib tashlash ==");
  await req("PUT", `/users/${scopedId}`, {
    token: bossToken,
    body: {
      fullName: "Shop Scoped Admin",
      phone: `99893${suffix}`,
      role: "admin",
      isActive: true,
      shopId: null,
      allowedMenuKeys: ["overview", "shops"],
    },
  });
  const afterClear = await req("GET", "/shops", { token: scopedToken });
  check(
    `do'kon olib tashlangach hammasi ko'rinadi (${afterClear.data?.length} == ${totalShops})`,
    afterClear.data?.length === totalShops,
  );

  // 7. Buxgalter roli
  console.log("\n== 7. Buxgalter roli ==");
  const bugalter = await req("POST", "/create-user", {
    token: bossToken,
    body: {
      fullName: "Test Buxgalter",
      phone: `99894${suffix}`,
      password: "Admin123!",
      role: "bugalter",
    },
  });
  check("buxgalter yaratildi", bugalter.status === 201, JSON.stringify(bugalter.data));
  check(
    "buxgalter menyusi = fiscalProducts",
    JSON.stringify(bugalter.data?.user?.allowedMenuKeys) === JSON.stringify(["fiscalProducts"]),
    JSON.stringify(bugalter.data?.user?.allowedMenuKeys),
  );

  console.log(`\n==== SUMMARY ====\nFailures: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
