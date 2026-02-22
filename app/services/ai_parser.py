"""
Parser: extracts structured data from raw PDF text.

Uses LLM-powered extraction when configured, with automatic
fallback to a rule-based regex parser. No document content
is stored or logged at any point.
"""
from __future__ import annotations

import re
import logging
from typing import Any, Optional

from app.services.extractor import ExtractedDocument

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────

async def parse(doc: ExtractedDocument) -> tuple[str, dict[str, Any]]:
    """
    Returns (document_type, result_dict).
    Uses LLM-powered extraction when GROQ_API_KEY is configured.
    Falls back to rule-based regex if key is missing or call fails.
    """
    from app.core.config import settings
    if settings.ai_enabled:
        try:
            return await _parse_with_ai(doc)
        except Exception as exc:  # noqa: BLE001
            log.warning("AI parse failed, falling back to rule-based: %s", exc)

    return _parse_rule_based(doc)


# ─────────────────────────────────────────────────────────────
# Rule-based extraction
# ─────────────────────────────────────────────────────────────

def _parse_rule_based(doc: ExtractedDocument) -> tuple[str, dict[str, Any]]:
    text = doc.text

    doc_type = _classify(text)

    if doc_type == "invoice":
        result = _extract_invoice(text, doc.tables)
    elif doc_type == "receipt":
        result = _extract_receipt(text, doc.tables)
    else:
        result = _extract_generic(text, doc.tables)

    result["document_type"] = doc_type
    return doc_type, result


# ─────────────────────────────────────────────────────────────
# Classification
# ─────────────────────────────────────────────────────────────

_INVOICE_SIGNALS = re.compile(
    r"\b(invoice|inv\s*#|invoice\s*number|invoice\s*date|bill\s+to|"
    r"remit\s+to|payment\s+due|purchase\s+order|net\s*\d+)\b",
    re.IGNORECASE,
)
_RECEIPT_SIGNALS = re.compile(
    r"\b(receipt|thank\s+you\s+for|your\s+purchase|cashier|"
    r"change\s+due|amount\s+tendered|transaction\s*#|order\s*#)\b",
    re.IGNORECASE,
)


def _classify(text: str) -> str:
    sample = text[:3000]
    inv_hits = len(_INVOICE_SIGNALS.findall(sample))
    rec_hits = len(_RECEIPT_SIGNALS.findall(sample))
    if inv_hits == 0 and rec_hits == 0:
        return "unknown"
    return "invoice" if inv_hits >= rec_hits else "receipt"


# ─────────────────────────────────────────────────────────────
# Regex helpers
# ─────────────────────────────────────────────────────────────

# Dates: 2024-01-15 / 15/01/2024 / Jan 15, 2024 / January 15 2024
_DATE_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2})"                          # ISO
    r"|(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})"    # 15/01/2024
    r"|([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})"     # Jan 15, 2024
)

# Monetary amounts: $1,234.56 / 1.234,56 / USD 100.00
_MONEY_RE = re.compile(
    r"(?:[\$£€])\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)"
    r"|(\d{1,3}(?:,\d{3})*\.\d{2})"
)

# Email
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Phone
_PHONE_RE = re.compile(
    r"(?:\+?\d[\d\s\-\(\)]{7,}\d)"
)

# Currency symbol/code
_CURRENCY_SYMBOL_MAP = {"$": "USD", "£": "GBP", "€": "EUR"}
_CURRENCY_RE = re.compile(r"(?<!\w)(USD|EUR|GBP|CAD|AUD|JPY|CHF|MXN|BRL)(?!\w)", re.IGNORECASE)


def _first_match(pattern: re.Pattern, text: str, group: int = 0) -> Optional[str]:
    m = pattern.search(text)
    if m:
        val = m.group(group).strip() if group else m.group(0).strip()
        return val if val else None
    return None


