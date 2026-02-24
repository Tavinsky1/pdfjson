import { Hono } from "hono";
import type { Env } from "../lib/types";
import { TIER_LIMITS } from "../lib/types";
import { generateApiKey, hashKeyAsync, getCurrentKey, getNextReset } from "../lib/auth";
import { getDb } from "../db/client";
import { apiKeys } from "../db/schema";
import { eq } from "drizzle-orm";

const keys = new Hono<{ Bindings: Env }>();

/* ── POST /keys — create a new API key ─────────────────── */
keys.post("/keys", async (c) => {
  const body = await c.req.json<{ email?: string; label?: string }>().catch(() => ({}));

  const prefix = c.env.API_KEY_PREFIX || "pdfa_";
  const [rawKey] = generateApiKey(prefix);
  const hashed = await hashKeyAsync(rawKey);

  const now = new Date();
  const nextReset = getNextReset(now);

  const db = getDb(c.env.DATABASE_URL);

  await db.insert(apiKeys).values({
    keyHash: hashed,
    label: body.label || null,
    email: body.email || null,
    tier: "free",
    usageCount: 0,
    usageResetAt: nextReset,
    revoked: false,
    createdAt: now,
  });

  const limitFn = TIER_LIMITS["free"];
  const limit = limitFn(c.env);

  return c.json(
    {
      key: rawKey,
      label: body.label || null,
      email: body.email || null,
      tier: "free",
      monthly_limit: limit,
      created_at: now.toISOString(),
    },
    201,
  );
});

/* ── GET /keys/usage — get usage for current key ────────── */
keys.get("/keys/usage", async (c) => {
  let row;
  try {
    row = await getCurrentKey(c.req.header("Authorization"), c.env);
  } catch (e: any) {
    return c.json({ detail: e.message }, e.status || 500);
  }

  const limitFn = TIER_LIMITS[row.tier] || TIER_LIMITS["free"];
  const limit = limitFn(c.env);

  return c.json({
    label: row.label,
    email: row.email,
    tier: row.tier,
    usage_count: row.usageCount,
    monthly_limit: limit,
    usage_reset_at: row.usageResetAt ? new Date(row.usageResetAt).toISOString() : null,
    revoked: row.revoked,
  });
});

/* ── DELETE /keys/me — revoke current key ───────────────── */
keys.delete("/keys/me", async (c) => {
  let row;
  try {
    row = await getCurrentKey(c.req.header("Authorization"), c.env);
  } catch (e: any) {
    return c.json({ detail: e.message }, e.status || 500);
  }

  const db = getDb(c.env.DATABASE_URL);
  await db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, row.id));

  return new Response(null, { status: 204 });
});

export default keys;
