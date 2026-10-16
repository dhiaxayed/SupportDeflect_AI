"""Fixed MiniLM dimension and indexed cosine search on PostgreSQL."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    """On PostgreSQL, install pgvector, add vector(384), backfill from JSON embeddings and create the cosine HNSW
    index. SQLite is deliberately unchanged and retains its JSON-vector development path.
    """
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute("ALTER TABLE vector_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(384)")
        op.execute(
            "UPDATE vector_chunks SET embedding_vector = embedding::text::vector " "WHERE embedding_vector IS NULL"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_vector_chunks_embedding_vector "
            "ON vector_chunks USING hnsw (embedding_vector vector_cosine_ops)"
        )


def downgrade():
    """On PostgreSQL, remove the native cosine index/vector column while retaining JSON embeddings and the
    extension; no-op on SQLite. Alembic owns transaction handling.
    """
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_vector_chunks_embedding_vector")
        op.execute("ALTER TABLE vector_chunks DROP COLUMN IF EXISTS embedding_vector")
