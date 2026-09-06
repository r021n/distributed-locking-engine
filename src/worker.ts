import "dotenv/config";
import Redis from "ioredis";
import { db } from "./db";
import { orders } from "./db/schema";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 100;

interface OrderData {
  product_id: string;
  user_id: string;
  timestamp: string;
}

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times: number) {
    return Math.min(times * 200, 3000);
  },
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => {
  console.error("[Worker] redis connection error:", err.message);
});

redis.on("connect", () => {
  console.log("[Worker] Redis connected");
});

redis.on("ready", () => {
  console.log("[Worker] Redis ready, starting order processor...");
});

async function processOrders(): Promise<void> {
  const batch: (typeof orders.$inferInsert)[] = [];

  try {
    const result = await redis.brpop("queue:orders", POLL_INTERVAL_MS / 1000);

    if (result) {
      const [key, value] = result;
      const orderData: OrderData = JSON.parse(value);

      batch.push({
        userId: orderData.user_id,
        productId: parseInt(orderData.product_id, 10),
        status: "completed",
      });

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

    if (batch.length > 0) {
      try {
        await db.insert(orders).values(batch);
        console.log(`[Worker] Inserted ${batch.length} order(s) to PostgreSQL`);
      } catch (insertError: any) {
        const errorDetail =
          insertError?.cause?.message ||
          insertError?.cause?.detail ||
          insertError.message;
        console.error(
          `[Worker] Batch insert failed (${errorDetail}). Falling back to individual inserts...`,
        );

        for (const order of batch) {
          try {
            await db.insert(orders).values(order);
            console.log(
              `[Worker] Inserted order for user ${order.userId} (productId: ${order.productId})`,
            );
          } catch (itemError: any) {
            const itemDetail =
              itemError?.cause?.message ||
              itemError?.cause?.detail ||
              itemError.message;
            console.error(
              `[Worker] Failed to insert order for user ${order.userId} (productId: ${order.productId}): ${itemDetail}. Moving to DLQ.`,
            );
            await redis.lpush(
              "queue:orders:dlq",
              JSON.stringify({ ...order, error: itemDetail }),
            );
          }
        }
      }
    }
  } catch (error: any) {
    if (error.message !== "Connection is closed.") {
      const detail = error?.cause?.message || error?.cause?.detail || error.message;
      console.error("[Worker] Error processing orders:", detail);
    }
  }
}

async function startWorker(): Promise<void> {
  console.log("[Worker] Waiting for Redis connection...");

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

  while (true) {
    await processOrders();
  }
}

async function gracefulShutdown(): Promise<void> {
  console.log("\n[Worker] Shutting down gracefully...");
  await redis.quit();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

startWorker().catch((err) => {
  console.error("[Worker] Failed to start worker:", err);
  process.exit(1);
});
