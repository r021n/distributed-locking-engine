# Fase 5: Worker Asinkron dari Redis ke PostgreSQL

## Gambaran Umum

Pada fase sebelumnya, endpoint checkout melakukan dua hal penting di Redis:

1. Mengurangi stok secara atomik.
2. Menambahkan data order ke Redis List bernama `queue:orders`.

Namun, data di Redis belum otomatis tersimpan ke PostgreSQL. Pada fase ini kita membuat **worker**: program kecil yang berjalan terus-menerus di proses dan terminal terpisah. Worker mengambil order dari Redis, lalu memasukkannya ke tabel `orders` di PostgreSQL.

Alur lengkapnya adalah:

```text
Client
  |
  v
Fastify -- mengurangi stok dan LPUSH order --> Redis List (queue:orders)
                                                     |
                                                     | BRPOP/RPOP
                                                     v
                                                  Worker
                                                     |
                                                     | INSERT batch
                                                     v
                                                PostgreSQL
```

### Mengapa menggunakan worker terpisah?

Endpoint checkout harus menjawab permintaan pengguna secepat mungkin. Endpoint cukup menyelesaikan pekerjaan cepat di Redis dan tidak perlu menunggu koneksi atau operasi tulis PostgreSQL. Pekerjaan menyimpan riwayat order dilakukan setelahnya oleh worker.

Konsekuensinya, penyimpanan order ke PostgreSQL bersifat **asinkron**: respons checkout dapat diterima lebih dahulu, sedangkan data order masuk ke PostgreSQL beberapa saat kemudian. Redis menjadi antrean sementara di antara server API dan worker.

## Tujuan

Setelah menyelesaikan fase ini, Anda akan memahami cara:

- membaca Redis List tanpa membuang CPU ketika antrean kosong;
- mengambil beberapa order dan menyimpannya sekaligus (**batch processing**);
- menjalankan program worker sebagai proses terpisah dari server Fastify;
- menghentikan worker tanpa memutus koneksi secara mendadak.

## Prasyarat

Pastikan Fase 1 sampai Fase 4 sudah selesai dan hal-hal berikut tersedia:

- Redis dan PostgreSQL berjalan di Docker;
- tabel `orders` sudah dibuat melalui Drizzle;
- skrip Lua untuk mengurangi stok sudah aktif;
- endpoint `POST /api/flash-sale/checkout` dapat digunakan;
- project memiliki `DATABASE_URL`, `REDIS_HOST`, dan `REDIS_PORT` di file `.env`.

Worker yang dibuat di sini mengimpor `db` dari `src/db/index.ts`. File tersebut membaca `DATABASE_URL` saat worker dimulai.

---

## Konsep Dasar Sebelum Menulis Kode

### Redis List sebagai antrean

Redis List adalah kumpulan nilai yang memiliki urutan. Dalam project ini, key `queue:orders` digunakan sebagai antrean order.

Skrip Lua pada fase sebelumnya menjalankan:

```lua
redis.call('LPUSH', 'queue:orders', order_data)
```

`LPUSH` menambahkan nilai dari sisi kiri list. Worker mengambil order dari sisi kanan menggunakan `BRPOP`. Kombinasi ini menghasilkan pola **FIFO** (*first in, first out*): order yang masuk lebih dahulu diproses lebih dahulu.

Contoh jika order masuk berurutan `A`, lalu `B`:

```text
Setelah LPUSH A: [A]
Setelah LPUSH B: [B, A]
BRPOP mengambil A terlebih dahulu
```

### `BRPOP` dan `RPOP`

- `BRPOP` berarti *blocking right pop*. Redis menunggu sampai ada nilai di sisi kanan, atau sampai timeout habis.
- `RPOP` berarti *right pop*. Redis langsung mengembalikan nilai jika tersedia; jika list kosong, hasilnya `null`.

