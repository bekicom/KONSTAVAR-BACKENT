# RUXSAT VA DO'KON CHEKLOVI (RBAC + SCOPE)

Xodimni do'konga biriktirish va "sidebar menyulari" ruxsatlari qanday
ishlashi. Frontend (`kassa_app`) va backend bir xil qoidaga tayanadi.

## Qisqa qoida

Ikki xil cheklov bor va ular bir-biridan mustaqil:

| Nima | Qayerda saqlanadi | Nimani cheklaydi |
| --- | --- | --- |
| **Menyu ruxsati** | `User.allowedMenuKeys` | Ilovada qaysi bo'limlar ko'rinishi |
| **Do'kon/ombor cheklovi** | `User.shopId`, `User.warehouseIds` | Qaysi ma'lumotlar qaytishi |

Menyuni yashirish — bu xavfsizlik emas, faqat qulaylik. Haqiqiy cheklovni
backend `shopId`/`warehouseIds` bo'yicha qo'yadi.

## 1. Rollar va biriktirish

| Rol | Biriktirish | Ko'radigan ma'lumot |
| --- | --- | --- |
| `admin` (Boshqaruvchi), do'konsiz | — | **Hammasi** (bosh admin) |
| `admin`, do'konli | `shopId` | Faqat o'sha do'kon va uning ombori |
| `warehouse` (Omborchi) | `warehouseIds` (majburiy) | Faqat o'sha omborlar + shu omborli do'konlar |
| `cashier` (Kassir) | `shopId` (majburiy) | Faqat o'z do'koni |
| `bugalter` (Buxgalter), do'konsiz | — | Hammasi (fiskal mahsulotlar) |
| `bugalter`, do'konli | `shopId` | Faqat o'sha do'kon |

- Do'kon biriktirilmagan `admin` — tizimning bosh admini. Birinchi admin
  `POST /api/create-admin` orqali shunday yaratiladi.
- Omborchiga do'kon biriktirilmaydi: u omborlar bilan cheklanadi. Rol
  `warehouse` ga o'zgartirilsa `shopId` avtomatik tozalanadi.
- Kassirga ombor biriktirilmaydi: u do'koni ombori bilan ishlaydi.

## 2. Cheklov texnik jihatdan qanday ishlaydi

`middleware/authMiddleware.js` har bir so'rovda foydalanuvchini o'qib,
do'konga biriktirilgan bo'lsa **do'kon omborini** ham aniqlaydi va
`req.user.shopWarehouseId` ga qo'yadi (15 sekundlik cache bilan).

`utils/userAccess.js` shundan "scope" chiqaradi:

```js
getScopeWarehouseIds(user)
//  null  -> cheklov yo'q (bosh admin / bosh buxgalter)
//  [...] -> faqat shu omborlar
//  []    -> hech narsa (biriktirish majburiy, lekin yo'q)
```

Keyin ro'yxat endpointlari shu scope'ni filtrga qo'yadi:

