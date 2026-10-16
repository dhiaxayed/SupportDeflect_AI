"""Pydantic contracts for platform administration, manual receipts/refunds and the authenticated mail worker.
Validation bounds requests; service layers enforce ownership, concurrency and lifecycle rules.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas import ReadableText

Currency = Literal["EUR", "USD", "TND"]
Plan = Literal["trial", "starter", "pro", "enterprise"]
SubscriptionStatus = Literal["trialing", "active", "suspended", "past_due", "canceled"]


class OrganizationCreate(BaseModel):
    """Platform-only organization/initial administrator request. Plan and currency are restricted vocabularies;
    monthly_fee_minor is a nonnegative minor-unit amount, not a payment instruction.
    """

    name: ReadableText = Field(min_length=2, max_length=160)
    admin_email: EmailStr
    admin_name: ReadableText = Field(min_length=1, max_length=160)
    subscription_plan: Plan = "trial"
    billing_currency: Currency = "EUR"
    monthly_fee_minor: int = Field(default=0, ge=0, le=1_000_000_000)
    billing_email: EmailStr | None = None


class OrganizationEdit(BaseModel):
    """Optional platform tenant/commercial edits; omitted fields retain their values. Nullable dates/email/notes
    can express clearing where the organization service permits it.
    """

    name: ReadableText | None = Field(default=None, min_length=2, max_length=160)
    billing_email: EmailStr | None = None
    admin_notes: str | None = Field(default=None, max_length=10_000)
    subscription_plan: Plan | None = None
    subscription_status: SubscriptionStatus | None = None
    monthly_fee_minor: int | None = Field(default=None, ge=0, le=1_000_000_000)
    billing_currency: Currency | None = None
    subscription_ends_at: datetime | None = None
    trial_ends_at: datetime | None = None

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        """Trim an explicitly supplied name and reject fewer than two visible characters; preserve None so
        optional-update semantics remain intact.
        """
        if value is not None and len(value.strip()) < 2:
            raise ValueError("Organization name must contain at least two characters")
        return value.strip() if value else value


class PeriodAdjustment(BaseModel):
    """Signed day adjustment with a bounded mandatory audit reason; the service selects the appropriate
    subscription/trial deadline.
    """

    days: int = Field(ge=-3650, le=3650)
    reason: ReadableText = Field(min_length=3, max_length=500)


class ArchiveRequest(BaseModel):
    """Explicit organization-name confirmation for reversible archival; the lifecycle service compares confirm_name
    with the current tenant name.
    """

    confirm_name: str


class PaymentCreate(BaseModel):
    """Manual received-payment input with positive minor-unit amount, supported currency, occurrence date and UUID
    idempotency key. The ledger service rejects future receipts and conflicting replays.
    """

    org_id: str
    amount_minor: int = Field(gt=0, le=1_000_000_000)
    currency: Currency
    occurred_at: datetime
    reference: str | None = Field(default=None, max_length=160)
    note: str | None = Field(default=None, max_length=1000)
    idempotency_key: UUID


class RefundCreate(BaseModel):
    """Positive minor-unit refund and required readable note keyed by UUID; original currency/tenant and available
    balance come from the referenced payment.
    """

    amount_minor: int = Field(gt=0, le=1_000_000_000)
    note: ReadableText = Field(min_length=3, max_length=1000)
    idempotency_key: UUID


class MailCampaign(BaseModel):
    """Platform broadcast draft targeting one organization or all active organizations. Audience exclusivity and
    actual recipients are resolved at the route/service boundary.
    """

    org_id: str | None = None
    all_organizations: bool = False
    subject: ReadableText = Field(min_length=3, max_length=180)
    message: ReadableText = Field(min_length=10, max_length=10_000)

    @field_validator("subject", mode="before")
    @classmethod
    def subject_line(cls, value):
        """Trim the campaign subject and reject CR/LF or a blank line before Pydantic length checks, preventing
        multi-line mail subjects.
        """
        if "\r" in value or "\n" in value or not value.strip():
            raise ValueError("Use a single subject line")
        return value.strip()


class MailSend(MailCampaign):
    """Confirmed campaign draft plus preview audience fingerprint and UUID deduplication key; the route rechecks
    recipients before enqueueing.
    """

    audience_token: str
    idempotency_key: UUID


class AutomationUpdate(BaseModel):
    """Boolean override for a named supported mail automation; route validation rejects unknown event names."""

    enabled: bool


class MailClaim(BaseModel):
    """Authenticated worker heartbeat declaring transport readiness and a bounded diagnostic category; readiness
    gates delivery claims, not recipient reachability.
    """

    smtp_ready: bool
    detail: Literal["ready", "local_capture", "not_configured", "authentication_failed", "connection_failed"]


class MailResult(BaseModel):
    """Claim-bound worker acknowledgement carrying success/provider ID or a safe failure category. The route checks
    the private claim token and allows only identical result replay.
    """

    claim_token: str
    success: bool
    error_code: (
        Literal[
            "authentication_failed", "recipient_rejected", "connection_failed", "delivery_failed", "invalid_message"
        ]
        | None
    ) = None
    message_id: str | None = Field(default=None, max_length=255)
