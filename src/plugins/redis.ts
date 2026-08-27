import type { FastifyInstance } from "fastify";
import fastifyPlugin from "fastify-plugin";
import Redis from "ioredis";

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);