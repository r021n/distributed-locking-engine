# Fase 1: Setup Infrastruktur & Inisialisasi Project

## Tujuan

Di fase ini, kita akan membuat fondasi dasar untuk project kita. Fondasi ini terdiri dari:

1. **Project TypeScript**: Project yang menggunakan bahasa pemrograman TypeScript (JavaScript dengan fitur tambahan untuk membantu menulis kode yang lebih rapi dan aman).
2. **Fastify**: Sebuah framework untuk membuat server web yang cepat dan sederhana.
3. **Redis**: Sebuah database cepat yang menyimpan data di memori (RAM), cocok untuk menyimpan data sementara atau cache.
4. **PostgreSQL**: Sebuah database yang menyimpan data secara permanen di disk.
5. **Docker**: Sebuah tool yang memungkinkan kita menjalankan aplikasi dalam "container" (seperti kotak terisolasi) agar mudah dipindahkan dan dijalankan di mana saja.

Dengan fondasi ini, kita bisa mulai membangun aplikasi kita.

## Prasyarat

Sebelum memulai, pastikan Anda sudah menginstall tool-tool berikut di komputer Anda:

1. **Node.js** (versi 20 atau lebih tinggi): Ini adalah environment untuk menjalankan kode JavaScript di luar browser. Untuk memeriksa apakah sudah terinstall, buka terminal dan jalankan:
   ```bash
   node --version
   ```
   Jika muncul versi (misal `v20.10.0`), berarti sudah terinstall. Jika belum, download dari https://nodejs.org.

2. **Docker & Docker Compose**: Docker memungkinkan kita menjalankan aplikasi dalam container. Docker Compose adalah tool untuk menjalankan beberapa container sekaligus. Untuk memeriksa, jalankan:
   ```bash
   docker --version
   docker compose version
   ```
   Jika muncul versi, berarti sudah terinstall. Jika belum, download Docker Desktop dari https://www.docker.com/products/docker-desktop.

3. **Terminal / Command Prompt**: Ini adalah aplikasi untuk menjalankan perintah teks. Di Windows, Anda bisa menggunakan Command Prompt (cmd) atau PowerShell. Di macOS/Linux, gunakan Terminal.

---

## Langkah 1: Inisialisasi Project

### 1.1 Inisialisasi npm

npm adalah tool yang disertakan dengan Node.js untuk mengelola package (library atau toolkit) yang digunakan dalam project. Untuk memulai project baru, kita perlu membuat file `package.json` yang berisi informasi tentang project.

Buka terminal di root folder project (`D:\coding\archi\distributed-locking-engine`) dan jalankan perintah berikut untuk membuat file `package.json` secara otomatis:

```bash
npm init -y
```

Perintah `-y` berarti "ya" untuk semua pertanyaan default, sehingga prosesnya cepat.

**Output yang diharapkan:**

```json
{
  "name": "distributed-locking-engine",
  "version": "1.0.0",
  "type": "commonjs"
}
```

Ini menunjukkan bahwa `package.json` berhasil dibuat dengan nama project "distributed-locking-engine".

### 1.2 Install Dependencies

Dependencies adalah package tambahan yang dibutuhkan project kita. Kita perlu menginstall beberapa dependencies:

1. **fastify**: Framework untuk membuat server web.
2. **ioredis**: Package untuk menghubungkan Node.js dengan Redis.
3. **fastify-plugin**: Tool untuk membuat plugin yang bisa digunakan di beberapa project Fastify.

Jalankan perintah berikut untuk menginstall dependencies tersebut:

```bash
npm install fastify ioredis fastify-plugin
```

Selain itu, kita juga butuh dependencies untuk pengembangan (development dependencies), yaitu:

1. **typescript**: Bahasa pemrograman yang kita gunakan (kita akan menulis kode dalam TypeScript).
2. **tsx**: Tool untuk menjalankan file TypeScript secara langsung tanpa perlu dikompilasi ke JavaScript terlebih dahulu.
3. **@types/node**: Type definitions untuk Node.js (membantu TypeScript memahami fitur-fitur Node.js).

Jalankan perintah berikut untuk menginstall development dependencies:

```bash
npm install -D typescript tsx @types/node
```

