# Fiskal integratsiya (Soliq / OFD — E-POS)

Bu hujjat KONSTAVAR backendiga qo'shilgan fiskal integratsiyani tushuntiradi.

## Nima uchun Flutter yuboradi?

VPS backend `http://127.0.0.1:3448/uzpos` ga kira olmaydi — bu address VPSning
o'zini bildiradi. E-POS Communicator esa **kassa kompyuterida** lokal ishlaydi.
Shuning uchun Soliqqa (OFD) yuborishni **Flutter kassa ilovasi lokal kompyuterdan**
qiladi. Backend faqat:

1. tayyor E-POS payloadni beradi (`GET /sales/:id/fiscal/payload`),
2. fiskal natijani saqlaydi (`POST /sales/:id/fiscal`).

Backend **E-POS tokenini qaytarmaydi** — token kassa kompyuterida (Flutterda) lokal
saqlanadi va payloadga Flutter qo'shadi.

> `FISCAL_ENABLED` env VPS backend uchun **shart emas**, chunki Soliqqa Flutter yuboradi.

## Umumiy flow

1. Flutter savdoni VPS backendga yuboradi → `POST /api/sales`.
2. Backend sale yaratadi va sale obyektini qaytaradi.
3. Flutter tayyor E-POS payload oladi → `GET /api/sales/:saleId/fiscal/payload`.
4. Flutter payloadga `token` qo'shadi.
5. Flutter lokal E-POSga POST qiladi → `POST http://127.0.0.1:3448/uzpos`.
6. E-POS QR va fiscal ma'lumotlarni qaytaradi.
7. Flutter fiscal javobni backendga saqlaydi → `POST /api/sales/:saleId/fiscal`.
8. Flutter chekda `qrCodeUrl` dan QR chiqaradi.

---

## 1. Mahsulot fiskal maydonlari (`Product`)

Mahsulotga uchta yangi maydon qo'shildi (admin ilova orqali to'ldiriladi):

| Maydon | E-POS field | Izoh |
|--------|-------------|------|
| `fiscalClassCode` | `classCode` | MXIK kodi |
| `fiscalPackageCode` | `packageCode` | Qadoq (package) kodi |
| `fiscalVatPercent` | `vatPercent` | QQS foizi (default `0`) |

`barcode` va `name` mavjud maydonlardan olinadi.

---

## 2. Kompaniya fiskal sozlamalari (`AppSetting.fiscal`)

Admin tomonidan sozlanadi. Token bu yerda **saqlanmaydi**.

### `GET /api/app-settings/fiscal`  (admin, cashier)
```json
{
  "enabled": true,
  "companyName": "QALAM KONSTAVARLAR",
  "companyAddress": "Namangan shahri, ...",
  "companyINN": "32911935960026",
  "companyPhoneNumber": "998905558685",
  "staffName": "",
  "printerSize": 58,
  "updatedAt": "2026-06-26T..."
}
```

### `PUT /api/app-settings/fiscal`  (faqat admin)
Yuqoridagi maydonlarni yuborib yangilanadi. `enabled=true` bo'lsa Flutter fiskal
flowni ishga tushiradi. `staffName` bo'sh bo'lsa — chekda sotuvchi (kassir) ismi
ishlatiladi.

---

## 3. Tayyor payload olish

### `GET /api/sales/:saleId/fiscal/payload`  (admin, cashier)
`Authorization: Bearer <token>`

