import { Hono } from "hono";
import type { Env } from "../lib/types";
import { TIER_LIMITS } from "../lib/types";
import { getDb } from "../db/client";
import { apiKeys } from "../db/schema";
import { eq, like, sql } from "drizzle-orm";

const admin = new Hono<{ Bindings: Env }>();

/* ── Admin auth middleware ──────────────────────────────
   All /admin/* routes require:
     Authorization: Bearer <SECRET_KEY>
   This is the same SECRET_KEY already set as a Worker secret.
   ──────────────────────────────────────────────────────── */
admin.use("/admin/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json({ detail: "Missing Authorization: Bearer <ADMIN_SECRET>" }, 401);
  }
  const token = auth.slice(7);
  if (token !== c.env.SECRET_KEY) {
    return c.json({ detail: "Invalid admin secret" }, 403);
  }
  await next();
});

/* ── GET /admin/keys — list all API keys ───────────────── */
admin.get("/admin/keys", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const q = c.req.query("email") || c.req.query("q");

  let rows;
  if (q) {
    rows = await db
      .select()
      .from(apiKeys)
      .where(like(apiKeys.email, `%${q}%`))
      .orderBy(apiKeys.createdAt)
      .limit(50);
  } else {
    rows = await db
      .select()
      .from(apiKeys)
      .orderBy(apiKeys.createdAt)
      .limit(100);
  }

  return c.json({
    count: rows.length,
    keys: rows.map((r) => ({
      id: r.id,
      label: r.label,
      email: r.email,
      tier: r.tier,
      usage_count: r.usageCount,
      monthly_limit: (TIER_LIMITS[r.tier] || TIER_LIMITS["free"])(c.env),
      revoked: r.revoked,
      stripe_customer_id: r.stripeCustomerId,
      stripe_subscription_id: r.stripeSubscriptionId,
      created_at: r.createdAt?.toISOString(),
    })),
  });
});

/* ── PATCH /admin/keys/:id/tier — set tier for a key ───── */
admin.patch("/admin/keys/:id/tier", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ detail: "Invalid key ID" }, 400);
  }

  const body = await c.req.json<{ tier: string }>().catch(() => ({ tier: "" }));
  const validTiers = Object.keys(TIER_LIMITS);

  if (!body.tier || !validTiers.includes(body.tier)) {
    return c.json(
      { detail: `Invalid tier '${body.tier}'. Valid: ${validTiers.join(", ")}` },
      400,
    );
  }

  const db = getDb(c.env.DATABASE_URL);

  // Verify the key exists
  const [existing] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ detail: `API key with id ${id} not found` }, 404);
  }

  const oldTier = existing.tier;

  await db
    .update(apiKeys)
    .set({ tier: body.tier })
    .where(eq(apiKeys.id, id));

  const limitFn = TIER_LIMITS[body.tier];
  const newLimit = limitFn(c.env);

  return c.json({
    id,
    email: existing.email,
    label: existing.label,
    old_tier: oldTier,
    new_tier: body.tier,
    monthly_limit: newLimit,
    message: `Tier changed from '${oldTier}' to '${body.tier}'`,
  });
});

/* ── PATCH /admin/keys/:id/revoke — revoke or unrevoke ── */
admin.patch("/admin/keys/:id/revoke", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ detail: "Invalid key ID" }, 400);
  }

  const body = await c.req
    .json<{ revoked: boolean }>()
    .catch(() => ({ revoked: true }));

  const db = getDb(c.env.DATABASE_URL);

  const [existing] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ detail: `API key with id ${id} not found` }, 404);
  }

  await db
    .update(apiKeys)
    .set({ revoked: body.revoked })
    .where(eq(apiKeys.id, id));

  return c.json({
    id,
    email: existing.email,
    revoked: body.revoked,
    message: body.revoked ? "Key revoked" : "Key restored",
  });
});

/* ── PATCH /admin/keys/:id/usage — reset usage counter ── */
admin.patch("/admin/keys/:id/usage", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ detail: "Invalid key ID" }, 400);
  }

  const body = await c.req
    .json<{ usage_count?: number }>()
    .catch(() => ({}));

  const db = getDb(c.env.DATABASE_URL);

  const [existing] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ detail: `API key with id ${id} not found` }, 404);
  }

  const newCount = body.usage_count ?? 0;

  await db
    .update(apiKeys)
    .set({ usageCount: newCount })
    .where(eq(apiKeys.id, id));

  return c.json({
    id,
    email: existing.email,
    old_usage: existing.usageCount,
    new_usage: newCount,
    message: `Usage reset to ${newCount}`,
  });
});

export default admin;