Perintah `-D` menandakan bahwa package ini hanya digunakan untuk pengembangan, bukan untuk production (lingkungan aplikasi yang digunakan oleh pengguna akhir).

**Output yang diharapkan:**

```
added XX packages, and audited XX packages in Xs
found 0 vulnerabilities
```

Ini menunjukkan bahwa semua package berhasil diinstall tanpa masalah keamanan.

---

## Langkah 2: Konfigurasi TypeScript

TypeScript adalah bahasa pemrograman yang dikembangkan di atas JavaScript dengan fitur tambahan seperti tipe data yang ketat. Agar TypeScript bisa bekerja dengan baik, kita perlu membuat file konfigurasi bernama `tsconfig.json`.

File `tsconfig.json` berisi pengaturan untuk TypeScript compiler (program yang mengubah kode TypeScript menjadi kode JavaScript yang bisa dijalankan oleh Node.js).

Buat file `tsconfig.json` di root project dengan isi berikut:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Penjelasan singkat tentang konfigurasi di atas:
- `target`: Versi JavaScript yang dihasilkan (ES2022 adalah versi terbaru).
- `module`: Sistem modul yang digunakan (NodeNext adalah untuk Node.js modern).
- `outDir`: Folder tempat file JavaScript hasil kompilasi disimpan (folder `dist`).
- `rootDir`: Folder tempat file TypeScript sumber disimpan (folder `src`).
- `strict`: Mengaktifkan fitur ketat TypeScript untuk menangkap error lebih awal.
- `include`: Pattern untuk file TypeScript yang akan dikompilasi (semua file di folder `src`).
- `exclude`: Folder yang tidak akan dikompilasi (node_modules dan dist).

---

## Langkah 3: Update package.json

File `package.json` memiliki bagian bernama `scripts` yang berisi perintah-perintah yang bisa dijalankan dengan mudah. Kita akan menambahkan beberapa perintah untuk membantu pengembangan.

Buka file `package.json` dan update bagian `scripts` menjadi seperti berikut:

```json
{
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "start": "tsx src/app.ts",
    "typecheck": "tsc --noEmit",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f"
  }
}
```

Penjelasan tentang setiap perintah:
- `dev`: Menjalankan aplikasi dalam mode development dengan fitur watch (otomatis restart saat file berubah).
- `start`: Menjalankan aplikasi tanpa fitur watch (untuk production).
- `typecheck`: Memeriksa apakah kode TypeScript kita memiliki error tanpa menghasilkan file output.
- `docker:up`: Menjalankan container Redis dan PostgreSQL menggunakan Docker Compose.
- `docker:down`: Menghentikan container yang sedang berjalan.
- `docker:logs`: Menampilkan log dari container yang sedang berjalan.

---

## Langkah 4: Buat Docker Compose

Docker Compose adalah tool untuk menjalankan beberapa container sekaligus dengan konfigurasi yang sudah ditentukan. Kita akan menggunakannya untuk menjalankan Redis dan PostgreSQL.

Buat file `docker-compose.yml` di root project dengan isi berikut:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: flash_sale
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

volumes:
  redis-data:
  postgres-data:
```

Penjelasan tentang konfigurasi di atas:
- `services`: Bagian yang mendefinisikan layanan (container) yang akan dijalankan.
  - `redis`: Container untuk Redis dengan image `redis:7-alpine` (versi Redis 7 yang ringan).
    - `ports`: Memetakan port 6379 dari container ke port 6379 di host (komputer kita). Port adalah "pintu masuk" komunikasi jaringan.
    - `volumes`: Menyimpan data Redis secara permanen agar tidak hilang saat container dihentikan.
    - `healthcheck`: Memeriksa apakah Redis berjalan dengan baik.
  - `postgres`: Container untuk PostgreSQL dengan image `postgres:16-alpine`.
    - `ports`: Memetakan port 5432 dari container ke port 5432 di host.
    - `environment`: Mengatur environment variables untuk PostgreSQL (user, password, nama database).
    - `volumes`: Menyimpan data PostgreSQL secara permanen.
    - `healthcheck`: Memeriksa apakah PostgreSQL berjalan dengan baik.
- `volumes`: Mendefinisikan named volumes untuk menyimpan data secara permanen.

---

## Langkah 5: Buat File Konfigurasi Environment

Environment variables adalah nilai-nilai yang digunakan untuk mengkonfigurasi aplikasi tanpa perlu mengubah kode sumber. Kita menyimpannya di file `.env` agar mudah diubah dan tidak perlu hardcode di kode.

Buat file `.env` di root project dengan isi berikut:

```
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=flash_sale
SERVER_PORT=3000
```

Penjelasan tentang setiap environment variable:
- `REDIS_HOST`: Alamat IP atau hostname Redis server. `127.0.0.1` berarti localhost (alamat IP untuk merujuk ke komputer kita sendiri).
- `REDIS_PORT`: Port tempat Redis server mendengarkan. Default Redis adalah 6379.
- `POSTGRES_HOST`: Alamat IP atau hostname PostgreSQL server.
- `POSTGRES_PORT`: Port tempat PostgreSQL server mendengarkan. Default PostgreSQL adalah 5432.
- `POSTGRES_USER`: Username untuk login ke PostgreSQL.
- `POSTGRES_PASSWORD`: Password untuk login ke PostgreSQL.
- `POSTGRES_DB`: Nama database yang akan digunakan.
- `SERVER_PORT`: Port tempat server Fastify akan berjalan.

---

## Langkah 6: Buat Struktur Source Code

Sekarang kita akan membuat folder dan file yang diperlukan untuk source code aplikasi kita.

### 6.1 Buat folder `src/plugins/`

Folder `src` akan berisi semua kode sumber aplikasi kita. Folder `plugins` di dalamnya akan berisi plugin-plugin yang bisa digunakan kembali.

Jalankan perintah berikut di terminal untuk membuat folder:

```bash
mkdir src\plugins
```

### 6.2 Buat file `src/plugins/redis.ts`

File ini berisi kode untuk menghubungkan aplikasi kita dengan Redis server. Kita akan membuat function `redisConnector` yang melakukan koneksi ke Redis dan menyimpannya agar bisa digunakan di seluruh aplikasi.

Buat file `src/plugins/redis.ts` dengan isi berikut:

```typescript
import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

async function redisConnector(fastify: FastifyInstance) {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  redis.on("error", (err) => {
    fastify.log.error(err, "Redis connection error");
  });

  redis.on("connect", () => {
    fastify.log.info("Redis connecting...");
  });

  redis.on("ready", () => {
    fastify.log.info("Redis connected and ready");
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Redis connection timed out after 5 seconds"));
    }, 5000);

    redis.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    redis.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    fastify.log.info("Closing Redis connection...");
    await redis.quit();
  });
}

export default fastifyPlugin(redisConnector);
```

Penjelasan tentang kode di atas:
- Kita mengimport library yang diperlukan: `FastifyInstance` untuk tipe data, `fastifyPlugin` untuk membuat plugin, dan `Redis` dari `ioredis` untuk koneksi Redis.
- Kita mengambil nilai `REDIS_HOST` dan `REDIS_PORT` dari environment variables (file `.env`).
- Function `redisConnector` menerima parameter `fastify` (instance Fastify) dan melakukan:
  - Membuat koneksi Redis baru dengan host, port, dan strategi retry (jika koneksi gagal, coba lagi dengan delay yang meningkat).
  - Menambahkan event listener untuk error, connect, dan ready. Event listener adalah kode yang akan dijalankan saat sesuatu terjadi (misal: saat koneksi berhasil atau gagal).
  - Menunggu koneksi siap dengan timeout 5 detik. Timeout adalah batas waktu maksimal untuk menunggu sesuatu.
  - Menambahkan Redis ke instance Fastify menggunakan `decorate` agar bisa diakses di seluruh aplikasi.
  - Menambahkan hook `onClose` untuk menutup koneksi Redis saat aplikasi berhenti. Hook adalah kode yang akan dijalankan saat event tertentu terjadi (misal: saat aplikasi berhenti).

### 6.3 Buat file `src/app.ts`

File ini adalah file utama aplikasi kita. Di sini kita akan membuat server Fastify dan menghubungkannya dengan Redis.

Buat file `src/app.ts` dengan isi berikut:

```typescript
import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis.js";

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

fastify.get("/health", async (_request, reply) => {
  const redisPing = await fastify.redis.ping();
  return {
    status: "ok",
    redis: redisPing === "PONG" ? "connected" : "disconnected",
  };
});

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

Penjelasan tentang kode di atas:
- Kita mengimport Fastify, Redis, dan plugin `redisConnector` yang sudah dibuat sebelumnya.
- `declare module "fastify"`: Menambahkan type `redis` ke instance Fastify agar TypeScript mengenali properti `redis`.
- Membuat instance Fastify dengan logger yang mengatur level log ke "info".
- `fastify.register(redisConnector)`: Meregistrasi plugin Redis ke Fastify.
- Membuat route `/health` yang memeriksa koneksi Redis dengan cara mengirim ping. Route adalah alamat URL yang bisa diakses oleh client (browser atau aplikasi lain). Endpoint adalah istilah lain untuk route.
- Function `start` untuk menjalankan server pada port yang ditentukan di environment variable `SERVER_PORT` (default 3000).
- Server mendengarkan di semua interface (`0.0.0.0`) agar bisa diakses dari luar. Interface adalah titik sambungan jaringan (misal: WiFi atau Ethernet).

---

## Langkah 7: Buat .gitignore

`.gitignore` adalah file yang memberitahu Git (sistem kontrol versi yang digunakan untuk melacak perubahan pada kode) untuk mengabaikan file atau folder tertentu. Ini penting agar file-file yang tidak perlu di-track (seperti folder `node_modules` yang berisi ribuan file) tidak masuk ke repository Git (tempat penyimpanan kode secara online).

Buat file `.gitignore` di root project dengan isi berikut:

```
node_modules/
dist/
.env
*.log
.DS_Store
```

Penjelasan tentang setiap baris:
- `node_modules/`: Folder yang berisi semua package yang diinstall oleh npm. Jangan di-track karena bisa dibuat ulang dengan `npm install`.
- `dist/`: Folder output dari kompilasi TypeScript. Jangan di-track karena bisa dibuat ulang dengan perintah kompilasi.
- `.env`: File environment variables yang berisi konfigurasi sensitif (password, API keys). Jangan di-track agar tidak bocor ke publik.
- `*.log`: Semua file dengan ekstensi `.log` (file log). Biasanya berisi informasi debugging yang tidak perlu di-track.
- `.DS_Store`: File yang dibuat secara otomatis oleh macOS untuk menyimpan pengaturan folder. Tidak perlu di-track.

---

## Langkah 8: Jalankan & Verifikasi

Sekarang kita akan menjalankan semua komponen yang sudah dibuat dan memastikan semuanya berjalan dengan baik.

### 8.1 Jalankan Docker Container

Pertama, kita jalankan container Redis dan PostgreSQL menggunakan Docker Compose. Jalankan perintah berikut di terminal:

```bash
npm run docker:up
```

Perintah ini akan menjalankan `docker compose up -d` yang akan:
- Mengunduh image Redis dan PostgreSQL jika belum ada di komputer.
- Membuat dan menjalankan container untuk Redis dan PostgreSQL.
- Menjalankan dalam mode detached (`-d`), artinya container berjalan di background (di belakang layar, tidak menempel di terminal).

**Output yang diharapkan:**

```
[+] Running 3/3
 ✔ Container distributed-locking-engine-redis-1    Healthy    0.0s
 ✔ Container distributed-locking-engine-postgres-1 Healthy    0.0s
```

### 8.2 Verifikasi Redis Berjalan

Untuk memastikan Redis berjalan dengan baik, kita bisa mengirim perintah ping ke Redis. Jalankan:

```bash
docker exec distributed-locking-engine-redis-1 redis-cli ping
```

Perintah ini akan:
- `docker exec`: Menjalankan perintah di dalam container yang sudah berjalan.
- `distributed-locking-engine-redis-1`: Nama container Redis.
- `redis-cli ping`: Perintah untuk mengirim ping ke Redis.

**Output yang diharapkan:**

```
PONG
```

Jika muncul `PONG`, berarti Redis berjalan dengan baik.

### 8.3 Verifikasi PostgreSQL Berjalan

Untuk memastikan PostgreSQL berjalan dengan baik, jalankan:

```bash
docker exec distributed-locking-engine-postgres-1 pg_isready -U postgres
```

