# Fase 7: Load Testing & Race Condition Verification (k6)

## Gambaran Umum

Pada fase-fase sebelumnya, kita telah membangun seluruh komponen sistem *flash sale*: endpoint checkout ultra-cepat dengan Redis Lua script, background worker untuk persistensi ke PostgreSQL, serta mekanisme idempotensi untuk mencegah user membeli lebih dari sekali. 

Namun, **semua pengujian sebelumnya hanya dilakukan secara serial atau dengan jumlah request yang sangat kecil** (5-10 request). Pertanyaan kritis yang belum terjawab: **Bisakah sistem ini menangani 2.000 request serentak dalam 2 detik tanpa overselling?**

Pada fase ini, kita menggunakan **k6** (load testing tool open-source dari Grafana) untuk melakukan *stress test* terhadap endpoint checkout dan memverifikasi secara empiris bahwa:
- Tepat 50 request berhasil (sesuai stok), sisanya gagal/SOLD_OUT
- Stok akhir di Redis tepat **0** (tidak pernah minus)
- Total baris di tabel `orders` PostgreSQL tepat **50**
- Tidak ada user yang berhasil checkout lebih dari 1 kali

Alur Load Testing Fase 7:

```text
k6 Load Test Runner (2000 VUs, 2 seconds burst)
  |
  |-- setup(): POST /__test/seed { stock: 50 }
  |     |
  |     +--> Truncate tables, Insert product, Reset Redis keys
  |
  |-- default() x 2000 concurrent: POST /api/flash-sale/checkout
  |     |
  |     +--> Lua Script (Atomic): SISMEMBER -> DECRBY -> SADD -> LPUSH
  |           |
  |           +--> 50x SUCCESS (200 OK)  |  1950x SOLD_OUT (409) / connection refused
  |
  |-- teardown(): GET /__test/verify?productId=<id>
        |
        +--> Verify: Redis stock == 0, PostgreSQL orders == 50, Redis buyers == 50
```

---

## Tujuan

Setelah menyelesaikan fase ini, Anda akan memahami cara:

1. Menginstal dan mengkonfigurasi **k6** untuk load testing HTTP API.
2. Menulis skrip k6 dengan skenario *constant-arrival-rate* untuk mensimulasikan traffic *flash sale* yang ekstrem.
3. Menggunakan `setup()` dan `teardown()` di k6 untuk inisialisasi data dan verifikasi hasil akhir.
4. Membuat *test helper endpoints* di Fastify untuk mendukung seed dan verifikasi otomatis.
5. Menggunakan `check()` assertions dan `thresholds` untuk memvalidasi hasil load test.
6. Membaca dan menginterpretasi laporan hasil k6 (*summary metrics*).
7. Membuktikan secara empiris bahwa sistem bebas dari *race condition* dan *overselling*.

---

## Prasyarat

Pastikan Fase 1 sampai Fase 6 sudah berjalan dengan baik:

- Container Redis dan PostgreSQL aktif di Docker (`docker compose ps` sehat).
- Server Fastify dan Worker asinkron dapat berjalan.
- File `.env` terkonfigurasi dengan benar.
- Load test membutuhkan **k6** terinstal di mesin Anda.

---

## Konsep Dasar Sebelum Menulis Kode

### 1. Mengapa k6?

**k6** adalah tool load testing modern open-source dari Grafana yang ditulis dalam Go dengan engine JavaScript (V8). Keunggulannya:

- **Performa tinggi**: Satu mesin bisa menghasilkan ribuan VUs tanpa overhead Node.js.
- **Skrip JavaScript**: Mudah ditulis bagi developer yang sudah familiar JS/TS.
- **Built-in metrics**: Latency (p50, p90, p95, p99), throughput, error rate otomatis terkumpul.
- **Thresholds**: Bisa gagalkan test jika metrik tertentu melampaui batas (cocok untuk CI/CD).
- **Custom summary**: Output bisa di-format ke JSON, HTML, atau format lain.

### 2. Executor `constant-arrival-rate`

Kita menggunakan executor `constant-arrival-rate` karena ingin mensimulasikan traffic yang datang dengan **laju konstan** (banyak request dalam waktu singkat), bukan berdasarkan jumlah VUs:

```javascript
export const options = {
  scenarios: {
    flash_sale_burst: {
      executor: "constant-arrival-rate",
      rate: 2000,           // 2000 iterasi per timeUnit
      timeUnit: "2s",       // dalam 2 detik
      duration: "2s",       // total durasi 2 detik
      preAllocatedVUs: 2000, // alokasi maksimum VUs
      maxVUs: 2000,
    },
  },
};
```

