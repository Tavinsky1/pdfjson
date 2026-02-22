"""
Tests for POST /parse.
AI extraction and PDF extraction are mocked to avoid real network calls.
"""
import io
import json
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient
from app.core.config import settings

# Minimal valid 1-page PDF (created with reportlab or just a tiny hand-crafted one)
# This base64 is a real minimal PDF with the text "Invoice #001  Total: $100.00"
MINIMAL_PDF_TEXT = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (Invoice #001  Total: $100.00) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
0000000368 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
441
%%EOF"""

MOCK_INVOICE_RESULT = {
    "document_type": "invoice",
    "vendor": {"name": "ACME Corp", "address": None, "email": None, "phone": None, "tax_id": None},
    "buyer": None,
    "invoice_number": "INV-001",
    "date_issued": "2024-01-15",
    "date_due": None,
    "po_number": None,
    "line_items": [{"description": "Services", "quantity": 1, "unit_price": 100.0, "total": 100.0}],
    "subtotal": 100.0,
    "tax": None,
    "discount": None,
    "total": 100.0,
    "currency": "USD",
    "payment_terms": None,
    "notes": None,
}


@pytest.fixture
def mock_ai_parse():
    """Stub out the OpenAI call so tests are fast and free."""
    with patch(
        "app.services.ai_parser.parse",
        new_callable=AsyncMock,
        return_value=("invoice", MOCK_INVOICE_RESULT),
    ) as mock:
        yield mock


@pytest.mark.asyncio
async def test_parse_file_upload(client: AsyncClient, mock_ai_parse):
    # Create a key first
    key_resp = await client.post("/keys", json={"email": "parse@example.com"})
    key = key_resp.json()["key"]

    resp = await client.post(
        "/parse",
        files={"file": ("invoice.pdf", io.BytesIO(MINIMAL_PDF_TEXT), "application/pdf")},
        headers={"Authorization": f"Bearer {key}"},
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "success"
    assert data["document_type"] == "invoice"
    assert data["result"]["invoice_number"] == "INV-001"
    assert data["usage"]["used"] == 1
    assert data["usage"]["limit"] == settings.free_monthly_limit


@pytest.mark.asyncio
async def test_parse_increments_usage(client: AsyncClient, mock_ai_parse):
    key_resp = await client.post("/keys", json={"email": "usage2@example.com"})
    key = key_resp.json()["key"]
    headers = {"Authorization": f"Bearer {key}"}
    file_data = {"file": ("invoice.pdf", io.BytesIO(MINIMAL_PDF_TEXT), "application/pdf")}

    # Parse twice (must stay within free_monthly_limit)
    for i in range(2):
        resp = await client.post("/parse", files=file_data, headers=headers)
        assert resp.status_code == 200

    usage_resp = await client.get("/keys/usage", headers=headers)
    assert usage_resp.json()["usage_count"] == 2


@pytest.mark.asyncio
async def test_parse_no_auth(client: AsyncClient):
    resp = await client.post(
        "/parse",
        files={"file": ("invoice.pdf", io.BytesIO(MINIMAL_PDF_TEXT), "application/pdf")},
    )
    assert resp.status_code == 403  # No auth header → HTTPBearer returns 403


@pytest.mark.asyncio
async def test_parse_no_file_or_url(client: AsyncClient, mock_ai_parse):
    key_resp = await client.post("/keys", json={"email": "empty@example.com"})
    key = key_resp.json()["key"]
    resp = await client.post("/parse", headers={"Authorization": f"Bearer {key}"})
    assert resp.status_code == 422
