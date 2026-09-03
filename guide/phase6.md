# Fase 6: Idempotensi & Validasi User Ganda (Locking Rules)

## Gambaran Umum

Pada fase-fase sebelumnya, kita telah membangun endpoint checkout ultra-cepat dengan Redis Lua script dan background worker untuk menyimpan order ke PostgreSQL. Namun, ada satu celah kritis pada sistem *flash sale*: **seorang user dapat melakukan checkout berkali-kali** baik sengaja (menggunakan bot/skrip otomatis) maupun tidak sengaja (*double click* pada tombol checkout).

Dalam bisnis *flash sale* barang bernilai tinggi atau stok terbatas, aturan umumnya adalah **1 user hanya boleh membeli 1 barang (kuota 1 item per akun)**.

Pada fase ini, kita mengimplementasikan **Idempotensi & Validasi User Ganda** menggunakan struktur data **Redis Set** yang dieksekusi langsung di dalam skrip atomik Lua.

Alur validasi di Fase 6:

```text
Client (userId: "user1", productId: 7)
  |
  v
Fastify Server
  |
  |-- EVALSHA decrement_stock.lua (KEYS: [stockKey, usersKey], ARGV: [productId, userId])
  |
  +---> [Redis Engine (Atomic Lua Execution)]
          |
          |-- 1. SISMEMBER product:users:7 "user1"
          |        |
          |        +--> Nilai = 1 (Sudah beli) ---> RETURN ERROR: "USER_ALREADY_PURCHASED"
          |
          |-- 2. GET product:stock:7
          |        |
          |        +--> Nilai <= 0 (Habis) -------> RETURN ERROR: "SOLD_OUT"
          |
          |-- 3. DECRBY product:stock:7 1 --------> Kurangi stok
          |-- 4. SADD product:users:7 "user1" ----> Catat user ke Set
          |-- 5. LPUSH queue:orders <json> -------> Antrekan order untuk worker
          |
          +--> RETURN {new_stock, 'OK'}
```

---

## Tujuan

Setelah menyelesaikan fase ini, Anda akan memahami cara:

1. Mencegah user yang sama membeli barang flash sale lebih dari satu kali (*single-purchase rule*).
2. Memanfaatkan struktur data **Redis Set** (`SADD`, `SISMEMBER`) untuk pengecekan keanggotaan instan dengan kompleksitas waktu **$O(1)$**.
3. Menjaga atomisitas validasi dan pemotongan stok di dalam skrip Lua untuk mencegah *Time-of-Check to Time-of-Use* (TOCTOU) *race condition*.
4. Mengembalikan HTTP Status Code yang tepat (`409 Conflict`) saat user terdeteksi sudah pernah membeli.
5. Menghindari jebakan ketidaksesuaian ID auto-increment PostgreSQL vs Redis dan retensi data Redis Set antar pengujian.

---

## Prasyarat

Pastikan Fase 1 sampai Fase 5 sudah berjalan dengan baik:

- Container Redis dan PostgreSQL aktif di Docker (`docker compose ps` sehat).
- Server Fastify dan Worker asinkron dapat berjalan.
- File `.env` terkonfigurasi dengan benar (`DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `SERVER_PORT`).

---

## Konsep Dasar Sebelum Menulis Kode

### 1. Mengapa Menggunakan Redis Set (`SADD` & `SISMEMBER`)?

Redis Set adalah kumpulan string unik tanpa urutan. Operasi utama Set memiliki performa ultra-tinggi:
- `SISMEMBER key member`: Mengecek apakah `member` ada di dalam Set. Mengembalikan `1` jika ada, `0` jika tidak ada. Kompleksitasnya **$O(1)$**.
- `SADD key member`: Menambahkan `member` ke dalam Set. Jika sudah ada, Redis tidak menduplikasi datanya. Kompleksitasnya **$O(1)$**.

Nama key yang kita gunakan untuk mencatat pembeli produk tertentu:
```text
product:users:<product_id>
```
Contoh jika `productId` adalah `7`, maka key-nya adalah `product:users:7`.

### 2. Bahaya TOCTOU (Time-of-Check to Time-of-Use) Jika Tanpa Lua

Bayangkan jika logika pengecekan dilakukan di aplikasi Node.js seperti ini:
```typescript
// CONTOH SALAH (RACE CONDITION BERBAHAYA!)
const alreadyBought = await redis.sismember(`product:users:${productId}`, userId);
if (alreadyBought) throw new Error("ALREADY_PURCHASED");

// Jeda milidetik di sini memungkinkan request kedua lolos sebelum request pertama selesai!
await redis.decr(`product:stock:${productId}`);
await redis.sadd(`product:users:${productId}`, userId);
```
Jika seorang user menekan tombol checkout 5 kali secara serentak dalam milidetik yang sama, kelima request tersebut akan membaca `sismember` bernilai `0` secara bersamaan, sehingga kelimanya berhasil memotong stok!

**Solusinya:** Logika pengecekan (`SISMEMBER`), pengurangan stok (`DECRBY`), dan pencatatan user (`SADD`) **wajib digabungkan di dalam satu Skrip Lua**. Karena Redis mengeksekusi skrip Lua secara *single-threaded* dan atomik, tidak ada request lain yang bisa menyela di tengah proses.

### 3. Standar Multi-Key pada Redis Lua (`KEYS` vs `ARGV`)

Redis mewajibkan setiap key yang diakses oleh skrip dideklarasikan melalui array `KEYS`. Ini krusial agar skrip kompatibel dengan Redis Cluster / Sharding:
- `KEYS[1]`: Key stok produk (`product:stock:<id>`)
- `KEYS[2]`: Key Set user pembeli (`product:users:<id>`)
- `ARGV[1]`: Nilai `product_id`
- `ARGV[2]`: Nilai `user_id`

Pada library `ioredis`, kita mendefinisikan command dengan opsi `numberOfKeys: 2`:
```typescript
redis.defineCommand("decrementStock", {
  numberOfKeys: 2,
  lua: DECREMENT_STOCK_SCRIPT,
});
```

---

## Perhatian Khusus: Pelajaran Berharga dari Fase 5

Sebelum memulai penulisan kode, ada dua potensi masalah nyata yang wajib dipahami agar Anda tidak mengalami *blocker*:

### Masalah 1: Auto-Increment PostgreSQL Identity vs Hardcoded ID Redis

> [!WARNING]
> **Mengapa ID PostgreSQL bisa menjadi 5, 7, atau lebih besar meskipun tabel sudah di-delete?**
>
> Pada schema Drizzle:
> ```typescript
> id: integer().primaryKey().generatedAlwaysAsIdentity()
> ```
> PostgreSQL menggunakan *internal sequence* (`products_id_seq`). Perintah `DELETE FROM products;` hanya menghapus baris data, **tetapi TIDAK me-reset sequence hitungan ID**!
> 
> Akibatnya:
> 1. Pertama kali `seed`: produk mendapat `id = 1`.
> 2. Kedua kali `seed`: produk mendapat `id = 2`.
> 3. Ketujuh kali `seed`: produk mendapat `id = 7`.
> 
> Jika Anda atau skrip pengujian melakukan hardcode `productId: 1` di Redis, sedangkan di PostgreSQL produknya memiliki `id: 7`, maka:
> - Fastify dan Redis menganggap checkout sukses (karena key `product:stock:1` ada).
> - Redis memasukkan `{ "product_id": "1", ... }` ke `queue:orders`.
> - Worker mengambil antrean dan mencoba insert ke tabel `orders` PostgreSQL.
> - **PostgreSQL menolak transaksi dengan error foreign key:**
>   `violates foreign key constraint "orders_product_id_products_id_fk" - Key (product_id)=(1) is not present in table "products".`

**Solusi Robust:**
1. Di skrip pengujian atau pemanggilan cURL, selalu pastikan menggunakan ID produk yang benar-benar ada di PostgreSQL (cek dengan `SELECT id FROM products;`).
2. Skrip pengujian otomatis harus mengambil ID produk secara dinamis langsung dari database.

### Masalah 2: Retensi Data Redis Set Antar Percobaan Pengujian

> [!IMPORTANT]
> Saat Anda menguji pembelian dengan user `user1`, Redis Set `product:users:<id>` akan menyimpan `'user1'`.
>
> Jika Anda mengulang pengujian kedua kalinya dan hanya mengatur ulang stok (`SET product:stock:<id> 50`), **Redis Set masih menyimpan `user1` dari percobaan sebelumnya**.
>
> Akibatnya, pada percobaan kedua, request pertama `user1` akan langsung ditolak dengan error `USER_ALREADY_PURCHASED`!
>
> Oleh karena itu, setiap kali mereset stok untuk pengujian, **kalian WAJIB menghapus key Set user**:
> ```bash
> docker compose exec redis redis-cli DEL product:users:<id>
> ```

---

## Langkah 1: Update Skrip Lua

Buka file `src/lua/decrement_stock.lua` dan perbarui isinya menjadi:

```lua
-- Lua script for atomic stock decrement, user idempotency check, and order queueing
-- KEYS[1] = product:stock:<product_id>
-- KEYS[2] = product:users:<product_id>
-- ARGV[1] = product_id
-- ARGV[2] = user_id

local stock_key = KEYS[1]
local user_set_key = KEYS[2]
local product_id = ARGV[1]
local user_id = ARGV[2]

-- 1. Cek apakah user sudah pernah checkout produk ini (Idempotensi)
if redis.call('SISMEMBER', user_set_key, user_id) == 1 then
    return redis.error_reply('USER_ALREADY_PURCHASED')
end

-- 2. Cek apakah stok produk ada
local current_stock = tonumber(redis.call('GET', stock_key))
if current_stock == nil then
    return redis.error_reply('PRODUCT_NOT_FOUND')
end

-- 3. Cek apakah kuota stok masih mencukupi
if current_stock <= 0 then
    return redis.error_reply('SOLD_OUT')
end

-- 4. Kurangi stok produk secara atomik sebesar 1
local new_stock = redis.call('DECRBY', stock_key, 1)

-- 5. Daftarkan userId ke dalam Redis Set agar tidak bisa checkout lagi
redis.call('SADD', user_set_key, user_id)

-- 6. Masukkan order ke antrean Redis List untuk diproses worker
local order_data = cjson.encode({
    product_id = product_id,
    user_id = user_id,
    timestamp = redis.call('TIME')[1]
})
redis.call('LPUSH', 'queue:orders', order_data)

-- 7. Kembalikan sisa stok dan status OK
return {new_stock, 'OK'}
```

### Penjelasan Logika:
1. `SISMEMBER user_set_key user_id`: Jika user sudah terdaftar di set, langsung kembalikan pesan error `USER_ALREADY_PURCHASED`. Kuota stok tidak akan dipotong.
2. `SADD user_set_key user_id`: Dijalankan **hanya setelah** validasi stok lolos dan `DECRBY` berhasil dieksekusi. User yang gagal beli karena *sold out* tidak akan dimasukkan ke dalam Set.

---

## Langkah 2: Update Plugin Redis Lua

Buka file `src/plugins/redis-lua.ts`. Kita perlu mengubah parameter `numberOfKeys` dari `1` menjadi `2` dan memperbarui deklarasi tipe TypeScript-nya.

Ganti isi `src/plugins/redis-lua.ts` dengan kode berikut:

```typescript
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { readFileSync } from "fs";
import { join } from "path";
import type Redis from "ioredis";

const DECREMENT_STOCK_SCRIPT = readFileSync(
  join(__dirname, "../lua/decrement_stock.lua"),
  "utf-8",
);

async function redisLuaScript(fastify: FastifyInstance) {
  // Deklarasi fungsi custom redis command sesuai jumlah KEYS dan ARGV baru
  const redis = fastify.redis as Redis & {
    decrementStock: (
      stockKey: string,
      userSetKey: string,
      productId: number,
      userId: string,
    ) => Promise<[number, string]>;
  };

  // Konfigurasi 2 keys: KEYS[1] = stockKey, KEYS[2] = userSetKey
  redis.defineCommand("decrementStock", {
    numberOfKeys: 2,
    lua: DECREMENT_STOCK_SCRIPT,
  });

  fastify.addHook("onClose", async () => {
    fastify.log.info("Redis Lua scripts cleaned up");
  });
}

export default fastifyPlugin(redisLuaScript);
```

---

## Langkah 3: Update Route Checkout API

Buka file `src/routes/flash-sale.ts`. Kita perlu:
1. Menentukan `userSetKey = \`product:users:\${productId}\``.
2. Meneruskan `userSetKey` saat memanggil `decrementStock`.
3. Menangkap error `USER_ALREADY_PURCHASED` dan mengembalikan respons HTTP `409 Conflict`.
4. Memastikan pengecekan error menggunakan `includes` (bukan typo `include`).

Perbarui `src/routes/flash-sale.ts` sehingga menjadi seperti berikut:

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
    async (
      request: FastifyRequest<{ Body: CheckoutBody }>,
      reply: FastifyReply,
    ) => {
      const { userId, productId } = request.body;
      const stockKey = `product:stock:${productId}`;
      const userSetKey = `product:users:${productId}`;

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
            userSetKey: string,
            productId: number,
            userId: string,
          ) => Promise<[number, string]>;
        };

        const result = await redisWithCommands.decrementStock(
          stockKey,
          userSetKey,
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

        // User sudah pernah checkout produk ini sebelumnya
        if (errorMessage.includes("USER_ALREADY_PURCHASED")) {
          return reply.status(409).send({
            success: false,
            error: "USER_ALREADY_PURCHASED",
          } as CheckoutErrorResponse);
        }

        // Stok produk sudah habis
        if (errorMessage.includes("SOLD_OUT")) {
          return reply.status(409).send({
            success: false,
            error: "SOLD_OUT",
          } as CheckoutErrorResponse);
        }

        // Produk tidak ditemukan di Redis
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

---

## Langkah 4: Menulis Skrip Pengujian Otomatis (`src/test-idempotency.ts`)

Untuk memastikan fitur idempotensi bekerja dengan sempurna dan bebas dari masalah ID mismatch, buat file baru:
`src/test-idempotency.ts`

Kode ini secara cerdas membaca ID produk aktif dari PostgreSQL secara dinamis, mereset Set Redis, menguji skenario request berurutan, serta mengirim 5 request bersamaan (*race condition attack*).

```typescript
import "dotenv/config";
import Redis from "ioredis";
import { db } from "./db";
import { products } from "./db/schema";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const BASE_URL = `http://localhost:${process.env.SERVER_PORT || "3000"}`;

async function testIdempotency() {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  console.log("=== Phase 6: Idempotency & Duplicate User Prevention Test ===\n");

  try {
    // 1. Ambil productId valid secara dinamis dari database PostgreSQL
    console.log("1. Mengambil produk aktif dari PostgreSQL...");
    const existingProducts = await db.select().from(products).limit(1);

    if (existingProducts.length === 0) {
      throw new Error(
        "Tidak ada produk di database PostgreSQL! Jalankan 'npm run db:seed' terlebih dahulu.",
      );
    }

    const testProduct = existingProducts[0];
    const productId = testProduct.id;
    console.log(
      `   Produk ditemukan: ID = ${productId}, Nama = "${testProduct.name}"\n`,
    );

    const stockKey = `product:stock:${productId}`;
    const usersKey = `product:users:${productId}`;

    // 2. Inisialisasi state di Redis (Reset stok dan bersihkan Set user)
    console.log("2. Menyiapkan state awal di Redis...");
    await redis.set(stockKey, 10);
    await redis.del(usersKey);
    await redis.del("queue:orders");
    console.log(`   Stok di-set ke: 10`);
    console.log(`   Key Set user '${usersKey}' dibersihkan`);
    console.log(`   Queue 'queue:orders' dibersihkan\n`);

    // 3. Test Kasus 1: Pembelian pertama user_alpha (Harus Sukses)
    console.log("3. Test: Pembelian pertama user_alpha...");
    const res1 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_alpha", productId }),
    });
    const data1 = (await res1.json()) as any;
    console.log(`   HTTP Status: ${res1.status}`);
    console.log(`   Response:`, data1);
    if (res1.status !== 200 || !data1.success) {
      throw new Error("Gagal pada pembelian pertama user_alpha!");
    }

    // 4. Test Kasus 2: Percobaan pembelian KEDUA oleh user_alpha (Harus Ditolak)
    console.log("\n4. Test: Percobaan pembelian KEDUA user_alpha (Idempotensi)...");
    const res2 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_alpha", productId }),
    });
    const data2 = (await res2.json()) as any;
    console.log(`   HTTP Status: ${res2.status} (Diharapkan: 409 Conflict)`);
    console.log(`   Response:`, data2);
    if (res2.status !== 409 || data2.error !== "USER_ALREADY_PURCHASED") {
      throw new Error(
        `Idempotensi gagal! User berhasil beli 2x atau error tidak sesuai. Status: ${res2.status}, Error: ${data2.error}`,
      );
    }
    console.log("   --> SUKSES: Request kedua user_alpha berhasil ditolak!");

    // 5. Test Kasus 3: Pembelian oleh user berbeda (user_beta)
    console.log("\n5. Test: Pembelian pertama user_beta (User berbeda)...");
    const res3 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_beta", productId }),
    });
    const data3 = (await res3.json()) as any;
    console.log(`   HTTP Status: ${res3.status}`);
    console.log(`   Response:`, data3);
    if (res3.status !== 200 || !data3.success) {
      throw new Error("Gagal pada pembelian user_beta!");
    }

    // 6. Test Kasus 4: Serangan 5 Request Paralel Serentak oleh 1 User (user_gamma)
    console.log("\n6. Test: 5 Request paralel serentak dari user_gamma...");
    const parallelRequests = Array.from({ length: 5 }, () =>
      fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user_gamma", productId }),
      }).then(async (res) => ({
        status: res.status,
        data: (await res.json()) as any,
      })),
    );

    const results = await Promise.all(parallelRequests);
    const successCount = results.filter((r) => r.status === 200).length;
    const rejectedCount = results.filter(
      (r) => r.status === 409 && r.data.error === "USER_ALREADY_PURCHASED",
    ).length;

    console.log(`   Hasil dari 5 request serentak:`);
    console.log(`   - Sukses (200 OK): ${successCount} (Diharapkan: 1)`);
    console.log(
      `   - Ditolak (409 USER_ALREADY_PURCHASED): ${rejectedCount} (Diharapkan: 4)`,
    );

    if (successCount !== 1 || rejectedCount !== 4) {
      throw new Error(
        `Race condition gagal dicegah! Sukses: ${successCount}, Ditolak: ${rejectedCount}`,
      );
    }
    console.log("   --> SUKSES: Atomisitas Lua script mencegah race condition user ganda!");

    // 7. Test Kasus 5: Verifikasi Data Konsistensi di Redis
    console.log("\n7. Verifikasi Data di Redis:");
    const finalStock = await redis.get(stockKey);
    const buyers = await redis.smembers(usersKey);
    const queueLength = await redis.llen("queue:orders");

    console.log(`   Sisa Stok di Redis: ${finalStock} (Awal: 10, Terjual: 3, Sisa: 7)`);
    console.log(`   Daftar Pembeli di Redis Set (${usersKey}):`, buyers);
    console.log(`   Jumlah Order di queue:orders: ${queueLength}`);

    if (parseInt(finalStock || "0", 10) !== 7) {
      throw new Error(`Sisa stok tidak tepat! Diharapkan 7, didapat: ${finalStock}`);
    }

    if (buyers.length !== 3 || queueLength !== 3) {
      throw new Error("Jumlah pembeli di Redis Set atau antrean tidak cocok!");
    }

    console.log("\n=== SEMUA PENGUJIAN FASE 6 BERHASIL DILALUI DENGAN SEMPURNA! ===");
  } catch (error: any) {
    console.error("\nTest Gagal:", error.message);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

testIdempotency();
```

---

## Langkah 5: Update `src/test-checkout.ts` (Opsional tapi Direkomendasikan)

Jika Anda ingin menjalankan `npm run test:checkout` (pengujian langsung fungsi Lua ioredis tanpa HTTP), perbarui pemanggilan `decrementStock` di `src/test-checkout.ts` agar menyertakan parameter `product:users:1` dan mengosongkan key tersebut sebelum pengujian:

```typescript
// Di dalam src/test-checkout.ts:
redis.defineCommand("decrementStock", {
  numberOfKeys: 2,
  lua: DECREMENT_STOCK_SCRIPT,
});

// Bersihkan state sebelum pengujian
await redis.set("product:stock:1", 50);
await redis.del("product:users:1");
await redis.del("queue:orders");

// Pemanggilan dengan 2 keys:
const result = await (redis as any).decrementStock(
  "product:stock:1",
  "product:users:1",
  1,
  "user1"
);
```

---

## Langkah 6: Tambahkan Script di `package.json`

Tambahkan baris berikut di dalam object `scripts` pada file `package.json`:

```json
"test:idempotency": "tsx src/test-idempotency.ts",
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
    "worker": "tsx src/worker.ts"
  },