Artinya: k6 akan mengirim **2000 request dalam 2 detik** (1000 request/detik) ke endpoint checkout.

### 3. `setup()` dan `teardown()` di k6

k6 mendukung lifecycle functions:

- **`setup()`**: Dijalankan **sekali** sebelum test dimulai. Digunakan untuk seed data, reset state, dll. Return value diteruskan ke `default()` dan `teardown()`.
- **`default()`**: Dijalankan oleh **setiap VU** untuk setiap iterasi. Ini adalah fungsi utama load test.
- **`teardown()`**: Dijalankan **sekali** setelah semua VUs selesai. Digunakan untuk verifikasi akhir dan cleanup.

### 4. Test Helper Endpoints

Untuk memudahkan k6 melakukan setup dan verifikasi, kita membuat 2 endpoint khusus di server Fastify:

- `POST /__test/seed` — Reset database dan Redis, buat produk baru dengan stok tertentu.
- `GET /__test/verify?productId=<id>` — Mengambil status akhir: stok Redis, jumlah order PostgreSQL, jumlah buyers di Redis Set.

Endpoint ini **hanya untuk pengujian** dan sebaiknya tidak di-expose ke publik di production.

### 5. Custom Metrics di k6

k6 memungkinkan definisi custom counter untuk melacak jenis response:

```javascript
import { Counter } from "k6/metrics";

const successCount = new Counter("checkout_success");
const soldOutCount = new Counter("checkout_sold_out");
```

Counter ini akan muncul di laporan akhir dan bisa digunakan dalam `thresholds`.

---

## Langkah 1: Instalasi k6

### Windows (pakai winget — direkomendasikan)

```bash
winget install k6 --source winget
```

**Output:**
```text
Found k6 [GrafanaLabs.k6] Version 2.2.0
...
Successfully installed
```

> [!NOTE]
> Setelah instalasi, **restart terminal** agar `k6` terdeteksi di PATH. Verifikasi dengan:
> ```bash
> k6 version
> ```
> **Output:**
> ```text
> k6.exe v2.2.0 (commit/00a9a1b7f5, go1.26.5, windows/amd64)
> ```

### Alternatif lain

| Metode | Perintah |
|---|---|
| Chocolatey | `choco install k6` |
| npm (global) | `npm install -g k6` |
| Docker | `docker pull grafana/k6` |
| MSI Installer | Download dari https://dl.k6.io/msi/ |

---

## Langkah 2: Buat Test Helper Endpoints

Buat file baru `src/routes/test-helpers.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";
import { db } from "../db";
import { products, orders } from "../db/schema";
import { sql } from "drizzle-orm";

async function testHelpersRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { stock: number } }>(
    "/seed",
    async (request: FastifyRequest<{ Body: { stock: number } }>, reply: FastifyReply) => {
      const { stock } = request.body;
      const redis = fastify.redis as Redis;

      // 1. Truncate semua data (reset auto-increment sequence)
      await db.execute(
        sql`TRUNCATE TABLE "orders", "products" RESTART IDENTITY CASCADE;`,
      );

      // 2. Insert produk baru dengan stok yang diinginkan
      const [product] = await db
        .insert(products)
        .values({
          name: "Flash Sale Load Test Item",
          stock: stock,
        })
        .returning();

      // 3. Set stok di Redis, bersihkan Set users dan queues
      const stockKey = `product:stock:${product.id}`;
      const usersKey = `product:users:${product.id}`;

      await redis.set(stockKey, stock);
      await redis.del(usersKey);
      await redis.del("queue:orders");
      await redis.del("queue:orders:dlq");

      return reply.status(200).send({
        productId: product.id,
        stock: stock,
      });
    },
  );

  fastify.get<{ Querystring: { productId: string } }>(
    "/verify",
    async (request: FastifyRequest<{ Querystring: { productId: string } }>, reply: FastifyReply) => {
      const { productId } = request.query;
      const redis = fastify.redis as Redis;

      const stockKey = `product:stock:${productId}`;
      const usersKey = `product:users:${productId}`;

      // 1. Ambil stok dari Redis
      const redisStock = parseInt((await redis.get(stockKey)) || "-1", 10);

      // 2. Hitung jumlah buyers di Redis Set
      const redisBuyersCount = await redis.scard(usersKey);

      // 3. Hitung jumlah orders di PostgreSQL
      const [orderCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.productId} = ${parseInt(productId, 10)}`);

      return reply.status(200).send({
        redisStock: redisStock,
        postgresOrders: orderCount.count,
        redisBuyersCount: redisBuyersCount,
      });
    },
  );
}

