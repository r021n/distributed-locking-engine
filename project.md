### Flash Sale Distributed Locking Engine

Sistem backend mikro untuk menangani ribuan pembelian bersamaan dalam 1 detik tanpa memicu *overselling* atau *race condition*.

* **Teknologi Utama:** TypeScript, Fastify/Express, Redis (Docker), PostgreSQL, Prisma/Drizzle ORM.
* **Fitur & Komponen yang Harus Ada:**
* Endpoint checkout cepat dengan validasi kuota instan.
* Implementasi *atomic decrement* atau *distributed lock* menggunakan Redis (via skrip Lua atau library Redlock).
* Worker asinkron untuk mencatat transaksi sukses dari Redis ke PostgreSQL secara persisten.
* Load test script (menggunakan `k6` atau `autocannon`) untuk membuktikan stok 0 tidak pernah tembus minus saat diserbu request paralel.


---

**Fase 1: Setup Infrastruktur & Inisialisasi Project**

* **Yang dikerjakan:**
* Inisialisasi repositori TypeScript (Fastify disarankan karena throughput tinggi).
* Buat file `docker-compose.yml` untuk menjalankan container **Redis** dan **PostgreSQL**.
* Konfigurasi koneksi dasar ke Redis (menggunakan library `ioredis`) dan verifikasi ping koneksi.


* **Yang harus ada setelah selesai:**
* Container Redis dan PostgreSQL aktif dan berjalan via Docker.
* Server Fastify berjalan di `localhost` dan sukses terhubung ke instance Redis.



---

**Fase 2: Schema Database & Seeding (ORM)**

* **Yang dikerjakan:**
* Setup Prisma atau Drizzle ORM.
* Buat schema database: tabel `products` (id, nama, stock) dan `orders` (id, user_id, product_id, status, created_at).
* Jalankan migrasi dan buat script *seed* untuk memasukkan 1 produk sample dengan kuota tertentu (misal: 50 item).


* **Yang harus ada setelah selesai:**
* Tabel `products` dan `orders` terbuat di PostgreSQL.
* Terdapat minimal 1 record produk flash sale di database.



---

**Fase 3: Core Lua Script & Atomic Decrement di Redis**

* **Yang dikerjakan:**
* Tulis skrip Lua untuk mengeksekusi operasi secara atomik:
1. Cek kuota stok produk di Redis key (`product:stock:<id>`).
2. Jika stok > 0, kurangi stok sebesar 1 (`DECRBY`) dan masukkan event transaksi ke Redis Stream atau Redis List (`queue:orders`).
3. Jika stok $\le 0$, kembalikan kode error / sold out.


* Daftarkan dan uji pemanggilan skrip Lua tersebut via `ioredis`.


* **Yang harus ada setelah selesai:**
* File skrip Lua yang modular dan fungsi pemanggilnya di TypeScript.
* Uji coba manual via command line: stok di Redis berkurang atomik dan transaksi masuk ke antrean Redis.



---

**Fase 4: Endpoint Fast Sale Checkout API**

* **Yang dikerjakan:**
* Buat endpoint `POST /api/flash-sale/checkout` dengan validasi schema payload (`userId`, `productId`).
* Integrasikan endpoint tersebut langsung ke skrip Lua Redis (tanpa menyentuh PostgreSQL saat request berlangsung).
* Kembalikan respons instan: `200 OK` (berhasil klaim kuota) atau `409 Conflict / 400 Bad Request` (stok habis).


* **Yang harus ada setelah selesai:**
* Route API siap menerima traffic HTTP.
* Respons latency ultra-rendah (<10ms per request) saat dites melalui cURL / Postman.



---

**Fase 5: Asynchronous Worker (Redis Queue ke PostgreSQL)**

* **Yang dikerjakan:**
* Buat proses *background worker* terpisah (bisa menggunakan consumer Redis Stream atau `BRPOP` Redis List).
* Worker membaca event order yang berhasil dari antrean Redis secara berkelanjutan.
* Simpan data transaksi secara persisten ke tabel `orders` di PostgreSQL menggunakan batch insert ORM.


* **Yang harus ada setelah selesai:**
* File worker yang bisa dijalankan di terminal terpisah.
* Setiap ada order sukses di Redis, data otomatis tercatat ke PostgreSQL dalam hitungan milidetik secara asinkron.



---

**Fase 6: Idempotensi & Validasi User Ganda (Locking Rules)**

* **Yang dikerjakan:**
* Update skrip Lua / logic Redis untuk mencegah 1 user membeli barang yang sama lebih dari sekali.
* Manfaatkan Redis Set (`SADD`) untuk mencatat user yang sudah pernah checkout; tolak transaksi jika `userId` sudah terdaftar di set produk tersebut.


* **Yang harus ada setelah selesai:**
* Skrip Lua menolak request kedua dari `userId` yang sama meskipun stok masih tersedia.



---

**Fase 7: Load Testing & Race Condition Verification (k6)**

* **Yang dikerjakan:**
* Tulis skrip skenario pengujian beban menggunakan **k6** atau **autocannon**.
* Konfigurasi skenario: 2.000 virtual users (VUs) menyerbu endpoint checkout secara serentak dalam 2 detik untuk produk dengan stok 50.
* Jalankan load test dan verifikasi konsistensi data.


* **Yang harus ada setelah selesai:**
* Laporan eksekusi k6 yang membuktikan:
* Tepat **50 request berstatus 200 OK** dan sisanya gagal/sold out.
* Stok akhir di Redis tepat **0** (tidak pernah minus).
* Total baris transaksi di tabel `orders` PostgreSQL tepat **50**.