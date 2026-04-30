# HODIM OYLIK API

Bu fayl xodimlarga oylik yozish bo'limi uchun.

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

- `admin` va `warehouse` oylik yozishi, o'zgartirishi, o'chirishi mumkin
- `cashier` faqat o'z oylik tarixini ko'radi
- oylik yozuvi alohida record bo'lib saqlanadi
- bir xodimga bir oyda bir nechta yozuv yozish mumkin

## Model

Asosiy fieldlar:

- `employeeId`
- `amount`
- `note`
- `salaryDate`
- `paidForMonth`
- `createdBy`
- `createdByName`
- `createdByRole`

---

## 1. Xodimlar ro'yxati

`GET /api/employees`

### Query

- `q`
- `role`
- `isActive`
- `limit`

### Misol

```txt
/api/employees?role=warehouse,cashier&limit=20
```

### Response

```json
[
  {
    "_id": "EMPLOYEE_ID",
    "fullName": "Sardor",
    "phone": "+998901234568",
    "role": "cashier",
    "shopId": {
      "_id": "SHOP_ID",
      "name": "Test Shop"
    },
    "isActive": true
  }
]
```

---

## 2. Oylik yaratish

`POST /api/salaries`

### Body

```json
{
  "employeeId": "EMPLOYEE_ID",
  "amount": 3000000,
  "note": "April salary",
  "paidForMonth": "2026-04"
}
```

### Qoidalar

- `employeeId` majburiy
- `amount` 0 dan katta bo'lishi kerak
- `note` ixtiyoriy
- `paidForMonth` ixtiyoriy, format tavsiya: `YYYY-MM`

### Response

```json
{
  "message": "Salary created successfully",
  "salary": {
    "_id": "SALARY_ID",
    "employeeId": {
      "_id": "EMPLOYEE_ID",
      "fullName": "Sardor",
      "phone": "+998901234568",
      "role": "cashier"
    },
    "amount": 3000000,
    "note": "April salary",
    "salaryDate": "2026-04-28T09:52:28.355Z",
    "paidForMonth": "2026-04",
    "createdBy": {
      "_id": "USER_ID",
      "fullName": "Admin",
      "role": "admin"
    }
  }
}
```

---

## 3. Oyliklar ro'yxati

`GET /api/salaries`

### Query

- `employeeId`
- `createdBy`
- `paidForMonth`
- `from`
- `to`
- `minAmount`
- `maxAmount`
- `limit`

### Misol

```txt
/api/salaries?employeeId=EMPLOYEE_ID&limit=20
```

### Cashier uchun

- faqat o'z oylik yozuvlari qaytadi

---

## 4. Oylik detail

`GET /api/salaries/:id`

### Response

```json
{
  "_id": "SALARY_ID",
  "employeeId": {
    "_id": "EMPLOYEE_ID",
    "fullName": "Sardor",
    "phone": "+998901234568",
    "role": "cashier"
  },
  "amount": 3000000,
  "note": "April salary",
  "salaryDate": "2026-04-28T09:52:28.355Z",
  "paidForMonth": "2026-04"
}
```

---

## 5. Oylik update

`PUT /api/salaries/:id`

### Body

```json
{
  "amount": 3300000,
  "note": "Updated salary",
  "paidForMonth": "2026-04"
}
```

### Yoki employee almashtirish

```json
{
  "employeeId": "EMPLOYEE_ID",
  "amount": 300000,
  "note": "Bonus"
}
```

### Qoidalar

- `amount` 0 dan katta bo'lishi kerak
- `employeeId` berilsa aktiv user bo'lishi kerak
- cashier o'zi yozmagan salary recordni o'zgartira olmaydi

---

## 6. Oylik delete

`DELETE /api/salaries/:id`

### Response

```json
{
  "message": "Salary deleted successfully"
}
```

---

## 7. Flutter flow

### Oylik yozish

1. `GET /api/employees?role=warehouse,cashier`
2. Employee tanlash
3. `POST /api/salaries`
4. `GET /api/salaries`
5. Kerak bo'lsa `PUT /api/salaries/:id`
6. Kerak bo'lsa `DELETE /api/salaries/:id`

---

## 8. Misol

Sardor uchun ikki yozuv:

```json
{
  "employeeId": "EMPLOYEE_ID",
  "amount": 3000000,
  "note": "April salary"
}
```

keyin yana:

```json
{
  "employeeId": "EMPLOYEE_ID",
  "amount": 300000,
  "note": "Bonus"
}
```

Bu yozuvlar alohida record sifatida saqlanadi.

