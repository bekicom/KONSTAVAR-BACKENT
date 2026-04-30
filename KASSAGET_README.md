# KASSA GET API

Bu fayl admin uchun kunlik sotuv hisoboti bo'limi.

## Base URL

```txt
http://127.0.0.1:8090/api
```

Production:

```txt
https://konstavar2.ataway.uz/api
```

## Auth

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

## Qisqa qoida

- Faqat `admin` ishlatadi
- Kunlik yoki interval bo'yicha savdo tarixini beradi
- Frontend `date` yuborsa, response ichidan shop, warehouse va cashier ro'yxati ham qaytadi
- Kassir kesimida sotuv, payment kesimida statistika, top productlar, recent sales va scope ma'lumotlari qaytaradi

---

## 1. Sotuv hisoboti

`GET /api/sales/history`

### Query

- `date` - `YYYY-MM-DD`
- `from` - `YYYY-MM-DD` yoki ISO date
- `to` - `YYYY-MM-DD` yoki ISO date
- `warehouseId` - ixtiyoriy
- `cashierId` - ixtiyoriy
- `shopId` - ixtiyoriy
- `limit` - recent sales soni
- `topLimit` - top productlar soni

### Misol

```txt
/api/sales/history?date=2026-04-30&limit=20&topLimit=10
```

### Response

```json
{
  "filters": {
    "date": "2026-04-30",
    "from": null,
    "to": null,
    "warehouseId": null,
    "cashierId": null,
    "shopId": null
  },
  "summary": {
    "totalSalesCount": 4,
    "totalSalesAmount": 705,
    "cashTotal": 705,
    "cardTotal": 0,
    "clickTotal": 0,
    "creditTotal": 0,
    "paidAmountTotal": 705,
    "averageCheck": 176.25
  },
  "scope": {
    "shops": [
      {
        "_id": "SHOP_ID",
        "name": "Main Shop",
        "warehouseId": {
          "_id": "WAREHOUSE_ID",
          "name": "Test Shop 2 - Shop Warehouse"
        },
        "isActive": true
      }
    ],
    "warehouses": [
      {
        "_id": "WAREHOUSE_ID",
        "name": "Test Shop 2 - Shop Warehouse",
        "isActive": true
      }
    ],
    "cashiers": [
      {
        "_id": "USER_ID",
        "fullName": "Kassa",
        "phone": "+998901234568",
        "role": "cashier",
        "shopId": {
          "_id": "SHOP_ID",
          "name": "Main Shop",
          "warehouseId": "WAREHOUSE_ID"
        }
      }
    ]
  },
  "cashierBreakdown": [
    {
      "cashierId": "USER_ID",
      "cashierName": "Kassa",
      "cashierPhone": "+998901234568",
      "shopId": "SHOP_ID",
      "shopName": "Main Shop",
      "warehouseId": "WAREHOUSE_ID",
      "totalSalesCount": 2,
      "totalSalesAmount": 455,
      "cashTotal": 455,
      "cardTotal": 0,
      "clickTotal": 0,
      "paidAmountTotal": 455,
      "averageCheck": 227.5,
      "lastSaleAt": "2026-04-28T08:26:14.229Z"
    }
  ],
  "paymentBreakdown": [
    {
      "paymentType": "cash",
      "count": 4,
      "totalAmount": 705,
      "cashTotal": 705,
      "cardTotal": 0,
      "clickTotal": 0
    }
  ],
  "topProducts": [
    {
      "productId": "PRODUCT_ID",
      "productName": "Smoke Product 1",
      "productModel": "SP-1",
      "barcode": "1776769636337",
      "miniSellPrice": 99,
      "sellPrice": 151,
      "wholesalePrice": null,
      "soldQuantity": 3,
      "soldAmount": 401,
      "salesCount": 3
    }
  ],
  "recentSales": [
    {
      "_id": "SALE_ID",
      "warehouseId": {
        "_id": "WAREHOUSE_ID",
        "name": "Test Shop 2 - Shop Warehouse"
      },
      "items": [],
      "subtotal": 99,
      "discount": 0,
      "totalAmount": 99,
      "paymentType": "cash",
      "cashAmount": 99,
      "cardAmount": 0,
      "clickAmount": 0,
      "paidAmount": 99,
      "dueAmount": 0,
      "note": "Mini price test",
      "createdBy": {
        "_id": "USER_ID",
        "fullName": "Admin",
        "role": "admin"
      },
      "createdAt": "2026-04-28T10:53:28.785Z"
    }
  ]
}
```

---

## 2. Nima ishlaydi

Bu report quyidagilarni beradi:

- kunlik umumiy savdo
- kassir kesimida savdo
- cash/card/click split
- credit savdo ham summary’da chiqadi
- o'rtacha чек
- eng ko'p sotilgan productlar
- recent sales list

---

## 3. Flutter flow

1. `POST /api/login`
2. Token olish
3. `GET /api/sales/history?date=2026-04-30`
4. Response’dan:
   - `scope.shops`
   - `scope.warehouses`
   - `scope.cashiers`
   - `summary`
   - `cashierBreakdown`
   - `paymentBreakdown`
   - `topProducts`
   - `recentSales`
   ni ekranga chiqarish

---

## 4. Foydali filterlar

### Faqat bitta kassir

```txt
/api/sales/history?date=2026-04-30&cashierId=USER_ID
```

### Faqat bitta ombor

```txt
/api/sales/history?date=2026-04-30&warehouseId=WAREHOUSE_ID
```

### Sana oralig'i

```txt
/api/sales/history?from=2026-04-01&to=2026-04-30
```

### Frontend uchun qulay ishlatish

Agar frontendga shopId, cashierId yoki warehouseId oldindan berilmagan bo'lsa, faqat sana yuboring:

```txt
/api/sales/history?date=2026-04-30
```

Shunda response ichida:

- `scope.shops`
- `scope.warehouses`
- `scope.cashiers`

qaytadi va frontend yuqoridagi tanlovlarni o'zi to'ldirishi mumkin.
