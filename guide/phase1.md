# Fase 1: Setup Infrastruktur & Inisialisasi Project

## Tujuan

Membuat fondasi project TypeScript dengan Fastify, menjalankan container Redis dan PostgreSQL via Docker, serta memastikan server Fastify bisa terhubung ke Redis.

## Prasyarat

- Node.js >= 20 terinstall
- Docker & Docker Compose terinstall
- Terminal / Command Prompt

---

## Langkah 1: Inisialisasi Project

### 1.1 Inisialisasi npm

Buka terminal di root folder project (`D:\coding\archi\distributed-locking-engine`) dan jalankan:

```bash
npm init -y
```

**Output yang diharapkan:**

```json
{
  "name": "distributed-locking-engine",
  "version": "1.0.0",
  "type": "commonjs"
}
```

### 1.2 Install Dependencies

```bash
npm install fastify ioredis fastify-plugin
```

```bash
npm install -D typescript tsx @types/node
```

**Output yang diharapkan:**

```
added XX packages, and audited XX packages in Xs
found 0 vulnerabilities
```

---

## Langkah 2: Konfigurasi TypeScript

Buat file `tsconfig.json` di root project:

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

---

## Langkah 3: Update package.json

Update bagian `scripts` di `package.json`:

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

---

## Langkah 4: Buat Docker Compose

Buat file `docker-compose.yml` di root project:

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

---

## Langkah 5: Buat File Konfigurasi Environment

Buat file `.env` di root project:

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

---

## Langkah 6: Buat Struktur Source Code

### 6.1 Buat folder `src/plugins/`

```bash
mkdir src\plugins
```

### 6.2 Buat file `src/plugins/redis.ts`

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

### 6.3 Buat file `src/app.ts`

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

---

## Langkah 7: Buat .gitignore

Buat file `.gitignore` di root project:

```
node_modules/
dist/
.env
*.log
.DS_Store
```

---

## Langkah 8: Jalankan & Verifikasi

### 8.1 Jalankan Docker Container

```bash
npm run docker:up
```

**Output yang diharapkan:**

```
[+] Running 3/3
 ✔ Container distributed-locking-engine-redis-1    Healthy    0.0s
 ✔ Container distributed-locking-engine-postgres-1 Healthy    0.0s
```

### 8.2 Verifikasi Redis Berjalan

```bash
docker exec distributed-locking-engine-redis-1 redis-cli ping
```

**Output yang diharapkan:**

```
PONG
```

### 8.3 Verifikasi PostgreSQL Berjalan

```bash
docker exec distributed-locking-engine-postgres-1 pg_isready -U postgres
```

**Output yang diharapkan:**

```
localhost:5432 - accepting connections
```

### 8.4 Jalankan Server Fastify

```bash
npm run dev
```

**Output yang diharapkan:**

```
[INFO] Redis connecting...
[INFO] Redis connected and ready
[INFO] Server listening at http://0.0.0.0:3000
```

### 8.5 Test Health Endpoint

Buka browser atau gunakan curl:

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

### 8.6 Hentikan Server

Tekan `Ctrl + C` di terminal untuk menghentikan server.

---

## Struktur File Akhir

```
distributed-locking-engine/
├── .env
├── .gitignore
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── project.md
├── src/
│   ├── app.ts
│   └── plugins/
│       └── redis.ts
└── guide/
    └── phase1.md
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `npm` tidak dikenal | Gunakan `cmd /c "npm ..."` di PowerShell |
| Docker tidak dikenal | Pastikan Docker Desktop terinstall dan running |
| Redis connection timeout | Pastikan container Redis sudah running: `docker compose ps` |
| Port 6379 sudah digunakan |Ubah port di `.env` dan `docker-compose.yml` |
| TypeScript error | Jalankan `npm run typecheck` untuk melihat error detail |

---

## Selanjutnya

Setelah Fase 1 selesai, lanjut ke **Fase 2: Schema Database & Seeding (ORM)** untuk membuat tabel `products` dan `orders` di PostgreSQL.