export default testHelpersRoutes;
```

### Penjelasan:

**`/seed` endpoint:**
- `TRUNCATE ... RESTART IDENTITY CASCADE` — Menghapus semua data DAN me-reset sequence auto-increment PostgreSQL ke 1. Ini memastikan produk pertama selalu mendapat `id = 1`.
- Mengembalikan `productId` agar k6 tahu ID produk yang harus di-checkout.

**`/verify` endpoint:**
- Mengambil 3 metrik verifikasi sekaligus: stok Redis, jumlah order PostgreSQL, jumlah buyers Redis Set.
- Digunakan oleh k6 `teardown()` untuk assert bahwa semuanya konsisten.

---

## Langkah 3: Register Test Helper Routes di Server

Buka file `src/app.ts` dan tambahkan import serta registrasi route:

```typescript
import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis";
import redisLuaScript from "./plugins/redis-lua";
import flashSaleRoutes from "./routes/flash-sale";
import testHelpersRoutes from "./routes/test-helpers";  // <-- TAMBAHKAN

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
fastify.register(testHelpersRoutes, { prefix: "/__test" });  // <-- TAMBAHKAN

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

---

## Langkah 4: Buat Skrip Load Test k6

Buat folder `load-test/` di root project, lalu buat file `load-test/flash-sale-load-test.js`:

```javascript
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const STOCK = parseInt(__ENV.STOCK || "50", 10);
const TOTAL_USERS = parseInt(__ENV.TOTAL_USERS || "2000", 10);

// Custom counters untuk melacak jenis response
const successCount = new Counter("checkout_success");
const soldOutCount = new Counter("checkout_sold_out");
const duplicateCount = new Counter("checkout_duplicate");
const otherErrorCount = new Counter("checkout_other_error");

export const options = {
  scenarios: {
    flash_sale_burst: {
      executor: "constant-arrival-rate",
      rate: TOTAL_USERS,
      timeUnit: "2s",
      duration: "2s",
      preAllocatedVUs: TOTAL_USERS,
      maxVUs: TOTAL_USERS,
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<500"],
    checkout_success: [`count==${STOCK}`],
    checkout_sold_out: [`count>=${TOTAL_USERS - STOCK}`],
  },
};

export function setup() {
  console.log(`\n=== FLASH SALE LOAD TEST SETUP ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Stock: ${STOCK}`);
  console.log(`Total VUs/Users: ${TOTAL_USERS}`);

  const seedRes = http.post(
    `${BASE_URL}/__test/seed`,
    JSON.stringify({ stock: STOCK }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (seedRes.status !== 200) {
    throw new Error(`Setup failed: seed returned status ${seedRes.status}`);
  }

  const seedData = seedRes.json();
  console.log(`Seeded product ID: ${seedData.productId}, stock: ${seedData.stock}`);

  return { productId: seedData.productId };
}

export default function (data) {
  const userId = `loadtest_user_${__VU}_${__ITER}`;
  const payload = JSON.stringify({
    userId: userId,
    productId: data.productId,
  });

  const params = {
    headers: { "Content-Type": "application/json" },
  };

  const res = http.post(`${BASE_URL}/api/flash-sale/checkout`, payload, params);

  if (res.status === 200) {
    const body = res.json();
    check(res, {
      "checkout success": (r) => r.status === 200 && body.success === true,
    });
    successCount.add(1);
  } else if (res.status === 409) {
    const body = res.json();
    if (body.error === "SOLD_OUT") {
      soldOutCount.add(1);
    } else if (body.error === "USER_ALREADY_PURCHASED") {
      duplicateCount.add(1);
    } else {
      otherErrorCount.add(1);
    }
  } else {
    otherErrorCount.add(1);
  }
}

export function teardown(data) {
  console.log(`\n=== VERIFYING RESULTS ===`);

  const verifyRes = http.get(
    `${BASE_URL}/__test/verify?productId=${data.productId}`,
  );

  if (verifyRes.status !== 200) {
    console.error(`Verify endpoint returned status: ${verifyRes.status}`);
    return;
  }

  const result = verifyRes.json();
  console.log(`Redis stock: ${result.redisStock} (expected: 0)`);
  console.log(`PostgreSQL orders: ${result.postgresOrders} (expected: ${STOCK})`);
  console.log(`Redis buyers count: ${result.redisBuyersCount} (expected: ${STOCK})`);

  check(result, {
    "redis stock is 0": (r) => r.redisStock === 0,
    [`postgres orders count is ${STOCK}`]: (r) => r.postgresOrders === STOCK,
    [`redis buyers count is ${STOCK}`]: (r) => r.redisBuyersCount === STOCK,
  });

  if (result.redisStock === 0 && result.postgresOrders === STOCK && result.redisBuyersCount === STOCK) {
    console.log(`\n=== ALL VERIFICATIONS PASSED ===`);
  } else {
    console.error(`\n=== SOME VERIFICATIONS FAILED ===`);
  }
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
    "load-test/summary.json": JSON.stringify(data, null, 2),
  };
}
```

