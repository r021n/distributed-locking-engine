# Fase 4: Endpoint Fast Sale Checkout API

## Tujuan

Di fase ini, kita akan membuat endpoint API utama untuk proses checkout flash sale. Endpoint ini akan:

1. **Menerima request HTTP** dengan payload `userId` dan `productId`
2. **Memvalidasi payload** menggunakan JSON Schema (validasi bawaan Fastify)
3. **Mengintegrasikan dengan skrip Lua Redis** untuk operasi atomik
4. **Mengembalikan respons instan**: `200 OK` (berhasil) atau `409 Conflict` / `400 Bad Request` (gagal)

Penting: Endpoint ini **tidak menyentuh PostgreSQL** saat request berlangsung. Semua operasi hanya dilakukan di Redis untuk latency ultra-rendah.

---

## Prasyarat

Pastikan Anda sudah menyelesaikan **Fase 1**, **Fase 2**, dan **Fase 3** dan memiliki:
- Redis berjalan di Docker
- PostgreSQL berjalan di Docker
- Skrip Lua untuk atomic decrement sudah siap
- Plugin Redis Lua sudah terdaftar di Fastify

---

## Langkah 1: Buat Folder Routes

Buat folder `src/routes/` untuk menyimpan route-route API:

```bash
mkdir src\routes
```

---

## Langkah 2: Buat File Route Flash Sale

Buat file `src/routes/flash-sale.ts` dengan isi berikut:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";

interface CheckoutBody {
  userId: string;
  productId: number;
}

interface CheckoutSuccessResponse {
  success: true;
  remainingStock: number;
  message: string;
}

interface CheckoutErrorResponse {
  success: false;
  error: string;
}

const checkoutSchema = {
  body: {
    type: "object",
    required: ["userId", "productId"],
    properties: {
      userId: {
        type: "string",
        minLength: 1,
        maxLength: 255,
      },
      productId: {
        type: "integer",
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        remainingStock: { type: "integer" },
        message: { type: "string" },
      },
    },
    400: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" },
      },
    },
    409: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" },
      },
    },
  },
};

async function flashSaleRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: CheckoutBody }>(
    "/checkout",
    {
      schema: checkoutSchema,
    },
    async (request: FastifyRequest<{ Body: CheckoutBody }>, reply: FastifyReply) => {
      const { userId, productId } = request.body;
      const stockKey = `product:stock:${productId}`;

      const exists = await fastify.redis.exists(stockKey);
      if (!exists) {
        return reply.status(400).send({
          success: false,
          error: "PRODUCT_NOT_FOUND",
        } as CheckoutErrorResponse);
      }

      try {
        const redisWithCommands = fastify.redis as Redis & {
          decrementStock: (
            stockKey: string,
            productId: number,
            userId: string,
          ) => Promise<[number, string]>;
        };

        const result = await redisWithCommands.decrementStock(
          stockKey,
          productId,
          userId,
        );

        return {
          success: true,
          remainingStock: result[0],
          message: "Checkout successful",
        } as CheckoutSuccessResponse;
      } catch (error: any) {
        const errorMessage = error.message || "UNKNOWN_ERROR";

        if (errorMessage.includes("SOLD_OUT")) {
          return reply.status(409).send({
            success: false,
            error: "SOLD_OUT",
          } as CheckoutErrorResponse);
        }

        if (errorMessage.includes("PRODUCT_NOT_FOUND")) {
          return reply.status(400).send({
            success: false,
            error: "PRODUCT_NOT_FOUND",
          } as CheckoutErrorResponse);
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
        } as CheckoutErrorResponse);
      }
    },
  );
}

