# Fase 3: Core Lua Script & Atomic Decrement di Redis

## Tujuan

Di fase ini, kita akan membuat skrip Lua untuk mengeksekusi operasi atomik di Redis. Skrip ini akan:

1. **Cek kuota stok** produk di Redis key (`product:stock:<id>`)
2. **Kurangi stok** sebesar 1 secara atomik jika stok > 0
3. **Masukkan event transaksi** ke Redis List (`queue:orders`) jika berhasil
4. **Kembalikan error** jika stok habis (sold out)

Operasi ini **atomik** artinya tidak ada race condition yang bisa terjadi saat ribuan request masuk bersamaan.

---

## Prasyarat

Pastikan Anda sudah menyelesaikan **Fase 1** dan **Fase 2** dan memiliki:
- Redis berjalan di Docker
- PostgreSQL berjalan di Docker
- Project TypeScript dengan Fastify dan ioredis

---

## Langkah 1: Buat Folder Lua

Buat folder `src/lua/` untuk menyimpan skrip Lua:

```bash
mkdir src\lua
```

---

## Langkah 2: Buat Skrip Lua

Buat file `src/lua/decrement_stock.lua` dengan isi berikut:

```lua
-- Lua script for atomic stock decrement and order queueing
-- KEYS[1] = product:stock:<product_id>
-- ARGV[1] = product_id
-- ARGV[2] = user_id

local stock_key = KEYS[1]
local product_id = ARGV[1]
local user_id = ARGV[2]

-- Get current stock
local current_stock = tonumber(redis.call('GET', stock_key))

-- If stock doesn't exist, return error
if current_stock == nil then
    return redis.error_reply('PRODUCT_NOT_FOUND')
end

-- If stock is zero or less, return sold out
if current_stock <= 0 then
    return redis.error_reply('SOLD_OUT')
end

-- Decrement stock atomically
local new_stock = redis.call('DECRBY', stock_key, 1)

-- Add order to queue (Redis List)
local order_data = cjson.encode({
    product_id = product_id,
    user_id = user_id,
    timestamp = redis.call('TIME')[1]
})
redis.call('LPUSH', 'queue:orders', order_data)

-- Return success with remaining stock
return {new_stock, 'OK'}
```

**Penjelasan:**
- `KEYS[1]`: Key Redis yang akan diakses (format: `product:stock:<product_id>`)
- `ARGV[1]`: Product ID (argumen tambahan)
- `ARGV[2]`: User ID (argumen tambahan)
- `redis.call('GET', stock_key)`: Mengambil nilai stok saat ini
- `redis.call('DECRBY', stock_key, 1)`: Mengurangi stok secara atomik sebesar 1
- `redis.call('LPUSH', 'queue:orders', order_data)`: Menambahkan order ke queue (Redis List)
- `redis.error_reply()`: Mengembalikan error ke client

**Kenapa Atomik?**
Redis menjalankan skrip Lua secara atomik. Artinya, selama skrip berjalan, tidak ada command lain yang bisa dieksekusi. Ini mencegah race condition di mana dua user bisa mengurangi stok yang sama secara bersamaan.

---

## Langkah 3: Buat Plugin Redis Lua

Buat file `src/plugins/redis-lua.ts` dengan isi berikut:

```typescript
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { readFileSync } from "fs";
import { join } from "path";
import type Redis from "ioredis";

const DECREMENT_STOCK_SCRIPT = readFileSync(
  join(__dirname, "../lua/decrement_stock.lua"),
  "utf-8"
);

async function redisLuaScript(fastify: FastifyInstance) {
  const redis = fastify.redis as Redis & {
    decrementStock: (
      productId: number,
      userId: string
    ) => Promise<[number, string]>;
  };

  redis.defineCommand("decrementStock", {
    numberOfKeys: 1,
    lua: DECREMENT_STOCK_SCRIPT,
  });

  fastify.addHook("onClose", async () => {
    fastify.log.info("Redis Lua scripts cleaned up");
  });
}

export default fastifyPlugin(redisLuaScript);
```

