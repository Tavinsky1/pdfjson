"""
Billing routes — Stripe Checkout, Customer Portal, Webhook.

Flow:
  1. User calls POST /billing/checkout  →  redirected to Stripe hosted payment page
  2. Stripe redirects back to /billing/success?session_id=...
  3. Stripe sends webhook POST /billing/webhook → tier upgraded in DB

Environment vars needed (add to .env):
  STRIPE_SECRET_KEY     sk_live_... or sk_test_...
  STRIPE_WEBHOOK_SECRET  whsec_...
  STRIPE_PRICE_STARTER   price_...
  STRIPE_PRICE_PRO       price_...
  STRIPE_PRICE_SCALE     price_...
"""

from __future__ import annotations

import json
import logging

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_key
from app.core.config import settings
from app.db.database import get_db
from app.models.db import ApiKey

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

# ─── Price ID → tier name mapping ────────────────────────────────────────────

PRICE_TO_TIER: dict[str, str] = {}


def _price_map() -> dict[str, str]:
    m: dict[str, str] = {}
    if settings.stripe_price_starter:
        m[settings.stripe_price_starter] = "starter"
    if settings.stripe_price_pro:
        m[settings.stripe_price_pro] = "pro"
    if settings.stripe_price_scale:
        m[settings.stripe_price_scale] = "scale"
    return m


# ─── Schemas ─────────────────────────────────────────────────────────────────


class CheckoutRequest(BaseModel):
    tier: str  # starter | pro | scale
    success_url: str = ""
    cancel_url: str = ""


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _billing_configured() -> bool:
    """True only when a real Stripe key is present (not empty, not a placeholder)."""
    key = settings.stripe_secret_key
    return bool(key) and not key.endswith("...") and key not in ("sk_test_", "sk_live_")


def _get_stripe_client() -> stripe.StripeClient:
    if not _billing_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing not configured — set STRIPE_SECRET_KEY in .env (get yours at dashboard.stripe.com)",
        )
    return stripe.StripeClient(settings.stripe_secret_key)


TIER_PRICE_MAP = {
    "starter": lambda: settings.stripe_price_starter,
    "pro": lambda: settings.stripe_price_pro,
    "scale": lambda: settings.stripe_price_scale,
}

TIER_DISPLAY = {
    "free":    {"name": "Free",    "price": "$0",   "limit": 50,     "features": ["50 parses/month", "Rule-based extraction", "JSON output"]},
    "starter": {"name": "Starter", "price": "$19",  "limit": 500,    "features": ["500 parses/month", "AI-powered extraction", "Email support"]},
    "pro":     {"name": "Pro",     "price": "$49",  "limit": 3000,   "features": ["3,000 parses/month", "AI-powered extraction", "Priority support"]},
    "scale":   {"name": "Scale",   "price": "$149", "limit": 20000,  "features": ["20,000 parses/month", "AI-powered extraction", "SLA + priority support"]},
}

# ─── Routes ──────────────────────────────────────────────────────────────────


@router.get("/plans", summary="List all pricing plans")
async def list_plans():
    """Public endpoint — returns all tier definitions (no auth required)."""
    return {
        "plans": [
            {
                "tier": tier,
                **info,
                "monthly_limit": info["limit"],
            }
            for tier, info in TIER_DISPLAY.items()
        ]
    }


