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
    const userKey = `product:users:${productId}`;
  } catch (error) {}
}
