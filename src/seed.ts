import "dotenv/config";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "./db";
import { products } from "./db/schema";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

async function seed() {
  console.log("Seeding database...");

  await db.execute(
    sql`TRUNCATE TABLE "orders", "products" RESTART IDENTITY CASCADE;`,
  );

  const sampleProduct = await db
    .insert(products)
    .values({
      name: "Flash Sale Item - Limited Edition",
      stock: 50,
    })
    .returning();

  console.log("Sample product inserted:", sampleProduct);

  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  try {
    await redis.del("queue:orders");
    await redis.del("queue:orders:dlq");
    if (sampleProduct[0]?.id) {
      const prodId = sampleProduct[0].id;
      await redis.set(`product:stock:${prodId}`, 50);
      await redis.del(`product:users:${prodId}`);
      console.log(`Redis stock & user set initialized for product ${prodId}`);
    }
    console.log("Redis queues cleaned successfully!");
  } catch (redisError: any) {
    console.warn("Could not clean Redis during seed:", redisError.message);
  } finally {
    await redis.quit();
  }

  console.log("Database seed successfully!");
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });
