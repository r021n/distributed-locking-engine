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
