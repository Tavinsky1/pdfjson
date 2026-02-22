"""
PDF text + table extractor.

Pipeline:
  1. Try pdfplumber  — best for text-based PDFs with tables.
  2. Fallback to PyMuPDF (fitz) — better at complex layouts.
  3. If both yield < 100 chars, signal that OCR is needed
     (Tesseract / cloud OCR — Phase 3).
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class ExtractedDocument:
    text: str             # full plain-text, pages separated by \n---PAGE---\n
    pages: int
    tables: list[list[list[str]]] = field(default_factory=list)
    needs_ocr: bool = False


def extract(pdf_bytes: bytes) -> ExtractedDocument:
    """
    Main entry point. Returns an ExtractedDocument.
    Raises ValueError for clearly corrupt or zero-page PDFs.
    """
    doc = _try_pdfplumber(pdf_bytes)
    if doc is not None and len(doc.text.strip()) >= 50:
        return doc

    doc = _try_pymupdf(pdf_bytes)
    if doc is not None and len(doc.text.strip()) >= 50:
        return doc

    # Both extractors returned < 50 chars — likely a scanned (image) PDF.
    if doc is not None:
        doc.needs_ocr = True
        return doc

    raise ValueError("Could not extract any text from the PDF. The file may be corrupt.")


# ─────────────────────────────────────────────────────────────
# pdfplumber backend
# ─────────────────────────────────────────────────────────────

def _try_pdfplumber(pdf_bytes: bytes) -> ExtractedDocument | None:
    try:
        import pdfplumber  # type: ignore

        all_text: list[str] = []
        all_tables: list[list[list[str]]] = []

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            page_count = len(pdf.pages)
            if page_count == 0:
                return None

            for page in pdf.pages:
                # Extract text (preserves rough layout)
                page_text = page.extract_text(x_tolerance=3, y_tolerance=3) or ""
                all_text.append(page_text)

                # Extract tables
                for table in page.extract_tables():
                    # Normalise: replace None cells with ""
                    cleaned = [
                        [str(cell) if cell is not None else "" for cell in row]
                        for row in table
                        if any(cell for cell in row)  # drop fully-empty rows
                    ]
                    if cleaned:
                        all_tables.append(cleaned)

        return ExtractedDocument(
            text="\n---PAGE---\n".join(all_text),
            pages=page_count,
            tables=all_tables,
        )

    except Exception as exc:  # noqa: BLE001
        log.warning("pdfplumber extraction failed: %s", exc)
        return None


# ─────────────────────────────────────────────────────────────
# PyMuPDF (fitz) backend
# ─────────────────────────────────────────────────────────────

def _try_pymupdf(pdf_bytes: bytes) -> ExtractedDocument | None:
    try:
        import fitz  # type: ignore  (PyMuPDF)

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = doc.page_count
        if page_count == 0:
            return None

        all_text: list[str] = []
        for page in doc:
            all_text.append(page.get_text("text"))

        doc.close()

        return ExtractedDocument(
            text="\n---PAGE---\n".join(all_text),
            pages=page_count,
            tables=[],  # PyMuPDF table extraction is more complex; skip for now
        )

    except Exception as exc:  # noqa: BLE001
        log.warning("PyMuPDF extraction failed: %s", exc)
        return None
