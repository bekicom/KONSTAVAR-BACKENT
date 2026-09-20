# KONSTAVAR Backend Troubleshooting README

Bu hujjat faqat backend muammolarini jamlaydi. Frontendga oid gaplar kiritilmagan.
Maqsad: backend sherigi qaysi route/controller/model bo‘yicha nima muammo bo‘lganini,
nima sababdan chiqqanini va qanday tekshirish kerakligini tez ko‘rsatish.

## Bugungi backend fixlar

Bugun yopilgan asosiy backend muammolar:

- `GET /api/health` diagnostika route’i qo‘shildi.
- 404 fallback endi `method` va `path` bilan qaytadi.
- `fiscal-products` CRUD’da `PUT` va `DELETE` `_id` bilan birga `classCode` bo‘yicha ham topiladi.
- Fiskal payload uchun MXIK validatsiyasi mustahkamlandi.
- Kirim edit qilinganda qadoqli mahsulot narxlari sinxronlandi.
- `GET /api/sales/history` fiskal savdolarni `cash/card/click/credit` bo‘yicha ham qaytaradigan bo‘ldi.
- `GET /api/dashboard` asosiy panel uchun `currentPurchaseValue` va `currentRetailValue` qaytaradi.
- Omborlar kesimida ham `currentPurchaseValue` va `currentRetailValue` qo‘shildi.
- `DELETE /api/shops/:id` to‘liq cascade bilan ishlaydi.
- Smoke testlar yuqoridagi barcha o‘zgarishlarni tekshiradigan holatga keltirildi.

## 1. Umumiy simptom

Ko‘rilgan asosiy simptom:

- Ba’zi endpointlar avval ishlaydi, keyin `{"message":"Route not found"}` qaytara boshlaydi.
- `GET`, `PUT`, `DELETE` kabi so‘rovlar route topilmagandek ko‘rinadi.

Ehtimoliy backend sabablari:

- server eski build bilan yuribdi;
- reverse proxy boshqa process/portga yo‘naltiryapti;
- backend process qayta ishga tushgan, lekin noto‘g‘ri instance ishga chiqqan;
- route mount qismi buzilgan;
- request aslida route’ga yetib kelmayapti.

## 2. Qo‘shilgan diagnostika

### `GET /api/health`

`server.js` ga health endpoint qo‘shilgan.

Javob misoli:

```json
{
  "ok": true,
  "service": "konstavar",
  "version": "1.0.0",
  "cwd": "/path/to/project",
  "nodeEnv": "development",
  "mongoConfigured": true,
  "uptimeSec": 1234,
  "timestamp": "2026-07-12T12:00:00.000Z"
}
```

### 404 fallback

Endi fallback 404 quyidagicha qaytadi:

```json
{
  "message": "Route not found",
  "method": "DELETE",
  "path": "/api/fiscal-products/..."
}
```

Bu qaysi request route’ga yetib bormaganini aniqlashga yordam beradi.

## 3. Fiskal mahsulotlar

### Route

- `POST /api/fiscal-products`
- `GET /api/fiscal-products`
- `GET /api/fiscal-products/:id`
- `PUT /api/fiscal-products/:id`
- `DELETE /api/fiscal-products/:id`

### Kontroller

Fayl:

- [`controllers/fiscalProductController.js`](./controllers/fiscalProductController.js)

### Model

Fayl:

- [`models/FiscalProduct.js`](./models/FiscalProduct.js)

### Qoidalar

- `classCode` majburiy.
- `classCode` valid fiscal payload uchun aynan 17 ta raqam bo‘lishi kerak.
- `price` nolga teng bo‘lmasligi kerak.
- `isActive=true` bo‘lgan mahsulotlar fiskal savatga kiradi.

### Kuzatilgan muammo

`GET /api/sales/:saleId/fiscal/payload` ichida quyidagi xato chiqardi:

```json
{
  "message": "Fiskal mahsulot MXIK kodi noto'g'ri (aynan 17 ta raqam bo'lishi kerak)..."
}
```

### Sabab

Fiskal katalogdagi `classCode` qiymatlaridan bir qismi 17 xonali emas edi.
Masalan `MX1`, `MX2` kabi noto‘g‘ri qiymatlar testda ishlatilgan.

### Tuzatish

- Smoke testdagi fiskal mahsulotlar valid 17 xonali MXIKga o‘tkazildi.
- Fiskal payload generator faqat valid MXIKli faol mahsulotlarni ishlatadi.

## 4. Fiskal payload

### Route

- `GET /api/sales/:saleId/fiscal/payload`

### Kontroller

Fayl:

- [`controllers/saleController.js`](./controllers/saleController.js)

### Muhim qoida

Fiskal payload ishlashi uchun:

