# PDF → JSON API

**Live API:** `https://pdfjson.inksky.net`  
**Interactive docs:** `https://pdfjson.inksky.net/docs`

A REST API that converts any PDF invoice or receipt into clean, structured JSON using LLM-powered extraction. No template drawing, no configuration, no GUI — just one endpoint.

---

## Table of Contents

1. [How it works](#how-it-works)
2. [Quick start (local)](#quick-start-local)
3. [Authentication](#authentication)
4. [API endpoints](#api-endpoints)
   - [POST /demo](#post-demo)
   - [POST /keys](#post-keys)
   - [GET /keys/usage](#get-keysusage)
   - [DELETE /keys/me](#delete-keysme)
   - [POST /parse](#post-parse)
   - [GET /health](#get-health)
   - [GET /billing/plans](#get-billingplans)
   - [POST /billing/checkout](#post-billingcheckout)
   - [POST /billing/portal](#post-billingportal)
   - [POST /billing/webhook](#post-billingwebhook)
5. [Response schemas](#response-schemas)
6. [Error codes](#error-codes)
7. [Security & privacy](#security--privacy)
8. [Pricing tiers](#pricing-tiers)
9. [Rate limits](#rate-limits)
10. [Environment variables](#environment-variables)
11. [Deploy to Railway](#deploy-to-railway)
12. [Project structure](#project-structure)
13. [Running tests](#running-tests)

---

## How it works

```
PDF file ──► text extraction (pdfplumber + PyMuPDF fallback)
         ──► LLM extraction (structured JSON via AI inference)
         ──► ParseResponse JSON
```

The pipeline is fully in-memory. Your document is **never written to disk** and is discarded immediately after the response is sent.

---

## Quick start (local)

```bash
git clone https://github.com/Tavinsky1/pdfjson.git
cd pdfjson

# Create venv
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Set GROQ_API_KEY (for LLM extraction) — see .env.example for where to get it

# Run
uvicorn app.main:app --reload
# → http://localhost:8000           (landing page)
# → http://localhost:8000/docs      (Swagger UI)
```

---

## Authentication

All endpoints except `/demo`, `POST /keys`, `/health`, and `/billing/plans` require a Bearer token:

```
Authorization: Bearer pdfa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Key lifecycle:**
- Keys are generated via `POST /keys` — the raw key is shown **once and never again**
- Keys are stored as SHA-256 hashes — a DB breach cannot expose raw keys
- Usage resets automatically on the 1st of each calendar month (UTC)
- Keys can be revoked at any time via `DELETE /keys/me`

---

## API endpoints

### POST /demo

Try parsing without an API key. No signup required.

**Rate limit:** 5 requests per IP per day (resets at midnight UTC).

```bash
curl -X POST https://pdfjson.inksky.net/demo \
  -F "file=@invoice.pdf"
```

**Response `200 OK`**

```json
{
  "document_type": "invoice",
  "result": {
    "vendor": { "name": "Acme Corp", "email": "billing@acme.com" },
    "invoice_number": "INV-2025-042",
    "date_issued": "2025-01-15",
    "date_due": "2025-02-15",
    "line_items": [
      { "description": "Design work", "quantity": 1, "unit_price": 2500.00, "total": 2500.00 }
    ],
    "subtotal": 2500.00,
    "tax": 250.00,
    "total": 2750.00,
    "currency": "USD"
  },
  "demo": true,
  "demo_remaining_today": 4,
  "upgrade": "Create a free key at POST /keys for 3 parses/month, or see /billing/plans to upgrade."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `document_type` | string | `invoice`, `receipt`, or `unknown` |
| `result` | object | Extracted fields |
| `demo` | boolean | Always `true` |
| `demo_remaining_today` | integer | Remaining demo calls today |
| `upgrade` | string | Prompt to create a real API key |

**Errors:** `400` empty file · `413` >20 MB · `415` not a PDF · `422` parse failed · `429` daily limit

---

### POST /keys

Create a free API key. No authentication required.

```bash
curl -X POST https://pdfjson.inksky.net/keys \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "label": "production"}'
```

| Field | Required | Description |
|-------|----------|-------------|
| `email` | ✅ | Your email — used for billing and support |
| `label` | No | Human-readable name for this key |

**Response `201 Created`**

```json
{
  "key": "pdfa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "label": "production",
  "email": "you@example.com",
  "tier": "free",
  "monthly_limit": 3,
  "created_at": "2025-01-15T10:00:00Z"
}
```

> ⚠️ The `key` field is returned **exactly once**. Store it securely — it cannot be retrieved again.

---

### GET /keys/usage

Get usage statistics for the authenticated key.

```bash
curl https://pdfjson.inksky.net/keys/usage \
  -H "Authorization: Bearer pdfa_xxxxxx"
```

**Response `200 OK`**

```json
{
  "label": "production",
  "email": "you@example.com",
  "tier": "free",
  "usage_count": 1,
  "monthly_limit": 3,
  "usage_reset_at": "2025-02-01T00:00:00Z",
  "revoked": false
}
```

---

### DELETE /keys/me

Revoke the authenticated key permanently. Cannot be undone.

```bash
curl -X DELETE https://pdfjson.inksky.net/keys/me \
  -H "Authorization: Bearer pdfa_xxxxxx"
```

**Response `200 OK`**

```json
{ "detail": "Key revoked." }
```

---

### POST /parse

Parse a PDF to structured JSON. Requires a valid API key within its monthly limit.

**Option A — file upload**

```bash
curl -X POST https://pdfjson.inksky.net/parse \
  -H "Authorization: Bearer pdfa_xxxxxx" \
  -F "file=@invoice.pdf"
```

**Option B — public URL**

```bash
curl -X POST https://pdfjson.inksky.net/parse \
  -H "Authorization: Bearer pdfa_xxxxxx" \
  -F "url=https://example.com/invoice.pdf"
```

**Constraints**

| Constraint | Value |
|-----------|-------|
| Max file size | 20 MB |
| Accepted format | PDF only (validated by magic bytes `%PDF`) |
| URL schemes | `http://` and `https://` only |
| Private/internal URLs | Rejected (SSRF protection) |
| Max URL redirects | 3 |

**Response `200 OK` — Invoice**

```json
{
  "job_id": 1,
  "status": "success",
  "document_type": "invoice",
  "filename": "invoice.pdf",
  "page_count": 2,
  "result": {
    "vendor": {
      "name": "Acme Corp",
      "address": "123 Main St, San Francisco, CA",
      "email": "billing@acme.com",
      "phone": "+1-555-0100"
    },
    "invoice_number": "INV-2025-042",
    "date_issued": "2025-01-15",
    "date_due": "2025-02-15",
    "po_number": "PO-9001",
    "line_items": [
      { "description": "Design work", "quantity": 1, "unit_price": 2500.00, "total": 2500.00 }
    ],
    "subtotal": 2500.00,
    "tax": 250.00,
    "discount": 0.00,
    "total": 2750.00,
    "currency": "USD",
    "payment_terms": "Net 30",
    "notes": ""
  },
  "usage": { "used": 1, "limit": 3 }
}
```

**Response `200 OK` — Receipt**

```json
{
  "job_id": 2,
  "status": "success",
  "document_type": "receipt",
  "filename": "receipt.pdf",
  "page_count": 1,
  "result": {
    "merchant": {
      "name": "Whole Foods Market",
      "address": "500 Harrison St, San Francisco, CA",
      "phone": ""
    },
    "date": "2025-01-15",
    "time": "14:32",
    "transaction_id": "TXN-12345",
    "items": [
      { "description": "Organic Whole Milk", "price": 4.99 },
      { "description": "Sourdough Bread",   "price": 6.49 }
    ],
    "subtotal": 11.48,
    "tax": 0.92,
    "total": 12.40,
    "payment_method": "Visa ***1234",
    "cashier": ""
  },
  "usage": { "used": 2, "limit": 3 }
}
```

**Errors:** `400` bad request · `401` invalid key · `402` limit reached · `403` revoked · `413` >20 MB · `415` not a PDF · `422` no file/url · `502` LLM failed

---

### GET /health

```bash
curl https://pdfjson.inksky.net/health
# → { "status": "ok" }
```

---

### GET /billing/plans

Returns all pricing plans. No authentication required.

```bash
curl https://pdfjson.inksky.net/billing/plans
```

```json
{
  "plans": [
    { "tier": "free",    "name": "Free",    "price": "$0",   "monthly_limit": 3,     "features": ["3 parses/month", "Rule-based extraction", "JSON output"] },
    { "tier": "starter", "name": "Starter", "price": "$19",  "monthly_limit": 500,   "features": ["500 parses/month", "AI-powered extraction", "Email support"] },
    { "tier": "pro",     "name": "Pro",     "price": "$49",  "monthly_limit": 3000,  "features": ["3,000 parses/month", "AI-powered extraction", "Priority support"] },
    { "tier": "scale",   "name": "Scale",   "price": "$149", "monthly_limit": 20000, "features": ["20,000 parses/month", "AI-powered extraction", "SLA + priority support"] }
  ]
}
```

---

### POST /billing/checkout

Create a Stripe Checkout session to upgrade the authenticated key's tier.

```bash
curl -X POST https://pdfjson.inksky.net/billing/checkout \
  -H "Authorization: Bearer pdfa_xxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"tier": "starter"}'
```

| Field | Required | Description |
|-------|----------|-------------|
| `tier` | ✅ | `starter`, `pro`, or `scale` |
| `success_url` | No | Redirect after payment (defaults to `/billing/success`) |
| `cancel_url` | No | Redirect on cancel (defaults to `/`) |

**Response `200 OK`**

```json
{ "checkout_url": "https://checkout.stripe.com/pay/cs_live_..." }
```

Redirect the user to `checkout_url`. After payment, Stripe sends a webhook that upgrades the tier automatically.

---

### POST /billing/portal

Open the Stripe Customer Portal to manage subscription, payment method, or view invoices.

```bash
curl -X POST https://pdfjson.inksky.net/billing/portal \
  -H "Authorization: Bearer pdfa_xxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"return_url": "https://yourapp.com/dashboard"}'
```

**Response `200 OK`**

```json
{ "portal_url": "https://billing.stripe.com/session/..." }
```

---

### POST /billing/webhook

Called automatically by Stripe. **Do not call this manually.**

Handles:

- `checkout.session.completed` → upgrades the key's tier in the database
- `customer.subscription.deleted` → downgrades the key back to `free`

**Setup in Stripe Dashboard:**  
Webhooks → Add endpoint → `https://pdfjson.inksky.net/billing/webhook`  
Events to subscribe: `checkout.session.completed`, `customer.subscription.deleted`  
Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` in your environment.

---

## Response schemas

### ParseResponse (top-level fields)

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | integer | Unique job identifier |
| `status` | string | `"success"` or `"failed"` |
| `document_type` | string | `"invoice"`, `"receipt"`, or `"unknown"` |
| `filename` | string or null | Uploaded filename; `null` for URL parses |
| `page_count` | integer | Pages detected |
| `result` | object | Extracted fields (see below) |
| `usage.used` | integer | Parses consumed this month |
| `usage.limit` | integer | Monthly limit for your tier |

### Invoice result fields

| Field | Type |
|-------|------|
| `vendor.name` | string |
| `vendor.address` | string |
| `vendor.email` | string |
| `vendor.phone` | string |
| `invoice_number` | string |
| `date_issued` | string (ISO 8601) |
| `date_due` | string (ISO 8601) |
| `po_number` | string |
| `line_items[].description` | string |
| `line_items[].quantity` | number |
| `line_items[].unit_price` | number |
| `line_items[].total` | number |
| `subtotal` | number |
| `tax` | number |
| `discount` | number |
| `total` | number |
| `currency` | string (ISO 4217) |
| `payment_terms` | string |
| `notes` | string |

### Receipt result fields

| Field | Type |
|-------|------|
| `merchant.name` | string |
| `merchant.address` | string |
| `merchant.phone` | string |
| `date` | string (ISO 8601) |
| `time` | string |
| `transaction_id` | string |
| `items[].description` | string |
| `items[].price` | number |
| `subtotal` | number |
| `tax` | number |
| `total` | number |
| `payment_method` | string |
| `cashier` | string |

---

## Error codes

All errors return:

```json
{ "detail": "Human-readable error message" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request (empty file, invalid URL, network error on URL fetch) |
| `401` | Missing or invalid `Authorization` header / API key |
| `402` | Monthly parse limit reached — upgrade at `/billing/checkout` |
| `403` | API key has been revoked |
| `413` | File exceeds 20 MB |
| `415` | File is not a PDF (failed magic bytes `%PDF` check) |
| `422` | Validation error (no file or URL, malformed request body) |
| `429` | Rate limit exceeded (demo: 5/day per IP) |
| `502` | Upstream LLM inference failed |
| `503` | Billing not configured (Stripe keys missing) |

---

## Security & privacy

| Guarantee | Implementation |
|-----------|---------------|
| **Zero data retention** | PDF bytes held in memory only; `del pdf_bytes` called in `finally` on every request — nothing is written to disk |
| **No content logging** | Request metadata logged (timestamp, IP, tier, page count) but document contents are never logged or stored |
| **TLS enforced** | HSTS header (`max-age=31536000; includeSubDomains`) — browsers always upgrade to HTTPS |
| **Hashed API keys** | Raw keys SHA-256 hashed before DB storage — a compromised database exposes no usable keys |
| **SSRF protection** | URL inputs have hostname DNS-resolved before fetch; private IP ranges rejected (`127.x`, `10.x`, `192.168.x`, `169.254.x`, `::1`, etc.) |
| **PDF validation** | Magic bytes (`%PDF`) checked before any processing — non-PDF payloads rejected immediately |
| **Security headers** | Every response includes: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| **Rate limiting** | Per-IP on `/demo` (5/day); monthly quota per key on `/parse` |
| **Restricted CORS** | `GET`, `POST`, `DELETE` only; explicit allowed headers |
| **Redirect cap** | Max 3 redirects on URL-mode fetches |

---

## Pricing tiers

| Tier | Price | Parses/month | Extraction |
|------|-------|-------------|------------|
| Free | $0 | 3 | Rule-based (regex) |
| Starter | $19/mo | 500 | AI-powered |
| Pro | $49/mo | 3,000 | AI-powered |
| Scale | $149/mo | 20,000 | AI-powered |

- Parses reset on the 1st of each calendar month (UTC)
- Upgrade: `POST /billing/checkout`
- Manage/cancel: `POST /billing/portal`
- Need >20,000/month? Email hi@pdfapi.dev

---

## Rate limits

| Endpoint | Limit |
|----------|-------|
| `POST /demo` | 5 per IP per day |
| `POST /parse` | Monthly quota by tier |
| All others | No hard limit |

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ | — | Groq API key for LLM inference. Get one free at [console.groq.com/keys](https://console.groq.com/keys) — no credit card required |
| `SECRET_KEY` | ✅ | `dev-secret-...` | Long random secret. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | No | SQLite | Defaults to `sqlite+aiosqlite:///./pdfapi.db`. Set a PostgreSQL URL on Railway — `postgres://` scheme auto-converted |
| `APP_URL` | No | `http://localhost:8000` | Base URL, e.g. `https://pdfjson.inksky.net` |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins. Tighten in prod: `https://pdfjson.inksky.net` |
| `FREE_MONTHLY_LIMIT` | No | `3` | Parses/month on the free tier |
| `STRIPE_SECRET_KEY` | No | — | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_STARTER` | No | — | Stripe Price ID for Starter tier (`price_...`) |
| `STRIPE_PRICE_PRO` | No | — | Stripe Price ID for Pro tier |
| `STRIPE_PRICE_SCALE` | No | — | Stripe Price ID for Scale tier |

---

## Deploy to Railway

The repo includes a `Dockerfile` and `railway.json` for one-click deployment.

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → `Tavinsky1/pdfjson`
2. Railway detects the Dockerfile and builds automatically
3. Right-click canvas → **Database → Add PostgreSQL** — `DATABASE_URL` is injected automatically
4. Click your service → **Variables** and add:

```
GROQ_API_KEY=gsk_...
SECRET_KEY=<output of: python -c "import secrets; print(secrets.token_hex(32))">
APP_URL=https://pdfjson.inksky.net
CORS_ORIGINS=https://pdfjson.inksky.net
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_SCALE=price_...
```

5. **Settings → Domains → Add custom domain** → `pdfjson.inksky.net`
6. Copy the Railway CNAME (e.g. `pdfjson-production-xxxx.up.railway.app`)

### Cloudflare DNS

In Cloudflare dashboard for `inksky.net` → DNS → Add record:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `pdfjson` | `pdfjson-production-xxxx.up.railway.app` | ON (orange cloud) |

Cloudflare handles SSL and DDoS. Railway runs the Python backend.

---

## Project structure

```
pdfapi/
├── app/
│   ├── main.py                  # FastAPI app, security middleware, router registration
│   ├── core/
│   │   ├── config.py            # All settings loaded from .env (pydantic-settings)
│   │   └── auth.py              # Bearer key validation, SHA-256 hashing, monthly reset
│   ├── db/
│   │   └── database.py          # SQLAlchemy async engine + session factory
│   ├── models/
│   │   ├── db.py                # ORM models: ApiKey, ParseJob
│   │   └── schemas.py           # Pydantic request/response schemas
│   ├── services/
│   │   ├── extractor.py         # PDF → plain text (pdfplumber + PyMuPDF fallback)
│   │   └── ai_parser.py         # Plain text → structured JSON (LLM + rule-based fallback)
│   ├── api/routes/
│   │   ├── health.py            # GET / (landing page), GET /health
│   │   ├── keys.py              # POST /keys, GET /keys/usage, DELETE /keys/me
│   │   ├── parse.py             # POST /demo, POST /parse
│   │   └── billing.py           # GET /billing/plans, POST /billing/checkout,
│   │                            # POST /billing/portal, POST /billing/webhook
│   └── static/
│       └── index.html           # Landing page with live demo (served at GET /)
├── tests/
│   ├── conftest.py              # Shared fixtures: in-memory SQLite, async test client
│   ├── test_keys.py             # Key creation, usage, revocation, limit enforcement
│   └── test_parse.py            # Parse flow tests (LLM mocked, no network calls)
├── Dockerfile                   # python:3.12-slim + libgl1 for PyMuPDF
├── railway.json                 # Railway build + deploy config (healthcheck, restart policy)
├── requirements.txt
├── .env.example                 # Template with all environment variables documented
├── pytest.ini                   # asyncio_mode=auto, pythonpath=.
├── main.py                      # Entry point: uvicorn app.main:app
└── smoke_test.py                # Manual end-to-end test script
```

### Key design decisions

| Decision | Reason |
|----------|--------|
| Two PDF extractors | `pdfplumber` handles tables well; `PyMuPDF` is faster and catches complex layouts pdfplumber misses |
| LLM + rule-based fallback | LLM gives near-100% accuracy on arbitrary layouts; regex handles cases where inference fails or no token is configured |
| SQLite default → PostgreSQL in prod | Zero-config for local dev; `DATABASE_URL` scheme auto-converted to asyncpg on Railway |
| In-memory rate limiting | No Redis dependency for MVP |
| SHA-256 key hashing | Raw keys never stored; hash recomputed on each request for DB lookup |
| `finally: del pdf_bytes` | Guarantees document content is released even if parsing raises an exception |

---

## Running tests

```bash
# From pdfapi/ with venv active:
pytest tests/ -v
```

Expected output:

```
tests/test_keys.py::test_create_key              PASSED
tests/test_keys.py::test_get_usage               PASSED
tests/test_keys.py::test_invalid_key_returns_401 PASSED
tests/test_keys.py::test_revoke_key              PASSED
tests/test_keys.py::test_usage_limit_enforced    PASSED
tests/test_parse.py::test_parse_file_upload      PASSED
tests/test_parse.py::test_parse_increments_usage PASSED
tests/test_parse.py::test_parse_no_auth          PASSED
tests/test_parse.py::test_parse_limit_reached    PASSED
9 passed
```

LLM calls and PDF extraction are mocked — no network calls or real PDFs needed.
