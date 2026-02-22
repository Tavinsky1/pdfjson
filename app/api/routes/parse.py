"""
POST /parse — core endpoint.

Accepts:
  - multipart file upload  (field name: "file")
  - OR json body           {"url": "https://..."}

Returns ParseResponse JSON.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from collections import defaultdict

from app.core.auth import get_current_key
from app.core.config import settings
from app.db.database import get_db
from app.models.db import ApiKey, ParseJob
from app.models.schemas import ParseResponse
from app.services import extractor, ai_parser

log = logging.getLogger(__name__)
router = APIRouter()

_MAX_BYTES = settings.max_upload_mb * 1024 * 1024

# ── In-memory IP rate limit for /demo (resets on server restart) ──
# { "ip": (count, date_str) }
_demo_hits: dict[str, tuple[int, str]] = defaultdict(lambda: (0, ""))
_DEMO_LIMIT = 5  # tries per IP per day


@router.post("/demo", summary="Try PDF parsing — no key required", tags=["parse"])
async def demo_parse(
    request: Request,
    file: UploadFile = File(..., description="PDF file to parse (max 20 MB)"),
):
    """
    No API key needed. Upload a PDF, get back JSON instantly.
    Rate-limited to 5 attempts per IP per day.
    To parse more, create a free key with POST /keys.
    """
    ip = request.client.host if request.client else "unknown"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    count, last_day = _demo_hits[ip]
    if last_day != today:
        count = 0
    if count >= _DEMO_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Demo limit reached ({_DEMO_LIMIT}/day per IP). Create a free API key at POST /keys to continue.",
        )
    _demo_hits[ip] = (count + 1, today)

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(pdf_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB limit.")
    # Validate PDF magic bytes — reject anything that isn't a real PDF
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="File is not a valid PDF (missing %PDF header).")

    # ── Process in-memory. pdf_bytes is never written to disk. ───────────────
    try:
        extracted = extractor.extract(pdf_bytes)
        doc_type, result_dict = await ai_parser.parse(extracted)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse document: {exc}") from exc
    finally:
        # Explicitly release reference — no retention of document content
        del pdf_bytes

    remaining = _DEMO_LIMIT - _demo_hits[ip][0]
    return {
        "document_type": doc_type,
        "result": result_dict,
        "demo": True,
        "demo_remaining_today": remaining,
        "upgrade": "Create a free key at POST /keys for 3 parses/month, or see /billing/plans to upgrade.",
    }


@router.post("/parse", response_model=ParseResponse, summary="Parse a PDF to structured JSON")
async def parse_pdf(
    file: Optional[UploadFile] = File(None, description="PDF file (max 20 MB)"),
    url: Optional[str] = Form(None, description="Public URL to a PDF"),
    key_row: ApiKey = Depends(get_current_key),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a PDF as a multipart file OR provide a `url` pointing to one.
    Returns structured JSON based on the detected document type.
    """
    # ── 1. Get PDF bytes ──────────────────────────────────────
    filename: Optional[str] = None

    if file is not None:
        filename = file.filename
        pdf_bytes = await file.read()
        if len(pdf_bytes) > _MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds the {settings.max_upload_mb} MB limit.",
            )
    elif url:
        pdf_bytes, filename = await _fetch_url(url)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide either a 'file' upload or a 'url' field.",
        )

    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file received.")    # Validate PDF magic bytes — reject non-PDF payloads before doing any work
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="File is not a valid PDF (missing %PDF header).")
    # ── 2. Create job row ─────────────────────────────────────
    job = ParseJob(api_key_id=key_row.id, filename=filename, source_url=url, status="pending")
    db.add(job)
    await db.flush()  # get job.id without committing

    # ── 3. Extract text from PDF ──────────────────────────────
    try:
        extracted = extractor.extract(pdf_bytes)
    except ValueError as exc:
        job.status = "failed"
        job.error_message = str(exc)
        await db.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job.page_count = extracted.pages

    if extracted.needs_ocr:
        # For now, continue with whatever little text we have and mark it degraded.
        # Phase 3 will add real OCR.
        log.warning("Job %s: PDF appears scanned — OCR not yet implemented", job.id)

    # ── 4. AI extraction ──────────────────────────────────────
    try:
        doc_type, result_dict = await ai_parser.parse(extracted)
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)
        await db.commit()
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {exc}") from exc
    finally:
        # Explicitly release — document content is never retained beyond this scope
        del pdf_bytes

    # ── 5. Persist result + bump usage ────────────────────────
    job.status = "success"
    job.document_type = doc_type
    job.result_json = json.dumps(result_dict)
    job.completed_at = datetime.now(timezone.utc)

    key_row.usage_count = (key_row.usage_count or 0) + 1
    await db.commit()

    limit = settings.tier_limits.get(key_row.tier, settings.free_monthly_limit)

    return ParseResponse(
        job_id=job.id,
        status="success",
        document_type=doc_type,
        filename=filename,
        page_count=extracted.pages,
        result=result_dict,
        usage={"used": key_row.usage_count, "limit": limit},
    )


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

# Private/reserved IP ranges blocked to prevent SSRF
_BLOCKED_PREFIXES = (
    "127.", "10.", "0.", "169.254.",  # loopback, private, link-local
    "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
    "172.30.", "172.31.", "::1", "fc", "fd",
)


async def _fetch_url(url: str) -> tuple[bytes, Optional[str]]:
    """Download a PDF from a public URL. Returns (bytes, filename)."""
    import socket
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    # SSRF protection: resolve hostname, block private ranges
    try:
        from urllib.parse import urlparse
        hostname = urlparse(url).hostname or ""
        resolved_ip = socket.gethostbyname(hostname)
        if any(resolved_ip.startswith(p) or resolved_ip.lower().startswith(p) for p in _BLOCKED_PREFIXES):
            raise HTTPException(status_code=400, detail="URL resolves to a private/reserved address.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not resolve URL hostname.")

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, max_redirects=3) as client:
            resp = await client.get(url)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {exc}") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=400, detail=f"Network error fetching URL: {exc}") from exc

    pdf_bytes = resp.content
    if len(pdf_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Remote file exceeds the {settings.max_upload_mb} MB limit.",
        )

    # Try to guess filename from URL path
    path = url.split("?")[0]
    filename = path.split("/")[-1] or None
    return pdf_bytes, filename