```

---

## Verifikasi & Pengujian Lengkap

Ikuti langkah-langkah di bawah ini secara runtut untuk memvalidasi pengerjaan Anda.

### 1. Periksa Tipe TypeScript

Jalankan perintah pengecekan tipe:

```bash
npm run typecheck
```

**Output yang diharapkan:**
```text
> distributed-locking-engine@1.0.0 typecheck
> tsc --noEmit
```
*(Tidak ada pesan error. Jika selesai tanpa error, berarti tipe data TypeScript valid).*

---

### 2. Siapkan Data Produk di PostgreSQL

Jalankan seed database:

```bash
npm run db:seed
```

**Contoh output:**
```text
> distributed-locking-engine@1.0.0 db:seed
> tsx src/seed.ts

Seeding database...
Sample product inserted: [
  {
    id: 7,
    name: 'Flash Sale Item - Limited Edition',
    stock: 50,
    createdAt: 2026-09-03T04:11:21.388Z
  }
]
Database seed successfully!
```

> [!NOTE]
> Perhatikan nilai `id` yang tercetak (misalnya `id: 7`). Nilai ID ini adalah ID produk resmi di database Anda saat ini.

---

### 3. Jalankan Pengujian Otomatis Idempotensi

Nyalakan server Fastify terlebih dahulu di **Terminal 1**:

```bash
npm run start
```

**Output yang muncul di Terminal 1:**
```text
{"level":30,"time":1788408809842,"pid":12124,"hostname":"...","msg":"Redis connected and ready"}
{"level":30,"time":1788408810045,"pid":12124,"hostname":"...","msg":"Server listening at http://127.0.0.1:3000"}
```

Buka **Terminal 2**, lalu jalankan pengujian:

```bash
npm run test:idempotency
```

**Output lengkap yang akan muncul:**
```text
> distributed-locking-engine@1.0.0 test:idempotency
> tsx src/test-idempotency.ts

