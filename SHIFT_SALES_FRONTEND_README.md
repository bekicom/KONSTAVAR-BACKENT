# Shift Sales Frontend README

Kassir smena savdolarini olish va smenani yopish uchun quyidagi APIlar ishlatiladi.

## Joriy ochiq smena savdolari

```http
GET /api/sales
Authorization: Bearer TOKEN
```

Kassir tokeni bilan chaqirilsa, backend avtomatik ochiq smenani topadi va shu smenadagi savdolarni qaytaradi.

## Aniq smena savdolari

```http
GET /api/sales?shiftId=SHIFT_ID
Authorization: Bearer TOKEN
```

Bu endpoint kassirning o'z smenasi bo'lsa, ochiq yoki yopilgan smena savdolarini qaytaradi.

Smena yopilgandan keyin hisob-kitob bilan bir xil savdolarni ko'rish uchun shu variant ishlatilsin.

## Joriy smenani yopish

```http
POST /api/shifts/close
Authorization: Bearer TOKEN
Content-Type: application/json
```

Body:

```json
{
  "closingCash": 5000000,
  "closeNote": ""
}
```

Backend kassirning ochiq smenasini o'zi topib yopadi.

## ID bilan smena yopish

Eski variant ham ishlaydi:

```http
POST /api/shifts/SHIFT_ID/close
Authorization: Bearer TOKEN
Content-Type: application/json
```

## Muhim qoida

Smena yopilgandan keyin `GET /api/sales` ochiq smena qidiradi. Yopilgan smena savdolarini olish uchun frontend `GET /api/sales?shiftId=SHIFT_ID` yuborishi kerak.