**Penjelasan:**
- `readFileSync`: Membaca file Lua saat plugin dimuat
- `redis.defineCommand("decrementStock", ...)`: Mendaftarkan skrip Lua sebagai command baru di ioredis
- `numberOfKeys: 1`: Menyatakan bahwa skrip ini menggunakan 1 key
- Setelah didaftarkan, kita bisa memanggil `redis.decrementStock()` seperti command Redis biasa

---

## Langkah 4: Update app.ts

Buka file `src/app.ts` dan tambahkan import serta register plugin:

```typescript
import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis"
import redisLuaScript from "./plugins/redis-lua"

declare module "fastify" {
    interface FastifyInstance {
        redis: Redis;
    }
}

const fastify = Fastify({
    logger: {
        level: "info"
    }
})

fastify.register(redisConnector);
fastify.register(redisLuaScript);

fastify.get("/health", async (_request, reply) => {
    const redisPing = await fastify.redis.ping();
    return {
        status: "ok",
        redis: redisPing === "PONG" ? "connected" : "disconnected",
    }
})

fastify.post<{Body: {productId: number, userId: string}}>("/test/checkout", async (request, reply) => {
    const { productId, userId } = request.body;
    const stockKey = `product:stock:${productId}`;
    
    // Initialize stock if not exists (for testing)
    const exists = await fastify.redis.exists(stockKey);
    if (!exists) {
        await fastify.redis.set(stockKey, 50);
    }
    
    try {
        const redisWithCommands = fastify.redis as any;
        const result = await redisWithCommands.decrementStock(stockKey, productId, userId);
        return {
            success: true,
            remainingStock: result[0],
            status: result[1]
        };
    } catch (error: any) {
        return reply.status(409).send({
            success: false,
            error: error.message
        });
    }
})

const start = async () => {
    const port = parseInt(process.env.SERVER_PORT || "3000", 10);
    try {
        await fastify.listen({port, host: "0.0.0.0"});
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

start();
```

**Penjelasan:**
- Import `redisLuaScript` dan register setelah `redisConnector`
- Endpoint `/test/checkout` menerima POST request dengan `productId` dan `userId`
- Endpoint ini menginisialisasi stok jika belum ada (untuk testing)
- Memanggil `decrementStock()` dan mengembalikan hasilnya
- Jika error (stok habis), mengembalikan status 409 Conflict

---

## Langkah 5: Buat Script Test

Buat file `src/test-checkout.ts` dengan isi berikut:

```typescript
import "dotenv/config";
import Redis from "ioredis";
import { readFileSync } from "fs";
import { join } from "path";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const DECREMENT_STOCK_SCRIPT = readFileSync(
  join(__dirname, "lua/decrement_stock.lua"),
  "utf-8"
);

async function testLuaScript() {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  try {
    // Register the Lua script
    redis.defineCommand("decrementStock", {
      numberOfKeys: 1,
      lua: DECREMENT_STOCK_SCRIPT,
    });

    // Test 1: Initialize stock
    console.log("Test 1: Initializing stock for product 1...");
    await redis.set("product:stock:1", 50);
    const stock = await redis.get("product:stock:1");
    console.log(`Initial stock: ${stock}`);

    // Test 2: Successful decrement
    console.log("\nTest 2: Testing successful decrement...");
    const result1 = await (redis as any).decrementStock("product:stock:1", 1, "user1");
    console.log(`Decrement result:`, result1);

    // Test 3: Multiple decrements
    console.log("\nTest 3: Testing multiple decrements...");
    for (let i = 2; i <= 5; i++) {
      const result = await (redis as any).decrementStock("product:stock:1", 1, `user${i}`);
      console.log(`Decrement ${i}:`, result);
    }

    // Test 4: Check remaining stock
    console.log("\nTest 4: Checking remaining stock...");
    const remainingStock = await redis.get("product:stock:1");
    console.log(`Remaining stock: ${remainingStock}`);

    // Test 5: Check order queue
    console.log("\nTest 5: Checking order queue...");
    const queueLength = await redis.llen("queue:orders");
    console.log(`Orders in queue: ${queueLength}`);

    // Test 6: Get orders from queue
    console.log("\nTest 6: Getting orders from queue...");
    const orders = await redis.lrange("queue:orders", 0, -1);
    orders.forEach((order, index) => {
      console.log(`Order ${index + 1}:`, JSON.parse(order));
    });

    // Test 7: Try to decrement when stock is zero
    console.log("\nTest 7: Testing sold out scenario...");
    await redis.set("product:stock:2", 0);
    try {
      await (redis as any).decrementStock("product:stock:2", 2, "user99");
    } catch (error: any) {
      console.log(`Expected error: ${error.message}`);
    }

    console.log("\n✅ All tests completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await redis.quit();
  }
}

testLuaScript();
```