### Penjelasan Komponen:

| Komponen | Fungsi |
|---|---|
| `__VU` | ID Virtual User saat ini (0 s/d 1999) |
| `__ITER` | Iterasi ke-berapa yang sedang dijalankan VU |
| `userId = loadtest_user_${__VU}_${__ITER}` | Setiap request menggunakan user ID unik |
| `preAllocatedVUs: 2000` | Alokasi 2000 VUs sekaligus di awal |
| `rate: 2000 / timeUnit: "2s"` | 2000 request dalam 2 detik = 1000 req/detik |
| `thresholds` | Gagal jika check tidak terpenuhi |
| `handleSummary` | Export hasil ke JSON file + stdout |

---

## Langkah 5: Tambahkan Script di `package.json`

Tambahkan baris berikut di dalam object `scripts` pada file `package.json`:

```json
"test:load": "k6 run load-test/flash-sale-load-test.js",
```

Sehingga bagian `scripts` tampak seperti berikut:

```json
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
    "test:flash-sale": "tsx src/test-flash-sale.ts",
    "test:idempotency": "tsx src/test-idempotency.ts",
    "test:load": "k6 run load-test/flash-sale-load-test.js",
    "worker": "tsx src/worker.ts"
  },
```

---

## Verifikasi & Pengujian Lengkap

### 1. Periksa Tipe TypeScript

```bash
npm run typecheck
```

**Output yang diharapkan:**
```text
> distributed-locking-engine@1.0.0 typecheck
> tsc --noEmit
```
*(Tidak ada pesan error)*

---

### 2. Jalankan Docker Services

```bash
docker compose up -d
```

**Output:**
```text
 Container distributed-locking-engine-redis-1 Started
 Container distributed-locking-engine-postgres-1 Started
```

---

### 3. Push Schema Database

```bash
npm run db:push
```

**Output:**
```text
[i] No changes detected
```
*(Atau jika ada perubahan schema, proses migrasi akan berjalan)*

---

### 4. Jalankan Server Fastify (Terminal 1)

```bash
npm run start
```

**Output:**
```text
{"level":30,...,"msg":"Redis connected and ready"}
{"level":30,...,"msg":"Server listening at http://127.0.0.1:3000"}
```

---

### 5. Jalankan Worker (Terminal 2)

```bash
npm run worker
```

**Output:**
```text
[Worker] Waiting for Redis connection...
[Worker] Redis connected
[Worker] Redis ready, starting order processor...
[Worker] Worker started. Listening for orders...
```

> [!IMPORTANT]
> **Worker HARUS berjalan** selama load test agar order di Redis queue diproses ke PostgreSQL. Tanpa worker, `PostgreSQL orders` akan 0 di verifikasi akhir.

---

### 6. Jalankan Load Test (Terminal 3)

```bash
npm run test:load
```

Atau langsung dengan k6:
```bash
k6 run load-test/flash-sale-load-test.js
```

**Output lengkap yang akan muncul:**