- faol fiskal mahsulotlar bo‘lishi kerak;
- `classCode` 17 ta raqam bo‘lishi kerak;
- `price > 0` bo‘lishi kerak.

### Xatolik xulq-atvori

Noto‘g‘ri MXIK bo‘lsa endpoint `400` qaytaradi.

## 5. Kirim edit

### Route

- `POST /api/purchase`
- `PUT /api/purchases/:id`
- `DELETE /api/purchases/:id`

### Kontroller

Fayl:

- [`controllers/purchaseController.js`](./controllers/purchaseController.js)

### Model

Fayl:

- [`models/Purchase.js`](./models/Purchase.js)

### Kuzatilgan muammo

Kirim edit qilinganda narx saqlangandek ko‘rinsa ham, `Product.purchasePrice`
va `Product.blockPurchasePrice` ba’zan o‘zgarmay qolardi.

### Sabab

Qadoqli mahsulotlarda unit narx va block narx sinxron emas edi.
Edit paytida bitta maydon yangilanib, ikkinchisi eski qiymatda qolardi.
Backend update logikasida esa bu holat noto‘g‘ri qayta ishlanardi.

### Tuzatish

`PUT /api/purchases/:id` ichida:

- qadoqli mahsulot uchun unit narx va block narx birga qayta hisoblanadi;
- `Product.purchasePrice` yangilanadi;
- `Product.blockPurchasePrice` ham mos ravishda qayta yoziladi;
- eski narx qaytib bosib ketmaydi.

### Smoke test natijasi

Yangi smoke test quyidagini tekshiradi:

- package product create;
- purchase create;
- purchase update;
- product’dagi `purchasePrice` yangilanganini tekshirish;
- product’dagi `blockPurchasePrice` yangilanganini tekshirish.

## 6. Smoke test

### Fayl

- [`scripts/api-smoke-test.js`](./scripts/api-smoke-test.js)

### Qo‘shilgan tekshiruvlar

- fiskal product create/update;
- fiscal payload;
- package product kirim create/update;
- purchase editdan keyin product narxi yangilanishi.
- shop delete with data:
  - stock;
  - purchase;
  - inventory session;
  - writeoff;
  - cashier;
  - shift;
  - quick products;
  - sale;
  - deletion code bilan delete;
  - shop va warehouse 404 bo‘lishi.

### Muhim natijalar

Smoke testda:

- package purchase update o‘tdi;
- product purchasePrice yangilanganini tekshirdi;
- product blockPurchasePrice yangilanganini tekshirdi;
- fiscal payload test valid MXIK bilan o‘tdi.

## 7. Hisobotlar bo‘limi: fiscal savdo kesimi

### Route

- `GET /api/sales/history`

### Kontroller

Fayl:

- [`controllers/saleController.js`](./controllers/saleController.js)

### Kuzatilgan muammo

Hisobotlar bo‘limida soliqqa yuborilgan savdolar faqat umumiy `fiscalTotal`
ko‘rinishida chiqardi. `cash`, `card`, `click` bo‘yicha fiskal kesim
alohida ko‘rinmas edi.

### Sabab

Backend summary’da fiskal bo‘lgan savdolar faqat bir umumiy summa sifatida
hisoblanardi. Ya’ni:

- `fiscalTotal` bor edi;
- lekin `fiscalCashTotal`, `fiscalCardTotal`, `fiscalClickTotal`,
  `fiscalCreditTotal` yo‘q edi.

### Tuzatish

`GET /api/sales/history` javobiga quyidagi maydonlar qo‘shildi:

- `summary.fiscalCashTotal`
- `summary.fiscalCardTotal`
- `summary.fiscalClickTotal`
- `summary.fiscalCreditTotal`

Bu qiymatlar faqat `fiscal.status == "success"` bo‘lgan savdolar ichidan
hisoblanadi.

### Natija

Endi backend Hisobotlar bo‘limi uchun quyidagilarni aniq qaytaradi:

- soliqqa yuborilgan jami savdo summasi;
- soliqqa yuborilgan naqd savdo summasi;
- soliqqa yuborilgan karta savdo summasi;
- soliqqa yuborilgan click savdo summasi;
- soliqqa yuborilgan credit savdo summasi.

## 8. Asosiy panel: kirim va qoldiq qiymati

### Route

- `GET /api/dashboard`

### Kontroller

Fayl:

- [`controllers/dashboardController.js`](./controllers/dashboardController.js)

### Kuzatilgan muammo

Asosiy bo‘limdagi `Jami kirim` va `Qoldiq qiymati` tarixiy kirimga bog‘liq
chiqib qolardi. Savdo bo‘lgandan keyin ham summa kamaymasdi.

### Sabab

