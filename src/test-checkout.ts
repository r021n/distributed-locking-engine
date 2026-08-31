import "dotenv/config";
import Redis from "ioredis";
import { readFileSync } from "fs";
import { join } from "path";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const DECREMENT_STOCK_SCRIPT = readFileSync(
  join(__dirname, "lua/decrement_stock.lua"),
  "utf-8",
);

async function testLuaScript() {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  try {
    redis.defineCommand("decrementStock", {
      numberOfKeys: 1,
      lua: DECREMENT_STOCK_SCRIPT,
    });

    // Initialize stock
    console.log("Test 1: Initializing stock for product 1...");
    await redis.set("product:stock:1", 50);
    const stock = await redis.get("product:stock:1");
    console.log(`Initial stock: ${stock}`);

    // decrement
    console.log("\nTest 2: Testing successful decrement...");
    const result1 = await (redis as any).decrementStock(
      "product:stock:1",
      1,
      "user1",
    );
    console.log(`Decrement result:`, result1);

    // multiple decrement
    console.log("\nTest 3: Testing multiple decrement...");
    for (let i = 2; i < 5; i++) {
      const result = await (redis as any).decrementStock(
        "product:stock:1",
        1,
        `user${i}`,
      );
      console.log(`Decrement ${i}:`, result);
    }
  } catch (error) {}
}
