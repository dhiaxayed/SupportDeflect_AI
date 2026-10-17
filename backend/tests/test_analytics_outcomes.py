"""Keep business reporting grounded in classified visitor activity, separately from testing and human work."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ConversationLog, SupportCase
from app.schemas import ChatResponse
from app.services import rag
from app.services.analytics import analytics_service
from app.services.business import business_dashboard
from tests.conftest import register_org


def test_business_series_uses_the_same_exclusive_end_as_its_counters(client, monkeypatch):
    """Records arriving after the reporting snapshot must not inflate charts while remaining absent from counters."""
    from app.models import BillingEntry, Organization
    from app.services import business

    now = datetime.now(UTC)
    _, payload = register_org(client, "Arriving account", "arriving@example.com")

    class Clock:
        """Freeze the start-of-report instant while later rows are already visible to subsequent reads."""

        @staticmethod
        def now(_):
            """Return the captured report boundary."""
            return now

    monkeypatch.setattr(business, "datetime", Clock)
    with SessionLocal() as db:
        org = db.get(Organization, payload["user"]["organization"]["id"])
        org.created_at = now + timedelta(seconds=1)
        db.add(BillingEntry(org_id=org.id, kind="payment", amount_minor=100, currency="EUR",
                            occurred_at=now, idempotency_key="snapshot-payment"))
        db.commit()
        report = business_dashboard(db)
        assert (
            sum(row["new_organizations"] for row in report["series"])
            == report["metrics"]["new_organizations"]["value"]
        )
        assert sum(row["revenue_minor"] for row in report["series"]) == report["metrics"]["revenue_minor"]["value"]


def test_tenant_and_platform_share_the_same_conservative_metrics(client):
    """Exercise every outcome plus Playground, greetings, unknown history and human closure in one dataset."""
    headers, payload = register_org(client, "Metrics", "metrics@example.com")
    org_id = payload["user"]["organization"]["id"]
    other_headers, _ = register_org(client, "Other", "other@example.com")
    with SessionLocal() as db:
        for outcome in ("answered", "escalated", "clarification", "provider_failure", "greeting", None):
            log = ConversationLog(
                org_id=org_id, channel="widget", question="Hello" if outcome == "greeting" else "A question?",
                answer="Response", outcome=outcome, resolved=outcome in {"answered", "greeting", None},
                needs_human=outcome in {"escalated", "provider_failure"}, confidence_score=0.8,
            )
            db.add(log)
            db.flush()
            if outcome == "escalated":
                db.add(SupportCase(org_id=org_id, conversation_id=log.id, status="resolved",
                                   human_answer="Human reply", resolved_at=datetime.now(UTC)))
        db.add(ConversationLog(org_id=org_id, channel="admin", question="A test?", answer="Test answer",
                               resolved=True, outcome="answered", needs_human=False))
        db.commit()
        summary = analytics_service.summary(db, org_id)
        platform = business_dashboard(db)
        assert summary.total_questions == platform["metrics"]["questions"]["value"] == 4
        assert summary.answered_questions == summary.resolved_questions == 1
        assert summary.answer_rate == summary.resolution_rate == 0.25
        assert platform["metrics"]["resolution_rate"]["value"] == 25
        assert summary.clarification_questions == summary.provider_failures == summary.escalated_questions == 1
        assert summary.unresolved_questions == len(summary.unanswered_questions) == 1
        assert summary.playground_interactions == summary.greetings == summary.legacy_interactions == 1
        assert summary.human_resolved_cases == 1
        assert summary.estimated_deflection_rate is platform["estimated_deflection_rate"] is None
        assert len(summary.latest_questions) == 4
        assert len(analytics_service.unresolved(db, org_id)) == 1
        assert sum(day["resolved"] for day in summary.daily) == 1
        assert sum(day["conversations"] for day in summary.daily) == 4
        assert business_dashboard(db, channel="all")["metrics"]["questions"]["value"] == 4
        assert business_dashboard(db, channel="admin")["metrics"]["questions"]["value"] == 0
    empty = client.get("/api/v1/analytics/summary", headers=other_headers).json()
    assert empty["total_questions"] == empty["answer_rate"] == empty["human_resolved_cases"] == 0
    assert client.get("/api/v1/analytics/summary", headers=headers).json()["total_questions"] == 4


@pytest.mark.parametrize("question,response,expected", [
    ("Hello!", {"status": "resolved", "reason": "greeting", "needs_human": False}, "greeting"),
    ("Hello!", {"status": "needs_human", "reason": "llm_unavailable", "needs_human": True}, "greeting"),
    ("Policy?", {"status": "resolved", "reason": "documented_answer", "needs_human": False}, "answered"),
    ("Policy?", {"status": "needs_human", "reason": "insufficient_knowledge", "needs_human": True}, "escalated"),
    ("Policy?", {"status": "needs_human", "reason": "retrieval_unavailable", "needs_human": True}, "provider_failure"),
    ("Policy?", {"status": "clarification_needed", "reason": "clarification_needed", "needs_human": False},
     "clarification"),
])
def test_rag_persists_the_outcome_with_its_response(client, question, response, expected):
    """Verify classification at the actual conversation/case commit boundary rather than deriving it in dashboards."""
    import time

    from app.models import Organization

    _, payload = register_org(client, "Persistence", "persistence@example.com")
    with SessionLocal() as db:
        org = db.get(Organization, payload["user"]["organization"]["id"])
        answer = ChatResponse(answer="Fixture reply", sources=[], confidence_score=0, **response)
        rag.rag_service._log(db, org, question, answer, "widget", "visitor", time.perf_counter())
        log = db.scalar(select(ConversationLog))
        assert log.outcome == expected
        assert (db.scalar(select(SupportCase)) is not None) == (expected == "escalated")
