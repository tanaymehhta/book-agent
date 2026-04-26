from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+psycopg://lookout:lookout@localhost:5434/lookout"
    )

    email_provider: str = Field(default="gmail")
    gmail_client_secrets: Path = Field(
        default=AGENT_ROOT / "secrets" / "gmail_client.json"
    )
    gmail_token_path: Path = Field(default=AGENT_ROOT / "secrets" / "gmail_token.json")
    # When deployed, file paths aren't writable / shipped with the image.
    # These env vars hold the JSON payloads directly and override the file paths.
    gmail_client_json: str | None = None
    gmail_token_json: str | None = None
    gmail_user_email: str = Field(default="lookoutfarm.bookings@gmail.com")

    anthropic_api_key: str | None = None
    poll_interval_seconds: int = 120
    stale_card_days: int = 14

    @field_validator("gmail_client_secrets", "gmail_token_path", mode="before")
    @classmethod
    def _resolve_agent_paths(cls, value: str | Path) -> Path:
        p = Path(value)
        return p if p.is_absolute() else (AGENT_ROOT / p)

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalize_db_url(cls, value: str) -> str:
        # Managed Postgres providers (Railway, Render, etc.) hand out
        # postgresql:// URLs. SQLAlchemy needs the explicit +psycopg driver.
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value[len("postgresql://"):]
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://"):]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
