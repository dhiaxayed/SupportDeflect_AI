"""Local hybrid ranking; similarity orders evidence but never certifies an answer.

Vector-store callers supply tenant-filtered candidates. Accent-folded lexical
matching and reciprocal-rank fusion choose context, while verbatim passage IDs
let RAG attach source excerpts without trusting model-retyped quotations.
"""

import re
import unicodedata

from rank_bm25 import BM25Plus

from app.services.vector_store import RetrievedChunk

STOP_WORDS = set(
    (
        "a an the of for to is who what how and or in on my your this that about me it "
        "de du des le la les un une et ou en est qui que quoi moi mon ma mes ton ta tes "
        "ce cette cet ses son sa c il elle parle donne quelles quels sont"
    ).split()
)


def lexical_tokens(text: str) -> list[str]:
    """Return accent-folded lowercase word tokens after short-word/stop-word removal.

    The same normalization feeds sparse ranking and query matching, allowing
    French accents and case variants to match without changing stored source text.
    """
    folded = "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c))
    return [word for word in re.findall(r"\w+", folded) if len(word) > 1 and word not in STOP_WORDS]


def evidence_passages(text: str) -> list[str]:
    """Group source lines into stable numbered-passage candidates without retyping content.

    Accumulate roughly 350 characters before splitting at line boundaries; long
    lines may exceed that size and tiny trailing fragments join the previous passage.
    Return stripped original excerpts for model ID selection and later verification.
    """
    # Keep source text verbatim; the model selects stable IDs rather than retyping/translating quotes.
    passages: list[str] = []
    current = ""
    for line in text.splitlines(keepends=True):
        current += line
        if len(current) >= 350:
            passages.append(current.strip())
            current = ""
    if current.strip():
        if len(current.strip()) < 8 and passages:
            passages[-1] += "\n" + current.strip()
        else:
            passages.append(current.strip())
    return passages


def key(chunk: RetrievedChunk) -> tuple[str, int]:
    """Return a document/chunk-index identity for already tenant-filtered retrieval results.

    Required metadata must exist and the index must be numeric; invalid metadata
    raises rather than merging unrelated chunks. Tenant filtering belongs upstream.
    """
    return str(chunk.metadata["document_id"]), int(chunk.metadata["chunk_index"])


def hybrid_rank(
    dense: list[RetrievedChunk], candidates: list[RetrievedChunk], query: str, top_k: int
) -> list[RetrievedChunk]:
    """Fuse dense and matching BM25Plus rankings into at most top_k unique chunks.

    Use reciprocal ranks, excluding BM25Plus's nonzero baseline for nonmatching
    text. Preserve dense-first chunk objects/scores while deduplicating by document
    and index. Inputs must already share tenant scope; no database or model calls occur.
    """
    tokens = lexical_tokens(query)
    corpus = [lexical_tokens(f"{item.metadata.get('title', '')} {item.text}") for item in candidates]
    sparse: list[RetrievedChunk] = []
    if tokens and any(corpus):
        scores = BM25Plus(corpus).get_scores(tokens)
        # BM25Plus has a nonzero baseline. Only actual term matches belong in the lexical list.
        matches = [
            (item, score)
            for item, words, score in zip(candidates, corpus, scores, strict=True)
            if set(tokens).intersection(words)
        ]
        sparse = [item for item, _ in sorted(matches, key=lambda item: item[1], reverse=True)]
    fused: dict[tuple[str, int], float] = {}
    items: dict[tuple[str, int], RetrievedChunk] = {}
    for ranking in (dense, sparse):
        for rank, item in enumerate(ranking, start=1):
            identity = key(item)
            fused[identity] = fused.get(identity, 0) + 1 / (60 + rank)
            items.setdefault(identity, item)
    return [items[identity] for identity in sorted(fused, key=lambda identity: fused[identity], reverse=True)[:top_k]]