Perbedaan ini penting. `BRPOP` dipakai untuk menunggu order pertama tanpa loop cepat yang terus-menerus bertanya kepada Redis. Setelah satu order ditemukan, `RPOP` dipakai untuk mengambil order lain yang sudah tersedia tanpa menunggu.

Perintah berikut menunggu maksimal 0,1 detik:

```text
BRPOP queue:orders 0.1
```

Angka timeout Redis menggunakan satuan detik, bukan milidetik. Jadi `0.1` sama dengan 100 milidetik. Setelah timeout habis dan tidak ada order, Redis mengembalikan `null`; worker lalu mencoba lagi.

### Batch processing

Daripada melakukan satu operasi `INSERT` untuk setiap order, worker mengumpulkan maksimal 10 order dalam array lalu melakukan satu `INSERT`:

```text
BRPOP -> order 1
RPOP  -> order 2, order 3, ...
INSERT semua order yang terkumpul -> PostgreSQL
```

Cara ini mengurangi jumlah perjalanan antara aplikasi dan database (*round-trip*) serta overhead query. `BATCH_SIZE` adalah batas maksimum order dalam satu batch, bukan jumlah order yang harus ditunggu. Jika baru ada 2 order, worker tetap menyimpan 2 order tersebut.

---

## Langkah 1: Membuat File Worker

Buat file `src/worker.ts`. Kode berikut sengaja diberi komentar pada bagian yang biasanya membingungkan pemula.

```typescript
import "dotenv/config";
import Redis from "ioredis";
import { db } from "./db";
import { orders } from "./db/schema";

// Nilai dari .env dipakai jika tersedia. Nilai setelah || adalah nilai default.
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 100;

// Bentuk JSON yang dibuat oleh skrip Lua pada fase sebelumnya.
interface OrderData {
  product_id: string;
  user_id: string;
  timestamp: string;
}

// Worker memiliki koneksi Redis sendiri. Koneksi ini tidak memakai instance
// Redis milik Fastify karena worker adalah proses yang berbeda.
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times: number) {
    // Jika Redis belum tersedia, coba lagi dengan jeda yang meningkat,
    // tetapi tidak lebih dari 3 detik.
    return Math.min(times * 200, 3000);
  },
  // BRPOP boleh menunggu selama koneksi sedang dipulihkan.
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => {
  console.error("[Worker] Redis connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[Worker] Redis connected");
});

redis.on("ready", () => {
  console.log("[Worker] Redis ready, starting order processor...");
});

async function processOrders(): Promise<void> {
  // Tipe ini diambil dari schema Drizzle. Dengan begitu, TypeScript dapat
  // memeriksa bahwa isi batch sesuai kolom tabel orders.
  const batch: typeof orders.$inferInsert[] = [];

  try {
    // ioredis mengembalikan [namaKey, nilai] atau null saat timeout.
    // Redis mengharapkan timeout dalam detik, sehingga 100 ms dibagi 1000.
    const result = await redis.brpop(
      "queue:orders",
      POLL_INTERVAL_MS / 1000,
    );

    if (result) {
      const [key, value] = result;
      const orderData: OrderData = JSON.parse(value);

      batch.push({
        userId: orderData.user_id,
        productId: parseInt(orderData.product_id, 10),
        status: "completed",
      });

      // Ambil order lain yang sudah ada sampai antrean kosong atau batch penuh.
      let drained = false;
      while (!drained && batch.length < BATCH_SIZE) {
        const nextResult = await redis.rpop("queue:orders");

        if (nextResult) {
          const nextOrder: OrderData = JSON.parse(nextResult);
          batch.push({
            userId: nextOrder.user_id,
            productId: parseInt(nextOrder.product_id, 10),
            status: "completed",
          });
        } else {
          drained = true;
        }
      }
    }

    // Saat BRPOP timeout, batch kosong dan database tidak dipanggil.
    if (batch.length > 0) {
      await db.insert(orders).values(batch);
      console.log(`[Worker] Inserted ${batch.length} order(s) to PostgreSQL`);
    }
  } catch (error: any) {
    // Error koneksi saat proses dihentikan dapat terjadi secara normal.
    if (error.message !== "Connection is closed.") {
      console.error("[Worker] Error processing orders:", error.message);
    }
  }
}

async function startWorker(): Promise<void> {
  console.log("[Worker] Waiting for Redis connection...");

  // Jangan masuk ke loop sebelum Redis benar-benar siap.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Redis connection timed out after 10 seconds"));
    }, 10000);

    redis.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    redis.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  console.log("[Worker] Worker started. Listening for orders...");

  // Setelah satu batch selesai, worker kembali menunggu order berikutnya.
  while (true) {
    await processOrders();
  }
}

async function gracefulShutdown(): Promise<void> {
  console.log("\n[Worker] Shutting down gracefully...");
  // quit menutup koneksi setelah command yang sedang berjalan selesai.
  await redis.quit();
  process.exit(0);
}

// SIGINT dikirim oleh Ctrl+C. SIGTERM umum dikirim oleh Docker atau process manager.
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

startWorker().catch((err) => {
  console.error("[Worker] Failed to start worker:", err);
  process.exit(1);
});
```