export default flashSaleRoutes;
```

**Penjelasan:**

### Interface TypeScript
- `CheckoutBody`: Mendefinisikan tipe data untuk request body (`userId` string, `productId` number)
- `CheckoutSuccessResponse`: Tipe data untuk respons berhasil
- `CheckoutErrorResponse`: Tipe data untuk respons error

### JSON Schema Validation
- `body.type: "object"`: Request body harus berupa object
- `body.required: ["userId", "productId"]`: Kedua field wajib diisi
- `body.properties.userId`: Harus berupa string dengan panjang 1-255 karakter
- `body.properties.productId`: Harus berupa integer positif (minimum 1)
- `body.additionalProperties: false`: Tidak boleh ada field tambahan

### Response Schema
- Mendefinisikan schema untuk response 200, 400, dan 409
- Fastify akan otomatis memfilter response sesuai schema untuk performa lebih baik

### Handler Function
- Mengecek apakah produk ada di Redis (`EXISTS`)
- Memanggil skrip Lua `decrementStock` untuk operasi atomik
- Mengembalikan response sesuai hasil operasi

---

## Langkah 3: Update app.ts

Buka file `src/app.ts` dan lakukan perubahan berikut:

1. Tambahkan import untuk flashSaleRoutes
2. Hapus endpoint `/test/checkout` lama
3. Register route baru dengan prefix `/api/flash-sale`

```typescript
import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis";
import redisLuaScript from "./plugins/redis-lua";
import flashSaleRoutes from "./routes/flash-sale";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

const fastify = Fastify({
  logger: {
    level: "info",
  },
});

fastify.register(redisConnector);
fastify.register(redisLuaScript);

fastify.get("/health", async (_request, reply) => {
  const redisPing = await fastify.redis.ping();
  return {
    status: "ok",
    redis: redisPing === "PONG" ? "connected" : "disconnected",
  };
});

fastify.register(flashSaleRoutes, { prefix: "/api/flash-sale" });

const start = async () => {
  const port = parseInt(process.env.SERVER_PORT || "3000", 10);
  try {
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
```

**Penjelasan:**
- `import flashSaleRoutes`: Import route plugin yang baru dibuat
- `fastify.register(flashSaleRoutes, { prefix: "/api/flash-sale" })`: Meregistrasi route dengan prefix `/api/flash-sale`
- Route `/api/flash-sale/checkout` akan otomatis dibuat

---

## Langkah 4: Buat Script Test

Buat file `src/test-flash-sale.ts` untuk menguji endpoint:

```typescript
import "dotenv/config";
import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const BASE_URL = `http://localhost:${process.env.SERVER_PORT || "3000"}`;

async function testFlashSaleEndpoint() {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  console.log("=== Flash Sale Checkout Endpoint Test ===\n");

  try {
    console.log("Test 1: Initialize stock for product 1...");
    await redis.set("product:stock:1", 50);
    const stock = await redis.get("product:stock:1");
    console.log(`Initial stock: ${stock}`);

    console.log("\nTest 2: Testing successful checkout...");
    const response1 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user1", productId: 1 }),
    });
    const data1 = await response1.json();
    console.log(`Status: ${response1.status}`);
    console.log(`Response:`, data1);

    console.log("\nTest 3: Testing multiple checkouts...");
    for (let i = 2; i <= 5; i++) {
      const response = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: `user${i}`, productId: 1 }),
      });
      const data = await response.json();
      console.log(`Checkout ${i}: Status ${response.status} - Stock: ${data.remainingStock}`);
    }

    console.log("\nTest 4: Checking remaining stock in Redis...");
    const remainingStock = await redis.get("product:stock:1");
    console.log(`Remaining stock: ${remainingStock}`);

    console.log("\nTest 5: Checking order queue...");
    const queueLength = await redis.llen("queue:orders");
    console.log(`Orders in queue: ${queueLength}`);

    console.log("\nTest 6: Testing sold out scenario...");
    await redis.set("product:stock:2", 0);
    try {
      const response = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user99", productId: 2 }),
      });
      const data = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response:`, data);
    } catch (error: any) {
      console.log(`Expected error: ${error.message}`);
    }

    console.log("\nTest 7: Testing validation - missing userId...");
    try {
      const response = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: 1 }),
      });
      const data = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response:`, data);
    } catch (error: any) {
      console.log(`Expected error: ${error.message}`);
    }

    console.log("\nTest 8: Testing validation - invalid productId...");
    try {
      const response = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user100", productId: -1 }),
      });
      const data = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(`Response:`, data);
    } catch (error: any) {
      console.log(`Expected error: ${error.message}`);
    }

    console.log("\nAll tests completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await redis.quit();
  }
}