Javob (token **yo'q**):
```json
{
  "method": "sale",
  "saleId": "SALE_ID",
  "fiscalEnabled": true,
  "alreadyFiscalized": false,
  "payload": {
    "companyName": "QALAM KONSTAVARLAR",
    "companyAddress": "Namangan shahri, ...",
    "companyINN": "32911935960026",
    "staffName": "Kassir",
    "printerSize": 58,
    "companyPhoneNumber": "998905558685",
    "params": {
      "items": [
        {
          "price": 500000,
          "discount": 0,
          "barcode": "123456",
          "amount": 2000,
          "vatPercent": 0,
          "vat": 0,
          "name": "Ruchka",
          "classCode": "MXIK_CODE",
          "packageCode": "PACKAGE_CODE",
          "other": 0,
          "ownerType": 0
        }
      ],
      "receivedCash": 1000000,
      "receivedCard": 0
    }
  }
}
```

Flutter lokal E-POSga yuborishdan oldin `token` qo'shadi:
```dart
final eposBody = {
  'token': eposToken,
  'method': response['method'],
  ...response['payload'],
};
```

### Backenddagi hisoblashlar (avtomatik)

- **Narx tiyinda:** `price = unitSellPrice * 100`  (5000 so'm → `500000`)
- **Miqdor minglikda:** `amount = quantity * 1000`  (2 dona → `2000`, 0.5 kg → `500`)
- **To'lov tiyinda:**
  - `receivedCash = cashAmount * 100`
  - `receivedCard = (cardAmount + clickAmount) * 100`
- **Chegirma:** sotuv darajasidagi `discount` satrlar bo'yicha **proporsional**
  taqsimlanadi (oxirgi satr yaxlitlash qoldig'ini yutadi), shunda fiskal jami =
  haqiqiy to'lov bo'ladi.
- **QQS:** narx ichida (included) hisoblanadi → `vat = round(net * p / (100 + p))`.
  `vatPercent = 0` bo'lsa `vat = 0`.

---

## 4. Fiskal natijani saqlash

### `POST /api/sales/:saleId/fiscal`  (admin, cashier)
`Authorization: Bearer <token>`

Muvaffaqiyat:
```json
{
  "status": "success",
  "method": "sale",
  "terminalId": "VG343420020998",
  "receiptSeq": "642",
  "dateTime": "20250716153633",
  "fiscalSign": "123456789012",
  "qrCodeUrl": "https://ofd.soliq.uz/check?...",
  "paycheck": null,
  "rawResponse": { "error": false, "message": { } }
}
```

Xatolik:
```json
{
  "status": "failed",
  "method": "sale",
  "errorMessage": "E-POS error text",
  "rawResponse": { "error": true, "message": "error message" }
}
```

Natija `sale.fiscal` ga yoziladi. `status` faqat `success` yoki `failed`.

---

## 5. Chekda QR

Sale qayta olinganda `sale.fiscal.qrCodeUrl` mavjud — shu URL QR code qilib
chiqariladi.

## E-POS status tekshirish (Flutter, lokal)

```json
{ "token": "<token>", "method": "checkStatus" }
```
`POST http://127.0.0.1:3448/uzpos`

---

## Kirish huquqlari (RBAC)

| Endpoint | Rollar |
|----------|--------|
| `GET /app-settings/fiscal` | admin, cashier |
| `PUT /app-settings/fiscal` | admin |
| `GET /sales/:id/fiscal/payload` | admin, cashier |
| `POST /sales/:id/fiscal` | admin, cashier |

Kassir faqat **o'z do'koni omboriga** tegishli sotuvni fiskal qila oladi (aks holda
`403`).

---

## Ilovalarda (Flutter)

### Admin ilova (`kassa_app`)
- **Mahsulot MXIK** — Qoldiqlar (stocks) sahifasida har bir mahsulot qatorida
  "Fiskal (MXIK)" tugmasi: `classCode`, `packageCode`, `vatPercent` ni
  `PUT /products/:id` orqali kiritish (yangi va mavjud mahsulotlar uchun).
- **Kompaniya sozlamalari** — Sozlamalar sahifasida "Fiskal (Soliq) kompaniya
  sozlamalari" kartasi (`GET/PUT /app-settings/fiscal`): nomi, INN, manzil,
  telefon, kassir nomi, printer kengligi, yoqilgan/o'chirilgan.

### Sotuv (kassir) ilovasi (`kassa_sotuv_pp`)
- **E-POS sozlamasi** — Hisobotlar sahifasidagi "Fiskal (Soliq) sozlamalari"
  tugmasi: E-POS token va lokal URL (`http://127.0.0.1:3448/uzpos`) shu
  kompyuterda lokal saqlanadi (`shared_preferences`).
- **Avtomatik fiskal** — sotuv **naqdsiz** (karta yoki click) bo'lsa va token
  sozlangan + backend `fiscal.enabled=true` bo'lsa: payload olinadi → tokensiz
  lokal E-POSga yuboriladi → natija backendga saqlanadi → chekka QR (ESC/POS
  GS ( k) chiqadi. Naqd sotuv, token sozlanmagan yoki fiskal o'chiq bo'lsa — jim
  o'tkazib yuboriladi (sotuv hech qachon bloklanmaydi).

## To'liq sotuv hisoboti kodi (report code)

Kassa ilovasidagi sotuv tarixi (Hisobotlar) **dastlab faqat soliqqa yuborilgan
(fiskal) sotuvlarni** ko'rsatadi (`GET /sales?fiscalStatus=success`). O'ng yuqori
burchakdagi 🔒 tugma maxfiy kod so'raydi; kod to'g'ri bo'lsa **to'liq hisobot**
ochiladi (filtrsiz `GET /sales`).

Kodni **admin** o'rnatadi (Sozlamalar → "To'liq sotuv hisoboti kodi").

| Endpoint | Rollar |
|----------|--------|
| `GET /app-settings/report-code` (status) | admin |
| `PUT /app-settings/report-code` (set/update) | admin |
| `DELETE /app-settings/report-code` (disable) | admin |
| `POST /app-settings/report-code/verify` (`{code}`) | admin, cashier |

`verify`: to'g'ri → `{ok:true}`; noto'g'ri → `401`; kod o'rnatilmagan →
`400 {reason:"NOT_SET"}`.
