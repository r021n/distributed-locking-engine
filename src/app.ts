import Fastify from "fastify";
import Redis from "ioredis";
import redisConnector from "./plugins/redis";
import redisLuaScript from "./plugins/redis-lua";
import flashSaleRoutes from "./routes/flash-sale";

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

fastify.register(flashSaleRoutes, { prefix: "/api/flash-sale" });

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
