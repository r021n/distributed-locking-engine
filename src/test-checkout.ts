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
      numberOfKeys: 2,
      lua: DECREMENT_STOCK_SCRIPT,
    });

    // Clean state
    await redis.set("product:stock:1", 50);
    await redis.del("product:users:1");
    await redis.del("queue:orders");

    // Initialize stock
    console.log("Test 1: Initializing stock for product 1...");
    await redis.set("product:stock:1", 50);
    const stock = await redis.get("product:stock:1");
    console.log(`Initial stock: ${stock}`);

    // decrement
    console.log("\nTest 2: Testing successful decrement...");
    const result1 = await (redis as any).decrementStock(
      "product:stock:1",
      "product:users:1",
      1,
      "user1",
    );
    console.log(`Decrement result:`, result1);

    // multiple decrement
    console.log("\nTest 3: Testing multiple decrement...");
    for (let i = 2; i < 5; i++) {
      const result = await (redis as any).decrementStock(
        "product:stock:1",
        "product:users:1",
        1,
        `user${i}`,
      );
      console.log(`Decrement ${i}:`, result);
    }

    // check remaining stock
    console.log("\nTest 4: Checking remaining stock...");
    const remainingStock = await redis.get("product:stock:1");
    console.log(`Remaining stock: ${remainingStock}`);

    // check order queue
    console.log("\nTest 5: Checking order queue...");
    const queueLength = await redis.llen("queue:orders");
    console.log(`Orders in queue: ${queueLength}`);

    // get orders from queue
    console.log("\nTest 6: Getting orders from queue...");
    const orders = await redis.lrange("queue:orders", 0, -1);
    orders.forEach((order, index) => {
      console.log(`Order ${index + 1}:`, JSON.parse(order));
    });

    // trying to decrement when stock is zero
    console.log("\nTest 7: Testing sold out scenario...");
    await redis.set("product:stock:2", 0);
    try {
      await (redis as any).decrementStock("product:stock:2", 2, "user99");
    } catch (error: any) {
      console.log(`Expected error: ${error.message}`);
    }

    console.log("\nAll tests completed successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await redis.quit();
  }
}

testLuaScript();
