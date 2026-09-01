import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";

interface CheckoutBody {
  userId: string;
  productId: number;
}

interface CheckoutSuccessResponse {
  success: true;
  remainingStock: number;
  message: string;
}

interface CheckoutErrorResponse {
  success: false;
  error: string;
}

const checkoutSchema = {
  body: {
    type: "object",
    required: ["userId", "productId"],
    properties: {
      userId: {
        type: "string",
        minLength: 1,
        maxLength: 255,
      },
      productId: {
        type: "integer",
        minimum: 1,
      },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        remainingStock: { type: "integer" },
        message: { type: "string" },
      },
    },
    400: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" },
      },
    },
    409: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" },
      },
    },
  },
};

async function flashSaleRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: CheckoutBody }>(
    "/checkout",
    {
      schema: checkoutSchema,
    },
    async (
      request: FastifyRequest<{ Body: CheckoutBody }>,
      reply: FastifyReply,
    ) => {
      const { userId, productId } = request.body;
      const stockKey = `product:stock:${productId}`;

      const exists = await fastify.redis.exists(stockKey);
      if (!exists) {
        return reply.status(400).send({
          success: false,
          error: "PRODUCT_NOT_FOUND",
        } as CheckoutErrorResponse);
      }

      try {
        const redisWithCommands = fastify.redis as Redis & {
          decrementStock: (
            stockKey: string,
            productId: number,
            userId: string,
          ) => Promise<[number, string]>;
        };

        const result = await redisWithCommands.decrementStock(
          stockKey,
          productId,
          userId,
        );

        return {
          success: true,
          remainingStock: result[0],
          message: "Checkout successful",
        } as CheckoutSuccessResponse;
      } catch (error: any) {
        const errorMessage = error.message || "UNKNOWN_ERROR";

        if (errorMessage.include("SOLD_OUT")) {
          return reply.status(409).send({
            success: false,
            error: "SOLD_OUT",
          } as CheckoutErrorResponse);
        }

        if (errorMessage.includes("PRODUCT_NOT_FOUND")) {
          return reply.status(400).send({
            success: false,
            error: "PRODUCT_NOT_FOUND",
          } as CheckoutErrorResponse);
        }

        return reply.status(500).send({
          success: false,
          error: "INTERNAL_SERVER_ERROR",
        } as CheckoutErrorResponse);
      }
    },
  );
}

export default flashSaleRoutes;