testFlashSaleEndpoint();
```

---

## Langkah 5: Update package.json

Tambahkan script test ke `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "start": "tsx src/app.ts",
    "typecheck": "tsc --noEmit",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:seed": "tsx src/seed.ts",
    "test:checkout": "tsx src/test-checkout.ts",
    "test:flash-sale": "tsx src/test-flash-sale.ts"
  }
}
```

---

## Langkah 6: Jalankan & Verifikasi

### 6.1 Pastikan Redis Berjalan

```bash
npm run docker:up
```

**Output yang diharapkan:**
```
[+] Running 3/3
 ✔ Container distributed-locking-engine-redis-1    Healthy    0.0s
 ✔ Container distributed-locking-engine-postgres-1 Healthy    0.0s
```

### 6.2 Jalankan Type Check

```bash
npm run typecheck
```

**Output yang diharapkan:**
```
(empty - berarti tidak ada error)
```

### 6.3 Jalankan Server

```bash
npm run dev
```

**Output yang diharapkan:**
```
[INFO] Redis connected and ready
[INFO] Server listening at http://0.0.0.0:3000
```

### 6.4 Test Endpoint dengan cURL

Buka terminal baru dan test endpoint:

**Test 1: Checkout Berhasil**

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user1\", \"productId\": 1}"
```

**Output yang diharapkan:**
```json
{"success":true,"remainingStock":49,"message":"Checkout successful"}
```

**Test 2: Produk Tidak Ditemukan**

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user1\", \"productId\": 999}"
```

**Output yang diharapkan:**
```json
{"success":false,"error":"PRODUCT_NOT_FOUND"}
```

**Test 3: Validation Error - Missing userId**

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"productId\": 1}"
```

**Output yang diharapkan:**
```json
{"statusCode":400,"error":"Bad Request","message":"body must have required property 'userId'"}
```

**Test 4: Validation Error - Invalid productId**

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user1\", \"productId\": -1}"
```

**Output yang diharapkan:**
```json
{"statusCode":400,"error":"Bad Request","message":"body/productId must be >= 1"}
```

### 6.5 Jalankan Script Test Lengkap

```bash
npm run test:flash-sale
```

**Output yang diharapkan:**
```
=== Flash Sale Checkout Endpoint Test ===

Test 1: Initialize stock for product 1...
Initial stock: 50

Test 2: Testing successful checkout...
Status: 200
Response: { success: true, remainingStock: 49, message: 'Checkout successful' }

Test 3: Testing multiple checkouts...
Checkout 2: Status 200 - Stock: 48
Checkout 3: Status 200 - Stock: 47
Checkout 4: Status 200 - Stock: 46
Checkout 5: Status 200 - Stock: 45

Test 4: Checking remaining stock in Redis...
Remaining stock: 45

Test 5: Checking order queue...
Orders in queue: 5

Test 6: Testing sold out scenario...
Status: 409
Response: { success: false, error: 'SOLD_OUT' }

Test 7: Testing validation - missing userId...
Status: 400
Response: { statusCode: 400, error: 'Bad Request', message: "body must have required property 'userId'" }

Test 8: Testing validation - invalid productId...
Status: 400
Response: { statusCode: 400, error: 'Bad Request', message: 'body/productId must be >= 1' }

