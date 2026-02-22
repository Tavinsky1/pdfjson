# PDF → JSON API

A dead-simple REST API: POST a PDF, receive structured JSON.
No GUI, no zone-drawing, no configuration. Just an API key and one endpoint.

## Quick Start

### 1. Install dependencies
```bash
cd pdfapi
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — set OPENAI_API_KEY at minimum
```

### 3. Run
```bash
python main.py
# → http://localhost:8000
# → http://localhost:8000/docs   (interactive Swagger UI)
```

### 4. Create a key
```bash
curl -X POST http://localhost:8000/keys \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "label": "dev key"}'

# Response:
# { "key": "pdfa_xxxxxxxxxxxx", "tier": "free", "monthly_limit": 50, ... }
```

### 5. Parse a PDF
```bash
curl -X POST http://localhost:8000/parse \
  -H "Authorization: Bearer pdfa_xxxxxxxxxxxx" \
  -F "file=@invoice.pdf"
```

Or by URL:
```bash
curl -X POST http://localhost:8000/parse \
  -H "Authorization: Bearer pdfa_xxxxxxxxxxxx" \
  -F "url=https://example.com/invoice.pdf"
```

### 6. Check usage
```bash
curl http://localhost:8000/keys/usage \
  -H "Authorization: Bearer pdfa_xxxxxxxxxxxx"
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/keys` | None | Create a free API key |
| `GET` | `/keys/usage` | Bearer | Get usage for current key |
| `DELETE` | `/keys/me` | Bearer | Revoke current key |
| `POST` | `/parse` | Bearer | Parse a PDF → JSON |
| `GET` | `/health` | None | Health check |
| `GET` | `/docs` | None | Swagger UI |

---

## Output Examples

### Invoice
```json
{
  "document_type": "invoice",
  "vendor": { "name": "Acme Corp", "email": "billing@acme.com" },
  "invoice_number": "INV-2024-001",
  "date_issued": "2024-01-15",
  "date_due": "2024-02-15",
  "line_items": [
    { "description": "Web Design", "quantity": 1, "unit_price": 1500.00, "total": 1500.00 }
  ],
  "subtotal": 1500.00,
  "tax": 150.00,
  "total": 1650.00,
  "currency": "USD"
}
```

### Receipt
```json
{
  "document_type": "receipt",
  "merchant": { "name": "Whole Foods" },
  "date": "2024-01-15",
  "items": [{ "description": "Organic Milk", "price": 4.99 }],
  "total": 5.40,
  "payment_method": "Visa ***1234"
}
```

---

## Deploy to Railway (5 minutes)

```bash
# Install Railway CLI
npm i -g @railway/cli
railway login
railway init
railway up

# Set env vars in Railway dashboard:
# OPENAI_API_KEY, DATABASE_URL (PostgreSQL), SECRET_KEY
```

---

## Run Tests
```bash
pytest tests/ -v
```

---

## Project Structure
```
pdfapi/
├── main.py                     # Entry point (uvicorn)
├── app/
│   ├── main.py                 # FastAPI app + lifespan
│   ├── core/
│   │   ├── config.py           # Settings from .env
│   │   └── auth.py             # Bearer key validation
│   ├── db/
│   │   └── database.py         # SQLAlchemy async engine + session
│   ├── models/
│   │   ├── db.py               # ORM models (ApiKey, ParseJob)
│   │   └── schemas.py          # Pydantic request/response schemas
│   ├── services/
│   │   ├── extractor.py        # PDF → plain text (pdfplumber + PyMuPDF)
│   │   └── ai_parser.py        # Plain text → JSON (OpenAI GPT-4o-mini)
│   └── api/routes/
│       ├── parse.py            # POST /parse
│       ├── keys.py             # POST /keys, GET /keys/usage, DELETE /keys/me
│       └── health.py           # GET /health
├── tests/
│   ├── conftest.py             # Shared fixtures (in-memory DB, test client)
│   ├── test_keys.py            # Key CRUD tests
│   └── test_parse.py           # Parse flow tests (OpenAI mocked)
├── Dockerfile
├── requirements.txt
├── .env.example
└── roadmap.md
```