### Membaca fungsi `processOrders`

Urutan kerja fungsi tersebut adalah:

1. Membuat `batch` kosong untuk satu putaran pemrosesan.
2. Menunggu satu order dengan `BRPOP`.
3. Mengubah string JSON menjadi object menggunakan `JSON.parse`.
4. Mengubah nama properti dari format Redis (`product_id`) ke format schema Drizzle (`productId`).
5. Mengambil order tambahan dengan `RPOP` sampai antrean kosong atau batch berisi 10 order.
6. Menyimpan seluruh batch dengan `db.insert(orders).values(batch)`.
7. Kembali menunggu order berikutnya.

Variabel `key` berisi string `queue:orders`, yaitu nama list yang dikembalikan Redis. Variabel itu tidak perlu dipakai lebih lanjut; yang dibutuhkan worker adalah `value`, yaitu JSON order.

Status diset ke `"completed"` karena pada desain fase ini order sudah berhasil melewati checkout dan sudah masuk antrean. Ini bukan status pembayaran atau pengiriman.

### Hal yang perlu dipahami tentang keandalan

Pada implementasi sederhana ini, order dihapus dari Redis saat `BRPOP` atau `RPOP` berhasil. Jika worker mati setelah order dihapus tetapi sebelum `INSERT` berhasil, order tersebut dapat hilang. Untuk sistem produksi, biasanya digunakan pola yang lebih kuat, misalnya Redis Streams dengan consumer group, atau antrean dengan mekanisme acknowledgment dan retry.

Fase ini sengaja menggunakan Redis List agar konsep worker dan batch mudah dipelajari terlebih dahulu.

---

## Langkah 2: Menambahkan Script ke `package.json`

Tambahkan script berikut di object `scripts` yang sudah ada. Jangan mengganti seluruh `package.json`; cukup tambahkan baris ini setelah script test yang ada:

```json
"worker": "tsx src/worker.ts"
```

`worker` menjalankan file worker dengan `tsx`, sehingga TypeScript dapat dijalankan langsung. Kita tidak menambahkan `test:worker` karena `src/test-worker.ts` belum dibuat pada fase ini. Script untuk file yang belum ada akan membuat proses belajar membingungkan ketika dijalankan.

Contoh bagian `scripts` setelah penambahan:

```json
"scripts": {
  "dev": "tsx watch src/app.ts",
  "start": "tsx src/app.ts",
  "typecheck": "tsc --noEmit",
  "docker:up": "docker compose up -d",
  "docker:down": "docker compose down",
  "docker:logs": "docker compose logs -f",
  "db:push": "drizzle-kit push",
  "db:seed": "tsx src/seed.ts",
  "test:checkout": "tsx src/test-checkout.ts",
  "test:flash-sale": "tsx src/test-flash-sale.ts",
  "worker": "tsx src/worker.ts"
}
```

