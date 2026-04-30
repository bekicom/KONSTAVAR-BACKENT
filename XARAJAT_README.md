# XARAJAT API

Bu fayl faqat `xarajat` bo'limi uchun.

## Base URL

```txt
http://127.0.0.1:8090/api
```

Production:

```txt
https://konstavar2.ataway.uz/api
```

## Auth

Ko'p endpointlar token talab qiladi.

```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

## Qisqa qoida

- `admin` hamma xarajatlarni ko'radi
- `warehouse` ham xarajat CRUD qilishi mumkin
- `cashier` xarajat qilsa, ochiq smenaga ulanadi
- cashier `shiftId` ni qo'lda almashtira olmaydi

## Xarajat modeli

Saqlanadigan asosiy fieldlar:

- `amount`
- `reason`
- `note`
- `shiftId`
- `createdBy`
- `createdByName`
- `createdByRole`

---

## 1. Xarajat yaratish

`POST /api/expenses`

### Body

```json
{
  "amount": 150,
  "reason": "Taxi",
  "note": "Delivery expense"
}
```

### Ixtiyoriy admin/warehouse body

```json
{
  "amount": 150,
  "reason": "Taxi",
  "note": "Delivery expense",
  "shiftId": "SHIFT_ID"
}
```

### Qoidalar

- `amount` majburiy, 0 dan katta bo'lishi kerak
- `reason` majburiy
- `note` ixtiyoriy
- cashier bo'lsa shift avtomatik current open shiftga ulanadi

### Response

```json
{
  "message": "Expense created successfully",
  "expense": {
    "_id": "EXPENSE_ID",
    "amount": 150,
    "reason": "Taxi",
    "note": "Delivery expense",
    "shiftId": "SHIFT_ID",
    "createdBy": {
      "_id": "USER_ID",
      "fullName": "Kassa",
      "role": "cashier"
    },
    "createdByName": "Kassa",
    "createdByRole": "cashier"
  }
}
```

---

## 2. Xarajatlar ro'yxati

`GET /api/expenses`

### Query params

- `shiftId`
- `createdBy`
- `reason`
- `from`
- `to`
- `minAmount`
- `maxAmount`
- `limit`

### Misol

```txt
/api/expenses?shiftId=SHIFT_ID&limit=20
```

### Cashier uchun

- faqat o'z xarajatlari ko'rinadi

### Response

```json
[
  {
    "_id": "EXPENSE_ID",
    "amount": 150,
    "reason": "Taxi",
    "note": "Delivery expense",
    "shiftId": {
      "_id": "SHIFT_ID",
      "status": "open"
    },
    "createdBy": {
      "_id": "USER_ID",
      "fullName": "Kassa",
      "role": "cashier"
    }
  }
]
```

---

## 3. Xarajat detail

`GET /api/expenses/:id`

### Response

```json
{
  "_id": "EXPENSE_ID",
  "amount": 150,
  "reason": "Taxi",
  "note": "Delivery expense",
  "shiftId": {
    "_id": "SHIFT_ID",
    "status": "open"
  },
  "createdBy": {
    "_id": "USER_ID",
    "fullName": "Kassa",
    "role": "cashier"
  }
}
```

---

## 4. Xarajat update

`PUT /api/expenses/:id`

### Body

```json
{
  "amount": 180,
  "reason": "Taxi updated",
  "note": "Updated note"
}
```

### Admin uchun shiftni o'zgartirish

```json
{
  "amount": 180,
  "reason": "Taxi updated",
  "note": "Updated note",
  "shiftId": "SHIFT_ID"
}
```

### Qoidalar

- cashier `shiftId` ni o'zgartira olmaydi
- `amount` 0 dan katta bo'lishi kerak
- `reason` bo'sh bo'lmasligi kerak

---

## 5. Xarajat delete

`DELETE /api/expenses/:id`

### Response

```json
{
  "message": "Expense deleted successfully"
}
```

---

## 6. Shift bilan bog'lanish

Cashier xarajati ochiq smenaga ulanadi.

Shift yopilganda `summary` ichida quyidagilar ham chiqadi:

```json
{
  "salesCount": 1,
  "salesTotal": 304,
  "returnsCount": 1,
  "returnsTotal": 152,
  "expensesCount": 1,
  "expensesTotal": 150,
  "netTotal": 152,
  "netAfterExpenses": 2
}
```

Shift detail javobida ham `expenses` list qaytadi.

---

## 7. Flutter flow

### Cashier

1. `POST /api/login`
2. `GET /api/shifts/current`
3. Agar shift yo'q bo'lsa `POST /api/shifts/start`
4. `POST /api/expenses`
5. `GET /api/expenses`
6. `PUT /api/expenses/:id`
7. `DELETE /api/expenses/:id`
8. `POST /api/shifts/:id/close`

### Admin

1. `POST /api/login`
2. `GET /api/expenses`
3. `POST /api/expenses`
4. `PUT /api/expenses/:id`
5. `DELETE /api/expenses/:id`
6. `GET /api/shifts/:id`