`overview.totalPurchases` oldin tarixiy `Purchase.aggregate` dan olinardi.
Bu esa ombordagi hozirgi qoldiqni emas, o‘tgan barcha kirimlarni ko‘rsatardi.

### Tuzatish

`GET /api/dashboard` endi qo‘shimcha ravishda quyidagilarni qaytaradi:

- `overview.currentPurchaseValue`
- `overview.currentRetailValue`

Hisoblash formulasi:

- `currentPurchaseValue = quantity × purchasePrice`
- `currentRetailValue = quantity × sellPrice`

Bu qiymatlar `Stock` miqdori o‘zgarganda avtomatik kamayadi yoki oshadi.
Demak:

- kirimda qoldiq tan narxida ko‘rinadi;
- qoldiq esa sotuv narxida ko‘rinadi;
- savdo bo‘lsa ikkisi ham kamayadi.

### Natija

Masalan:

- 100 dona mahsulot `1000` so‘mdan kirim qilinsa:
  - kirim qiymati `100000`
  - qoldiq qiymati `150000`
- 1 dona sotilsa:
- kirim qiymati `99000`
- qoldiq qiymati `148500`

### Omborlar kesimi

`GET /api/dashboard` javobidagi `warehouses` ro‘yxati ham endi har bir ombor
uchun alohida qaytaradi:

- `currentPurchaseValue`
- `currentRetailValue`

Bu qiymatlar ombor kartasida ko‘rsatiladi:

- `Kirim qiymati` = ombordagi qoldiq tan narxida
- `Qoldiq qiymati` = ombordagi qoldiq sotuv narxida

## 9. Do'kon o'chirish: to'liq cascade

### Route

- `DELETE /api/shops/:id`

### Kontroller

Fayl:

- [`controllers/shopController.js`](./controllers/shopController.js)

### Kuzatilgan muammo

Kod bilan do'kon o'chirilayotganda ichidagi ma'lumotlar qolib ketardi yoki
frontend tomondan kod noto'g'ri yuborilgani uchun delete ishlamasdi.

### Sabab

Ikki xil muammo bor edi:

- Flutter delete payload’da `deletionCode` noto‘g‘ri yuborilardi;
- backend faqat ayrim shop-specific yozuvlarni tozalardi, qolgan
  warehouse bog‘liq hujjatlar saqlanib qolardi.

### Tuzatish

`DELETE /api/shops/:id` endi quyidagilarni o‘chiradi yoki tozalaydi:

- `ShopTransfer`
- `ShopQuickProduct`
- `Sale`
- `SaleReturn`
- `Purchase`
- `SupplierReturn`
- `ClientPayment`
- `InventorySession`
- `Writeoff`
- `StockAdjustment`
- `Stock`
- `Shift`
- shu shop’ga bog‘langan `Expense`
- shu shop’ga bog‘langan `User.shopId` qiymati `null` ga tushiriladi

So‘ng:

- `Shop` o‘chiriladi;
- unga tegishli `Warehouse` o‘chiriladi.

### Muhim eslatma

Delete kod talab qilinayotgan bo‘lsa, so‘rov body’sida `deletionCode` bo‘lishi
kerak. Flutter tomonda bu payload tuzatildi.

## 10. `fiscal-products` CRUD bo‘yicha eslatma

### `PUT /api/fiscal-products/:id`

- `_id` bo‘yicha ishlaydi;
- fallback sifatida `classCode` bo‘yicha ham topishga urunadi;
- duplicate `classCode` bo‘lsa `409` qaytaradi.

### `DELETE /api/fiscal-products/:id`

- `_id` bo‘yicha ishlaydi;
- fallback sifatida `classCode` bo‘yicha ham qidiradi.

## 11. Tekshirish tartibi

Prod’da backendni tekshirish uchun:

1. `GET /api/health`
2. `GET /api/fiscal-products`
3. `PUT /api/fiscal-products/:id`
4. `DELETE /api/fiscal-products/:id`
5. `GET /api/sales/:saleId/fiscal/payload`
6. `PUT /api/purchases/:id`

Agar 404 chiqsa:

- response body’da `method` va `path` ni ko‘ring;
- backend aynan qaysi process/build bilan yurayotganini tekshiring;
- route mount qismi `app.use("/api", require("./routes/mainRoutes"))` ekanini tasdiqlang.

## 12. Muhim fayllar

- [`server.js`](./server.js)
- [`routes/mainRoutes.js`](./routes/mainRoutes.js)
- [`controllers/fiscalProductController.js`](./controllers/fiscalProductController.js)
- [`controllers/purchaseController.js`](./controllers/purchaseController.js)
- [`controllers/saleController.js`](./controllers/saleController.js)
- [`scripts/api-smoke-test.js`](./scripts/api-smoke-test.js)
