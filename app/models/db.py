from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # key_hash: SHA-256 of the raw key — never store raw keys
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(254), nullable=True, index=True)

    # Billing
    tier: Mapped[str] = mapped_column(String(20), default="free", nullable=False)
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Usage
    usage_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    usage_reset_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # State
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # Relationships
    parse_jobs: Mapped[list["ParseJob"]] = relationship("ParseJob", back_populates="api_key")


class ParseJob(Base):
    __tablename__ = "parse_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key_id: Mapped[int] = mapped_column(Integer, ForeignKey("api_keys.id"), nullable=False)

    # Input
    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Output
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )  # pending | success | failed
    document_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    result_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # serialized JSON
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timing
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    api_key: Mapped["ApiKey"] = relationship("ApiKey", back_populates="parse_jobs")
