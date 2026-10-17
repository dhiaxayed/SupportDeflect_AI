"""Shared HTTP input/output contracts for tenant, widget, support and platform workflows. Output models
deliberately exclude password hashes, encrypted invitations and private delivery claim tokens.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    StringConstraints,
    computed_field,
    field_validator,
)

from app.core.datetime import as_utc
from app.core.source_urls import redact_source_urls
from app.widget_design import WidgetDesign


def validate_password_bytes(value: str) -> str:
    """Return the unchanged password if its UTF-8 encoding fits bcrypt's 72-byte limit; raise ValueError before
    hashing/verification would silently truncate it.
    """
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must not exceed 72 UTF-8 bytes")
    return value


Password = Annotated[str, AfterValidator(validate_password_bytes)]
ReadableText = Annotated[str, StringConstraints(strip_whitespace=True)]
PublicSourceText = Annotated[str, AfterValidator(redact_source_urls)]


class OrganizationOut(BaseModel):
    """Safe authenticated tenant identity, widget policy and subscription summary serialized from ORM attributes;
    administrative notes and ledger details are excluded.
    """

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
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserOut(BaseModel):
    """Authenticated user response with current role/activity/reset flag and optional tenant; hashes, token
    versions and invitation secrets are never serialized.
    """

    id: str
    email: EmailStr
    full_name: str | None = None
    role: Literal["super_admin", "tenant_admin", "support_agent"]
    is_active: bool
    must_change_password: bool = False
    created_at: datetime
    organization: OrganizationOut | None = None

    model_config = ConfigDict(from_attributes=True)


class RegisterRequest(BaseModel):
    """Public self-registration input for a new tenant administrator, with bounded identity fields and bcrypt-safe
    password; it cannot select a platform role.
    """

    organization_name: str = Field(min_length=2, max_length=160)
    admin_email: EmailStr
    password: Password = Field(min_length=8, max_length=128)
    admin_full_name: str | None = Field(default=None, max_length=160)

    @field_validator("organization_name", mode="before")
    @classmethod
    def strip_organization_name(cls, value):
        """Trim string organization names before length validation; leave nonstrings for Pydantic to reject through
        its normal type contract.
        """
        return value.strip() if isinstance(value, str) else value


class LoginRequest(BaseModel):
    """Email/password authentication input; the schema bounds payloads, while login checks active identity,
    password, organization and invitation state.
    """

    email: EmailStr
    password: Password = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    """Current and replacement bcrypt-safe credentials; the new password has a twelve-character minimum and the
    route enforces difference/revocation.
    """

    current_password: Password = Field(min_length=1, max_length=128)
    new_password: Password = Field(min_length=12, max_length=128)


class TokenResponse(BaseModel):
    """Bearer token paired with its safe current user snapshot; clients use the snapshot for routing and server
    dependencies still revalidate authorization.
    """

    access_token: str
    token_type: str = "bearer"
    user: UserOut


class SubscriptionUsageOut(BaseModel):
    """Current plan/effective lifecycle and document/chunk/rolling-question usage/limits. Upload bytes and feature
    flags describe enforced capability, not billing-provider state.
    """

    plan: str
    plan_label: str
    status: str
    trial_ends_at: str | None = None
    subscription_ends_at: str | None = None
    effective_status: str
    is_active: bool
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
    """Tenant-visible knowledge metadata and sanitized indexing result; stored document text/vectors and worker
    payloads remain private.
    """

    id: str
    title: PublicSourceText
    source_type: str
    source: PublicSourceText
    mime_type: str | None = None
    status: str
    chunk_count: int
    error_message: PublicSourceText | None = None
    is_active: bool
    created_at: datetime
    indexed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class DocumentUrlRequest(BaseModel):
    """Bounded HTTP(S) URL and optional title; public-network/DNS/redirect restrictions are enforced by ingestion,
    beyond this syntactic URL validation.
    """

    url: HttpUrl = Field(max_length=1024)
    title: str | None = Field(default=None, max_length=255)


class SourceOut(BaseModel):
    """Verified retrieved passage citation with document/chunk identity, score and snippet. reference binds answer
    citations; retrieval score is not a probability of truth.
    """

    document_id: str
    title: PublicSourceText
    source: PublicSourceText
    chunk_index: int
    score: float
    snippet: PublicSourceText
    reference: int | None = None


class ChatTurn(BaseModel):
    """Bounded user/assistant conversation history item; history assists follow-up interpretation and is never
    treated as authoritative knowledge evidence.
    """

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=3000)


class ChatRequest(BaseModel):
    """Authenticated playground question trimmed to API bounds with at most eight prior turns; tenant identity
    comes from authentication rather than the body.
    """

    question: ReadableText = Field(min_length=2, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)


class WidgetChatRequest(BaseModel):
    """Legacy public widget body including company and visitor IDs plus bounded question/history; origin, company
    policy, throttles and quota remain server checks.
    """

    company_id: str = Field(min_length=4, max_length=80)
    visitor_id: str = Field(min_length=4, max_length=128)
    question: ReadableText = Field(min_length=2, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)


class WidgetChatPathRequest(BaseModel):
    """Canonical widget chat body; company identity is supplied by the URL, while visitor_id is correlation data
    rather than authenticated identity.
    """

    visitor_id: str = Field(min_length=4, max_length=128)
    question: ReadableText = Field(min_length=2, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)


class ChatResponse(BaseModel):
    """Answer, verified sources and operational outcome/reason. Provider failures carry safe error/retry hints;
    escalation may carry a scoped case capability, which must remain private.
    """

    answer: PublicSourceText
    sources: list[SourceOut]
    confidence_score: float
    status: Literal["resolved", "needs_human", "clarification_needed"]
    needs_human: bool
    reason: Literal[
        "documented_answer",
        "greeting",
        "insufficient_knowledge",
        "retrieval_unavailable",
        "llm_unavailable",
        "clarification_needed",
    ] = "documented_answer"
    error_code: str | None = None
    retry_after_seconds: int | None = Field(default=None, ge=1, le=300)
    support_case_id: str | None = None
    case_access_token: str | None = None


class VisitorCaseRequest(BaseModel):
    """Bounded visitor case capability submitted in a POST body to avoid putting the private token in normal access
    URLs.
    """

    token: str = Field(min_length=1, max_length=2048)


class WidgetPublicSettings(BaseModel):
    """Public tenant branding/behavior contract for the embed renderer; excludes host allowlists, administrative
    data and private account state.
    """

    company_id: str
    brand_name: str
    primary_color: str
    greeting_message: str
    support_email: str | None = None
    strict_mode: bool
    design: WidgetDesign = Field(default_factory=WidgetDesign)


class WidgetSettingsUpdate(BaseModel):
    """Tenant administrator widget draft with strict design, readable copy, color bounds and normalized domain
    policy; ownership/custom-logo requirements are checked before persistence.
    """

    design: WidgetDesign = Field(default_factory=WidgetDesign)
    brand_name: ReadableText = Field(min_length=1, max_length=120)
    primary_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    greeting_message: ReadableText = Field(min_length=1, max_length=500)
    support_email: EmailStr | None = None
    strict_mode: bool = True
    allowed_domains: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, value: list[str]) -> list[str]:
        """Normalize allowed HTTP(S) hostnames to sorted unique IDNA ASCII, dropping empty entries. Reject
        credentials, ports, paths, queries, fragments and malformed labels with ValueError.
        """
        cleaned: list[str] = []
        for item in value:
            value = item.strip().lower()
            if not value:
                continue
            parsed = urlsplit(value if "://" in value else f"//{value}")
            if (
                parsed.scheme not in {"", "http", "https"}
                or parsed.username
                or parsed.password
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or parsed.port
            ):
                raise ValueError("Allowed domains must be hostnames without ports, paths or credentials")
            domain = (parsed.hostname or "").rstrip(".").encode("idna").decode("ascii")
            if len(domain) > 253 or not all(
                re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in domain.split(".")
            ):
                raise ValueError("Invalid allowed hostname")
            cleaned.append(domain)
        return sorted(set(cleaned))


class AnalyticsQuestion(BaseModel):
    """Safe tenant conversation row used in analytics, including channel/status/visitor correlation and timestamps
    without exposing worker or credential data.
    """

    id: str
    question: str
    answer: PublicSourceText
    confidence_score: float
    status: Literal["resolved", "needs_human", "clarification_needed"]
    needs_human: bool
    channel: str
    outcome: str | None = None
    visitor_id: str | None = None
    created_at: datetime


class DocumentUsage(BaseModel):
    """Aggregated citation-use count for a tenant document; count measures observed source usage rather than unique
    visitors or guaranteed resolutions.
    """

    document_id: str
    title: PublicSourceText
    count: int


class AnalyticsSummary(BaseModel):
    """Tenant aggregate series, unresolved frequencies, rates and bounded conversation/source lists; business
    meaning is computed by the analytics service.
    """

    daily: list[dict] = Field(default_factory=list)
    frequent_unresolved: list[dict] = Field(default_factory=list)
    total_questions: int
    resolved_questions: int
    unresolved_questions: int
    resolution_rate: float
    answered_questions: int = 0
    answer_rate: float = 0.0
    clarification_questions: int = 0
    provider_failures: int = 0
    escalated_questions: int = 0
    human_resolved_cases: int = 0
    greetings: int = 0
    playground_interactions: int = 0
    legacy_interactions: int = 0
    # No visitor-confirmed resolution/deflection feedback is collected.
    estimated_deflection_rate: float | None = None
    average_confidence: float
    latest_questions: list[AnalyticsQuestion]
    unanswered_questions: list[AnalyticsQuestion]
    top_documents: list[DocumentUsage]


class InvitationDeliveryOut(BaseModel):
    """Safe latest-invitation delivery metadata; mode distinguishes local capture from SMTP and never exposes
    temporary passwords, ciphertext or claim tokens.
    """

    id: str
    status: Literal["queued", "sending", "sent", "failed", "canceled"]
    attempts: int
    error_code: str | None = None
    created_at: datetime
    sent_at: datetime | None = None
    mode: Literal["local_capture", "smtp", "unknown"] = "unknown"

    model_config = ConfigDict(from_attributes=True)


class TeamUserOut(BaseModel):
    """Tenant team identity with current reset/expiry state and optional safe invitation delivery; only tenant
    roles are representable.
    """

    id: str
    email: EmailStr
    full_name: str | None = None
    role: Literal["tenant_admin", "support_agent"]
    is_active: bool
    must_change_password: bool = False
    temporary_password_expires_at: datetime | None = None
    invitation_delivery: InvitationDeliveryOut | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def invitation_state(self) -> Literal["pending", "expired", "accepted", "inactive"]:
        """Derive inactive/accepted/expired/pending from current activity, reset requirement and UTC expiry.
        Missing expiry is expired, preventing an apparently valid invitation without a deadline.
        """
        if not self.is_active:
            return "inactive"
        if not self.must_change_password:
            return "accepted"
        if not self.temporary_password_expires_at or as_utc(self.temporary_password_expires_at) <= datetime.now(UTC):
            return "expired"
        return "pending"


class TeamUserCreate(BaseModel):
    """Tenant administrator's invitation request with optional explicit initial password and tenant-only role;
    service-issued credentials still require replacement on acceptance.
    """

    email: EmailStr
    full_name: str | None = Field(default=None, max_length=160)
    password: Password | None = Field(default=None, min_length=12, max_length=128)
    role: Literal["tenant_admin", "support_agent"] = "support_agent"


class TeamUserUpdate(BaseModel):
    """Partial tenant team mutation; omitted fields are retained and explicit null full_name can clear it.
    Role/activity changes trigger service invitation/revocation safeguards.
    """

    full_name: str | None = Field(default=None, max_length=160)
    role: Literal["tenant_admin", "support_agent"] | None = None
    is_active: bool | None = None


class SupportCaseOut(BaseModel):
    """Authenticated staff view combining case, assignee and conversation data, including private notes. Public
    visitor responses intentionally use a separate minimal payload.
    """

    id: str
    org_id: str
    conversation_id: str
    status: Literal["open", "in_review", "resolved", "closed"]
    assigned_to_user_id: str | None = None
    assignee: TeamUserOut | None = None
    human_answer: str | None = None
    internal_note: str | None = None
    reason: str
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    visitor_id: str | None = None
    channel: str
    question: str
    ai_answer: PublicSourceText
    confidence_score: float
    sources: list[dict]

    @field_validator("sources")
    @classmethod
    def safe_legacy_sources(cls, sources: list[dict]) -> list[dict]:
        """Sanitize old partial citation snapshots without requiring new metadata fields."""
        return [
            {key: redact_source_urls(value) if isinstance(value, str) else value for key, value in source.items()}
            for source in sources
        ]


class SupportCaseAssignRequest(BaseModel):
    """Optional assignee request: omission means the acting support user and explicit null means unassign; the
    route verifies active accepted staff in the same tenant.
    """

    assigned_to_user_id: str | None = None


class SupportCaseNoteRequest(BaseModel):
    """Bounded private staff note; trimmed empty input clears it and the note is never part of the public visitor
    answer.
    """

    internal_note: ReadableText = Field(max_length=10_000)


class SupportCaseResolveRequest(BaseModel):
    """Required nonblank human reply for case resolution; the route persists it and exposes only this answer
    through scoped visitor polling.
    """

    human_answer: ReadableText = Field(min_length=1, max_length=20_000)


class SupportCaseStatusRequest(BaseModel):
    """Constrained lifecycle status change; the route rejects resolved without an existing human answer and
    maintains resolved_at.
    """

    status: Literal["open", "in_review", "resolved", "closed"]


class AuditEventOut(BaseModel):
    """Safe platform audit view using event_metadata's storage alias and optional actor email; deleted
    actors/tenants can leave nullable historical identifiers.
    """

    id: str
    org_id: str | None = None
    actor_user_id: str | None = None
    actor_email: str | None = None
    scope: str
    action: str
    target_type: str
    target_id: str | None = None
    metadata: dict = Field(default_factory=dict, validation_alias="event_metadata")
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PlatformOverviewOut(BaseModel):
    """Cross-tenant platform counters for organizations, identities, knowledge, recent questions, open cases and
    ingestion state; restricted to super administrators.
    """

    organizations_total: int
    organizations_active: int
    organizations_trialing: int
    organizations_suspended: int
    users_total: int
    documents_total: int
    vector_chunks_total: int
    questions_30d: int
    open_support_cases: int
    pending_ingestion_jobs: int
    processing_ingestion_jobs: int
    failed_ingestion_jobs: int


class PlatformOrganizationSummary(BaseModel):
    """Platform tenant/commercial summary with grouped usage counts; fees are minor units and archival is
    represented separately from subscription status.
    """

    id: str
    public_id: str
    name: str
    subscription_plan: str
    subscription_status: str
    trial_ends_at: datetime | None = None
    subscription_ends_at: datetime | None = None
    monthly_fee_minor: int = 0
    billing_currency: str = "EUR"
    billing_email: str | None = None
    archived_at: datetime | None = None
    created_at: datetime
    users_count: int
    documents_count: int
    chunks_count: int
    questions_30d: int
    support_cases_count: int


class PlatformOrganizationList(BaseModel):
    """Paged platform organization summaries and matching total; page_size is returned explicitly for consistent
    list navigation.
    """

    items: list[PlatformOrganizationSummary]
    total: int
    page: int
    page_size: int


class PlatformOrganizationDetail(PlatformOrganizationSummary):
    """Expanded platform tenant summary with private administrator notes, administrator identities and ingestion
    counts; never a public widget contract.
    """

    widget_brand_name: str
    allowed_domains_count: int
    pending_ingestion_jobs: int
    processing_ingestion_jobs: int
    failed_ingestion_jobs: int
    admin_notes: str | None = None
    administrators: list[TeamUserOut] = Field(default_factory=list)


class PlatformOrganizationUpdate(BaseModel):
    """Narrow optional plan/status schema; the current platform route accepts the broader OrganizationEdit.

    Declaring this input shape performs no authorization or subscription mutation on its own.
    """

    subscription_plan: Literal["trial", "starter", "pro", "enterprise"] | None = None
    subscription_status: Literal["trialing", "active", "suspended", "past_due", "canceled"] | None = None


class PlatformHealthCheck(BaseModel):
    """One sanitized dependency health category/detail; details are operational diagnostics rather than raw
    exception strings or credentials.
    """

    status: Literal["healthy", "degraded", "unhealthy"]
    detail: str | None = None


class PlatformHealthOut(BaseModel):
    """Overall platform health plus named dependency checks; degradation is distinct from process liveness and
    schema readiness.
    """

    status: Literal["healthy", "degraded", "unhealthy"]
    checks: dict[str, PlatformHealthCheck]
