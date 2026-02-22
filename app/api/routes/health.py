from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from app.db.database import AsyncSessionLocal

router = APIRouter()

_HTML = (Path(__file__).parent.parent.parent / "static" / "index.html").read_text()


@router.get("/health", tags=["meta"], summary="Health check")
async def health():
    """Returns 200 if the API and database are reachable."""
    db_ok = False
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        pass

    return {"status": "ok" if db_ok else "degraded", "database": db_ok}


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root():
    return HTMLResponse(content=_HTML)