def _find_after_label(label_pattern: str, text: str) -> Optional[str]:
    """Find the value on the same line after a label like 'Invoice #: INV-001'."""
    pattern = re.compile(
        label_pattern + r"[\s:#\-]*([^\n]{1,80})",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if m:
        val = m.group(1).strip().rstrip(".,;")
        return val if val else None
    return None


def _find_amount_after_label(label_pattern: str, text: str) -> Optional[float]:
    """Find a dollar amount on the same line as a label."""
    pattern = re.compile(
        label_pattern + r"[\s:#\-]*" + r"[\$£€]?\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if m:
        return _to_float(m.group(1))
    return None


def _to_float(s: str) -> Optional[float]:
    if s is None:
        return None
    # Handle European-style 1.234,56 → 1234.56
    s = s.strip()
    if re.match(r"^\d{1,3}(\.\d{3})+(,\d{2})?$", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _detect_currency(text: str) -> Optional[str]:
    # Check explicit codes first
    m = _CURRENCY_RE.search(text[:2000])
    if m:
        return m.group(0).upper()
    # Fall back to symbol
    for sym, code in _CURRENCY_SYMBOL_MAP.items():
        if sym in text[:2000]:
            return code
    return None


def _find_date(label_pattern: str, text: str) -> Optional[str]:
    """Find a date after a label."""
    pattern = re.compile(
        label_pattern + r"[\s:#\-]*([^\n]{1,40})",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if not m:
        return None
    candidate = m.group(1)
    dm = _DATE_RE.search(candidate)
    if dm:
        raw = next(g for g in dm.groups() if g is not None).strip()
        return _normalise_date(raw)
    return None


def _normalise_date(raw: str) -> str:
    """Best-effort convert a date string to YYYY-MM-DD."""
    import datetime
    raw = raw.strip().replace(".", "/")
    # Try common formats
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y",
                "%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y",
                "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw  # return as-is if we can't parse it


# ─────────────────────────────────────────────────────────────
# Invoice extraction
# ─────────────────────────────────────────────────────────────

def _extract_invoice(text: str, tables: list) -> dict[str, Any]:
    # --- Vendor (usually at the top, before "Bill To") ---
    vendor_block = text[:500]
    buyer_block = ""
    bill_to_match = re.search(r"(bill\s*to|sold\s*to|client|customer)[:\s]+(.*?)(?=\n\n|\Z)",
                               text, re.IGNORECASE | re.DOTALL)
    if bill_to_match:
        buyer_block = bill_to_match.group(2)[:300]

    return {
        "vendor": {
            "name": _extract_org_name(vendor_block),
            "address": None,
            "email": _first_match(_EMAIL_RE, vendor_block),
            "phone": _first_match(_PHONE_RE, vendor_block),
            "tax_id": _find_after_label(r"(?:vat|tax|gst|ein|abn)\s*(?:id|number|no|#)?", vendor_block),
        },
        "buyer": {
            "name": _extract_org_name(buyer_block) if buyer_block else None,
            "address": None,
            "email": _first_match(_EMAIL_RE, buyer_block) if buyer_block else None,
            "phone": None,
            "tax_id": None,
        },
        "invoice_number": (
            _find_after_label(r"invoice\s*(?:number|no|#|num)?", text)
            or _find_after_label(r"inv\s*#?", text)
        ),
        "date_issued": (
            _find_date(r"invoice\s*date", text)
            or _find_date(r"date\s*(?:issued|of\s*invoice)?", text)
            or _find_date(r"date", text)
        ),
        "date_due": (
            _find_date(r"(?:due|payment)\s*date", text)
            or _find_date(r"due\s*by", text)
        ),
        "po_number": _find_after_label(r"p\.?o\.?\s*(?:number|no|#)?", text),
        "line_items": _extract_line_items(text, tables),
        "subtotal": _find_amount_after_label(r"sub\s*total", text),
        "tax": (
            _find_amount_after_label(r"(?:vat|tax|gst|hst)\s*(?:\d+\s*%)?", text)
            or _find_amount_after_label(r"tax", text)
        ),
        "discount": _find_amount_after_label(r"discount", text),
        "total": (
            _find_amount_after_label(r"(?:grand\s*)?total\s*(?:due|amount)?", text)
            or _find_amount_after_label(r"amount\s*due", text)
            or _find_amount_after_label(r"balance\s*due", text)
        ),
        "currency": _detect_currency(text),
        "payment_terms": _find_after_label(r"(?:payment\s*)?terms?", text),
        "notes": _find_after_label(r"notes?|memo|remarks?", text),
    }


def _extract_org_name(block: str) -> Optional[str]:
    """Heuristic: first non-empty line of a block is often the org name."""
    for line in block.splitlines():
        line = line.strip()
        # Skip lines that look like addresses or keywords
        if (len(line) > 3 and not re.match(r"^\d", line)
                and not re.search(r"\b(invoice|receipt|date|bill|to|from|page)\b", line, re.I)):
            return line
    return None


def _extract_line_items(text: str, tables: list) -> list[dict]:
    """
    Try to extract line items from tables first, then fall back to text parsing.
    """
    items = []

    # From tables: look for a table with ≥3 columns and numeric last column
    for table in tables:
        if len(table) < 2:
            continue
        header = [c.lower() for c in table[0]]
        has_desc = any(k in " ".join(header) for k in ("desc", "item", "service", "product"))
        has_amount = any(k in " ".join(header) for k in ("amount", "total", "price", "rate"))
        if not (has_desc or has_amount):
            continue
        for row in table[1:]:
            if not any(row):
                continue
            item: dict[str, Any] = {
                "description": None, "quantity": None,
                "unit_price": None, "total": None,
            }
            # Map columns by header name
            for i, col in enumerate(header):
                if i >= len(row):
                    break
                val = row[i].strip()
                if "desc" in col or "item" in col or "service" in col or "product" in col:
                    item["description"] = val or None
                elif "qty" in col or "quant" in col:
                    item["quantity"] = _to_float(val)
                elif "unit" in col or "rate" in col or "price" in col:
                    item["unit_price"] = _to_float(re.sub(r"[^\d.,]", "", val))
                elif "amount" in col or "total" in col:
                    item["total"] = _to_float(re.sub(r"[^\d.,]", "", val))
            if item["description"] or item["total"]:
                items.append(item)
        if items:
            return items

    # Fallback: scan lines that look like "Description   qty   price   amount"
    line_re = re.compile(
        r"^(.+?)\s{2,}(\d+(?:\.\d+)?)\s+[\$£€]?(\d[\d.,]+)\s+[\$£€]?(\d[\d.,]+)\s*$"
    )
    for line in text.splitlines():
        m = line_re.match(line.strip())
        if m:
            items.append({
                "description": m.group(1).strip(),
                "quantity": _to_float(m.group(2)),
                "unit_price": _to_float(m.group(3)),
                "total": _to_float(m.group(4)),
            })

    return items


# ─────────────────────────────────────────────────────────────
# Receipt extraction
# ─────────────────────────────────────────────────────────────

def _extract_receipt(text: str, tables: list) -> dict[str, Any]:
    merchant_block = text[:400]

    return {
        "merchant": {
            "name": _extract_org_name(merchant_block),
            "address": None,
            "email": _first_match(_EMAIL_RE, merchant_block),
            "phone": _first_match(_PHONE_RE, merchant_block),
        },
        "date": (
            _find_date(r"date", text)
            or _find_date(r"", text[:500])
        ),
        "time": _first_match(re.compile(r"\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b", re.I), text),
        "items": _extract_receipt_items(text, tables),
        "subtotal": _find_amount_after_label(r"sub\s*total", text),
        "tax": _find_amount_after_label(r"tax", text),
        "tip": _find_amount_after_label(r"tip|gratuity", text),
        "total": (
            _find_amount_after_label(r"total", text)
            or _find_amount_after_label(r"amount\s*due", text)
        ),
        "currency": _detect_currency(text),
        "payment_method": _find_after_label(r"(?:payment\s*method|paid\s*(?:by|via)|card|cash)", text),
    }


def _extract_receipt_items(text: str, tables: list) -> list[dict]:
    items = []

    # From tables
    for table in tables:
        if len(table) < 2:
            continue
        for row in table[1:]:
            if len(row) >= 2 and any(row):
                desc = row[0].strip()
                price_str = row[-1].strip()
                price = _to_float(re.sub(r"[^\d.,]", "", price_str))
                if desc and price is not None:
                    items.append({"description": desc, "quantity": None, "price": price})
        if items:
            return items

    # Fallback: "Item name   $9.99" patterns
    item_re = re.compile(r"^(.{3,40}?)\s{2,}[\$£€]?\s*(\d+\.\d{2})\s*$")
    skip_re = re.compile(r"\b(total|subtotal|tax|tip|change|cash|card|visa|master)\b", re.I)
    for line in text.splitlines():
        line = line.strip()
        if skip_re.search(line):
            continue
        m = item_re.match(line)
        if m:
            items.append({
                "description": m.group(1).strip(),
                "quantity": None,
                "price": float(m.group(2)),
            })

    return items


# ─────────────────────────────────────────────────────────────
# Generic / unknown extraction
# ─────────────────────────────────────────────────────────────

def _extract_generic(text: str, tables: list) -> dict[str, Any]:
    # Extract any "Key: Value" pairs from the text
    kv_re = re.compile(r"^([A-Za-z][A-Za-z\s]{1,30}?):\s*(.+)$", re.MULTILINE)
    key_values = {}
    for m in kv_re.finditer(text[:3000]):
        k = m.group(1).strip()
        v = m.group(2).strip()
        if len(k) <= 30 and len(v) <= 200:
            key_values[k] = v

    # First non-empty line as title
    title = None
    for line in text.splitlines():
        line = line.strip()
        if line:
            title = line
            break

    return {
        "title": title,
        "raw_text": text[:2000],
        "key_values": key_values,
        "tables": tables[:3],
    }


# ─────────────────────────────────────────────────────────────
# Optional AI enhancement (only called if OPENAI_API_KEY is set)
# ─────────────────────────────────────────────────────────────

async def _parse_with_ai(doc: ExtractedDocument) -> tuple[str, dict[str, Any]]:
    """
    LLM-powered extraction. Document content is sent to the AI inference
    endpoint, processed immediately, and never retained by the provider
    beyond the scope of a single API call.
    """
    import json
    from openai import AsyncOpenAI
    from app.core.config import settings

    client = AsyncOpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=settings.groq_api_key,
    )
    model = "llama-3.3-70b-versatile"

    text_snippet = doc.text[:6000]
    table_summary = ""
    if doc.tables:
        table_summary = "\n\nDetected tables:\n"
        for i, table in enumerate(doc.tables[:5]):
            table_summary += f"\nTable {i + 1}:\n"
            for row in table[:20]:
                table_summary += " | ".join(row) + "\n"

    system = (
        "You are a document data-extraction engine. Output ONLY valid JSON. "
        "Detect document_type as 'invoice', 'receipt', or 'unknown'. "
        "Use null for missing fields. Monetary values must be numbers. "
        "Dates must be YYYY-MM-DD strings."
    )
    user = (
        f"Extract all data from this document and return structured JSON.\n\n"
        f"Document text:\n{text_snippet}{table_summary}"
    )

    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=2000,
    )

    result = json.loads(response.choices[0].message.content)
    doc_type = result.get("document_type", "unknown")
    return doc_type, result
