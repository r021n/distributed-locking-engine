import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";
import { db } from "../db";
import { products, orders } from "../db/schema";
import { sql } from "drizzle-orm";

async function testHelpersRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { stock: number } }>(
    "/seed",
    async (
      request: FastifyRequest<{ Body: { stock: number } }>,
      reply: FastifyReply,
    ) => {
      const { stock } = request.body;
      const redis = fastify.redis as Redis;

      //   truncate all data
      await db.execute(
        sql`TRUNCATE TABLE "orders", "products" RESTART IDENTITY CASCADE;`,
      );

      //   insert new product
      const [product] = await db
        .insert(products)
        .values({
          name: "Flash Sale Load Test Item",
          stock: stock,
        })
        .returning();

      // reset redis
      const stockKey = `product:stock:${product.id}`;
      const usersKey = `product:users:${product.id}`;

      await redis.set(stockKey, stock);
      await redis.del(usersKey);
      await redis.del("queue:orders");
      await redis.del("queue:orders:dlq");

      return reply.status(200).send({
        productId: product.id,
        stock: stock,
      });
    },
  );

  fastify.get<{ Querystring: { productId: string } }>(
    "/verify",
    async (
      request: FastifyRequest<{ Querystring: { productId: string } }>,
      reply: FastifyReply,
    ) => {
      const { productId } = request.query;
      const redis = fastify.redis as Redis;

      const stockKey = `product:stock:${productId}`;
      const usersKey = `product:users:${productId}`;

      // get stock from redis
      const redisStock = parseInt((await redis.get(stockKey)) || "-1", 10);

      // get total buyers
      const redisBuyersCount = await redis.scard(usersKey);

      // get total orders in postgreSQL
      const [orderCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.productId} = ${parseInt(productId, 10)}`);

      return reply.status(200).send({
        redisStock: redisStock,
        postgresOrders: orderCount.count,
        redisBuyersCount: redisBuyersCount,
      });
    },
  );
}

export default testHelpersRoutes;
