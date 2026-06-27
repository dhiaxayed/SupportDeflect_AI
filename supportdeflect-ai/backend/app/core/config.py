from functools import lru_cache
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables.

    Keep secrets out of source control. The defaults are safe for local
    development only; production must provide SECRET_KEY, DATABASE_URL and
    GROQ_API_KEY explicitly.
    """

    app_name: str = "SupportDeflect AI"
    environment: str = "local"
    debug: bool = True
    docs_enabled: bool = True
    init_database_on_startup: bool = True
    api_v1_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./supportdeflect.db"
    frontend_url: str = "http://localhost:5173"
    backend_public_url: str = "http://localhost:8000"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://localhost:8000",
        ]
    )
    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "*.localhost"])

    secret_key: str = "CHANGE_ME_WITH_A_LONG_RANDOM_SECRET"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    llm_provider: str = "groq"  # groq | mock

    embedding_provider: str = "sentence-transformers"  # sentence-transformers | fake
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384
    allow_fake_embeddings_fallback: bool = True

    vector_provider: str = "database"  # database | memory | chroma
    chroma_persist_directory: str = "./.chroma"
    vector_collection_name: str = "supportdeflect_chunks"

    chunk_size: int = 900
    chunk_overlap: int = 150
    retrieval_top_k: int = 5
    min_confidence_score: float = 0.35

    ingestion_mode: str = "queued"  # queued | inline
    ingestion_worker_poll_seconds: float = 2.0
    ingestion_job_max_attempts: int = 3

    max_upload_bytes: int = 10 * 1024 * 1024
    allowed_upload_mime_types: list[str] = Field(
        default_factory=lambda: [
            "application/pdf",
            "text/plain",
            "text/markdown",
            "text/x-markdown",
            "application/octet-stream",
        ]
    )
    request_timeout_seconds: float = 20.0

    rate_limit_provider: str = "database"  # database | memory
    widget_rate_limit_per_minute: int = 20
    admin_rate_limit_per_minute: int = 120
    default_widget_brand_name: str = "SupportDeflect AI"
    default_widget_primary_color: str = "#2563eb"
    default_widget_greeting: str = "Hi! Ask me anything about this product."

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        enable_decoding=False,
    )

    @field_validator("cors_origins", "allowed_upload_mime_types", mode="before")
    @classmethod
    def parse_csv_list(cls, value: Any) -> Any:
        if isinstance(value, str):
            if value.strip().startswith("["):
                return value
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value: Any) -> Any:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production"}:
                return False
            if normalized in {"debug", "dev", "development", "local"}:
                return True
        return value

    @field_validator("trusted_hosts", mode="before")
    @classmethod
    def parse_trusted_hosts(cls, value: Any) -> Any:
        return cls.parse_csv_list(value)

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.environment.lower() not in {"prod", "production"}:
            return self

        errors: list[str] = []
        if self.debug:
            errors.append("DEBUG must be false in production")
        if self.docs_enabled:
            errors.append("DOCS_ENABLED must be false in production")
        if self.secret_key == "CHANGE_ME_WITH_A_LONG_RANDOM_SECRET" or len(self.secret_key) < 32:
            errors.append("SECRET_KEY must be a strong production secret")
        if self.database_url.startswith("sqlite"):
            errors.append("DATABASE_URL must point to PostgreSQL/Neon in production")
        if self.llm_provider.lower() == "groq" and not self.groq_api_key:
            errors.append("GROQ_API_KEY is required when LLM_PROVIDER=groq")
        if self.embedding_provider.lower() != "sentence-transformers":
            errors.append("EMBEDDING_PROVIDER must be sentence-transformers in production")
        if self.allow_fake_embeddings_fallback:
            errors.append("ALLOW_FAKE_EMBEDDINGS_FALLBACK must be false in production")
        if self.rate_limit_provider.lower() != "database":
            errors.append("RATE_LIMIT_PROVIDER must be database in production")
        if any("localhost" in origin or "127.0.0.1" in origin for origin in self.cors_origins):
            errors.append("CORS_ORIGINS must not include localhost in production")
        if not self.trusted_hosts or "*" in self.trusted_hosts:
            errors.append("TRUSTED_HOSTS must be explicit in production")
        if errors:
            raise ValueError("; ".join(errors))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
