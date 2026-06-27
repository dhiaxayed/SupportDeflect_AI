from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator


class OrganizationOut(BaseModel):
    id: str
    public_id: str
    name: str
    widget_brand_name: str
    widget_primary_color: str
    widget_greeting: str
    support_email: str | None = None
    strict_mode: bool
    allowed_domains: list[str]
    subscription_plan: str
    subscription_status: str
    trial_ends_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None = None
    role: str
    organization: OrganizationOut

    model_config = ConfigDict(from_attributes=True)


class RegisterRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    admin_email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    admin_full_name: str | None = Field(default=None, max_length=160)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SubscriptionUsageOut(BaseModel):
    plan: str
    plan_label: str
    status: str
    trial_ends_at: str | None = None
    documents_used: int
    documents_limit: int
    chunks_used: int
    chunks_limit: int
    questions_used_30d: int
    questions_limit_30d: int
    max_upload_bytes: int
    advanced_analytics: bool
    manual_upgrade_label: str


class DocumentOut(BaseModel):
    id: str
    title: str
    source_type: str
    source: str
    mime_type: str | None = None
    status: str
    chunk_count: int
    error_message: str | None = None
    is_active: bool
    created_at: datetime
    indexed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class DocumentUrlRequest(BaseModel):
    url: HttpUrl
    title: str | None = Field(default=None, max_length=255)


class SourceOut(BaseModel):
    document_id: str
    title: str
    source: str
    chunk_index: int
    score: float
    snippet: str


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


class WidgetChatRequest(BaseModel):
    company_id: str = Field(min_length=4, max_length=80)
    visitor_id: str = Field(min_length=4, max_length=128)
    question: str = Field(min_length=2, max_length=2000)


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceOut]
    confidence_score: float
    status: Literal["resolved", "needs_human"]
    needs_human: bool


class WidgetPublicSettings(BaseModel):
    company_id: str
    brand_name: str
    primary_color: str
    greeting_message: str
    support_email: str | None = None
    strict_mode: bool


class WidgetSettingsUpdate(BaseModel):
    brand_name: str = Field(min_length=1, max_length=120)
    primary_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    greeting_message: str = Field(min_length=1, max_length=500)
    support_email: EmailStr | None = None
    strict_mode: bool = True
    allowed_domains: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            domain = item.strip().lower().replace("https://", "").replace("http://", "").strip("/")
            if not domain:
                continue
            if len(domain) > 255 or "/" in domain:
                raise ValueError("Allowed domains must be hostnames, not full URLs")
            cleaned.append(domain)
        return sorted(set(cleaned))


class AnalyticsQuestion(BaseModel):
    id: str
    question: str
    answer: str
    confidence_score: float
    status: Literal["resolved", "needs_human"]
    needs_human: bool
    channel: str
    visitor_id: str | None = None
    created_at: datetime


class DocumentUsage(BaseModel):
    document_id: str
    title: str
    count: int


class AnalyticsSummary(BaseModel):
    total_questions: int
    resolved_questions: int
    unresolved_questions: int
    resolution_rate: float
    average_confidence: float
    latest_questions: list[AnalyticsQuestion]
    unanswered_questions: list[AnalyticsQuestion]
    top_documents: list[DocumentUsage]
