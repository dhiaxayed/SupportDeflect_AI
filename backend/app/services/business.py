"""Cross-tenant operational and cash reporting for the authorized platform dashboard.

Combines conversation activity, manually recorded cash and subscription metadata.
The route supplies platform authorization; reads neither commit nor create ledger entries.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, select

from app.core.datetime import as_utc
from app.models import BillingEntry, ConversationLog, Document, IngestionJob, Organization, SupportCase


def business_dashboard(db, *, days=30, currency="EUR", channel="widget"):
    """Return platform BI for the selected rolling window, currency and channel.

    Cash is receipts minus refunds in minor units; MRR uses current eligible
    subscription fees rather than cash received. Conversation resolution is an
    AI-outcome metric, not a count of agent-closed cases. This cross-tenant read
    requires platform authorization at the route and does not commit.
    """
    now = datetime.now(UTC)
    start, previous_start = now - timedelta(days=days), now - timedelta(days=2 * days)
    channel_filter = [] if channel == "all" else [ConversationLog.channel == channel]
    activity = db.execute(
        select(
            func.date(ConversationLog.created_at).label("day"),
            func.count().label("questions"),
            func.sum(case((ConversationLog.resolved.is_(True), 1), else_=0)).label("resolved"),
        )
        .where(ConversationLog.created_at >= start, ConversationLog.created_at <= now, *channel_filter)
        .group_by(func.date(ConversationLog.created_at))
    ).all()
    cash_value = case((BillingEntry.kind == "payment", BillingEntry.amount_minor), else_=-BillingEntry.amount_minor)
    cash = db.execute(
        select(func.date(BillingEntry.occurred_at).label("day"), func.sum(cash_value).label("net"))
        .where(BillingEntry.currency == currency, BillingEntry.occurred_at >= start, BillingEntry.occurred_at <= now)
        .group_by(func.date(BillingEntry.occurred_at))
    ).all()
    org_dates = db.execute(
        select(func.date(Organization.created_at).label("day"), func.count().label("total"))
        .where(Organization.created_at >= start)
        .group_by(func.date(Organization.created_at))
    ).all()
    activity_map = {str(row.day): row for row in activity}
    cash_map = {str(row.day): row.net for row in cash}
    org_map = {str(row.day): row.total for row in org_dates}
    series = []
    for offset in range(days + 1):
        day = (start + timedelta(days=offset)).date().isoformat()
        row = activity_map.get(day)
        series.append(
            dict(
                date=day,
                questions=row.questions if row else 0,
                resolved=int(row.resolved or 0) if row else 0,
                revenue_minor=cash_map.get(day, 0),
                new_organizations=org_map.get(day, 0),
            )
        )

    def window_stats(begin, end):
        """Aggregate questions, resolutions, net cash and new tenants in [begin, end).

        Capture the parent session, currency and channel filters so adjacent comparison
        windows use the same definitions without double-counting their boundary.
        """
        q, resolved = db.execute(
            select(
                func.count(), func.coalesce(func.sum(case((ConversationLog.resolved.is_(True), 1), else_=0)), 0)
            ).where(ConversationLog.created_at >= begin, ConversationLog.created_at < end, *channel_filter)
        ).one()
        revenue = db.scalar(
            select(func.coalesce(func.sum(cash_value), 0)).where(
                BillingEntry.currency == currency, BillingEntry.occurred_at >= begin, BillingEntry.occurred_at < end
            )
        )
        new = db.scalar(
            select(func.count())
            .select_from(Organization)
            .where(Organization.created_at >= begin, Organization.created_at < end)
        )
        return dict(
            questions=q,
            resolved=int(resolved),
            resolution_rate=round(resolved / q * 100, 2) if q else 0,
            revenue_minor=revenue,
            new_organizations=new,
        )

    current, previous = window_stats(start, now), window_stats(previous_start, start)
    metrics = {
        key: dict(
            value=value,
            previous=previous[key],
            delta=value - previous[key],
            delta_percent=round((value - previous[key]) / abs(previous[key]) * 100, 1) if previous[key] else None,
        )
        for key, value in current.items()
    }
    organizations = list(db.scalars(select(Organization).where(Organization.archived_at.is_(None))))
    docs = dict(
        db.execute(
            select(Document.org_id, func.count()).where(Document.is_active.is_(True)).group_by(Document.org_id)
        ).all()
    )
    usage = {
        row.org_id: row
        for row in db.execute(
            select(
                ConversationLog.org_id,
                func.count().label("questions"),
                func.sum(case((ConversationLog.resolved.is_(True), 1), else_=0)).label("resolved"),
            )
            .where(ConversationLog.created_at >= start, *channel_filter)
            .group_by(ConversationLog.org_id)
        )
    }
    paying = []
    risks = []
    for org in organizations:
        end = as_utc(org.trial_ends_at if org.subscription_plan == "trial" else org.subscription_ends_at)
        if org.subscription_plan != "trial" and org.subscription_status == "active" and (not end or end > now):
            paying.append(org)
        reason = None
        if org.subscription_status == "past_due":
            reason = "past_due"
        elif end and end <= now and org.subscription_status in {"active", "trialing"}:
            reason = "expired"
        elif end and now < end <= now + timedelta(days=7):
            reason = "expiring"
        elif org.subscription_status in {"active", "trialing"}:
            if not docs.get(org.id):
                reason = "no_documents"
            elif not org.allowed_domains:
                reason = "no_widget_domain"
            elif org.id not in usage and as_utc(org.created_at) < start:
                reason = "inactive"
        if reason:
            risks.append(
                dict(
                    id=org.id,
                    name=org.name,
                    reason=reason,
                    plan=org.subscription_plan,
                    ends_at=end,
                    status=org.subscription_status,
                )
            )
    order = {
        name: i
        for i, name in enumerate(["past_due", "expired", "expiring", "no_documents", "no_widget_domain", "inactive"])
    }
    risks.sort(key=lambda item: order[item["reason"]])
    mrr = sum(org.monthly_fee_minor for org in paying if org.billing_currency == currency)
    top = sorted(
        (
            dict(
                id=org.id,
                name=org.name,
                plan=org.subscription_plan,
                questions=usage[org.id].questions,
                resolution_rate=round((usage[org.id].resolved or 0) / usage[org.id].questions * 100, 1),
            )
            for org in organizations
            if org.id in usage
        ),
        key=lambda row: row["questions"],
        reverse=True,
    )[:10]
    return dict(
        days=days,
        currency=currency,
        channel=channel,
        generated_at=now,
        start=start,
        end=now,
        metrics=metrics,
        series=series,
        mrr_minor=mrr,
        arr_minor=mrr * 12,
        organizations_total=len(organizations),
        paying_organizations=len(paying),
        unpriced_organizations=sum(org.monthly_fee_minor == 0 for org in paying),
        plan_distribution=[
            dict(name=name, value=count)
            for name, count in Counter(org.subscription_plan for org in organizations).items()
        ],
        status_distribution=[
            dict(name=name, value=count)
            for name, count in Counter(org.subscription_status for org in organizations).items()
        ],
        risks=risks[:20],
        risks_total=len(risks),
        top_organizations=top,
        open_cases=db.scalar(
            select(func.count()).select_from(SupportCase).where(SupportCase.status.in_(["open", "in_review"]))
        ),
        failed_ingestion=db.scalar(
            select(func.count()).select_from(IngestionJob).where(IngestionJob.status == "failed")
        ),
        documents_total=sum(docs.values()),
    )
