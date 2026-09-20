# Frontend Pagination README

Quyidagi endpointlar frontend uchun pagination bilan ishlaydi:

- `GET /api/stocks`
- `GET /api/purchases`
- `GET /api/:warehouseId/stock`
- `GET /api/sales/offline-catalog`

Hammasida bir xil pagination format ishlatiladi.

## Paginationni yoqish

Backend paginated object qaytarishi uchun queryda quyidagilardan bittasi bo'lishi kerak:

- `page`
- `skip`
- `paginated=true`

Tavsiya etilgan ishlatish usuli:

```http
GET /api/stocks?page=1&limit=20
GET /api/purchases?page=1&limit=20
```

## Query parametrlari

- `page` - sahifa raqami, `1` dan boshlanadi
- `limit` - har sahifada nechta element kelishi
- `skip` - nechta yozuv tashlab o'tilishi
- `sort` - masalan `updatedAt:-1,_id:-1` yoki `createdAt:-1,_id:-1`
- `paginated=true` - `page` bermasdan ham object format majburiy olish uchun

Default qiymatlar:

- `page=1`
- `limit=50`
- `max limit=500`

## Response formati

Pagination bilan chaqirilganda javob:

```json
{
  "items": [],
  "total": 125,
  "page": 1,
  "limit": 20,
  "pages": 7,
  "hasMore": true
}
```

Frontend aynan `items` ni list sifatida ishlatadi.

## Orqaga moslik

Agar frontend `page`, `skip` yoki `paginated=true` yubormasa, backend eski formatni saqlab qoladi:

```json
[]
```

Shuning uchun yangi paginationli ekranlarda `page` yoki `paginated=true` yuborish shart.

## Stocks endpoint

Endpoint:

```http
GET /api/stocks
Authorization: Bearer TOKEN
Content-Type: application/json
```

Misollar:

```http
GET /api/stocks?page=1&limit=20
GET /api/stocks?page=2&limit=20
GET /api/stocks?paginated=true&limit=20
GET /api/stocks?page=1&limit=20&warehouseId=WAREHOUSE_ID
GET /api/stocks?page=1&limit=20&sort=updatedAt:-1,_id:-1
```

Qo'shimcha filter:

- `warehouseId`
- `q` (yoki `search`) - mahsulot nomi, modeli yoki barcode bo'yicha qidiruv

```http
GET /api/stocks?page=1&limit=20&q=sement
```

Sort tavsiyasi:

- default `updatedAt:-1,_id:-1`

## Warehouse stock endpoint

Endpoint:

```http
GET /api/:warehouseId/stock
Authorization: Bearer TOKEN
```

Misollar:

```http
GET /api/WAREHOUSE_ID/stock?page=1&limit=20
GET /api/WAREHOUSE_ID/stock?paginated=true&limit=20
GET /api/WAREHOUSE_ID/stock?page=1&limit=20&includeDormant=true
```

Bu endpoint `items` emas, **`data`** ichida qaytaradi (eski format saqlangan):

```json
{
  "success": true,
  "warehouse": { "_id": "...", "name": "Asosiy ombor" },
  "totalProducts": 1240,
  "dormantHidden": 12,
  "dormantDays": 60,
  "total": 1240,
  "page": 1,
  "limit": 20,
  "pages": 62,
  "hasMore": true,
  "data": []
}
```

Paramsiz chaqirilsa eski format: `page`, `limit`, `pages`, `hasMore`, `total` maydonlari bo'lmaydi, `data` ichida hammasi keladi.

## Offline catalog endpoint

Endpoint:

```http
GET /api/sales/offline-catalog
Authorization: Bearer TOKEN
```

Misollar:

```http
GET /api/sales/offline-catalog?page=1&limit=50
GET /api/sales/offline-catalog?paginated=true&limit=50
```

```json
{
  "shop": { "_id": "...", "name": "Do'kon 1" },
  "warehouse": { "_id": "...", "name": "Asosiy ombor" },
  "total": 1240,
  "quickProductIds": [],
  "page": 1,
  "limit": 50,
  "pages": 25,
  "hasMore": true,
  "items": []
}
```

Tartib o'zgarmaydi: avval "quick" mahsulotlar (`order` bo'yicha), keyin nom bo'yicha alifbo tartibida. Sahifalar ham shu tartibda bo'linadi, shuning uchun `page=1..N` ni ketma-ket yuklab to'liq katalog yig'iladi.

Katalog 10 soniya kesh'da saqlanadi — bir sahifadan keyingisini so'rash bazaga qayta murojaat qilmaydi.

## Purchases endpoint

Endpoint:

```http
GET /api/purchases
Authorization: Bearer TOKEN
Content-Type: application/json
```

Misollar:

```http
GET /api/purchases?page=1&limit=20
GET /api/purchases?page=2&limit=20
GET /api/purchases?paginated=true&limit=20
GET /api/purchases?page=1&limit=20&supplierId=SUPPLIER_ID
GET /api/purchases?page=1&limit=20&warehouseId=WAREHOUSE_ID
GET /api/purchases?page=1&limit=20&paymentType=cash
GET /api/purchases?page=1&limit=20&from=2026-07-01&to=2026-07-25
GET /api/purchases?page=1&limit=20&sort=createdAt:-1,_id:-1
```

Qo'shimcha filterlar:

- `supplierId`
- `warehouseId`
- `paymentType`
- `from`
- `to`

Sort tavsiyasi:

- default `createdAt:-1,_id:-1`

## Flutter / Dio misol

```dart
final response = await dio.get(
  '/api/stocks',
  queryParameters: {
    'page': 1,
    'limit': 20,
  },
);

final data = response.data as Map<String, dynamic>;
final items = List<Map<String, dynamic>>.from(data['items'] ?? []);
final total = data['total'] ?? 0;
final page = data['page'] ?? 1;
final pages = data['pages'] ?? 1;
final hasMore = data['hasMore'] ?? false;
```

`/api/purchases` uchun ham xuddi shu parse ishlaydi.

## Infinite scroll tavsiya

- birinchi request: `page=1&limit=20`
- keyingi request: `page + 1`
- `hasMore=false` bo'lsa, keyingi request yuborilmaydi
- filter o'zgarsa, yana `page=1` dan boshlanadi

## Frontend uchun qisqa qoida

- eski kod array kutayotgan bo'lsa, pagination params yubormasin
- yangi kod object kutayotgan bo'lsa, doim `page` yuborsin
- tavsiya: barcha yangi list ekranlarda `page` + `limit` ishlatilsin
