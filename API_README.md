# KONSTAVAR Backend API

Flutter frontend uchun tez tushuniladigan API qo'llanma.

## Base URL

Local:

```txt
http://127.0.0.1:8090/api
```

VPS / production:

```txt
https://konstavar2.ataway.uz/api
```

## Auth

Ko'p endpointlar `Bearer token` talab qiladi.

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

## Role'lar

- `admin`
- `warehouse`
- `cashier`

## Muhim shift qoida

Cashier login qilganda backend `activeShift` qaytaradi.

- Shift ochilmagan bo'lsa, cashier `sale` qila olmaydi.
- `sale` va `sale return` faqat ochiq shift ichiga yoziladi.
- Shift yopilganda shu shift ichidagi `sales` va `returns` summary qaytadi.

---

## 1. Auth

### 1.1 Admin yaratish

`POST /api/create-admin`

Body:

```json
{
  "fullName": "Admin",
  "phone": "+998901234567",
  "password": "0000"
}
```

### 1.2 Login

`POST /api/login`

Body:

```json
{
  "phone": "+998901234567",
  "password": "0000"
}
```

Response'da:

```json
{
  "message": "Login successful",
  "token": "JWT_TOKEN",
  "user": {
    "id": "USER_ID",
    "fullName": "Admin",
    "role": "admin",
    "shopId": null,
    "shopWarehouseId": null
  },
  "activeShift": null
}
```

Cashier login bo'lsa `activeShift` qaytadi.

### 1.3 Admin user yaratish

`POST /api/create-user`

Headers:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Body:

```json
{
  "fullName": "Kassa",
  "phone": "+998901234568",
  "password": "1234",
  "role": "cashier",
  "shopId": "SHOP_ID"
}
```

`role` faqat:

- `warehouse`
- `cashier`

`cashier` uchun `shopId` majburiy.

---

## 2. Shift / Smena

### 2.1 Current shift

`GET /api/shifts/current`

Faqat cashier.

Response:

```json
{
  "shift": null
}
```

yoki

```json
{
  "shift": {
    "_id": "SHIFT_ID",
    "status": "open",
    "openedAt": "2026-04-28T08:25:18.098Z",
    "shopId": "SHOP_ID",
    "warehouseId": "WAREHOUSE_ID"
  }
}
```

### 2.2 Shift ochish

`POST /api/shifts/start`

Headers:

```http
Authorization: Bearer <CASHIER_TOKEN>
```

Body:

```json
{
  "openingCash": 10000,
  "note": "Morning shift"
}
```

Fieldlar:

- `openingCash` - number, 0 yoki undan katta
- `note` - optional text

Response:

```json
{
  "message": "Shift started successfully",
  "shift": {
    "_id": "SHIFT_ID",
    "status": "open",
    "openingCash": 10000
  }
}
```

### 2.3 Shift yopish

`POST /api/shifts/:id/close`

Headers:

```http
Authorization: Bearer <CASHIER_OR_ADMIN_TOKEN>
```

Body:

```json
{
  "closingCash": 10150,
  "closeNote": "End of shift"
}
```

Fieldlar:

- `closingCash` - optional number
- `closeNote` - optional text

Response:

```json
{
  "message": "Shift closed successfully",
  "shift": {
    "_id": "SHIFT_ID",
    "status": "closed",
    "openingCash": 10000,
    "closingCash": 10150,
    "summary": {
      "salesCount": 1,
      "salesTotal": 151,
      "returnsCount": 0,
      "returnsTotal": 0,
      "expensesCount": 0,
      "expensesTotal": 0,
      "netTotal": 151,
      "netAfterExpenses": 151
    }
  }
}
```

### 2.4 Shifts list

`GET /api/shifts`

Query:

- `cashierId`
- `shopId`
- `status` = `open` / `closed`
- `from`
- `to`
- `limit`

### 2.5 Shift detail

`GET /api/shifts/:id`

Response:

```json
{
  "shift": { },
  "sales": [ ],
  "returns": [ ],
  "expenses": [ ],
  "summary": {
    "salesCount": 1,
    "salesTotal": 304,
    "returnsCount": 1,
    "returnsTotal": 152,
    "expensesCount": 1,
    "expensesTotal": 150,
    "netTotal": 152,
    "netAfterExpenses": 2
  }
}
```

Cashier faqat o'z shiftini ko'radi. Admin hammasini ko'radi.

---

## 3. Expenses / Xarajatlar

### 3.1 Xarajat yaratish

`POST /api/expenses`

Headers:

```http
Authorization: Bearer <TOKEN>
```

Body:

```json
{
  "amount": 150,
  "reason": "Taxi",
  "note": "Delivery expense"
}
```

Cashier bo'lsa:

- ochiq shift bo'lishi kerak
- `shiftId` avtomatik current open shiftga ulanadi

Admin / warehouse uchun ixtiyoriy `shiftId` berish mumkin:

```json
{
  "amount": 150,
  "reason": "Taxi",
  "note": "Delivery expense",
  "shiftId": "SHIFT_ID"
}
```

### 3.2 Xarajatlar listi

`GET /api/expenses`

Query:

- `shiftId`
- `createdBy`
- `reason`
- `from`
- `to`
- `minAmount`
- `maxAmount`
- `limit`

Cashier faqat o'z xarajatlarini ko'radi.

### 3.3 Xarajat detail

`GET /api/expenses/:id`

### 3.4 Xarajat update

`PUT /api/expenses/:id`

Body:

```json
{
  "amount": 180,
  "reason": "Taxi updated",
  "note": "Updated note"
}
```

Admin `shiftId` ni ham o'zgartirishi mumkin.

### 3.5 Xarajat delete

`DELETE /api/expenses/:id`

---

## 4. Shops

### 3.1 Shop yaratish

`POST /api/shops`

Headers:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

Body:

```json
{
  "name": "Shop 1",
  "warehouseId": "WAREHOUSE_ID"
}
```

### 3.2 Shops list

`GET /api/shops`

Role:

- `admin`
- `warehouse`
- `cashier`

### 3.3 Shop detail

`GET /api/shops/:id`

### 3.4 Shop update

`PUT /api/shops/:id`

Body misol:

```json
{
  "name": "New Shop Name"
}
```

### 3.5 Shop delete

`DELETE /api/shops/:id`

### 3.6 Shop transfer

`POST /api/shops/:id/transfers`

Body odatda transfer ma'lumotlari bilan keladi.

---

## 5. Warehouses

### 4.1 Warehouse yaratish

`POST /api/warehouses/create`

Body:

```json
{
  "name": "Main Warehouse",
  "address": "Tashkent"
}
```

### 4.2 Warehouses list

`GET /api/warehouses/getall`

### 4.3 Warehouse detail

`GET /api/warehouses/:id`

### 4.4 Warehouse update

`PUT /api/warehouses/:id`

Body:

```json
{
  "name": "Updated Warehouse",
  "address": "New address"
}
```

### 4.5 Warehouse delete

`DELETE /api/warehouses/:id`

### 4.6 Warehouse stock

`GET /api/:warehouseId/stock`

---

## 6. Products

### 5.1 Product yaratish

`POST /api/products`

Body misol:

```json
{
  "name": "Product Name",
  "model": "Model 1",
  "categoryId": "CATEGORY_ID",
  "barcode": "123456789",
  "baseUnit": "dona",
  "hasPackage": false,
  "packageQuantity": null,
  "purchasePrice": 100,
  "blockPurchasePrice": null,
  "sellPrice": 150,
  "wholesalePrice": 140,
  "miniSellPrice": 100,
  "minStockQuantity": 200,
  "reorderQuantity": 10,
  "blockSellPrice": null,
  "isActive": true
}
```

`minStockQuantity` - omborda shu miqdorga tushganda ogohlantirish.
`reorderQuantity` - shu darajaga tushganda tavsiya etiladigan buyurtma miqdori.

### 5.2 Products list

`GET /api/products`

### 5.3 Product by id

`GET /api/products/:id`

### 5.4 Product by barcode

`GET /api/products/barcode/:barcode`

### 5.5 Product update

`PUT /api/products/:id`

### 5.6 Product delete

`DELETE /api/products/:id`

---

## 7. Clients

### 6.1 Client yaratish

`POST /api/clients`

Body:

```json
{
  "name": "Ali",
  "phone": "+998901112233",
  "address": "Tashkent",
  "note": "Regular client"
}
```

### 6.2 Clients list

`GET /api/clients`

### 6.3 Client detail

`GET /api/clients/:id`

### 6.4 Client update

`PUT /api/clients/:id`

### 6.5 Client payment

`POST /api/clients/:id/payments`

Body:

```json
{
  "amount": 50000,
  "method": "cash",
  "note": "Partial payment"
}
```

### 6.6 Client ledger

`GET /api/clients/:id/ledger`

---

## 8. Suppliers

### 7.1 Supplier yaratish

`POST /api/suppliers`

Body:

```json
{
  "name": "Supplier 1",
  "phone": "+998901112244",
  "address": "Tashkent",
  "note": "Main supplier"
}
```

### 7.2 Suppliers list

