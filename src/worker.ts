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
