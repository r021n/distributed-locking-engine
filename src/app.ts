import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis";
import redisLuaScript from "./plugins/redis-lua";
import { request } from "node:http";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

const fastify = Fastify({
  logger: {
    level: "info",
  },
});

fastify.register(redisConnector);
fastify.register(redisLuaScript);

fastify.get("/health", async (_request, reply) => {
  const redisPing = await fastify.redis.ping();
  return {
    status: "ok",
    redis: redisPing === "PONG" ? "connected" : "disconnected",
  };
});

fastify.post<{ Body: { productId: number; userId: string } }>(
  "/test/checkout",
  async (request, reply) => {
    const { productId, userId } = request.body;
    const stockKey = `product:stock:${productId}`;

    const exists = await fastify.redis.exists(stockKey);
    if (!exists) {
      await fastify.redis.set(stockKey, 50);
    }

    try {
      const redisWithCommands = fastify.redis as any;
      const result = await redisWithCommands.decrementStock(
        stockKey,
        productId,
        userId,
      );
      return {
        success: true,
        remainingStock: result[0],
        status: result[1],
      };
    } catch (error: any) {
      return reply.status(409).send({
        success: false,
        error: error.message,
      });
    }
  },
);

const start = async () => {
  const port = parseInt(process.env.SERVER_PORT || "3000", 10);
  try {
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