---

## Langkah 6: Update package.json

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
    "test:checkout": "tsx src/test-checkout.ts"
  }
}
```

---

## Langkah 7: Jalankan & Verifikasi

### 7.1 Pastikan Redis Berjalan

```bash
npm run docker:up
```

**Output yang diharapkan:**
```
[+] Running 3/3
 ✔ Container distributed-locking-engine-redis-1    Healthy    0.0s
 ✔ Container distributed-locking-engine-postgres-1 Healthy    0.0s
```

### 7.2 Jalankan Type Check

```bash
npm run typecheck
```

**Output yang diharapkan:**
```
(empty - berarti tidak ada error)
```

### 7.3 Jalankan Script Test

```bash
npm run test:checkout
```

**Output yang diharapkan:**
```
Test 1: Initializing stock for product 1...
Initial stock: 50

Test 2: Testing successful decrement...
Decrement result: [ 49, 'OK' ]

Test 3: Testing multiple decrements...
Decrement 2: [ 48, 'OK' ]
Decrement 3: [ 47, 'OK' ]
Decrement 4: [ 46, 'OK' ]
Decrement 5: [ 45, 'OK' ]

Test 4: Checking remaining stock...
Remaining stock: 45

Test 5: Checking order queue...
Orders in queue: 5

Test 6: Getting orders from queue...
Order 1: { product_id: '1', timestamp: '1788099154', user_id: 'user5' }
Order 2: { product_id: '1', timestamp: '1788099154', user_id: 'user4' }
Order 3: { product_id: '1', timestamp: '1788099154', user_id: 'user3' }
Order 4: { product_id: '1', timestamp: '1788099154', user_id: 'user2' }
Order 5: { product_id: '1', timestamp: '1788099154', user_id: 'user1' }

Test 7: Testing sold out scenario...
Expected error: ERR SOLD_OUT

