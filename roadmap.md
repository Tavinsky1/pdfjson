# PDF → JSON API — Roadmap

## What This Is
A dead-simple REST API for developers. POST a PDF (invoice, receipt, contract) and get back clean,
structured JSON. No GUI. No zone-drawing. No configuration. Just a key and an endpoint.

---

## Business Model
| Tier       | Price   | Parses/mo | Notes                        |
|------------|---------|-----------|------------------------------|
| Free       | $0      | 50        | Key required, watermarked    |
| Starter    | $19/mo  | 500       | Email alerts on errors       |
| Pro        | $49/mo  | 3,000     | Webhook callbacks, priority  |
| Scale      | $149/mo | 20,000    | Dedicated queue, SLA         |

Monetization: Stripe. No trials — free tier IS the trial.

---

## Target Users
1. Freelancers and indie devs building expense/invoice tools
2. Small accounting app makers
3. Anyone processing receipts, contracts, or reports programmatically

---

## MVP Scope (Week 1-2)

### Core Endpoint
- `POST /parse` — accepts a PDF file or URL, returns JSON
- Auto-detects document type: invoice, receipt, ID, contract, "unknown"
- Extracts common fields per type (see schemas below)

### Auth
- API key in `Authorization: Bearer <key>` header
- Keys generated on signup (web form, no OAuth for now)
- Usage counter per key, blocked when limit exceeded

### Infrastructure
- FastAPI + Uvicorn
- SQLite (dev) → PostgreSQL (prod)
- OpenAI GPT-4o-mini for extraction (cheap, fast, accurate)
- pdfplumber for text extraction (fallback: PyMuPDF for scanned PDFs via OCR)
- Redis for rate limiting (optional, can fake with DB for MVP)

---

## JSON Output Schemas

### Invoice
```json
{
  "document_type": "invoice",
  "vendor": { "name": "Acme Corp", "address": "123 Main St", "email": "billing@acme.com" },
  "buyer": { "name": "John Doe", "address": "456 Oak Ave" },
  "invoice_number": "INV-2024-001",
  "date_issued": "2024-01-15",
  "date_due": "2024-02-15",
  "line_items": [
    { "description": "Web Design", "quantity": 1, "unit_price": 1500.00, "total": 1500.00 }
  ],
  "subtotal": 1500.00,
  "tax": 150.00,
  "total": 1650.00,
  "currency": "USD",
  "notes": "Net 30"
}
```

### Receipt
```json
{
  "document_type": "receipt",
  "merchant": { "name": "Whole Foods", "address": "789 Market St" },
  "date": "2024-01-15",
  "items": [
    { "description": "Organic Milk", "price": 4.99 }
  ],
  "subtotal": 4.99,
  "tax": 0.41,
  "total": 5.40,
  "payment_method": "Visa ***1234",
  "currency": "USD"
}
```

### Generic (catch-all)
```json
{
  "document_type": "unknown",
  "title": "Q4 Report",
  "raw_text": "...",
  "key_values": { "Date": "2024-01-15", "Author": "Jane Smith" },
  "tables": [ [["Header1", "Header2"], ["val1", "val2"]] ]
}
```

---

## Phase 1 — MVP (Week 1-2)
- [ ] FastAPI app skeleton
- [ ] `POST /parse` accepts file upload + URL
- [ ] pdfplumber text extraction
- [ ] OpenAI extraction with structured output / JSON mode
- [ ] API key generation + SQLite storage
- [ ] Usage tracking (increment on each call)
- [ ] Block calls when usage limit exceeded
- [ ] `GET /usage` — show current usage for a key
- [ ] `POST /keys` — create a new key (internal use for now)
- [ ] Basic error handling (corrupt PDF, no text, over limit)
- [ ] Deployment: Railway or Fly.io (Dockerfile included)

## Phase 2 — Billing (Week 3)
- [ ] Stripe Checkout integration (hosted billing page)
- [ ] Webhook: `invoice.payment_succeeded` → bump key limit
- [ ] Webhook: `customer.subscription.deleted` → downgrade key
- [ ] Simple landing page (HTML/Tailwind, no framework)
- [ ] Signup form (email + stripe) → generate key → send by email
- [ ] Customer portal link via Stripe

## Phase 3 — Reliability + Features (Week 4-5)
- [ ] Webhook callback: `POST <user_url>` with result when async
- [ ] Async mode: `POST /parse?async=true` → returns job ID, polls `GET /jobs/<id>`
- [ ] OCR fallback for scanned PDFs (Tesseract or AWS Textract)
- [ ] Confidence scores per extracted field
- [ ] Retry logic + dead-letter queue
- [ ] Rate limiting per key (req/min cap)
- [ ] Postgres migration via Alembic

## Phase 4 — Growth (Week 6+)
- [ ] Landing page SEO: target "pdf to json api", "parse invoice api"
- [ ] Python SDK (pip install pdfapi-client)
- [ ] Node.js SDK
- [ ] Postman collection published
- [ ] Product Hunt launch
- [ ] Write dev tutorials (dev.to, HN Show HN)

---

## Key Technical Decisions
| Decision | Choice | Reason |
|---|---|---|
| Language | Python | Best PDF + AI library ecosystem |
| Framework | FastAPI | Async, OpenAPI auto-docs, fast to build |
| PDF extraction | pdfplumber | Better table/layout handling than PyPDF2 |
| AI model | GPT-4o-mini | $0.15/1M tokens, fast, accurate JSON |
| DB (dev) | SQLite | Zero setup, migrate later |
| DB (prod) | PostgreSQL | Via Railway or Supabase |
| Auth | Bearer API key | Simplest DX for developers |
| Billing | Stripe | Standard, trusted |
| Hosting | Railway | $5/mo, git push deploy, easy env vars |

---

## Pricing Math (to break even)
- OpenAI GPT-4o-mini cost: ~$0.001 per average PDF
- At 3,000 parses/mo (Pro plan, $49): costs ~$3 in AI tokens
- Gross margin: ~94%
- Need 3 Starter customers ($19 × 3 = $57) to cover Railway hosting + domain