`GET /api/suppliers`

### 7.3 Supplier detail

`GET /api/suppliers/:id`

### 7.4 Supplier update

`PUT /api/suppliers/:id`

### 7.5 Supplier delete

`DELETE /api/suppliers/:id`

### 7.6 Supplier payment

`POST /api/suppliers/:id/payments`

### 7.7 Supplier ledger

`GET /api/suppliers/:id/ledger`

### 7.8 Supplier act / sverka

`GET /api/suppliers/:id/act-sverka`

---

## 9. Purchases

### 8.1 Purchase yaratish

`POST /api/purchase`

Body misol:

```json
{
  "warehouseId": "WAREHOUSE_ID",
  "supplierId": "SUPPLIER_ID",
  "items": [
    {
      "productId": "PRODUCT_ID",
      "quantity": 10,
      "unitPrice": 100
    }
  ],
  "note": "Incoming purchase"
}
```

`supplierId` yuborilmasa backend default `Noma'lum yetkazib beruvchi` ni yaratib ishlatadi.
`supplier` obyektini ham yuborish mumkin:

```json
{
  "name": "Supplier name",
  "phone": "+998901112244",
  "address": "Tashkent",
  "note": "Main supplier"
}
```

Purchase ichida yangi product yaratishda ham shu maydonlarni yuborish mumkin:

```json
{
  "name": "New Product",
  "model": "NP-1",
  "hasPackage": false,
  "inputType": "unit",
  "inputQuantity": 10,
  "categoryId": "CATEGORY_ID",
  "purchasePrice": 5000,
  "sellPrice": 10000,
  "wholesalePrice": 7000,
  "miniSellPrice": 3000,
  "minStockQuantity": 200,
  "reorderQuantity": 10
}
```

### 8.2 Purchases list

`GET /api/purchases`

### 8.3 Purchase detail

`GET /api/purchases/:id`

### 8.4 Purchase update

`PUT /api/purchases/:id`

### 8.5 Purchase delete

`DELETE /api/purchases/:id`

---

## 10. Sales

### 9.1 Sale yaratish

`POST /api/sales`

Cashier uchun shift ochiq bo'lishi shart.

Body misol:

```json
{
  "warehouseId": "WAREHOUSE_ID",
  "items": [
    {
      "productId": "PRODUCT_ID",
      "inputType": "unit",
      "inputQuantity": 2,
      "priceType": "mini",
      "unitSellPrice": 100
    }
  ],
  "discount": 0,
  "paymentType": "cash",
  "cashAmount": 300,
  "cardAmount": 0,
  "clickAmount": 0,
  "clientId": null,
  "note": "Sale note"
}
```

`paymentType`:

- `cash`
- `card`
- `click`
- `mixed`
- `credit`

`priceType` item ichida ishlatilsa:

- `retail`
- `wholesale`
- `mini`
- `custom`

`unitSellPrice` berilsa, o'sha narx ishlatiladi. `priceType=mini` bo'lsa backend `miniSellPrice` ni oladi.

`miniSellPrice` dan tashqari:

- `wholesalePrice`
- `minStockQuantity`
- `reorderQuantity`

### 9.2 Sales list

`GET /api/sales`

Query:

- `warehouseId`
- `cashierId`
- `paymentType`
- `from`
- `to`
- `limit`
- `shiftId`  (admin uchun)

### 9.2a Sales history report

`GET /api/sales/history`

Faqat `admin`.

### Query

- `date` - `YYYY-MM-DD`
- `from`
- `to`
- `warehouseId`
- `cashierId`
- `shopId`
- `limit`
- `topLimit`

### Nima qaytadi

- `summary`
- `scope`
- `cashierBreakdown`
- `paymentBreakdown`
- `topProducts`
- `recentSales`

### Summary maydonlari

- `totalSalesCount`
- `totalSalesAmount`
- `cashTotal`
- `cardTotal`
- `clickTotal`
- `creditTotal`
- `paidAmountTotal`
- `averageCheck`

### Cashier breakdown

Har bir kassir uchun:

- `cashierId`
- `cashierName`
- `cashierPhone`
- `shopId`
- `shopName`
- `warehouseId`
- `totalSalesCount`
- `totalSalesAmount`
- `cashTotal`
- `cardTotal`
- `clickTotal`
- `paidAmountTotal`
- `averageCheck`

### Scope maydonlari

`scope` frontend uchun filterlarni avtomatik to'ldirishga xizmat qiladi.

- `scope.shops`
- `scope.warehouses`
- `scope.cashiers`

Frontendga shopId, cashierId yoki warehouseId oldindan berilmagan bo'lsa, faqat sana yuborish yetarli:

```txt
/api/sales/history?date=2026-04-30
```

### Misol

```txt
/api/sales/history?date=2026-04-30
```

### 9.3 Sale detail

`GET /api/sales/:id`

### 9.4 Sale delete

`DELETE /api/sales/:id`

### 9.5 Sale barcode search

`GET /api/sales/barcode/:barcode`

### 9.6 Sale product search

`GET /api/sales/search-products`

### 9.7 Quick products

`GET /api/sales/quick-products`

`PUT /api/sales/quick-products`

Body:

```json
{
  "productIds": [
    "PRODUCT_ID_1",
    "PRODUCT_ID_2"
  ]
}
```

### 9.8 Top products

`GET /api/sales/top-products`

`GET /api/sales/top-products/stats`

`GET /api/sales/top-products/available`

### 9.9 Sale return search

`GET /api/sales/returns/search-barcode/:barcode`

### 9.10 Sale return yaratish

`POST /api/sales/returns`

Cashier uchun shift ochiq bo'lishi shart.

Body misol:

```json
{
  "saleId": "SALE_ID",
  "items": [
    {
      "productId": "PRODUCT_ID",
      "returnQuantity": 1
    }
  ],
  "refundType": "cash",
  "cashAmount": 152,
  "cardAmount": 0,
  "clickAmount": 0,
  "reason": "Client returned item",
  "warehouseId": "WAREHOUSE_ID"
}
```

`refundType`:

- `cash`
- `card`
- `click`
- `mixed`

### 9.11 Sale return list by sale

`GET /api/sales/:id/returns`

---

## 11. Inventory Sessions

### 10.1 Inventory session yaratish

`POST /api/inventories/sessions`

Body misol:

```json
{
  "warehouseId": "WAREHOUSE_ID",
  "note": "Monthly inventory"
}
```

### 10.2 Inventory sessions list

`GET /api/inventories/sessions`

### 10.3 Inventory detail

`GET /api/inventories/sessions/:id`

### 10.4 Count update

`PUT /api/inventories/sessions/:id/count`

Body:

```json
{
  "items": [
    {
      "productId": "PRODUCT_ID",
      "countedQuantity": 100
    }
  ]
}
```

### 10.5 Post inventory

`POST /api/inventories/sessions/:id/post`

### 10.6 Cancel inventory

`POST /api/inventories/sessions/:id/cancel`

---

## 12. Writeoffs

### 11.1 Writeoff yaratish

`POST /api/writeoffs`

Body misol:

```json
{
  "warehouseId": "WAREHOUSE_ID",
  "items": [
    {
      "productId": "PRODUCT_ID",
      "quantity": 2
    }
  ],
  "reason": "Broken goods"
}
```

### 11.2 Writeoffs list

`GET /api/writeoffs`

### 11.3 Writeoff detail

`GET /api/writeoffs/:id`

### 11.4 Writeoff update

`PUT /api/writeoffs/:id`

### 11.5 Writeoff delete

`DELETE /api/writeoffs/:id`

---

## 13. Categories

### 12.1 Category yaratish

`POST /api/categories`

Body:

```json
{
  "name": "Beverages",
  "description": "Soft drinks"
}
```

### 12.2 Categories list

`GET /api/categories`

### 12.3 Category detail

`GET /api/categories/:id`

### 12.4 Category update

`PUT /api/categories/:id`

### 12.5 Category delete

`DELETE /api/categories/:id`

---

## 14. Dashboard

### 13.1 Dashboard

`GET /api/dashboard`

Faqat `admin`.

---

## 15. Flutter uchun qisqa flow

### Cashier flow

1. `POST /api/login`
2. `GET /api/shifts/current`
3. Agar `shift` yo'q bo'lsa `POST /api/shifts/start`
4. `POST /api/sales`
5. `POST /api/expenses` kerak bo'lsa
6. `POST /api/sales/returns` kerak bo'lsa
7. `POST /api/shifts/:id/close`
8. `GET /api/shifts/:id`

### Admin flow

1. `POST /api/login`
2. `GET /api/shops`, `GET /api/users`, `GET /api/warehouses/getall`
3. `POST /api/create-user`
4. `POST /api/products`
5. `POST /api/purchase`
6. `GET /api/shifts`

---

## 16. Eslatma

- `GET` endpointlar odatda body olmaydi.
- `POST` va `PUT` endpointlar `application/json` yuboradi.
- Cashier sale qilishdan oldin shift ochilgan bo'lishi kerak.
- Shift bo'yicha barcha sale/returnlar `shiftId` bilan saqlanadi.
