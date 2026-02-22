from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # GitHub token for LLM inference
    github_token: str = ""

    # DB — Railway supplies DATABASE_URL as postgresql://...; we fix the scheme automatically
    database_url: str = "sqlite+aiosqlite:///./pdfapi.db"

    @field_validator("database_url", mode="before")
    @classmethod
    def fix_db_url(cls, v: str) -> str:
        """Convert Railway's postgres:// / postgresql:// to the async driver scheme."""
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    # App
    app_url: str = "http://localhost:8000"

    # Security
    secret_key: str = "dev-secret-change-in-prod"
    api_key_prefix: str = "pdfa_"
    max_upload_mb: int = 20

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_price_scale: str = ""

    # Tier limits (parses per month)
    free_monthly_limit: int = 3
    starter_monthly_limit: int = 500
    pro_monthly_limit: int = 3000
    scale_monthly_limit: int = 20000

    @property
    def ai_enabled(self) -> bool:
        """True when GitHub token is set — enables LLM-powered extraction."""
        return bool(self.github_token)

    @property
    def tier_limits(self) -> dict[str, int]:
        return {
            "free": self.free_monthly_limit,
            "starter": self.starter_monthly_limit,
            "pro": self.pro_monthly_limit,
            "scale": self.scale_monthly_limit,
        }


settings = Settings()
