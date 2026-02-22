from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.db.database import init_db
from app.api.routes import parse, keys, health, billing


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create DB tables
    await init_db()
    yield
    # Shutdown: nothing needed for SQLite; connection pool closes automatically


# ── Security headers applied to every response ────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        # Prevent MIME-type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Block framing (clickjacking)
        response.headers["X-Frame-Options"] = "DENY"
        # Legacy XSS filter
        response.headers["X-XSS-Protection"] = "1; mode=block"
        # Strict TLS (1 year) — browser-enforced when behind HTTPS
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Content-Security-Policy — no inline scripts except our own page
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none';"
        )
        # Never send Referer to third parties
        response.headers["Referrer-Policy"] = "no-referrer"
        # Permissions policy — disable sensitive browser features
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        # Hide implementation details
        if "server" in response.headers:
            del response.headers["server"]
        response.headers["Server"] = "pdfapi"
        return response


app = FastAPI(
    title="PDF → JSON API",
    description=(
        "POST a PDF, get back clean structured JSON.\n\n"
        "**Security:** Files are processed entirely in memory and never stored.\n"
        "Your documents are discarded immediately after parsing.\n\n"
        "**Quick start:**\n"
        "1. `POST /keys` with your email → get an API key\n"
        "2. `POST /parse` with `Authorization: Bearer <key>` + a PDF file\n"
        "3. `GET /keys/usage` to check your monthly usage\n\n"
        "Full docs: https://pdfapi.dev/docs"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Order matters: SecurityHeaders wraps everything, then CORS
app.add_middleware(SecurityHeadersMiddleware)

# CORS — tighten allow_origins to your frontend domain(s) in production
_ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=False,          # credentials=True only with explicit origins
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.include_router(health.router, tags=["meta"])
app.include_router(keys.router, tags=["keys"])
app.include_router(parse.router, tags=["parse"])
app.include_router(billing.router)
