# Fase 2: Schema Database & Seeding (ORM)

## Tujuan

Di fase ini, kita akan membuat fondasi database untuk menyimpan data produk dan pesanan. Kita akan menggunakan **Drizzle ORM** sebagai Object-Relational Mapping (ORM) yang membantu kita berinteraksi dengan database menggunakan TypeScript tanpa perlu menulis SQL mentah secara langsung.

Yang akan kita capai:
1. Setup Drizzle ORM untuk koneksi ke PostgreSQL
2. Membuat schema database: tabel `products` (untuk produk flash sale) dan `orders` (untuk pesanan)
3. Menjalankan migrasi untuk membuat tabel di database
4. Membuat script seed untuk memasukkan data sampel produk

---

## Prasyarat

Pastikan Anda sudah menyelesaikan **Fase 1** dan memiliki:
- PostgreSQL berjalan di Docker
- Project TypeScript dengan Fastify
- File `.env` dengan konfigurasi database

---

## Langkah 1: Install Dependencies

Pertama, kita perlu menginstall dependencies yang dibutuhkan untuk Drizzle ORM.

Buka terminal di root project (`D:\coding\archi\distributed-locking-engine`) dan jalankan:

```bash
npm install drizzle-orm pg dotenv
```

Kemudian install development dependencies:

```bash
npm install -D drizzle-kit @types/pg
```

**Penjelasan:**
- `drizzle-orm`: ORM untuk berinteraksi dengan database
- `pg`: PostgreSQL client untuk Node.js
- `dotenv`: Untuk membaca file `.env`
- `drizzle-kit`: Tool untuk migrasi database
- `@types/pg`: Type definitions untuk PostgreSQL

**Output yang diharapkan:**
```
added XX packages, and audited XX packages in Xs
found 0 vulnerabilities
```

---

## Langkah 2: Update Environment Variables

Buka file `.env` dan tambahkan `DATABASE_URL`:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=flash_sale
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/flash_sale
SERVER_PORT=3000
```

**Penjelasan:**
- `DATABASE_URL`: URL koneksi ke PostgreSQL dalam format `postgresql://username:password@host:port/database`

---

## Langkah 3: Buat Drizzle Config

Buat file `drizzle.config.ts` di root project dengan isi berikut:

```typescript
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Penjelasan:**
- `out`: Folder tempat file migrasi disimpan
- `schema`: Path ke file schema database
- `dialect`: Jenis database yang digunakan (postgresql)
- `dbCredentials`: Kredensial koneksi database

---

## Langkah 4: Buat Database Schema

Buat folder `src/db/` dan buat file `src/db/schema.ts` dengan isi berikut:

```typescript
import { integer, pgTable, varchar, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  stock: integer().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  status: varchar({ length: 50 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Penjelasan:**
- `products`: Tabel untuk menyimpan data produk flash sale
  - `id`: Primary key otomatis
  - `name`: Nama produk (string, wajib diisi)
  - `stock`: Jumlah stok produk (integer, wajib diisi)
  - `createdAt`: Waktu pembuatan record (otomatis terisi)
- `orders`: Tabel untuk menyimpan data pesanan
  - `id`: Primary key otomatis
  - `userId`: ID pengguna yang melakukan pesanan
  - `productId`: Foreign key ke tabel products
  - `status`: Status pesanan (default: "pending")
  - `createdAt`: Waktu pembuatan record

---

## Langkah 5: Buat Database Connection

Buat file `src/db/index.ts` dengan isi berikut:

```typescript
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export const db = drizzle(process.env.DATABASE_URL!, { schema });
```

**Penjelasan:**
- File ini membuat koneksi ke database menggunakan Drizzle ORM
- `db` akan digunakan di seluruh aplikasi untuk berinteraksi dengan database

---

## Langkah 6: Update package.json

Buka file `package.json` dan tambahkan scripts berikut ke bagian `"scripts"`:

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
    "db:seed": "tsx src/seed.ts"
  }
}
```

**Penjelasan:**
- `db:push`: Push schema ke database tanpa membuat file migrasi
- `db:generate`: Generate file migrasi SQL
- `db:migrate`: Jalankan migrasi ke database
- `db:studio`: Buka Drizzle Studio (GUI untuk melihat database)
- `db:seed`: Jalankan script seed untuk memasukkan data sampel

---

## Langkah 7: Push Schema ke Database

Pastikan Docker container PostgreSQL sudah berjalan, kemudian jalankan:

```bash
npm run db:push
```

**Output yang diharapkan:**
```
> drizzle-kit push

No config path provided, using default 'drizzle.config.ts'
Reading config file 'D:\coding\archi\distributed-locking-engine\drizzle.config.ts'
Using 'pg' driver for database querying
[⣷] Pulling schema from database...
[✓] Pulling schema from database...
[✓] Changes applied
```

---

## Langkah 8: Buat Script Seed

Buat file `src/seed.ts` dengan isi berikut:

```typescript
import "dotenv/config";
import { db } from "./db";
import { products, orders } from "./db/schema";

async function seed() {
  console.log("Seeding database...");

  // Clear existing data
  await db.delete(orders);
  await db.delete(products);

  // Insert sample flash sale product
  const sampleProduct = await db
    .insert(products)
    .values({
      name: "Flash Sale Item - Limited Edition",
      stock: 50,
    })
    .returning();

  console.log("Sample product inserted:", sampleProduct);

  console.log("Database seeded successfully!");
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });
```

**Penjelasan:**
- Script ini akan menghapus semua data yang ada (orders dan products)
- Kemudian memasukkan 1 produk flash sale dengan stok 50 item
- Berguna untuk testing dan development

---

## Langkah 9: Jalankan Script Seed

```bash
npm run db:seed
```

**Output yang diharapkan:**
```
> tsx src/seed.ts

