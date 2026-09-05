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

  console.log(
    "=== Phase 6: Idempotency & Duplicate User Prevention Test ===\n",
  );

  try {
    console.log("1. Mengambil produk aktif dari PostgreSQL...");
    const existingProducts = await db.select().from(products).limit(1);

    if (existingProducts.length === 0) {
      throw new Error(
        "Tidak ada produk di database PostgreSQL! Jalankan 'npm run db:seed' terlebih dahulu",
      );
    }

    const testProduct = existingProducts[0];
    const productId = testProduct.id;
    console.log(
      `Produk ditemukan: ID = ${productId}, Nama = "${testProduct.name}"\n`,
    );

    const stockKey = `product:stock:${productId}`;
    const usersKey = `product:users:${productId}`;

    console.log("2. Menyiapkan state awal di Redis...");
    await redis.set(stockKey, 10);
    await redis.del(usersKey);
    await redis.del("queue:orders");
    console.log(`Stok di-set ke:10`);
    console.log(`Key set user '${usersKey}' dibersihkan`);
    console.log(`Queue 'queue:orders' dibersihkan\n`);

    console.log("3. Test: Pembelian pertama user alpha...");
    const res1 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_alpha", productId }),
    });
    const data1 = (await res1.json()) as any;
    console.log(`HTTP Status: ${res1.status}`);
    console.log(`Response:`, data1);
    if (res1.status !== 200 || !data1.success) {
      throw new Error("Gagal pada pembelian pertama user_alpha!");
    }

    console.log(
      "\n4. Test: Percobaan pembelian KEDUA user_alpha (idempotensi)...",
    );
    const res2 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_alpha", productId }),
    });
    const data2 = (await res2.json()) as any;
    console.log(`HTTP Status: ${res2.status} (Diharapkan: 409 Conflict)`);
    console.log(`Response:`, data2);
    if (res2.status !== 409 || data2.error !== "USER_ALREADY_PURCHASED") {
      throw new Error(
        `Idempotensi gagal! User berhasil beli 2x atau error tidak sesuai. Status: ${res2.status}, Error: ${data2.error}`,
      );
    }
    console.log("--> SUKSES: Request kedua user_alpha berhasil ditolak!");

    console.log("\n5. Test: Pembelian pertama user_beta (User berbeda)...");
    const res3 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user_beta", productId }),
    });
    const data3 = (await res3.json()) as any;
    console.log(`HTTP Status: ${res3.status}`);
    console.log(`Response:`, data3);
    if (res3.status !== 200 || !data3.success) {
      throw new Error("Gagal pada pembelian user_beta");
    }

    console.log("\nRequest paralel serentak dari user_gamma...");
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

    console.log("Hasil dari 5 request serentak:");
    console.log(`- Sukses (200 ok): ${successCount} (Diharapkan: 1)`);
    console.log(
      `- Ditolak (409 USER_ALREADY_PURCHASED): ${rejectedCount} (Diharapkan: 4)`,
    );

    if (successCount !== 1 || rejectedCount !== 4) {
      throw new Error(
        `Race condition gagal dicegah! Sukses: ${successCount}, Ditolak: ${rejectedCount}`,
      );
    }
    console.log(
      "--> SUKSES: Atomisitas Lua script mencegah race condition user ganda!",
    );
  } catch (error) {}
}
