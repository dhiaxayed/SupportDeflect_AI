from __future__ import annotations

from collections import Counter

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import ConversationLog, Document
from app.schemas import AnalyticsQuestion, AnalyticsSummary, DocumentUsage


class AnalyticsService:
    def summary(self, db: Session, org_id: str) -> AnalyticsSummary:
        total = db.scalar(select(func.count(ConversationLog.id)).where(ConversationLog.org_id == org_id)) or 0
        resolved = db.scalar(
            select(func.count(ConversationLog.id)).where(ConversationLog.org_id == org_id, ConversationLog.resolved.is_(True))
        ) or 0
        unresolved = max(0, total - resolved)
        avg_conf = db.scalar(select(func.avg(ConversationLog.confidence_score)).where(ConversationLog.org_id == org_id)) or 0.0
        latest = list(
            db.scalars(
                select(ConversationLog)
                .where(ConversationLog.org_id == org_id)
                .order_by(desc(ConversationLog.created_at))
                .limit(10)
            )
        )
        unanswered = list(
            db.scalars(
                select(ConversationLog)
                .where(ConversationLog.org_id == org_id, ConversationLog.resolved.is_(False))
                .order_by(desc(ConversationLog.created_at))
                .limit(10)
            )
        )
        top_documents = self._top_documents(db, org_id)
        return AnalyticsSummary(
            total_questions=total,
            resolved_questions=resolved,
            unresolved_questions=unresolved,
            resolution_rate=round(resolved / total, 4) if total else 0.0,
            average_confidence=round(float(avg_conf), 2),
            latest_questions=[to_question(item) for item in latest],
            unanswered_questions=[to_question(item) for item in unanswered],
            top_documents=top_documents,
        )

    def unresolved(self, db: Session, org_id: str) -> list[AnalyticsQuestion]:
        rows = list(
            db.scalars(
                select(ConversationLog)
                .where(ConversationLog.org_id == org_id, ConversationLog.resolved.is_(False))
                .order_by(desc(ConversationLog.created_at))
                .limit(100)
            )
        )
        return [to_question(item) for item in rows]

    def _top_documents(self, db: Session, org_id: str) -> list[DocumentUsage]:
        rows = list(
            db.scalars(
                select(ConversationLog)
                .where(ConversationLog.org_id == org_id)
                .order_by(desc(ConversationLog.created_at))
                .limit(500)
            )
        )
        counter: Counter[str] = Counter()
        for row in rows:
            for source in row.sources or []:
                document_id = source.get("document_id")
                if document_id:
                    counter[document_id] += 1
        if not counter:
            return []
        docs = {
            doc.id: doc
            for doc in db.scalars(select(Document).where(Document.org_id == org_id, Document.id.in_(list(counter.keys()))))
        }
        output: list[DocumentUsage] = []
        for document_id, count in counter.most_common(5):
            doc = docs.get(document_id)
            output.append(DocumentUsage(document_id=document_id, title=doc.title if doc else "Unknown document", count=count))
        return output


def to_question(log: ConversationLog) -> AnalyticsQuestion:
    return AnalyticsQuestion(
        id=log.id,
        question=log.question,
        answer=log.answer,
        confidence_score=log.confidence_score,
        status="resolved" if log.resolved else "needs_human",
        needs_human=log.needs_human,
        channel=log.channel,
        visitor_id=log.visitor_id,
        created_at=log.created_at,
    )


analytics_service = AnalyticsService()