| Helper | Qachon ishlatiladi |
| --- | --- |
| `applyWarehouseScope(user, query, field)` | Hujjatda ombor maydoni bor (`Stock`, `Sale`, `Shop.warehouseId`, `Warehouse._id`) |
| `applyWarehouseScopeAny(user, query, fields)` | Bir nechta ombor maydoni (`ShopTransfer`) |
| `restrictWarehouseFilter(user, query, field)` | Query parametrida ombor berilgan hisobotlar |
| `warehouseScopeStages(user, field)` | Aggregate pipeline (`$match` bosqichi) |
| `applyShiftScope(user, query)` | Faqat `shiftId` orqali bog'langan (`Expense`) |
| `applyEmployeeScope(user, query)` | `User` kolleksiyasi (xodimlar ro'yxati) |
| `ensureWarehouseAccess(user, warehouseId)` | Bitta hujjat yoki yozish amali — ruxsat bo'lmasa `403` |

**Muhim**: query parametri cheklovni bekor qilmaydi. `?warehouseId=...`
berilsa, avval `ensureWarehouseAccess` tekshiradi va ruxsat bo'lmasa `403`
qaytadi.

### Cheklangan endpointlar

`/shops`, `/shops/:id`, `/shops/transfers`, `/warehouses/getall`,
`/warehouses/:id`, `/:warehouseId/stock`, `/stocks`, `/stocks/search`,
`/stocks/:id`, `/purchases`, `/purchases/:id`, `/sales`, `/sales/:id`,
`/sales/history`, `/sales/history/excel`, `/shifts`, `/shifts/:id`,
`/expenses`, `/expenses/:id`, `/salaries`, `/employees`, `/users`,
`/users/:id`, `/writeoffs`, `/supplier-returns`, `/inventories/sessions`,
`/products/barcode/:barcode`, `/dashboard`.

Yozish amallari ham tekshiriladi: `PUT/DELETE /shops/:id`,
`POST /shops/:id/transfers` (qabul qiluvchi do'kon), `PUT/DELETE
/warehouses/:id`, `DELETE /sales/:id`, `PUT/DELETE /stocks/:id`.

### Cheklanmaganlar (umumiy ma'lumot)

Mahsulot katalogi, kategoriyalar, yetkazib beruvchilar, mijozlar va
ularning to'lovlari — bu ma'lumotlar butun tizim uchun umumiy.

## 3. Menyu ruxsatlari

`utils/userAccess.js` dagi `DASHBOARD_MENU_KEYS` **Flutter'dagi
`DashboardMenuKey` enum'i bilan bir xil bo'lishi SHART**:

```
overview, pos, salesHistory, sales, shops, warehouses, cashiers,
suppliers, clients, categories, stocks, productAnalytics, inventories,
expenses, salaries, writeoffs, returns, transfers, fiscalProducts, settings
```

(`pos` faqat kassa ilovasida menyu, admin ilovasida yo'q.)

`DEFAULT_MENUS_BY_ROLE` esa Flutter'dagi
`dashboardMenuItems[].allowedRoles` ning aynan nusxasi.

`normalizeAllowedMenuKeys(role, keys)` qoidasi:

1. `keys` bo'sh bo'lsa — rolning hamma menyusi (frontendda ham bo'sh
   ro'yxat "hammasiga ruxsat" degani).
2. Aks holda — rolga ruxsat etilganlari bilan kesishma.
3. Kesishma bo'sh chiqsa (hamma kalit noto'g'ri) — rolning hamma
   menyusi. Bo'sh massiv saqlanmaydi, chunki u "hammasi" degani bo'lib
   qolardi.

> **Diqqat**: yangi menyu qo'shilsa, uni IKKI joyga ham qo'shish kerak —
> Flutter `dashboard_menu_item.dart` va backend `DASHBOARD_MENU_KEYS` +
> `DEFAULT_MENUS_BY_ROLE`. Bitta joyda qolsa, admin tanlagan ruxsat
> jimgina tashlab yuboriladi.

## 4. Ruxsat o'zgarganda

- `PUT /api/users/:id` dan keyin backend `authMiddleware` cache'ini
  tozalaydi (`invalidateUserCache`) — yangi ruxsat darhol kuchga kiradi.
- Flutter ilova ishga tushganda `GET /api/me` orqali foydalanuvchini
  yangilaydi, shuning uchun xodim qayta kirmasdan ham yangi menyu va
  do'kon cheklovini oladi (aloqa bo'lmasa saqlangani bilan davom etadi).

## 5. Atomarlik (tranzaksiya)

Qoldiqni o'zgartiradigan amallar bitta tranzaksiyada bajariladi, ya'ni
o'rtada xato chiqsa hammasi bekor bo'ladi — qoldiq yarim holatda qolmaydi:

`POST /sales`, `POST /purchase`, `PUT /purchases/:id`,
`DELETE /purchases/:id`, `POST /shops/:id/transfers`, `POST /sales/returns`,
`DELETE /sales/:id`, `POST /writeoffs`, `DELETE /writeoffs/:id`,
`POST /supplier-returns`, `DELETE /supplier-returns/:id`,
`POST /inventories/sessions/:id/post`, `POST /clients/:id/payments`,
`PUT /sales/quick-products`.

Qoldiq ayirishda har doim `quantity: { $gte: kerakli }` sharti qo'yiladi va
`bulkWrite` natijasidagi `matchedCount` tekshiriladi — ikki kassa/transfer
bir vaqtda ishlasa ham qoldiq manfiyga tushmaydi (`409` qaytadi).

`utils/withTransaction.js` standalone mongod'da tranzaksiyasiz fallback
yo'ldan ketadi, shuning uchun lokal ishlab chiqishda ham sinadi. Prod Atlas
replica set, ya'ni tranzaksiya haqiqatan ishlaydi.

> **Istisno**: `DELETE /shops/:id` tranzaksiyaga olinmagan — u o'nlab
> kolleksiyadan kaskad o'chiradi va tarixi uzun do'kon uchun tranzaksiya
> limitiga urilib, do'konni umuman o'chirib bo'lmay qolardi.

## 6. Test

```bash
# 1) lokal mongod + server
npm run dev

# 2) to'liq oqim (admin + kassir)
npm run test:e2e

# 3) do'kon cheklovi va menyu ruxsatlari (e2e dan KEYIN)
MONGO_URI=mongodb://127.0.0.1:27017/konstavar npm run test:scope

# 4) atomarlik + fiskal endpoint auth (replica set kerak, e2e dan KEYIN)
MONGO_RAW="mongodb://127.0.0.1:27019/?directConnection=true" \
  DB_NAME=konstavar npm run test:atomic
```

`test:scope` quyidagilarni tekshiradi: do'konga biriktirilgan admin faqat
o'z do'konini/omborini/qoldig'ini/savdosini/smenasini/xodimini ko'radi,
begona do'kon va omborga murojaat `403`/`404` qaytaradi, tanlangan menyu
ruxsatlari saqlanadi, `/me` yangi ruxsatni beradi, biriktirish olib
tashlansa yana hammasi ko'rinadi, buxgalter roli ishlaydi.

`test:atomic` esa: qoldiqdan oshiq transfer `409` qaytaradi va qoldiqni
o'zgartirmaydi; ko'p qatorli transferda bitta qator yetarli bo'lmasa
boshqalari ham ayirilmaydi; to'g'ri transfer/kirim oplogda bitta `applyOps`
yozuvi bo'lib tushadi; `GET /fiscal-products` tokensiz `401` qaytaradi.
