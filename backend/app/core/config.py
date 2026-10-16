"""Load environment/.env settings and validate provider, persistence, request-budget and production security
invariants. Settings are process-cached; changing configuration requires restarting consumers.
"""

import json
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables.

    Keep secrets out of source control. The defaults are safe for local
    development only; production must provide secrets and deployment URLs
    explicitly.
    """

    app_name: str = "SupportDeflect AI"
    environment: str = "local"
    debug: bool = True
    docs_enabled: bool = True
    init_database_on_startup: bool = False
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
    enforce_trusted_hosts: bool = False
    trusted_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "*.localhost"])

    secret_key: str = "CHANGE_ME_WITH_A_LONG_RANDOM_SECRET"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    groq_api_key: str | None = None
    groq_model: str = ""
    llm_provider: str = "groq"  # mock is reserved for explicit test environments
    groq_timeout_seconds: float = Field(default=30, ge=1, le=120)
    groq_max_tokens: int = Field(default=2048, ge=256, le=4096)
    # Optional: omit this parameter for models without configurable reasoning.
    groq_reasoning_effort: Literal["", "low", "medium", "high"] = ""

    embedding_provider: str = "sentence-transformers"  # sentence-transformers | fake
    embedding_model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_dimension: int = Field(default=384, ge=384, le=384)
    allow_fake_embeddings_fallback: bool = False

    vector_provider: str = "database"  # memory is reserved for tests

    chunk_size: int = Field(default=900, ge=100, le=10000)
    chunk_overlap: int = Field(default=150, ge=0)
    retrieval_top_k: int = Field(default=5, ge=1, le=20)
    retrieval_candidate_limit: int = Field(default=200, ge=20, le=1000)
    rag_context_max_chars: int = Field(default=10000, ge=2000, le=40000)
    rag_history_max_chars: int = Field(default=4000, ge=0, le=12000)
    # Legacy environment compatibility. Cosine similarity is not an answer-confidence probability.
    min_confidence_score: float = Field(default=0.35, ge=0, le=1)

    ingestion_mode: str = "queued"  # queued | inline
    ingestion_worker_poll_seconds: float = 2.0
    ingestion_job_max_attempts: int = 3

    max_upload_bytes: int = 10 * 1024 * 1024
    widget_assets_directory: str = "./data/widget-assets"
    widget_logo_max_bytes: int = 2 * 1024 * 1024
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
    url_max_redirects: int = 5
    url_max_bytes: int = 10 * 1024 * 1024

    rate_limit_provider: str = "database"  # database | memory
    widget_rate_limit_per_minute: int = 20
    admin_rate_limit_per_minute: int = 120
    default_widget_brand_name: str = "SupportDeflect AI"
    default_widget_primary_color: str = "#2563eb"
    default_widget_greeting: str = "Hi! Ask me anything about this product."

    superadmin_email: str | None = None
    superadmin_password: str | None = None
    superadmin_name: str = "Platform Administrator"
    mailer_service_token: str | None = None
    mail_from: str = "dhiaayed03@gmail.com"
    billing_currency: str = "EUR"
    mail_daily_limit: int = Field(default=400, ge=1, le=2000)

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
        """Convert a JSON-array or comma-separated environment string into a list; leave existing typed values
        unchanged for Pydantic validation. Invalid JSON raises a settings validation error.
        """
        if isinstance(value, str):
            if value.strip().startswith("["):
                return json.loads(value)
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, value: Any) -> Any:
        """Interpret deployment words such as production/local as debug booleans; delegate other values to
        Pydantic's normal boolean validation.
        """
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
        """Reuse list parsing for TRUSTED_HOSTS so Compose CSV values and JSON environment arrays share one
        contract.
        """
        return cls.parse_csv_list(value)

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        # Chunking must advance; the persisted pgvector schema uses 384 dimensions.
        """Reject incompatible chunking/providers in every environment, then enforce production secrets,
        PostgreSQL, real AI, explicit hosts/CORS and migration ownership. Return this Settings instance or raise
        ValueError; no network or database calls occur.
        """
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        if self.embedding_provider not in {"sentence-transformers", "fake"}:
            raise ValueError("Unsupported EMBEDDING_PROVIDER")
        if self.ingestion_mode not in {"queued", "inline"}:
            raise ValueError("INGESTION_MODE must be queued or inline")
        if self.rate_limit_provider not in {"database", "memory"}:
            raise ValueError("Unsupported RATE_LIMIT_PROVIDER")
        if self.vector_provider not in {"database", "memory"}:
            raise ValueError("VECTOR_PROVIDER must be database (or memory for isolated tests)")
        if self.environment != "test" and self.vector_provider == "memory":
            raise ValueError("In-memory vectors are only permitted in ENVIRONMENT=test")
        if self.llm_provider not in {"groq", "mock"}:
            raise ValueError("LLM_PROVIDER must be groq (or mock in ENVIRONMENT=test)")
        if self.environment.lower() != "test" and (
            self.llm_provider == "mock" or self.embedding_provider == "fake" or self.allow_fake_embeddings_fallback
        ):
            raise ValueError("Mock LLM and fake embeddings are only permitted in ENVIRONMENT=test")
        if self.environment.lower() not in {"prod", "production"}:
            return self

        errors: list[str] = []
        if self.debug:
            errors.append("DEBUG must be false in production")
        if self.docs_enabled:
            errors.append("DOCS_ENABLED must be false in production")
        if self.secret_key.lower().startswith(("change_me", "replace")) or len(self.secret_key) < 32:
            errors.append("SECRET_KEY must be a strong production secret")
        if self.database_url.startswith("sqlite"):
            errors.append("DATABASE_URL must point to PostgreSQL in production")
        if self.init_database_on_startup:
            errors.append("INIT_DATABASE_ON_STARTUP must be false in production; use Alembic migrations")
        if self.llm_provider.lower() != "groq":
            errors.append("LLM_PROVIDER must be groq in production")
        if self.llm_provider.lower() == "groq" and not self.groq_api_key:
            errors.append("GROQ_API_KEY is required when LLM_PROVIDER=groq")
        if not self.groq_model.strip():
            errors.append("GROQ_MODEL is required in production")
        if self.embedding_provider.lower() != "sentence-transformers":
            errors.append("EMBEDDING_PROVIDER must be sentence-transformers in production")
        if self.allow_fake_embeddings_fallback:
            errors.append("ALLOW_FAKE_EMBEDDINGS_FALLBACK must be false in production")
        if self.rate_limit_provider.lower() != "database":
            errors.append("RATE_LIMIT_PROVIDER must be database in production")
        if self.vector_provider.lower() != "database":
            errors.append("VECTOR_PROVIDER must be database in production")
        if "*" in self.cors_origins:
            errors.append("CORS_ORIGINS must not contain a wildcard in production")
        if any("localhost" in origin or "127.0.0.1" in origin for origin in self.cors_origins):
            errors.append("CORS_ORIGINS must not include localhost in production")
        if not self.enforce_trusted_hosts:
            errors.append("ENFORCE_TRUSTED_HOSTS must be true in production")
        elif not self.trusted_hosts or "*" in self.trusted_hosts:
            errors.append("TRUSTED_HOSTS must be explicit when ENFORCE_TRUSTED_HOSTS is true")
        if errors:
            raise ValueError("; ".join(errors))
        return self


@lru_cache
def get_settings() -> Settings:
    """Return the cached validated Settings instance for this process. Environment or .env edits are not observed
    until cache clearing or process restart.
    """
    return Settings()