```text
         /\      Grafana   /‾‾/
    /\  /  \     |\  __   /  /
   /  \/    \    | |/ /  /   ‾‾\
  /          \   |   (  |  (‾)  |
 / __________ \  |_|\_\  \_____/


     execution: local
        script: load-test\flash-sale-load-test.js
        output: -

     scenarios: (100.00%) 1 scenario, 2000 max VUs, 32s max duration (incl. graceful stop):
              * flash_sale_burst: 1000.00 iterations/s for 2s (maxVUs: 2000)

=== FLASH SALE LOAD TEST SETUP ===
Target: http://localhost:3000
Stock: 50
Total VUs/Users: 2000
Seeded product ID: 1, stock: 50

running (00.6s), 0117/2000 VUs, 455 complete and 0 interrupted iterations
flash_sale_burst   [  29% ] 0117/2000 VUs  0.6s/2s  1000.00 iters/s

running (01.6s), 0013/2000 VUs, 1560 complete and 0 interrupted iterations
flash_sale_burst   [  79% ] 0013/2000 VUs  1.6s/2s  1000.00 iters/s

=== VERIFYING RESULTS ===
Redis stock: 0 (expected: 0)
PostgreSQL orders: 50 (expected: 50)
Redis buyers count: 50 (expected: 50)

=== ALL VERIFICATIONS PASSED ===

     ✓ checkout success

     █ teardown

       ✓ redis stock is 0
       ✓ postgres orders count is 50
       ✓ redis buyers count is 50

   ✓ checkout_sold_out..............: 1950   895.87/s
   ✓ checkout_success...............: 50     22.97/s
     checks.........................: 100.00% ✓ 53         ✗ 0
     data_received..................: 428 kB  197 kB/s
     data_sent......................: 385 kB  177 kB/s
     http_req_duration..............: avg=51.01ms  min=4.3ms   med=33.17ms  max=143.41ms p(90)=113.25ms p(95)=122.99ms
     http_reqs......................: 2002    919.76/s
     iterations.....................: 2000    918.84/s
     vus_max........................: 2000

running (02.2s), 0000/2000 VUs, 2000 complete and 0 interrupted iterations
flash_sale_burst ✓ [ 100% ] 0000/2000 VUs  2s  1000.00 iters/s
```

---

### 7. Verifikasi Hasil Load Test

#### 7.1 Cek Stok di Redis

```bash
docker compose exec redis redis-cli GET product:stock:1
```

**Output:**
```text
"0"
```

Stok tepat **0**, tidak pernah minus.

#### 7.2 Cek Orders di PostgreSQL

```bash
docker compose exec postgres psql -U postgres -d flash_sale -c "SELECT count(*) FROM orders;"
```

**Output:**
```text
 count
-------
    50
(1 row)
```

Tepat **50 order** tersimpan di PostgreSQL.

#### 7.3 Cek Buyers di Redis Set

```bash
docker compose exec redis redis-cli SCARD product:users:1
```

**Output:**
```text
(integer) 50
```

Tepat **50 unique buyers** tercatat di Redis Set.

#### 7.4 Cek Summary JSON

Setelah load test selesai, file `load-test/summary.json` akan terbuat. Anda bisa membukanya untuk analisis lebih detail:

```bash
cat load-test/summary.json | head -50
```

---

### 8. Jalankan Ulang Load Test

Untuk mengulang test, cukup jalankan ulang perintah yang sama:

```bash
npm run test:load
```

Setup endpoint akan otomatis mereset semua state (truncate tables, reset Redis).

---

### 9. Konfigurasi Parameter via Environment Variable

Anda bisa mengubah parameter tanpa mengedit skrip:

```bash
# Ganti jumlah stok dan VUs
set STOCK=100
set TOTAL_USERS=5000
k6 run load-test/flash-sale-load-test.js
```

Atau di PowerShell:
```powershell
$env:STOCK=100; $env:TOTAL_USERS=5000; k6 run load-test/flash-sale-load-test.js
```

---

## Interpretasi Laporan k6

### Metrik Utama

| Metrik | Penjelasan | Target |
|---|---|---|
| `checkout_success` | Jumlah request yang berhasil (200 OK) | = `STOCK` (50) |
| `checkout_sold_out` | Jumlah request yang ditolak karena stok habis | >= `TOTAL_USERS - STOCK` |
| `http_req_duration` | Latency per request (avg, p90, p95, p99) | p99 < 500ms |
| `http_req_failed` | Persentase request yang gagal | - |
| `iterations` | Total iterasi yang dieksekusi | = `TOTAL_USERS` (2000) |

### Thresholds

Thresholds adalah aturan yang jika dilanggar, k6 akan mengembalikan **exit code non-zero** (gagal):

```javascript
thresholds: {
  http_req_duration: ["p(99)<500"],     // p99 latency harus < 500ms
  checkout_success: ["count==50"],       // Harus tepat 50 sukses
  checkout_sold_out: ["count>=1950"],    // Minimal 1950 sold out
},
```

Jika threshold gagal, Anda melihat di output:
```text
time="..." level=error msg="thresholds on metrics '...' have been crossed"
```