All tests completed successfully!
```

### 6.6 Verifikasi Data di Redis

Buka terminal baru dan jalankan:

```bash
docker exec distributed-locking-engine-redis-1 redis-cli GET product:stock:1
```

**Output yang diharapkan:**
```
"45"
```

Cek queue orders:

```bash
docker exec distributed-locking-engine-redis-1 redis-cli LLEN queue:orders
```

**Output yang diharapkan:**
```
(integer) 5
```

### 6.7 Hentikan Server

Tekan `Ctrl + C` di terminal tempat server berjalan.

---

## Struktur File Akhir

```
distributed-locking-engine/
├── .env                    # File environment variables
├── .gitignore              # File untuk mengabaikan file tertentu di Git
├── docker-compose.yml      # Konfigurasi Docker untuk Redis dan PostgreSQL
├── drizzle.config.ts       # Konfigurasi Drizzle ORM
├── package.json            # Informasi project dan dependencies
├── tsconfig.json           # Konfigurasi TypeScript
├── project.md              # Deskripsi project
├── src/                    # Folder source code
│   ├── app.ts              # File utama aplikasi
│   ├── seed.ts             # Script untuk seed database
│   ├── test-checkout.ts    # Script test Lua script
│   ├── test-flash-sale.ts  # Script test endpoint flash sale
│   ├── db/                 # Folder untuk database
│   │   ├── index.ts        # Koneksi database
│   │   └── schema.ts       # Schema database
│   ├── lua/                # Folder untuk skrip Lua
│   │   └── decrement_stock.lua  # Skrip Lua untuk decrement stok
│   ├── plugins/            # Folder untuk plugin
│   │   ├── redis.ts        # Plugin untuk koneksi Redis
│   │   └── redis-lua.ts    # Plugin untuk Redis Lua script
│   └── routes/             # Folder untuk route API
│       └── flash-sale.ts   # Route untuk flash sale checkout
├── drizzle/                # Folder untuk migrasi (otomatis dibuat)
└── guide/                  # Folder panduan
    ├── phase1.md           # Panduan fase 1
    ├── phase2.md           # Panduan fase 2
    ├── phase3.md           # Panduan fase 3
    └── phase4.md           # Panduan fase 4
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `PRODUCT_NOT_FOUND` error | Pastikan key `product:stock:<id>` sudah diinisialisasi sebelum dipanggil |
| `SOLD_OUT` error | Normal jika stok sudah 0. Inisialisasi ulang dengan `redis.set("product:stock:1", 50)` |
| `400 Bad Request` | Pastikan body request sesuai schema (userId string, productId integer > 0) |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat error detail |
| Server tidak bisa diakses | Pastikan Docker container Redis sudah running dengan `npm run docker:up` |
| Route not found | Pastikan endpoint menggunakan path `/api/flash-sale/checkout` |

---

## Konsep Penting

### Fastify Route Validation

Fastify menggunakan JSON Schema untuk validasi request. Keuntungannya:

1. **Performance**: Schema dikompilasi menjadi fungsi validasi yang sangat cepat
2. **Type Safety**: TypeScript interface dan JSON Schema harus konsisten
3. **Auto Response Filtering**: Response otomatis difilter sesuai schema untuk keamanan

### Route Prefixing

Fastify mendukung route prefixing untuk mengorganisasi API:

```typescript
fastify.register(flashSaleRoutes, { prefix: "/api/flash-sale" });
// Route /checkout akan menjadi /api/flash-sale/checkout
```

### Response Serialization

Fastify menggunakan `fast-json-stringify` untuk serialisasi response. Dengan mendefinisikan response schema:
- Response body otomatis difilter (field yang tidak didefinisikan tidak akan dikirim)
- Performa serialisasi meningkat 10-20%

### HTTP Status Codes

- `200 OK`: Request berhasil diproses
- `400 Bad Request`: Request tidak valid (validation error atau produk tidak ditemukan)
- `409 Conflict`: Terjadi konflik (stok habis)
- `500 Internal Server Error`: Error yang tidak terduga

---

## Ringkasan Perintah

```bash
# Jalankan Docker container
npm run docker:up

# Type checking
npm run typecheck

# Jalankan server
npm run dev

# Test endpoint dengan cURL
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user1\", \"productId\": 1}"

# Jalankan script test lengkap
npm run test:flash-sale

# Cek data di Redis
docker exec distributed-locking-engine-redis-1 redis-cli GET product:stock:1
docker exec distributed-locking-engine-redis-1 redis-cli LLEN queue:orders
docker exec distributed-locking-engine-redis-1 redis-cli LRANGE queue:orders 0 -1
```

---

## Selanjutnya

Selamat! Anda sudah berhasil menyelesaikan Fase 4. Sekarang Anda memiliki:
- Endpoint `POST /api/flash-sale/checkout` dengan validasi payload
- Integrasi dengan skrip Lua Redis untuk operasi atomik
- Respons instan: 200 OK, 400 Bad Request, atau 409 Conflict

Di **Fase 5: Asynchronous Worker (Redis Queue ke PostgreSQL)**, kita akan:
1. Membuat proses background worker untuk membaca order dari Redis
2. Menyimpan data transaksi ke PostgreSQL secara asinkron
3. Menggunakan batch insert untuk performa lebih baik

Lanjut ke Fase 5 untuk melanjutkan pengembangan aplikasi kita.
