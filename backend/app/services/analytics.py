"""Tenant-scoped conversation reporting for dashboard summaries and unresolved questions.

Reads SQLAlchemy conversation history and document metadata without committing.
Tenant authorization belongs to the route; every query here retains its org_id scope.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, desc, func, select
from sqlalchemy.orm import Session

from app.models import ConversationLog, Document, SupportCase
from app.schemas import AnalyticsQuestion, AnalyticsSummary, DocumentUsage

QUESTION_OUTCOMES = ("answered", "escalated", "clarification", "provider_failure")


def visitor_questions():
    """Shared customer-support scope; legacy interactions lack enough evidence for classification."""
    return and_(ConversationLog.channel == "widget", ConversationLog.outcome.in_(QUESTION_OUTCOMES))


def ai_answered():
    """Count a recorded AI answer without escalation, not a confirmed customer resolution."""
    return ConversationLog.outcome == "answered"


class AnalyticsService:
    """Read-only tenant analytics over persisted AI outcomes and source usage."""

    def summary(self, db: Session, org_id: str) -> AnalyticsSummary:
        """Return the tenant dashboard summary from the caller's read session.

        Totals cover classified visitor questions; daily buckets cover 30 UTC dates.
        Greetings, Playground and unclassified legacy interactions are reported separately.
        Database failures propagate; no records are changed or committed.
        """
        scope = (ConversationLog.org_id == org_id, visitor_questions())
        counts = dict(db.execute(
            select(ConversationLog.outcome, func.count()).where(*scope).group_by(ConversationLog.outcome)
        ).all())
        total = sum(counts.values())
        resolved = counts.get("answered", 0)
        unresolved = counts.get("escalated", 0)
        avg_conf = (
            db.scalar(select(func.avg(ConversationLog.confidence_score)).where(*scope, ai_answered())) or 0.0
        )
        latest = list(
            db.scalars(
                select(ConversationLog)
                .where(*scope)
                .order_by(desc(ConversationLog.created_at))
                .limit(10)
            )
        )
        unanswered = list(
            db.scalars(
                select(ConversationLog)
                .where(*scope, ConversationLog.outcome == "escalated")
                .order_by(desc(ConversationLog.created_at))
                .limit(10)
            )
        )
        top_documents = self._top_documents(db, org_id)
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=29)
        day = func.date(ConversationLog.created_at)
        rows = db.execute(
            select(day, func.count(), func.sum(case((ai_answered(), 1), else_=0)))
            .where(*scope, ConversationLog.created_at >= start)
            .group_by(day)
        ).all()
        buckets = {str(date): (count, resolved_count) for date, count, resolved_count in rows}
        daily = []
        for offset in range(30):
            date = (start + timedelta(days=offset)).date().isoformat()
            count, resolved_count = buckets.get(date, (0, 0))
            daily.append({"date": date, "conversations": count, "resolved": resolved_count})
        frequent = db.execute(
            select(ConversationLog.question, func.count().label("count"))
            .where(*scope, ConversationLog.outcome == "escalated")
            .group_by(ConversationLog.question)
            .order_by(desc("count"), ConversationLog.question)
            .limit(6)
        ).all()
        return AnalyticsSummary(
            daily=daily,
            frequent_unresolved=[{"question": question, "count": count} for question, count in frequent],
            total_questions=total,
            resolved_questions=resolved,
            unresolved_questions=unresolved,
            resolution_rate=round(resolved / total, 4) if total else 0.0,
            answered_questions=resolved,
            answer_rate=round(resolved / total, 4) if total else 0.0,
            clarification_questions=counts.get("clarification", 0),
            provider_failures=counts.get("provider_failure", 0),
            escalated_questions=unresolved,
            greetings=db.scalar(select(func.count()).select_from(ConversationLog).where(
                ConversationLog.org_id == org_id, ConversationLog.channel == "widget",
                ConversationLog.outcome == "greeting",
            )) or 0,
            playground_interactions=db.scalar(select(func.count()).select_from(ConversationLog).where(
                ConversationLog.org_id == org_id, ConversationLog.channel == "admin",
            )) or 0,
            legacy_interactions=db.scalar(select(func.count()).select_from(ConversationLog).where(
                ConversationLog.org_id == org_id, ConversationLog.channel == "widget",
                ConversationLog.outcome.is_(None),
            )) or 0,
            human_resolved_cases=db.scalar(select(func.count()).select_from(SupportCase).where(
                SupportCase.org_id == org_id, SupportCase.resolved_at.is_not(None),
                SupportCase.human_answer.is_not(None),
            )) or 0,
            average_confidence=round(float(avg_conf), 2),
            latest_questions=[to_question(item) for item in latest],
            unanswered_questions=[to_question(item) for item in unanswered],
            top_documents=top_documents,
        )

    def unresolved(self, db: Session, org_id: str) -> list[AnalyticsQuestion]:
        """Return up to 100 newest tenant questions flagged for human attention.

        This reports conversation outcomes rather than the current support-case status;
        the caller retains session ownership and no database writes occur.
        """
        rows = list(
            db.scalars(
                select(ConversationLog)
                .where(ConversationLog.org_id == org_id, visitor_questions(), ConversationLog.outcome == "escalated")
                .order_by(desc(ConversationLog.created_at))
                .limit(100)
            )
        )
        return [to_question(item) for item in rows]

    def _top_documents(self, db: Session, org_id: str) -> list[DocumentUsage]:
        """Count at most one use of each document per tenant answer and return five leaders.

        History is streamed in batches; tenant-owned document titles are loaded once.
        Missing historical documents retain their counts with an Unknown document label.
        The query does not commit or infer usage from raw vector similarity.
        """
        rows = db.scalars(select(ConversationLog.sources).where(
            ConversationLog.org_id == org_id, visitor_questions(), ai_answered(),
        )).yield_per(500)
        counter: Counter[str] = Counter()
        for sources in rows:
            # Multiple cited passages from one document still represent one answer using that document.
            counter.update({source["document_id"] for source in sources or [] if source.get("document_id")})
        if not counter:
            return []
        docs = {
            doc.id: doc
            for doc in db.scalars(
                select(Document).where(Document.org_id == org_id, Document.id.in_(list(counter.keys())))
            )
        }
        output: list[DocumentUsage] = []
        for document_id, count in counter.most_common(5):
            doc = docs.get(document_id)
            output.append(
                DocumentUsage(document_id=document_id, title=doc.title if doc else "Unknown document", count=count)
            )
        return output


def to_question(log: ConversationLog) -> AnalyticsQuestion:
    """Map one conversation row to its analytics contract without changing the row.

    Resolved takes precedence, then needs_human; the remaining state is clarification.
    Stored answer text is returned; the route must already authorize tenant access.
    """
    return AnalyticsQuestion(
        id=log.id,
        question=log.question,
        answer=log.answer,
        confidence_score=log.confidence_score,
        status="resolved" if log.resolved else "needs_human" if log.needs_human else "clarification_needed",
        needs_human=log.needs_human,
        channel=log.channel,
        outcome=log.outcome,
        visitor_id=log.visitor_id,
        created_at=log.created_at,
    )


analytics_service = AnalyticsService()