---

## Langkah 3: Menjalankan dan Memverifikasi

Karena server, worker, dan perintah test berjalan bersamaan, gunakan tiga terminal. Jalankan semua perintah dari root project.

### 3.1 Menyalakan Docker

```bash
npm run docker:up
```

Pastikan service Redis dan PostgreSQL berstatus sehat. Nama container dapat berbeda antarversi Docker Compose, jadi gunakan `docker compose ps` jika nama container pada contoh berbeda.

### 3.2 Memeriksa TypeScript

```bash
npm run typecheck
```

Tidak ada output biasanya berarti pemeriksaan tipe berhasil. Jika ada error, perbaiki sebelum melanjutkan.

### 3.3 Membuat Data Awal Database

```bash
npm run db:seed
```

Perintah ini membuat data produk contoh. Pastikan juga schema database sudah diterapkan sesuai instruksi Fase 2.

### 3.4 Mengisi Stok di Redis

```bash
docker compose exec redis redis-cli SET product:stock:1 50
```

Output yang diharapkan:

```text
OK
```

Perintah ini berarti produk dengan ID `1` memiliki 50 unit stok di Redis. Nama service `redis` berasal dari `docker-compose.yml`; ini lebih aman daripada menebak nama container lengkap.

### 3.5 Menjalankan Worker di Terminal 1

```bash
npm run worker
```

Output awal yang diharapkan:

```text
[Worker] Waiting for Redis connection...
[Worker] Redis connected
[Worker] Redis ready, starting order processor...
[Worker] Worker started. Listening for orders...
```

Biarkan terminal ini terbuka. Worker sedang menunggu data pada `queue:orders`; kondisi menunggu itu normal, bukan error.

### 3.6 Menjalankan Server di Terminal 2

```bash
npm run dev
```

Pastikan server mendengarkan pada port 3000, misalnya:

```text
[INFO] Server listening at http://0.0.0.0:3000
```

### 3.7 Mengirim Checkout di Terminal 3

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user1\", \"productId\": 1}"
```

Respons yang diharapkan:

```json
{"success":true,"remainingStock":49,"message":"Checkout successful"}
```

Pada titik ini endpoint sudah mengurangi stok dan menambahkan order ke Redis. Endpoint belum tentu sudah menulis ke PostgreSQL; itulah tugas worker.

### 3.8 Mengamati Worker

Lihat kembali Terminal 1. Setelah order diproses, akan muncul:

```text
[Worker] Inserted 1 order(s) to PostgreSQL
```

Jika pesan belum muncul, tunggu sebentar. `BRPOP` menggunakan timeout 100 milidetik, sehingga worker akan mencoba kembali secara berkala.

### 3.9 Memeriksa PostgreSQL

```bash
docker compose exec postgres psql -U postgres -d flash_sale -c "SELECT * FROM orders;"
```

Anda akan melihat satu baris dengan `user_id` `user1`, `product_id` `1`, dan status `completed`. Nilai `id` serta `created_at` dibuat oleh PostgreSQL berdasarkan schema.

### 3.10 Menguji Batch Processing

Kirim beberapa checkout dari Terminal 3:

```bash
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user2\", \"productId\": 1}"
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user3\", \"productId\": 1}"
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user4\", \"productId\": 1}"
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user5\", \"productId\": 1}"
curl -X POST http://localhost:3000/api/flash-sale/checkout -H "Content-Type: application/json" -d "{\"userId\": \"user6\", \"productId\": 1}"
```

Worker dapat menampilkan `Inserted 5 order(s)`, atau beberapa pesan dengan jumlah lebih kecil. Keduanya benar: batching bergantung pada apakah order-order tersebut sudah tersedia bersamaan ketika worker mengambilnya.

Jumlah seluruh order dapat diperiksa dengan:

```bash
docker compose exec postgres psql -U postgres -d flash_sale -c "SELECT COUNT(*) FROM orders;"
```

Jika order pertama juga masih ada, hasil yang diharapkan adalah `6`.

### 3.11 Menghentikan Program

1. Tekan `Ctrl+C` di Terminal 1 untuk mengirim `SIGINT` ke worker.
2. Tekan `Ctrl+C` di Terminal 2 untuk menghentikan server.
3. Jika ingin menghentikan Redis dan PostgreSQL, jalankan:

```bash
npm run docker:down
```

Worker akan menjalankan `gracefulShutdown`, menutup koneksi Redis dengan `quit()`, lalu keluar.

---

## Struktur File yang Relevan

```text
src/
├── worker.ts              # Proses pengambil antrean dan penyimpan order
├── app.ts                 # Server Fastify
├── db/
│   ├── index.ts           # Koneksi Drizzle ke PostgreSQL
│   └── schema.ts          # Definisi tabel products dan orders
├── lua/
│   └── decrement_stock.lua # Mengurangi stok dan LPUSH order
└── routes/
    └── flash-sale.ts      # Endpoint checkout
