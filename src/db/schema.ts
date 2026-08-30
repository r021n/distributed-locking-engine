import { integer, pgTable, varchar, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  stock: integer().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar("user_id", {length: 255}).notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    status: varchar({length: 50}).notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
})