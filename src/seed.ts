import "dotenv/config";
import { db } from "./db";
import { products, orders } from "./db/schema";

async function seed() {
  console.log("Seeding database...");

  await db.delete(orders);
  await db.delete(products);

  const sampleProduct = await db
    .insert(products)
    .values({
      name: "Flash Sale Item - Limited Edition",
      stock: 50,
    })
    .returning();

  console.log("Sample product inserted:", sampleProduct);

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