```

Hubungan antarfile:

- `flash-sale.ts` memanggil command Redis yang menjalankan skrip Lua.
- `decrement_stock.lua` mengurangi stok dan memasukkan JSON order ke `queue:orders`.
- `worker.ts` mengambil JSON tersebut, mengubahnya menjadi format kolom tabel, lalu memanggil Drizzle.
- `schema.ts` memberi tahu Drizzle bahwa `userId` dipetakan ke kolom database `user_id` dan `productId` ke `product_id`.

---

## Troubleshooting

| Masalah | Pemeriksaan dan solusi |
|---|---|
| `Redis connection error` | Jalankan `npm run docker:up`, lalu periksa `docker compose ps`. |
| Worker terus menampilkan pesan menunggu | Ini normal jika `queue:orders` kosong. Kirim checkout untuk mengujinya. |
| Worker tidak memproses order | Periksa antrean dengan `docker compose exec redis redis-cli LLEN queue:orders`. Jika hasilnya 0, endpoint mungkin belum berhasil menambahkan order. |
| Data tidak masuk PostgreSQL | Periksa `DATABASE_URL`, schema database, dan error di Terminal 1. Pastikan PostgreSQL sehat. |
| `ECONNREFUSED` | Redis atau PostgreSQL belum berjalan, atau host/port di `.env` tidak sesuai. |
| `Connection is closed` saat Ctrl+C | Ini normal saat worker dihentikan. Jika muncul terus ketika worker berjalan, mulai ulang worker dan periksa koneksi Redis. |
| `SyntaxError` dari `JSON.parse` | Nilai di queue bukan JSON order yang dibuat skrip Lua. Kosongkan data uji yang rusak setelah memastikan tidak ada order penting. |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat file dan baris yang bermasalah. |

Untuk melihat isi antrean tanpa mengambil data:

```bash
docker compose exec redis redis-cli LRANGE queue:orders 0 -1
```

Untuk melihat jumlah data di antrean:

```bash
docker compose exec redis redis-cli LLEN queue:orders
```

---

## Ringkasan

Pada fase ini:

- Fastify memasukkan event checkout ke Redis List dengan `LPUSH`.
- Worker menunggu order menggunakan `BRPOP` tanpa polling yang boros CPU.
- Worker memakai `RPOP` untuk menguras order tambahan yang sudah tersedia.
- Beberapa order disimpan sekaligus melalui satu operasi Drizzle ke PostgreSQL.
- `SIGINT` dan `SIGTERM` ditangani agar koneksi Redis ditutup dengan benar.

### Selanjutnya

Pada **Fase 6: Idempotensi dan Validasi User Ganda**, kita akan mencegah satu user membeli produk yang sama lebih dari sekali. Kita akan menggunakan Redis Set untuk mencatat user yang sudah checkout.
