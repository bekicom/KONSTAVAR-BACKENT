/**
 * Atomarlik testi: transfer va kirim yarim holatda qolmasligini tekshiradi,
 * hamda fiskal endpoint tokensiz ochiq emasligini.
 *
 * `scripts/e2e-full-run.js` dan KEYIN ishga tushiriladi.
 *
 * MUHIM: tranzaksiyalar faqat replica set'da ishlaydi. Standalone mongod'da
 * `withTransaction` fallback yo'ldan ketadi va "bitta tranzaksiyada"
 * tekshiruvlari o'tmaydi (xulq-atvor testlari esa o'tadi).
 *
 * Lokal replica set:
 *   mongod --replSet rs0 --dbpath <dir> --port 27019
 *   mongosh --port 27019 --eval "rs.initiate()"
 *
 *   BASE_URL=http://127.0.0.1:8110/api  *   MONGO_RAW="mongodb://127.0.0.1:27019/?directConnection=true"  *   DB_NAME=konstavar_tx node scripts/atomic-smoke-test.js
 */
const { MongoClient, ObjectId } = require("mongodb");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8110/api";
const MONGO = process.env.MONGO_RAW || "mongodb://127.0.0.1:27019/?directConnection=true";
const DB = process.env.DB_NAME || "konstavar_tx";
const ADMIN_PASSWORD = "Admin123!";

let failures = 0;
const check = (label, ok, extra = "") => {
  if (ok) console.log(`  [OK]   ${label}`);
  else {
    failures += 1;
    console.log(`  [FAIL] ${label} ${extra}`);
  }
};

const req = async (m, p, { token, body } = {}) => {
  const h = {};
  if (token) h.authorization = "Bearer " + token;
  if (body) h["content-type"] = "application/json";
  const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { status: r.status, data: d };
};

const main = async () => {
  const client = new MongoClient(MONGO);
  await client.connect();
  const db = client.db(DB);
  const Stock = db.collection("stocks");
  const oplog = client.db("local").collection("oplog.rs");

  const admin = await db.collection("users").findOne({ role: "admin", shopId: null }, { sort: { createdAt: 1 } });
  const token = (await req("POST", "/login", { body: { phone: admin.phone, password: ADMIN_PASSWORD } })).data.token;

  const shops = (await req("GET", "/shops", { token })).data;
  const shop = shops[0];
  const shopWarehouseId = new ObjectId(String(shop.warehouseId._id || shop.warehouseId));

  const warehouses = (await req("GET", "/warehouses/getall", { token })).data;
  const centralRaw = warehouses.find((w) => w.name.startsWith("Central"));
  const central = { ...centralRaw, _id: new ObjectId(String(centralRaw._id)) };

  // Markaziy omborda qoldig'i bor ikki mahsulot
  const rows = await Stock.find({ warehouseId: central._id, quantity: { $gt: 5 } }).limit(2).toArray();
  if (rows.length < 2) throw new Error("Test uchun markaziy omborda 2 ta mahsulot kerak");
  const [a, b] = rows;

  const qtyOf = async (productId, warehouseId) => {
    const r = await Stock.findOne({ productId, warehouseId });
    return r ? Number(r.quantity) : 0;
  };

  console.log("\n== 1. Qoldiqdan oshiq transfer rad etiladi ==");
  const aBefore = await qtyOf(a.productId, central._id);
  const aShopBefore = await qtyOf(a.productId, shopWarehouseId);

  const tooMuch = await req("POST", `/shops/${shop._id}/transfers`, {
    token,
    body: { sourceWarehouseId: String(central._id), items: [{ productId: String(a.productId), quantity: aBefore + 1000 }] },
  });
  check("409 qaytadi", tooMuch.status === 409, `got ${tooMuch.status} ${JSON.stringify(tooMuch.data)}`);
  check("manba qoldiq o'zgarmagan", (await qtyOf(a.productId, central._id)) === aBefore, `${await qtyOf(a.productId, central._id)} != ${aBefore}`);
  check("do'kon qoldig'i o'zgarmagan", (await qtyOf(a.productId, shopWarehouseId)) === aShopBefore);

  console.log("\n== 2. Ikki qatorli transfer: ikkinchisi yetarli emas ==");
  // ENG MUHIM SINOV: tuzatishdan oldin birinchi qator ayirilib, ikkinchisida
  // xato chiqardi va qoldiq yarim holatda qolardi.
  const a2 = await qtyOf(a.productId, central._id);
  const b2 = await qtyOf(b.productId, central._id);
  const a2Shop = await qtyOf(a.productId, shopWarehouseId);

  const halfFail = await req("POST", `/shops/${shop._id}/transfers`, {
    token,
    body: {
      sourceWarehouseId: String(central._id),
      items: [
        { productId: String(a.productId), quantity: 1 },
        { productId: String(b.productId), quantity: b2 + 5000 },
      ],
    },
  });
  check("409 qaytadi", halfFail.status === 409, `got ${halfFail.status}`);
  check("1-mahsulot manbada o'zgarmagan (yarim holat yo'q)", (await qtyOf(a.productId, central._id)) === a2, `${await qtyOf(a.productId, central._id)} != ${a2}`);
  check("1-mahsulot do'konga kirmagan", (await qtyOf(a.productId, shopWarehouseId)) === a2Shop);
  check("2-mahsulot o'zgarmagan", (await qtyOf(b.productId, central._id)) === b2);

  console.log("\n== 3. To'g'ri transfer o'tadi va atomar yoziladi ==");
  const a3 = await qtyOf(a.productId, central._id);
  const a3Shop = await qtyOf(a.productId, shopWarehouseId);

  const ok = await req("POST", `/shops/${shop._id}/transfers`, {
    token,
    body: { sourceWarehouseId: String(central._id), items: [{ productId: String(a.productId), quantity: 2 }] },
  });
  check("201 qaytadi", ok.status === 201, `got ${ok.status} ${JSON.stringify(ok.data).slice(0, 150)}`);
  check("manbadan 2 ayirildi", (await qtyOf(a.productId, central._id)) === a3 - 2, `${await qtyOf(a.productId, central._id)} != ${a3 - 2}`);
  check("do'konga 2 qo'shildi", (await qtyOf(a.productId, shopWarehouseId)) === a3Shop + 2);

  const txEntry = await oplog
    .find({ "o.applyOps": { $exists: true } })
    .sort({ ts: -1 })
    .limit(10)
    .toArray();
  const transferTx = txEntry.find((e) => e.o.applyOps.some((o) => o.ns.endsWith(".shoptransfers")));
  check(
    "qoldiq va transfer hujjati bitta tranzaksiyada",
    Boolean(transferTx) && transferTx.o.applyOps.some((o) => o.ns.endsWith(".stocks")),
    transferTx ? [...new Set(transferTx.o.applyOps.map((o) => o.ns))].join(",") : "applyOps topilmadi",
  );

  console.log("\n== 4. Kirim (purchase) atomar yoziladi ==");
  const purchase = await req("POST", "/purchase", {
    token,
    body: {
      warehouseId: String(central._id),
      paymentType: "cash",
      items: [{ productId: String(a.productId), inputType: "unit", inputQuantity: 3, purchasePrice: 1000, sellPrice: 1500 }],
    },
  });
  check("201 qaytadi", purchase.status === 201, `got ${purchase.status} ${JSON.stringify(purchase.data).slice(0, 150)}`);

  const purchaseTx = (
    await oplog
      .find({ "o.applyOps": { $exists: true } })
      .sort({ ts: -1 })
      .limit(10)
      .toArray()
  ).find((e) => e.o.applyOps.some((o) => o.ns.endsWith(".purchases")));
  check(
    "qoldiq va kirim hujjati bitta tranzaksiyada",
    Boolean(purchaseTx) && purchaseTx.o.applyOps.some((o) => o.ns.endsWith(".stocks")),
    purchaseTx ? [...new Set(purchaseTx.o.applyOps.map((o) => o.ns))].join(",") : "applyOps topilmadi",
  );

  console.log("\n== 5. Fiskal endpoint endi tokensiz ochiq emas ==");
  const noAuth = await fetch(BASE + "/fiscal-products");
  check("401 qaytadi", noAuth.status === 401, `got ${noAuth.status}`);
  const withAuth = await req("GET", "/fiscal-products", { token });
  check("admin token bilan 200", withAuth.status === 200, `got ${withAuth.status}`);

  await client.close();
  console.log(`\n==== SUMMARY ====\nFailures: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
