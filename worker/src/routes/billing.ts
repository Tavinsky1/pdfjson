import { Hono } from "hono";
import type { Env } from "../lib/types";
import { TIER_DISPLAY } from "../lib/types";
import { getCurrentKey } from "../lib/auth";
import { getDb } from "../db/client";
import { apiKeys } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const billing = new Hono<{ Bindings: Env }>();

/* ── GET /billing/plans — public endpoint ─────────────── */
billing.get("/billing/plans", async (c) => {
  const plans = Object.entries(TIER_DISPLAY).map(([tier, info]) => ({
    tier,
    ...info,
    monthly_limit: info.limit,
  }));
  return c.json({ plans });
});

/* ── POST /billing/checkout — create Stripe Checkout ───── */
billing.post("/billing/checkout", async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(
      {
        detail:
          "Billing not configured — set STRIPE_SECRET_KEY in .env (get yours at dashboard.stripe.com)",
      },
      503,
    );
  }

  let keyRow;
  try {
    keyRow = await getCurrentKey(c.req.header("Authorization"), c.env);
  } catch (e: any) {
    return c.json({ detail: e.message }, e.status || 500);
  }

  const body = await c.req
    .json<{ tier: string; success_url?: string; cancel_url?: string }>()
    .catch(() => ({ tier: "" }));

  const tierPriceMap: Record<string, string | undefined> = {
    starter: c.env.STRIPE_PRICE_STARTER,
    pro: c.env.STRIPE_PRICE_PRO,
    scale: c.env.STRIPE_PRICE_SCALE,
  };

  if (!body.tier || !(body.tier in tierPriceMap)) {
    return c.json(
      { detail: `Unknown tier '${body.tier}'. Choose: starter, pro, scale` },
      400,
    );
  }

  const priceId = tierPriceMap[body.tier];
  if (!priceId) {
    return c.json(
      {
        detail: `Price for tier '${body.tier}' not configured — set STRIPE_PRICE_${body.tier.toUpperCase()} in .env`,
      },
      503,
    );
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

  // Create or reuse Stripe customer
  let customerId = keyRow.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: keyRow.email || "",
      metadata: {
        api_key_id: String(keyRow.id),
        label: keyRow.label || "",
      },
    });
    customerId = customer.id;
    const db = getDb(c.env.DATABASE_URL);
    await db
      .update(apiKeys)
      .set({ stripeCustomerId: customerId })
      .where(eq(apiKeys.id, keyRow.id));
  }

  const appUrl = c.env.APP_URL || "https://pdfjson.inksky.net";
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:
      (body.success_url || `${appUrl}/billing/success`) +
      "?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: body.cancel_url || `${appUrl}/billing/cancel`,
    metadata: { api_key_id: String(keyRow.id), tier: body.tier },
    subscription_data: {
      metadata: { api_key_id: String(keyRow.id), tier: body.tier },
    },
  });

  return c.json({ checkout_url: session.url, session_id: session.id });
});

/* ── POST /billing/portal — Stripe customer portal ─────── */
billing.post("/billing/portal", async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ detail: "Billing not configured" }, 503);
  }

  let keyRow;
  try {
    keyRow = await getCurrentKey(c.req.header("Authorization"), c.env);
  } catch (e: any) {
    return c.json({ detail: e.message }, e.status || 500);
  }

  if (!keyRow.stripeCustomerId) {
    return c.json(
      {
        detail:
          "No billing account found. Subscribe to a plan first via POST /billing/checkout",
      },
      400,
    );
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
  const appUrl = c.env.APP_URL || "https://pdfjson.inksky.net";

  const portal = await stripe.billingPortal.sessions.create({
    customer: keyRow.stripeCustomerId,
    return_url: `${appUrl}/billing/plans`,
  });

  return c.json({ portal_url: portal.url });
});

/* ── POST /billing/webhook — Stripe webhook ────────────── */
billing.post("/billing/webhook", async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ detail: "Billing not configured" }, 503);
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

  const payload = await c.req.text();
  const sig = c.req.header("stripe-signature") || "";

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return c.json({ detail: "Invalid webhook signature" }, 400);
  }

  const db = getDb(c.env.DATABASE_URL);
  const data = event.data.object;

  const priceToTier: Record<string, string> = {};
  if (c.env.STRIPE_PRICE_STARTER) priceToTier[c.env.STRIPE_PRICE_STARTER] = "starter";
  if (c.env.STRIPE_PRICE_PRO) priceToTier[c.env.STRIPE_PRICE_PRO] = "pro";
  if (c.env.STRIPE_PRICE_SCALE) priceToTier[c.env.STRIPE_PRICE_SCALE] = "scale";

  if (event.type === "checkout.session.completed") {
    const apiKeyId = parseInt(data.metadata?.api_key_id || "0");
    const tier = data.metadata?.tier || "";
    const subscriptionId = data.subscription;

    if (apiKeyId && tier) {
      await db
        .update(apiKeys)
        .set({ tier, stripeSubscriptionId: subscriptionId })
        .where(eq(apiKeys.id, apiKeyId));
    }
  } else if (event.type === "customer.subscription.updated") {
    const apiKeyId = parseInt(data.metadata?.api_key_id || "0");
    if (apiKeyId) {
      const items = data.items?.data || [];
      const priceId = items[0]?.price?.id;
      const newTier = priceId ? priceToTier[priceId] : null;
      if (newTier) {
        await db
          .update(apiKeys)
          .set({ tier: newTier })
          .where(eq(apiKeys.id, apiKeyId));
      }
    }
  } else if (event.type === "customer.subscription.deleted") {
    const apiKeyId = parseInt(data.metadata?.api_key_id || "0");
    if (apiKeyId) {
      await db
        .update(apiKeys)
        .set({ tier: "free", stripeSubscriptionId: null })
        .where(eq(apiKeys.id, apiKeyId));
    }
  }

  return c.json({ status: "ok" });
});

/* ── GET /billing/success + /billing/cancel ────────────── */
billing.get("/billing/success", (c) => {
  return c.html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Payment successful — PDF API</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#111}
.check{font-size:64px}h1{margin:16px 0 8px}p{color:#555;line-height:1.6}
a{display:inline-block;margin-top:24px;padding:12px 28px;background:#111;color:#fff;border-radius:8px;text-decoration:none}</style>
</head><body><div class="check">✅</div><h1>You're all set!</h1>
<p>Your subscription is active. Your API key limit has been upgraded.<br>Start parsing PDFs immediately — no restart needed.</p>
<a href="/">Back to home →</a></body></html>`);
});

billing.get("/billing/cancel", (c) => {
  return c.html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Payment cancelled — PDF API</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#111}
.icon{font-size:64px}h1{margin:16px 0 8px}p{color:#555;line-height:1.6}
a{display:inline-block;margin-top:24px;padding:12px 28px;background:#111;color:#fff;border-radius:8px;text-decoration:none}</style>
</head><body><div class="icon">↩️</div><h1>No charge made</h1>
<p>You cancelled the checkout. Your free plan is still active.<br>Come back whenever you're ready to upgrade.</p>
<a href="/billing/plans">View plans →</a></body></html>`);
});

export default billing;
