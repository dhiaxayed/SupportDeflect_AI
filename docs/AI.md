# AI and Local Knowledge

## Runtime and Data Boundary

Normal operation uses `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL` and
`GROQ_TIMEOUT_SECONDS`. The provider does not hardcode a model. Health checks verify
that the configured ID is available to the account. The current native account uses
`openai/gpt-oss-20b`; choose another available model by changing configuration and restarting.
Do not assume a model listed publicly is included in this account's free offer.
See [Groq models](https://console.groq.com/docs/models) and
[account quotas](https://console.groq.com/docs/rate-limits).

The database, extracted text, vectors, file/logo storage, logs and embedding model remain
local. Groq receives the question, a bounded recent conversation and selected document
passages, not the database or entire repository. Imported public URLs are fetched on demand.
Initial dependency/model downloads are installation requirements, not hosted embedding services.

## Ingestion and Retrieval

1. PDF/TXT/Markdown and public HTML are parsed locally. A scanned PDF without selectable
   text is rejected as unreadable; there is no hidden OCR service.
2. Normalized text is split into overlapping chunks and indexed under its organization.
3. `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` creates local normalized
   384-dimensional embeddings, supporting French questions about English text.
   See [Sentence Transformers models](https://sbert.net/docs/sentence_transformer/pretrained_models.html).
4. Every vector stores its provider/model/dimension identity. Dense retrieval excludes
   incompatible vectors; active/indexed document and tenant filters apply throughout.
5. The question and up to two recent **user** turns form the retrieval query.
   Assistant replies are never factual evidence.
6. Dense cosine and lexical BM25Plus rankings are combined with Reciprocal Rank Fusion.
   Lexical candidates require actual matching terms. Header and neighboring chunks preserve
   the identity and context of a CV or multi-section document.
7. SQLite computes cosine over tenant rows. PostgreSQL uses pgvector/HNSW and bounded
   lexical candidates. Transaction-local iterative HNSW scans improve recall after tenant
   filtering; they do not remove filters or guarantee exact search.

Libraries: [rank-bm25](https://github.com/dorianbrown/rank_bm25),
[pgvector iterative scans](https://github.com/pgvector/pgvector#iterative-index-scans).

`RETRIEVAL_TOP_K` controls initial ranking; adjacent/header expansion is bounded.
`RETRIEVAL_CANDIDATE_LIMIT` bounds PostgreSQL lexical candidates (default 200).
`RAG_CONTEXT_MAX_CHARS` bounds excerpts (default 10000).
`RAG_HISTORY_MAX_CHARS` bounds recent conversation (default 4000, at most eight turns).
The API accepts only user/assistant history, at most 3000 characters per turn.
The legacy `confidence_score` field is a **retrieval similarity heuristic**, not a
calibrated probability. The UI labels it Retrieval score. Neither it nor the retained
legacy `MIN_CONFIDENCE_SCORE` rejects a supported answer before generation.

## Grounded Generation

Groq JSON mode returns a schema-validated answer, a supported/unsupported decision,
an optional clarification flag and document/passage identifiers. The server owns these
identifiers and resolves them to verbatim text. Missing/invented identifiers are rejected;
citation numbers and excerpts are attached server-side. Short skill lines such as Python
or React remain in the passages. See [Groq JSON output](https://console.groq.com/docs/structured-outputs).

Documents/history are untrusted data, not instructions. The prompt distinguishes people,
CVs, employers and the uploading organization, prohibiting invented facts and disclosure
of authentication secrets. An organization named Forvia does not make an uploaded CV
a source describing Forvia.

| Outcome | API reason | Product behavior |
|---|---|---|
| Greeting/thanks | greeting | Short Groq reply, no sources or support case |
| Supported fact | documented_answer | Answer with verified source references |
| Ambiguous person/company | clarification_needed | Ask for precision; neither resolved nor a human case |
| Missing fact | insufficient_knowledge | Abstain; widget opens a human case |
| Risk/incident | documented_answer or insufficient_knowledge | Human follow-up; CV cybersecurity skills are not incidents |
| Provider outage/429/invalid evidence | llm_unavailable | Honest operational error, no business case |
| Retrieval outage | retrieval_unavailable | Operational error, not fake success |

`GROQ_MAX_TOKENS` bounds generated JSON including reasoning tokens (default 2048).
`GROQ_REASONING_EFFORT` is optional: use `low` for the current gpt-oss account, leave empty
when the selected model does not support this option. Reasoning is excluded from the reply,
but still consumes the output budget. See [Groq reasoning controls](https://console.groq.com/docs/reasoning).
Truncated/empty provider responses and empty supported answers are rejected. Unsupported
answers may have empty text: the server supplies its localized abstention. HTTP 429 has
code `rate_limit`, a distinct message and bounded
`retry_after_seconds` when supplied by Groq. Free-account quotas can still temporarily
prevent an answer. No runtime mock or silent fallback LLM is enabled. SDK debug payload
logging is disabled to avoid logging document bodies or credentials.

Citation checks prove that cited text exists, **not formal entailment or perfect factual
accuracy**. Prompt restrictions and phrase-based risk handling are not a complete security
classifier. Evaluate representative tenant questions before a sensitive production rollout.

## Startup and Model Changes

The API loads and warms local embeddings before accepting requests. A broken/missing model
fails startup instead of timing out the first user's question. The native launcher waits for
readiness; Compose allows a five-minute cold-start health-check grace period. The initial
download may need longer depending on network/hardware. The model cache persists locally
(`hf_cache` in Compose). After caching, use `HF_HUB_OFFLINE=1` or native
`--offline-embeddings`; Groq still requires Internet.

Migration 0006 records embedding identity. Reindexing uses **already stored text**, in
batches, without uploading private documents again or sending them to Groq:

```bash
cd backend
alembic upgrade head
python scripts/reindex_vectors.py --all
# Or select one organization:
python scripts/reindex_vectors.py --organization-id ORGANIZATION_UUID
```

Stop ingestion while changing the model. Reindexing is idempotent and rejects conflicting
concurrent text changes. Native `scripts/run_native.py` automatically reindexes stale
vectors before starting services. For Compose, after backup and model configuration change:

```bash
docker compose stop backend worker
docker compose run --rm migrate
docker compose run --rm --no-deps backend python scripts/reindex_vectors.py --all
docker compose up -d backend worker
```

Keep the 384-dimensional schema invariant. A dimension change requires a deliberate schema
migration and reindexing; incompatible dimensions fail model loading.

## Verification

```bash
cd backend
python scripts/verify_local_knowledge.py
# Also test real authenticated Groq/widget generation:
python scripts/verify_local_knowledge.py --groq
pytest -q
```

The helper creates a disposable migrated database, indexes a synthetic policy with actual
local embeddings, reopens connections and checks tenant exclusion. Without `--groq` no
generation is attempted. Unit/browser tests explicitly use deterministic providers **only
in ENVIRONMENT=test**; they do not prove real Groq.

The 6-8 October 2026 repair also reindexed nine native chunks, including the existing
seven-chunk CV. Live tenant API and independent-widget/browser verification are recorded
in [Testing](TESTING.md). Acceptance logs omit secrets and private CV bodies.
Linux/PostgreSQL runtime verification still requires the VM/Compose acceptance environment.