Perintah ini akan:
- `docker exec`: Menjalankan perintah di dalam container yang sudah berjalan.
- `distributed-locking-engine-postgres-1`: Nama container PostgreSQL.
- `pg_isready -U postgres`: Perintah untuk memeriksa apakah PostgreSQL siap menerima koneksi.

**Output yang diharapkan:**

```
localhost:5432 - accepting connections
```

### 8.4 Jalankan Server Fastify

Sekarang kita jalankan server Fastify kita. Jalankan perintah berikut di terminal baru (biarkan terminal sebelumnya tetap berjalan untuk menjalankan Docker):

```bash
npm run dev
```

Perintah ini akan menjalankan `tsx watch src/app.ts` yang akan:
- Menjalankan file `src/app.ts` menggunakan tsx.
- Mengaktifkan fitur watch, sehingga server akan otomatis restart saat file berubah.

**Output yang diharapkan:**

```
[INFO] Redis connecting...
[INFO] Redis connected and ready
[INFO] Server listening at http://0.0.0.0:3000
```

### 8.5 Test Health Endpoint

Server Fastify kita sudah berjalan dan terhubung ke Redis. Sekarang kita uji endpoint `/health` yang sudah dibuat. Endpoint adalah alamat URL khusus yang bisa diakses oleh client (browser atau aplikasi lain) untuk berinteraksi dengan server.

Buka browser (client) dan akses `http://localhost:3000/health`, atau gunakan curl di terminal:

```bash
curl http://localhost:3000/health
```

**Output yang diharapkan:**

```json
{
  "status": "ok",
  "redis": "connected"
}
```

Ini menunjukkan bahwa server berjalan dengan baik dan Redis terhubung.

### 8.6 Hentikan Server

Untuk menghentikan server Fastify, tekan `Ctrl + C` di terminal tempat server berjalan.

Untuk menghentikan container Docker, jalankan:

```bash
npm run docker:down
```

---

## Struktur File Akhir

Setelah semua langkah selesai, struktur folder project kita akan seperti berikut:

```
distributed-locking-engine/
├── .env                    # File environment variables (konfigurasi)
├── .gitignore              # File untuk mengabaikan file tertentu di Git
├── docker-compose.yml      # Konfigurasi Docker untuk Redis dan PostgreSQL
├── package.json            # Informasi project dan dependencies
├── tsconfig.json           # Konfigurasi TypeScript
├── project.md              # Deskripsi project (opsional)
├── src/                    # Folder source code
│   ├── app.ts              # File utama aplikasi
│   └── plugins/            # Folder untuk plugin
│       └── redis.ts        # Plugin untuk koneksi Redis
└── guide/                  # Folder panduan
    └── phase1.md           # Panduan fase ini
```

---

## Troubleshooting

Jika Anda mengalami masalah, berikut beberapa solusi umum:

| Masalah | Solusi |
|---------|--------|
| `npm` tidak dikenal di PowerShell | Gunakan `cmd /c "npm ..."` di PowerShell atau buka Command Prompt (cmd) langsung |
| Docker tidak dikenal | Pastikan Docker Desktop terinstall dan sudah running (lihat icon Docker di system tray) |
| Redis connection timeout | Pastikan container Redis sudah running dengan perintah `docker compose ps` |
| Port 6379 sudah digunakan | Ubah port di `.env` dan `docker-compose.yml` (misal ke 6380) |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat error detail |
| Server tidak bisa diakses | Pastikan firewall tidak memblokir port 3000, atau coba port lain |

---

## Selanjutnya

Selamat! Anda sudah berhasil menyelesaikan Fase 1. Sekarang Anda memiliki:
- Project TypeScript dengan Fastify
- Redis dan PostgreSQL yang berjalan di Docker
- Koneksi antara Fastify dan Redis

Di **Fase 2: Schema Database & Seeding (ORM)**, kita akan:
1. Membuat tabel `products` dan `orders` di PostgreSQL.
2. Menggunakan ORM (Object-Relational Mapping) untuk memudahkan interaksi dengan database.
3. Menambahkan data sampel ke database untuk pengujian.

Lanjut ke Fase 2 untuk melanjutkan pengembangan aplikasi kita.
