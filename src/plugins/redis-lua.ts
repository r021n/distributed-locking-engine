import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { readFileSync } from "fs";
import { join } from "path";
import type Redis from "ioredis";

const DECREMENT_STOCK_SCRIPT = readFileSync(
  join(__dirname, "../lua/decrement_stock.lua"),
  "utf-8",
);

async function redisLuaScript(fastify: FastifyInstance) {
  const redis = fastify.redis as Redis & {
    decrementStock: (
      stockKey: string,
      userSetKey: string,
      productId: number,
      userId: string,
    ) => Promise<[number, string]>;
  };

  redis.defineCommand("decrementStock", {
    numberOfKeys: 2,
    lua: DECREMENT_STOCK_SCRIPT,
  });

  fastify.addHook("onClose", async () => {
    fastify.log.info("Redis Lua scripts cleaned up");
  });
}

export default fastifyPlugin(redisLuaScript);