Seeding database...
Sample product inserted: [
  {
    id: 1,
    name: 'Flash Sale Item - Limited Edition',
    stock: 50,
    createdAt: 2026-08-30T04:04:22.561Z
  }
]
Database seeded successfully!
```

---

## Langkah 10: Verifikasi Database

### 10.1 Cek Tabel yang Dibuat

```bash
docker exec distributed-locking-engine-postgres-1 psql -U postgres -d flash_sale -c "\dt"
```

**Output yang diharapkan:**
```
          List of relations
 Schema |   Name   | Type  |  Owner   
--------+----------+-------+----------
 public | orders   | table | postgres
 public | products | table | postgres
(2 rows)
```

### 10.2 Cek Data Produk

```bash
docker exec distributed-locking-engine-postgres-1 psql -U postgres -d flash_sale -c "SELECT * FROM products;"
```

**Output yang diharapkan:**
```
 id |               name                | stock |         created_at         
----+-----------------------------------+-------+----------------------------
  1 | Flash Sale Item - Limited Edition |    50 | 2026-08-30 04:04:22.561868
(1 row)
```

---

## Struktur File Akhir

Setelah semua langkah selesai, struktur folder project akan seperti berikut:

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
│   ├── db/                 # Folder untuk database
│   │   ├── index.ts        # Koneksi database
│   │   └── schema.ts       # Schema database
│   └── plugins/            # Folder untuk plugin
│       └── redis.ts        # Plugin untuk koneksi Redis
├── drizzle/                # Folder untuk migrasi (otomatis dibuat)
└── guide/                  # Folder panduan
    ├── phase1.md           # Panduan fase 1
    └── phase2.md           # Panduan fase 2
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `DATABASE_URL` not found | Pastikan file `.env` sudah benar dan ada baris `DATABASE_URL` |
| PostgreSQL connection refused | Pastikan container PostgreSQL sudah running dengan `npm run docker:up` |
| Table already exists | Jalankan `npm run db:push` untuk sync schema |
| Seed gagal | Pastikan database sudah ada dan schema sudah di-push |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat error detail |

---

## Ringkasan Perintah

Berikut adalah perintah-perintah penting di fase ini:

```bash
# Install dependencies
npm install drizzle-orm pg dotenv
npm install -D drizzle-kit @types/pg

# Jalankan Docker container
npm run docker:up

# Push schema ke database
npm run db:push

# Seed database
npm run db:seed

# Type checking
npm run typecheck

# Lihat logs Docker
npm run docker:logs
```

---

## Selanjutnya

Selamat! Anda sudah berhasil menyelesaikan Fase 2. Sekarang Anda memiliki:
- Schema database untuk tabel `products` dan `orders`
- Script seed untuk memasukkan data sampel
- Koneksi database yang siap digunakan

Di **Fase 3: Core Lua Script & Atomic Decrement di Redis**, kita akan:
1. Menulis skrip Lua untuk operasi atomik di Redis
2. Mengintegrasikan skrip Lua dengan aplikasi
3. Menguji operasi decrement stok secara atomik

Lanjut ke Fase 3 untuk melanjutkan pengembangan aplikasi kita.
