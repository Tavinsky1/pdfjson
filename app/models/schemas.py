"""
Pydantic schemas for API request/response validation.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, EmailStr, Field


# ─────────────────────────────────────────────────────────────
# Shared
# ─────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str


# ─────────────────────────────────────────────────────────────
# API Keys
# ─────────────────────────────────────────────────────────────

class CreateKeyRequest(BaseModel):
    email: EmailStr
    label: Optional[str] = Field(None, max_length=100)


class CreateKeyResponse(BaseModel):
    key: str = Field(..., description="Your API key. Store it safely — shown only once.")
    label: Optional[str]
    email: str
    tier: str
    monthly_limit: int
    created_at: datetime


class KeyUsageResponse(BaseModel):
    label: Optional[str]
    email: Optional[str]
    tier: str
    usage_count: int
    monthly_limit: int
    usage_reset_at: Optional[datetime]
    revoked: bool


# ─────────────────────────────────────────────────────────────
# Parse — extracted document structures
# ─────────────────────────────────────────────────────────────

class VendorInfo(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    tax_id: Optional[str] = None


class LineItem(BaseModel):
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None


class InvoiceResult(BaseModel):
    document_type: str = "invoice"
    vendor: Optional[VendorInfo] = None
    buyer: Optional[VendorInfo] = None
    invoice_number: Optional[str] = None
    date_issued: Optional[str] = None
    date_due: Optional[str] = None
    po_number: Optional[str] = None
    line_items: list[LineItem] = []
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    discount: Optional[float] = None
    total: Optional[float] = None
    currency: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class ReceiptItem(BaseModel):
    description: Optional[str] = None
    quantity: Optional[float] = None
    price: Optional[float] = None


class ReceiptResult(BaseModel):
    document_type: str = "receipt"
    merchant: Optional[VendorInfo] = None
    date: Optional[str] = None
    time: Optional[str] = None
    items: list[ReceiptItem] = []
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    tip: Optional[float] = None
    total: Optional[float] = None
    currency: Optional[str] = None
    payment_method: Optional[str] = None


class GenericResult(BaseModel):
    document_type: str = "unknown"
    title: Optional[str] = None
    raw_text: Optional[str] = None
    key_values: dict[str, str] = {}
    tables: list[list[list[str]]] = []


# ─────────────────────────────────────────────────────────────
# Parse — API response envelope
# ─────────────────────────────────────────────────────────────

class ParseResponse(BaseModel):
    job_id: int
    status: str
    document_type: str
    filename: Optional[str]
    page_count: Optional[int]
    result: Any  # InvoiceResult | ReceiptResult | GenericResult
    usage: dict[str, int]  # {"used": 3, "limit": 50}
