"""SQLAlchemy persistence contracts for tenant identities, knowledge, conversations, support, quotas and the manual
ledger/outbox. Alembic owns schema changes; services enforce lifecycle and authorization invariants.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.datetime import UTCDateTime
from app.db import Base


def new_uuid() -> str:
    """Return a string UUID4 for ORM primary-key defaults; database uniqueness constraints remain the final
    identity boundary.
    """
    return str(uuid4())


def utcnow() -> datetime:
    """Return an aware current UTC datetime for model defaults/on-update hooks; UTCDateTime preserves its meaning
    across database dialects.
    """
    return datetime.now(UTC)


class UserRole(StrEnum):
    """Persisted role vocabulary: a tenant administrator and support agent belong to one organization; a super
    administrator belongs to none.
    """

    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    SUPPORT_AGENT = "support_agent"


TENANT_ROLES = {UserRole.TENANT_ADMIN.value, UserRole.SUPPORT_AGENT.value}


class Organization(Base):
    """Tenant ownership root with public widget identity, saved design and commercial lifecycle. public_id is
    discoverable, not authentication; fees are currency minor units and archival preserves historical records.
    """

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)

    widget_brand_name: Mapped[str] = mapped_column(String(120), nullable=False)
    widget_primary_color: Mapped[str] = mapped_column(String(16), nullable=False, default="#2563eb")
    widget_greeting: Mapped[str] = mapped_column(String(500), nullable=False)
    # Replace the JSON value when saving; nested in-place edits are not tracked by plain JSON mapping.
    widget_design: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    support_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    strict_mode: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allowed_domains: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    subscription_plan: Mapped[str] = mapped_column(String(32), default="trial", nullable=False)
    subscription_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    subscription_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    monthly_fee_minor: Mapped[int] = mapped_column(default=0, nullable=False)
    billing_currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    billing_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )

    users: Mapped[list[User]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    documents: Mapped[list[Document]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    conversations: Mapped[list[ConversationLog]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    support_cases: Mapped[list[SupportCase]] = relationship(
        back_populates="organization",
        cascade="all, delete-orphan",
    )
    audit_events: Mapped[list[AuditEvent]] = relationship(back_populates="organization")


class User(Base):
    """Globally unique email identity with a database-enforced role/org pairing. hashed_password never leaves safe
    output schemas; token_version revokes old sessions and temporary expiry limits mandatory-reset invitations.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        CheckConstraint(
            "(role = 'super_admin' AND org_id IS NULL) OR "
            "(role IN ('tenant_admin', 'support_agent') AND org_id IS NOT NULL)",
            name="ck_users_role_org",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default=UserRole.TENANT_ADMIN.value, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # JWT version claims are compared with this current value on every authenticated request.
    token_version: Mapped[int] = mapped_column(default=0, nullable=False)
    temporary_password_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)

    organization: Mapped[Organization | None] = relationship(back_populates="users")


