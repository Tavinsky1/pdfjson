import {
  pgTable, varchar, text, boolean, integer,
  timestamp, serial, index,
} from "drizzle-orm/pg-core";

/* ── API Keys ──────────────────────────────────────── */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  label: varchar("label", { length: 100 }),
  email: varchar("email", { length: 254 }),
  tier: varchar("tier", { length: 20 }).notNull().default("free"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 50 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 50 }),
  usageCount: integer("usage_count").notNull().default(0),
  usageResetAt: timestamp("usage_reset_at", { withTimezone: true }),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_api_keys_hash").on(t.keyHash),
  index("idx_api_keys_email").on(t.email),
]);

/* ── Parse Jobs ────────────────────────────────────── */
export const parseJobs = pgTable("parse_jobs", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull().references(() => apiKeys.id),
  filename: varchar("filename", { length: 255 }),
  sourceUrl: text("source_url"),
  pageCount: integer("page_count"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  documentType: varchar("document_type", { length: 50 }),
  resultJson: text("result_json"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
