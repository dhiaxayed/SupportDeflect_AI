"""Exercise real MiniLM ingestion and database retrieval in a disposable SQLite database."""

import argparse
import os
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    """Create/migrate a disposable SQLite database, run real local embeddings, reconnect and verify persisted
    tenant-isolated retrieval. With --groq, use configured credentials for synthetic-only greeting/sourced-
    answer checks; dispose/delete temporary state and never print secrets.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--groq", action="store_true", help="Also make a real, synthetic-data-only Groq API request")
    args = parser.parse_args()
    if args.groq and not os.environ.get("GROQ_API_KEY"):
        from dotenv import dotenv_values

        backend_values = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
        root_values = dotenv_values(Path(__file__).resolve().parents[2] / ".env")
        if not backend_values.get("GROQ_API_KEY") and root_values.get("GROQ_API_KEY"):
            os.environ["GROQ_API_KEY"] = root_values["GROQ_API_KEY"]
            if not os.environ.get("GROQ_MODEL") and root_values.get("GROQ_MODEL"):
                os.environ["GROQ_MODEL"] = root_values["GROQ_MODEL"]
    with ExitStack() as stack:
        directory = stack.enter_context(tempfile.TemporaryDirectory(prefix="supportdeflect-real-knowledge-"))
        os.environ.update(
            ENVIRONMENT="local",
            DATABASE_URL="sqlite:///" + (Path(directory) / "knowledge.db").as_posix(),
            LLM_PROVIDER="groq",
            EMBEDDING_PROVIDER="sentence-transformers",
            VECTOR_PROVIDER="database",
            ALLOW_FAKE_EMBEDDINGS_FALLBACK="false",
            INGESTION_MODE="inline",
        )
        from alembic import command
        from alembic.config import Config
        from app.db import SessionLocal, engine
        from app.models import Document, Organization
        from app.services.embeddings import get_embedding_service
        from app.services.ingestion import IngestionService
        from app.services.vector_store import get_vector_store

        stack.callback(engine.dispose)
        command.upgrade(Config("alembic.ini"), "head")
        with SessionLocal() as db:
            org = Organization(
                name="Disposable real embedding verification",
                public_id="verify_local_knowledge",
                widget_brand_name="Verification",
                widget_greeting="Welcome",
                allowed_domains=["client.example"],
            )
            db.add(org)
            db.flush()
            document = Document(org_id=org.id, title="Shipping policy", source="shipping.txt", source_type="file")
            db.add(document)
            db.commit()
            result = IngestionService().ingest_text(
                db=db,
                org=org,
                document=document,
                raw_text="Shipping delivery takes three working days. Returns are accepted within thirty days.",
            )
            assert result.status == "indexed", result.error_message
            org_id = org.id
        engine.dispose()
        query = get_embedding_service().embed_query("How long does shipping take?")
        chunks = get_vector_store().search(org_id=org_id, query_embedding=query, top_k=3)
        assert chunks and "three working days" in chunks[0].text
        assert not get_vector_store().search(org_id="foreign-organization", query_embedding=query, top_k=3)
        print(f"REAL_EMBEDDING_DIMENSION={len(query)} PERSISTED_CHUNKS={len(chunks)} TENANT_ISOLATION=PASS")
        if args.groq:
            from fastapi.testclient import TestClient

            from app.core.config import get_settings
            from app.main import app
            from app.services.llm import check_llm_health

            assert check_llm_health()[0] == "healthy", "Configured Groq key/model is unavailable"
            with TestClient(app, base_url="http://localhost") as client:
                greeting = client.post(
                    "/api/v1/widget/verify_local_knowledge/chat",
                    headers={"Origin": "https://client.example"},
                    json={"visitor_id": "visitor_real_greeting", "question": "helo"},
                )
                assert greeting.status_code == 200
                assert greeting.json()["reason"] == "greeting" and not greeting.json()["needs_human"]
                assert greeting.json()["answer"] and not greeting.json()["sources"]
                print("REAL_GROQ_GREETING=PASS NO_HUMAN_ESCALATION=PASS")
                response = client.post(
                    "/api/v1/widget/verify_local_knowledge/chat",
                    headers={"Origin": "https://client.example"},
                    json={
                        "visitor_id": "visitor_real_groq_verification",
                        "question": "How long does shipping delivery take?",
                    },
                )
                assert response.status_code == 200, f"Widget returned HTTP {response.status_code}"
                answer = response.json()
                assert answer["status"] == "resolved" and answer["sources"], "No grounded Groq response"
                assert "day" in answer["answer"].lower() and any(x in answer["answer"].lower() for x in ["three", "3"])
                print(
                    f"REAL_GROQ_MODEL={get_settings().groq_model} WIDGET_HTTP=200 "
                    f"STATUS=resolved SOURCES={len(answer['sources'])}"
                )
                print("SYNTHETIC_POLICY_ANSWER=" + answer["answer"])
        else:
            print("Real local ingestion and retrieval passed. No Groq generation was attempted.")
        engine.dispose()


if __name__ == "__main__":
    main()