@router.post("/checkout", summary="Create a Stripe Checkout session")
async def create_checkout_session(
    body: CheckoutRequest,
    api_key: ApiKey = Depends(get_current_key),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a Stripe Checkout session for the requested tier.
    Returns a redirect URL — send the user there to pay.
    """
    sc = _get_stripe_client()

    if body.tier not in TIER_PRICE_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown tier '{body.tier}'. Choose: starter, pro, scale")

    price_id = TIER_PRICE_MAP[body.tier]()
    if not price_id:
        raise HTTPException(
            status_code=503,
            detail=f"Price for tier '{body.tier}' not configured — set STRIPE_PRICE_{body.tier.upper()} in .env",
        )

    # Create or reuse Stripe customer
    customer_id = api_key.stripe_customer_id
    if not customer_id:
        customer = sc.customers.create(params={
            "email": api_key.email or "",
            "metadata": {"api_key_id": str(api_key.id), "label": api_key.label or ""},
        })
        customer_id = customer.id
        api_key.stripe_customer_id = customer_id
        await db.commit()

    session = sc.checkout.sessions.create(params={
        "customer": customer_id,
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": (body.success_url or f"{settings.app_url}/billing/success") + "?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": body.cancel_url or f"{settings.app_url}/billing/cancel",
        "metadata": {"api_key_id": str(api_key.id), "tier": body.tier},
        "subscription_data": {
            "metadata": {"api_key_id": str(api_key.id), "tier": body.tier}
        },
    })

    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/portal", summary="Open Stripe Customer Portal (manage/cancel subscription)")
async def create_portal_session(
    api_key: ApiKey = Depends(get_current_key),
    return_url: str = "",
):
    """Returns a URL to the Stripe self-service portal so customers can manage or cancel."""
    sc = _get_stripe_client()

    if not api_key.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No billing account found. Subscribe to a plan first via POST /billing/checkout",
        )

    portal = sc.billing_portal.sessions.create(params={
        "customer": api_key.stripe_customer_id,
        "return_url": return_url or f"{settings.app_url}/billing/plans",
    })
    return {"portal_url": portal.url}


@router.post("/webhook", summary="Stripe webhook receiver", include_in_schema=False)
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receives Stripe events.
    Must be registered at: https://dashboard.stripe.com/webhooks
    Endpoint URL: https://your-domain.com/billing/webhook
    Events to enable:
      - checkout.session.completed
      - customer.subscription.updated
      - customer.subscription.deleted
    """
    if not _billing_configured():
        raise HTTPException(status_code=503, detail="Billing not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except stripe.SignatureVerificationError:
        logger.warning("Stripe webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type = event["type"]
    data = event["data"]["object"]
    price_map = _price_map()

    # ── checkout.session.completed ──────────────────────────────────────────
    if event_type == "checkout.session.completed":
        api_key_id = int(data.get("metadata", {}).get("api_key_id", 0))
        tier = data.get("metadata", {}).get("tier", "")
        subscription_id = data.get("subscription")

        if api_key_id and tier:
            result = await db.execute(select(ApiKey).where(ApiKey.id == api_key_id))
            key_row = result.scalar_one_or_none()
            if key_row:
                key_row.tier = tier
                key_row.stripe_subscription_id = subscription_id
                await db.commit()
                logger.info("Upgraded key %s to tier %s", api_key_id, tier)

    # ── customer.subscription.updated ──────────────────────────────────────
    elif event_type == "customer.subscription.updated":
        api_key_id = int(data.get("metadata", {}).get("api_key_id", 0))
        if not api_key_id:
            return JSONResponse({"status": "ignored"})

        # Determine new tier from first item's price
        items = data.get("items", {}).get("data", [])
        new_tier = None
        if items:
            price_id = items[0].get("price", {}).get("id")
            new_tier = price_map.get(price_id)

        if new_tier:
            result = await db.execute(select(ApiKey).where(ApiKey.id == api_key_id))
            key_row = result.scalar_one_or_none()
            if key_row:
                key_row.tier = new_tier
                await db.commit()
                logger.info("Updated key %s to tier %s", api_key_id, new_tier)

    # ── customer.subscription.deleted ──────────────────────────────────────
    elif event_type == "customer.subscription.deleted":
        api_key_id = int(data.get("metadata", {}).get("api_key_id", 0))
        if api_key_id:
            result = await db.execute(select(ApiKey).where(ApiKey.id == api_key_id))
            key_row = result.scalar_one_or_none()
            if key_row:
                key_row.tier = "free"
                key_row.stripe_subscription_id = None
                await db.commit()
                logger.info("Downgraded key %s to free (subscription cancelled)", api_key_id)

    return JSONResponse({"status": "ok"})


# ─── Static confirmation pages ────────────────────────────────────────────────


@router.get("/success", response_class=HTMLResponse, include_in_schema=False)
async def billing_success():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment successful — PDF API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; color: #111; }
    .check { font-size: 64px; }
    h1 { margin: 16px 0 8px; }
    p  { color: #555; line-height: 1.6; }
    a  { display: inline-block; margin-top: 24px; padding: 12px 28px;
         background: #111; color: #fff; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="check">✅</div>
  <h1>You're all set!</h1>
  <p>Your subscription is active. Your API key limit has been upgraded.<br>
     Start parsing PDFs immediately — no restart needed.</p>
  <a href="/docs">Back to API docs →</a>
</body>
</html>
""")


@router.get("/cancel", response_class=HTMLResponse, include_in_schema=False)
async def billing_cancel():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment cancelled — PDF API</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; color: #111; }
    .icon { font-size: 64px; }
    h1 { margin: 16px 0 8px; }
    p  { color: #555; line-height: 1.6; }
    a  { display: inline-block; margin-top: 24px; padding: 12px 28px;
         background: #111; color: #fff; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="icon">↩️</div>
  <h1>No charge made</h1>
  <p>You cancelled the checkout. Your free plan is still active.<br>
     Come back whenever you're ready to upgrade.</p>
  <a href="/billing/plans">View plans →</a>
</body>
</html>
""")