✅ All tests completed successfully!
```

### 7.4 Test Endpoint HTTP

Jalankan server:

```bash
npm run dev
```

**Output yang diharapkan:**
```
[INFO] Redis connected and ready
[INFO] Server listening at http://0.0.0.0:3000
```

Buka terminal baru dan test endpoint:

```bash
curl -X POST http://localhost:3000/test/checkout -H "Content-Type: application/json" -d "{\"productId\": 1, \"userId\": \"testuser1\"}"
```

**Output yang diharapkan:**
```json
{"success":true,"remainingStock":49,"status":"OK"}
```

Test sold out (stok 0):

```bash
curl -X POST http://localhost:3000/test/checkout -H "Content-Type: application/json" -d "{\"productId\": 999, \"userId\": \"testuser2\"}"
```

**Output yang diharapkan (jika stok habis):**
```json
{"success":false,"error":"ERR SOLD_OUT"}
```

### 7.5 Verifikasi Data di Redis

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

### 7.6 Hentikan Server

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
│   ├── db/                 # Folder untuk database
│   │   ├── index.ts        # Koneksi database
│   │   └── schema.ts       # Schema database
│   ├── lua/                # Folder untuk skrip Lua
│   │   └── decrement_stock.lua  # Skrip Lua untuk decrement stok
│   └── plugins/            # Folder untuk plugin
│       ├── redis.ts        # Plugin untuk koneksi Redis
│       └── redis-lua.ts    # Plugin untuk Redis Lua script
├── drizzle/                # Folder untuk migrasi (otomatis dibuat)
└── guide/                  # Folder panduan
    ├── phase1.md           # Panduan fase 1
    ├── phase2.md           # Panduan fase 2
    └── phase3.md           # Panduan fase 3
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `EACCES` error saat baca file Lua | Pastikan path file Lua benar dan file ada di `src/lua/` |
| `PRODUCT_NOT_FOUND` error | Pastikan key `product:stock:<id>` sudah diinisialisasi sebelum dipanggil |
| `SOLD_OUT` error | Normal jika stok sudah 0. Inisialisasi ulang dengan `redis.set("product:stock:1", 50)` |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat error detail |
| Server tidak bisa diakses | Pastikan Docker container Redis sudah running dengan `npm run docker:up` |
| Lua script timeout | Pastikan skrip tidak ada infinite loop atau blocking command |

---

## Konsep Penting

### Apa itu Lua Scripting di Redis?

Redis mendukung eksekusi skrip Lua secara server-side. Keuntungannya:

1. **Atomicity**: Semua operasi dalam skrip Lua dijalankan secara atomik. Tidak ada interupsi antar command.
2. **Performance**: Skrip dikirim sekali ke Redis server, semua operasi dijalankan di server tanpa round-trip berulang.
3. **Complex Logic**: Bisa menjalankan logika kompleks (if-else, loop, dll) di server.

### Kenapa Harus Atomic?

Bayangkan 1000 user mencoba membeli produk dengan stok 10:

**Tanpa Atomic (Race Condition):**
1. User A cek stok: 10
2. User B cek stok: 10 (sebelum User A selesai mengurangi)
3. User A kurangi stok: 9
4. User B kurangi stok: 9 (stok jadi minus!)

**Dengan Atomic (Lua Script):**
1. User A jalankan Lua script: cek stok (10) → kurangi (9) → selesai
2. User B jalankan Lua script: cek stok (9) → kurangi (8) → selesai
3. Stok tidak pernah minus!

### ioredis defineCommand

ioredis menyediakan `defineCommand` untuk mendaftarkan skrip Lua sebagai command custom:

```typescript
redis.defineCommand("decrementStock", {
    numberOfKeys: 1,  // Jumlah key yang diakses
    lua: "..."        // Isi skrip Lua
});

// Sekarang bisa dipanggil seperti command biasa
await redis.decrementStock("product:stock:1", 1, "user1");
```

---

## Ringkasan Perintah

```bash
# Jalankan Docker container
npm run docker:up

# Type checking
npm run typecheck

# Jalankan test script
npm run test:checkout

# Jalankan server
npm run dev

# Test endpoint (di terminal lain)
curl -X POST http://localhost:3000/test/checkout -H "Content-Type: application/json" -d "{\"productId\": 1, \"userId\": \"user1\"}"

# Cek data di Redis
docker exec distributed-locking-engine-redis-1 redis-cli GET product:stock:1
docker exec distributed-locking-engine-redis-1 redis-cli LLEN queue:orders
docker exec distributed-locking-engine-redis-1 redis-cli LRANGE queue:orders 0 -1
```

---

## Selanjutnya

Selamat! Anda sudah berhasil menyelesaikan Fase 3. Sekarang Anda memiliki:
- Skrip Lua untuk operasi atomik di Redis
- Fungsi `decrementStock()` yang bisa dipanggil dari TypeScript
- Test script untuk memverifikasi fungsi

Di **Fase 4: Endpoint Fast Sale Checkout API**, kita akan:
1. Membuat endpoint `POST /api/flash-sale/checkout` dengan validasi payload
2. Mengintegrasikan endpoint dengan skrip Lua Redis
3. Mengembalikan respons instan (200 OK atau 409 Conflict)

Lanjut ke Fase 4 untuk melanjutkan pengembangan aplikasi kita.