=== Phase 6: Idempotency & Duplicate User Prevention Test ===

1. Mengambil produk aktif dari PostgreSQL...
   Produk ditemukan: ID = 7, Nama = "Flash Sale Item - Limited Edition"

2. Menyiapkan state awal di Redis...
   Stok di-set ke: 10
   Key Set user 'product:users:7' dibersihkan
   Queue 'queue:orders' dibersihkan

3. Test: Pembelian pertama user_alpha...
   HTTP Status: 200
   Response: { success: true, remainingStock: 9, message: 'Checkout successful' }

4. Test: Percobaan pembelian KEDUA user_alpha (Idempotensi)...
   HTTP Status: 409 (Diharapkan: 409 Conflict)
   Response: { success: false, error: 'USER_ALREADY_PURCHASED' }
   --> SUKSES: Request kedua user_alpha berhasil ditolak!

5. Test: Pembelian pertama user_beta (User berbeda)...
   HTTP Status: 200
   Response: { success: true, remainingStock: 8, message: 'Checkout successful' }

6. Test: 5 Request paralel serentak dari user_gamma...
   Hasil dari 5 request serentak:
   - Sukses (200 OK): 1 (Diharapkan: 1)
   - Ditolak (409 USER_ALREADY_PURCHASED): 4 (Diharapkan: 4)
   --> SUKSES: Atomisitas Lua script mencegah race condition user ganda!