class Document(Base):
    """Tenant-owned knowledge metadata and indexing lifecycle. is_active gates retrieval/deletion; source records a
    file name or public URL, while chunk_count/indexed_at describe the persisted indexing result.
    """

    __tablename__ = "documents"
    __table_args__ = (Index("ix_documents_org_status", "org_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)  # file | url
    source: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    chunk_count: Mapped[int] = mapped_column(default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)
    indexed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    organization: Mapped[Organization] = relationship(back_populates="documents")


class ConversationLog(Base):
    """Persist one tenant's admin/widget question, answer and verified-source snapshot for analytics and support.
    resolved/confidence are operational outcomes, not guaranteed truth or financial savings.
    """

    __tablename__ = "conversation_logs"
    __table_args__ = (
        Index("ix_conversation_org_created", "org_id", "created_at"),
        Index("ix_conversation_org_resolved", "org_id", "resolved"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    visitor_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(32), nullable=False)  # admin | widget
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # NULL means legacy/unknown: booleans alone cannot distinguish greetings or outages.
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True)
    needs_human: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sources: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    latency_ms: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="conversations")
    support_case: Mapped[SupportCase | None] = relationship(back_populates="conversation", uselist=False)


class VectorChunk(Base):
    """Persist one document passage and JSON embedding, unique by tenant/document/chunk index. embedding_model
    prevents comparing incompatible vectors; PostgreSQL's native vector column is managed by
    migrations/services.
    """

    __tablename__ = "vector_chunks"
    __table_args__ = (
        UniqueConstraint("org_id", "document_id", "chunk_index", name="uq_vector_chunks_document_chunk"),
        Index("ix_vector_chunks_org_document", "org_id", "document_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    # Empty means legacy/unknown, which requires reindexing before comparison to current query vectors.
    embedding_model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    org_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(1024), nullable=False)
    chunk_index: Mapped[int] = mapped_column(nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)


class IngestionJob(Base):
    """Durable tenant/document indexing task with text or URL payload. attempts plus locked_at fence worker leases;
    locked_by is diagnostic ownership and raw_text is scrubbed on relevant terminal/cancel paths.
    """

    __tablename__ = "ingestion_jobs"
    __table_args__ = (
        Index("ix_ingestion_jobs_status_created", "status", "created_at"),
        Index("ix_ingestion_jobs_document", "document_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_type: Mapped[str] = mapped_column(String(32), nullable=False)  # text | url
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    locked_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Attempt and UTC timestamp jointly identify a lease; manual retry may reset the attempt number.
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class RateLimitEvent(Base):
    """Persist one timestamped throttle-key event for shared rolling-window accounting; services own expiry cleanup
    and request admission.
    """

    __tablename__ = "rate_limit_events"
    __table_args__ = (
        Index("ix_rate_limit_key_created", "key", "created_at"),
        Index("ix_rate_limit_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)


class QuestionReservation(Base):
    """Expiring in-flight tenant question slot counted before slow generation. Services release/expire reservations
    so admission does not hold database locks across AI calls.
    """

    __tablename__ = "question_reservations"
    __table_args__ = (Index("ix_question_reservations_org_expires", "org_id", "expires_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class SupportCase(Base):
    """One human-follow-up case per conversation with tenant ownership and constrained status. Internal
    notes/assignee stay private; only the final human answer is exposed through the visitor capability endpoint.
    """

    __tablename__ = "support_cases"
    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_support_cases_conversation"),
        Index("ix_support_cases_org_status", "org_id", "status"),
        Index("ix_support_cases_assignee", "assigned_to_user_id"),
        CheckConstraint(
            "status IN ('open', 'in_review', 'resolved', 'closed')",
            name="ck_support_cases_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("conversation_logs.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False)
    assigned_to_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    human_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="needs_human")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    organization: Mapped[Organization] = relationship(back_populates="support_cases")
    conversation: Mapped[ConversationLog] = relationship(back_populates="support_case")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assigned_to_user_id])


class AuditEvent(Base):
    """Append operational actor/action/resource metadata in the caller's business transaction. Nullable
    tenant/actor links preserve history after identity deletion; metadata must omit passwords, tokens and
    private answer bodies.
    """

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_scope_created", "scope", "created_at"),
        Index("ix_audit_events_org_created", "org_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, nullable=False)

    organization: Mapped[Organization | None] = relationship(back_populates="audit_events")
    actor: Mapped[User | None] = relationship(foreign_keys=[actor_user_id])


class BillingEntry(Base):
    """Manual payment/refund ledger record with positive minor-unit amount and globally unique idempotency key.
    refund_of_id links the original payment; remaining-balance and currency rules are service invariants, not
    gateway activity.
    """

    __tablename__ = "billing_entries"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_billing_amount_positive"),
        CheckConstraint("kind IN ('payment', 'refund')", name="ck_billing_kind"),
        Index("ix_billing_currency_occurred", "currency", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="payment")
    amount_minor: Mapped[int] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(160))
    note: Mapped[str | None] = mapped_column(String(1000))
    refund_of_id: Mapped[str | None] = mapped_column(ForeignKey("billing_entries.id"), index=True)
    # One global key namespace covers both payments and refunds, including concurrent requests.
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class MailMessage(Base):
    """Durable email outbox record with public template data and encrypted sensitive_payload. Claim tokens fence
    acknowledgements; dedupe_key limits repeat enqueueing and SMTP uncertainty can require manual review.
    """

    __tablename__ = "mail_messages"
    __table_args__ = (Index("ix_mail_status_available", "status", "available_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recipient: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(180))
    template: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    # Encrypted invitation material is scrubbed by delivery/cancellation/expiry workflows.
    sensitive_payload: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    attempts: Mapped[int] = mapped_column(default=0)
    claim_token: Mapped[str | None] = mapped_column(String(64))
    available_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    error_code: Mapped[str | None] = mapped_column(String(64))
    provider_message_id: Mapped[str | None] = mapped_column(String(255))


class MailAutomation(Base):
    """Persist an optional enable/disable override for a known automation event; the mailing service supplies
    default-enabled behavior when no row exists.
    """

    __tablename__ = "mail_automations"
    event: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class MailWorkerState(Base):
    """Singleton observed Nodemailer heartbeat and SMTP readiness. last_seen_at determines connection freshness;
    readiness describes the configured transport, not delivery to an external recipient inbox.
    """

    __tablename__ = "mail_worker_state"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    smtp_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    detail: Mapped[str] = mapped_column(String(64), default="not_configured")
