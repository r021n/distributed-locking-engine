import "dotenv";
import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

const BASE_URL = `http://localhost:${process.env.SERVER_PORT || "3000"}`;

async function testFlashSaleEndpoint() {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  console.log("=== Flash Sale Checkout Endpoint Test ===\n");

  try {
    console.log("Test 1: Initialize stock for product 1...");
    await redis.set("product:stock:1", 50);
    const stock = await redis.get("product:stock:1");
    console.log(`Initial stock: ${stock}`);

    console.log("\nTest 2: Testing successful checkout...");
    const response1 = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user1", productId: 1 }),
    });
    const data1 = await response1.json();
    console.log(`Status: ${response1.status}`);
    console.log(`Response:`, data1);

    console.log("\nTest 3: Testing multiple checkouts...");
    for (let i = 2; i <= 5; i++) {
      const response = await fetch(`${BASE_URL}/api/flash-sale/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: `user${i}`, productId: 1 }),
      });
      const data = await response.json();
      console.log(
        `Checkout ${i}: Status ${response.status} - Stock: ${data.remainingStock}`,
      );
    }
  } catch (error: any) {}
}