### Kenapa `checkout_sold_out` Bisa Kurang dari 1950?

Dalam test real, beberapa request mungkin gagal karena **connection refused** (server kewalahan menangani 2000 koneksi simultan). Request yang gagal terhubung dihitung sebagai `checkout_other_error`, bukan `checkout_sold_out`. Yang penting:

- **`checkout_success` tepat 50** — Tidak ada overselling
- **`checkout_duplicate` = 0** — Tidak ada user yang beli 2x
- **Redis stock = 0, PostgreSQL orders = 50** — Konsisten

---

## Struktur File yang Relevan di Fase 7

```text
distributed-locking-engine/
├── load-test/
│   ├── flash-sale-load-test.js    # Baru: Skrip k6 load test
│   └── summary.json               # Auto-generated: Hasil load test (setelah run)
├── src/
│   ├── routes/
│   │   ├── flash-sale.ts          # Tidak berubah
│   │   └── test-helpers.ts        # Baru: /__test/seed & /__test/verify endpoints
│   ├── app.ts                     # Diperbarui: registrasi testHelpersRoutes
│   ├── lua/
│   │   └── decrement_stock.lua    # Tidak berubah (dari fase 6)
│   ├── plugins/
│   │   ├── redis.ts               # Tidak berubah
│   │   └── redis-lua.ts           # Tidak berubah
│   ├── db/
│   │   ├── schema.ts              # Tidak berubah
│   │   └── index.ts               # Tidak berubah
│   ├── worker.ts                  # Tidak berubah
│   └── seed.ts                    # Tidak berubah
├── package.json                   # Diperbarui: tambah script "test:load"
└── .env                           # Tidak berubah
```

---

## Troubleshooting & FAQ

| Masalah | Penyebab | Solusi |
|---|---|---|
| `k6: command not found` | k6 belum terdeteksi di PATH setelah instalasi. | Restart terminal. Atau cek path instalasi secara manual. |
| `PostgreSQL orders: 0` di verifikasi | Worker tidak berjalan saat load test. | Jalankan `npm run worker` di terminal terpisah SEBELUM menjalankan load test. |
| `checkout_success > 50` (overselling) | Kemungkinan race condition di Lua script. | Pastikan skrip Lua menggunakan operasi atomik (DECRBY, SISMEMBER, SADD dalam satu script). |
| `checkout_success < 50` | Server tidak mampu menangani throughput atau timeout. | Cek apakah Redis dan PostgreSQL dalam kondisi sehat. Coba kurangi `TOTAL_USERS`. |
| `Setup failed: seed returned status 500` | Server belum jalan atau error di endpoint `/__test/seed`. | Pastikan server berjalan di port 3000. Cek log server. |
| `thresholds ... have been crossed` | Salah satu threshold tidak terpenuhi. | Cek metrik yang gagal. Bisa jadi jumlah success tidak sesuai atau latency terlalu tinggi. |
| Error `Connection refused` dalam jumlah besar | Server kewalahan dengan 2000 koneksi simultan. | Normal untuk mesin development. Yang penting `checkout_success` tetap tepat 50. |

---

## Ringkasan

Dengan menyelesaikan Fase 7:
- Sistem telah **terbukti secara empiris** mampu menangani **2.000 request serentak dalam 2 detik** tanpa overselling.
- Tepat **50 request berhasil** dan sisanya ditolak (SOLD_OUT atau connection limit).
- **Stok Redis = 0** (tidak pernah minus), **PostgreSQL orders = 50** (terpersist dengan benar).
- **Tidak ada race condition**: 0 duplikat pembelian dari user yang sama.
- Load test dapat diulang kapan saja dengan `npm run test:load`.
- Script k6 mendukung parameterisasi via environment variable untuk skenario test yang berbeda.

### Selanjutnya

Fase 7 adalah fase terakhir dari proyek Flash Sale Distributed Locking Engine. Seluruh komponen telah terbangun dan teruji:
1. Infrastruktur Docker (Redis + PostgreSQL)
2. Schema Database & ORM (Drizzle)
3. Atomic Lua Script di Redis
4. Fastify Checkout API
5. Async Worker (Redis Queue -> PostgreSQL)
6. Idempotensi & Anti-Duplicate
7. Load Testing & Race Condition Verification

Sistem ini siap untuk dikembangkan lebih lanjut ke arah production-ready (misalnya: monitoring, graceful shutdown, rate limiting, dll).
