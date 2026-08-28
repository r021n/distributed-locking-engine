import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

async function redisConnector(fastify: FastifyInstance) {
    const redis = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        retryStrategy(times: number) {
            const delay = Math.min(times * 200, 3000);
            return delay;
        },
        maxRetriesPerRequest: 3,
    });

    redis.on("error", (err) => {
        fastify.log.error(err, "Redis connection error");
    });

    redis.on("connect", () => {
        fastify.log.info("Redis connected and ready");
    });

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Redis connection timed out after 5 seconds"));
        }, 5000);

        redis.once("ready", () => {
            clearTimeout(timeout);
            resolve();
        });

        redis.once("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });

    fastify.decorate("redis", redis);

    fastify.addHook("onClose", async () => {
        fastify.log.info("Closing redis connection...");
        await redis.quit();
    })
}

export default fastifyPlugin(redisConnector);