7. Verifikasi Data di Redis:
   Sisa Stok di Redis: 7 (Awal: 10, Terjual: 3, Sisa: 7)
   Daftar Pembeli di Redis Set (product:users:7): [ 'user_alpha', 'user_beta', 'user_gamma' ]
   Jumlah Order di queue:orders: 3

=== SEMUA PENGUJIAN FASE 6 BERHASIL DILALUI DENGAN SEMPURNA! ===
```

---

### 4. Pengujian Manual via cURL

Anda juga bisa melakukan pengujian manual menggunakan cURL. Ganti `7` dengan ID produk yang ada di database Anda jika berbeda.

#### 4.1 Inisialisasi Stok & Bersihkan Set di Redis
```bash
docker compose exec redis redis-cli SET product:stock:7 50
docker compose exec redis redis-cli DEL product:users:7
```
**Output:**
```text
OK
(integer) 1
```

#### 4.2 Request Pertama dari `user10` (Harus Berhasil)
```bash
curl -i -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user10\", \"productId\": 7}"
```
**Output:**
```text
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 64

{"success":true,"remainingStock":49,"message":"Checkout successful"}
```

#### 4.3 Request KEDUA dari `user10` dengan Produk yang Sama (Harus Ditolak!)
```bash
curl -i -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user10\", \"productId\": 7}"
```
**Output:**
```text
HTTP/1.1 409 Conflict
content-type: application/json; charset=utf-8
content-length: 49

{"success":false,"error":"USER_ALREADY_PURCHASED"}
```

#### 4.4 Periksa Isi Redis Set
```bash
docker compose exec redis redis-cli SMEMBERS product:users:7
```
**Output:**
```text
1) "user10"
```

---

### 5. Verifikasi Alur Worker ke PostgreSQL

Jalankan worker di terminal untuk memproses order:

```bash
npm run worker
```

**Output yang muncul:**
```text
[Worker] Waiting for Redis connection...
[Worker] Redis connected
[Worker] Redis ready, starting order processor...
[Worker] Worker started. Listening for orders...
[Worker] Inserted 1 order(s) to PostgreSQL
```

Periksa data di PostgreSQL:

```bash
docker compose exec postgres psql -U postgres -d flash_sale -c "SELECT id, user_id, product_id, status FROM orders;"
```

**Output:**
```text
 id | user_id | product_id |  status   
----+---------+------------+-----------
 27 | user10  |          7 | completed
(1 row)
```

Data masuk ke PostgreSQL dengan aman tanpa kendala foreign key constraint.

---

## Struktur File yang Relevan di Fase 6

```text
src/
├── lua/
│   └── decrement_stock.lua # Diperbarui: SISMEMBER, SADD, 2 KEYS (stockKey, usersKey)
├── plugins/
│   └── redis-lua.ts        # Diperbarui: numberOfKeys: 2 & tipe TypeScript
├── routes/
│   └── flash-sale.ts       # Diperbarui: userSetKey & penanganan error 409 USER_ALREADY_PURCHASED
├── test-idempotency.ts     # Baru: Skrip testing komprehensif & penanganan ID dinamis
├── test-checkout.ts        # Diperbarui: Mendukung 2 keys dan membersihkan Set
├── worker.ts               # Berjalan seperti biasa mengambil order dari queue
└── seed.ts                 # Menyediakan data produk awal
```

---

## Troubleshooting & FAQ

| Masalah | Penyebab | Solusi |
|---|---|---|
| Request pertama langsung `USER_ALREADY_PURCHASED` | Redis Set `product:users:<id>` masih menyimpan user dari pengujian sebelumnya. | Jalankan `docker compose exec redis redis-cli DEL product:users:<id>` sebelum menguji ulang. |
| Worker error: `violates foreign key constraint ... Key (product_id)=(...) is not present` | Produk di PostgreSQL memiliki ID berbeda karena auto-increment `generatedAlwaysAsIdentity()`. | Cek ID produk di PostgreSQL dengan `docker compose exec postgres psql -U postgres -d flash_sale -c "SELECT id FROM products;"` dan gunakan ID tersebut di Redis & request checkout. |
| `TypeError: errorMessage.include is not a function` | Typo di file `routes/flash-sale.ts` baris error handling (`include` alih-alih `includes`). | Ganti `errorMessage.include` menjadi `errorMessage.includes`. |
| Respons 500 `INTERNAL_SERVER_ERROR` | `numberOfKeys` di `redis-lua.ts` belum diubah menjadi `2`, atau parameter yang dikirim tidak sesuai. | Pastikan `numberOfKeys: 2` di `redis-lua.ts` dan fungsi menerima `(stockKey, userSetKey, productId, userId)`. |
| Error `PRODUCT_NOT_FOUND` | Key `product:stock:<id>` belum dibuat di Redis. | Buat key dengan `docker compose exec redis redis-cli SET product:stock:<id> 50`. |

---

## Ringkasan

Dengan menyelesaikan Fase 6:
- Sistem kini **idempoten per user**: seorang user tidak dapat memonopoli kuota flash sale atau membeli dua kali.
- Kecepatan validasi tetap di bawah **1 milidetik** berkat operasi Set $O(1)$ (`SISMEMBER` dan `SADD`) langsung di memori Redis.
- Tidak ada celah *race condition* karena seluruh logika verifikasi, pemotongan stok, dan pencatatan user dilakukan secara atomik di dalam satu **Skrip Lua**.
- Masalah perbedaan ID antara PostgreSQL dan Redis diatasi dengan verifikasi ID database dan pembersihan state Redis Set sebelum pengujian.

### Selanjutnya

Pada **Fase 7: Load Testing & Race Condition Verification (k6)**, kita akan menguji sistem ini dengan skenario beban ekstrem (2.000 Virtual Users serentak dalam 2 detik) untuk membuktikan secara empiris bahwa tidak ada kuota yang bocor, stok tidak pernah minus, dan tidak ada user yang berhasil checkout lebih dari 1 kali.
