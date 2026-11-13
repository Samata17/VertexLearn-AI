"""
Retrieval step of RAG (PRD 9.2, step 2): embed the question, then find the course's most
similar chunks with pgvector. `<=>` is cosine distance (0 = identical), so similarity = 1 - distance.
The `WHERE course_id = ...` filter is what keeps answers grounded in *this* course only.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.db import fetch_all
from app.rag.embeddings import embed_query

MIN_SIMILARITY = 0.35  # below this a chunk is unlikely to be about the question


def retrieve(course_id: str, question: str, k: int | None = None, lecture_id: str | None = None) -> list[dict]:
    k = k or get_settings().retrieval_top_k
    qv = embed_query(question)
    rows = fetch_all(
        """
        SELECT dc.id, dc.lecture_id, dc.chunk_text, dc.timestamp_seconds, dc.source_type, dc.source_name,
               l.title AS lecture_title, m.id AS module_id, m.title AS module_title,
               1 - (dc.embedding <=> %(qv)s) AS similarity
        FROM document_chunks dc
        JOIN lectures l ON l.id = dc.lecture_id
        JOIN modules m ON m.id = l.module_id
        WHERE dc.course_id = %(course_id)s AND dc.embedding IS NOT NULL
          AND (%(lecture_id)s::uuid IS NULL OR dc.lecture_id = %(lecture_id)s::uuid)
        ORDER BY dc.embedding <=> %(qv)s
        LIMIT %(k)s
        """,
        {"qv": qv, "course_id": course_id, "k": k, "lecture_id": lecture_id},
    )
    return [r for r in rows if float(r["similarity"]) >= MIN_SIMILARITY]


def format_context(chunks: list[dict]) -> str:
    """Numbered passages so the model can cite them as [1], [2], ..."""
    out = []
    for i, c in enumerate(chunks, 1):
        where = f"Lecture: {c['lecture_title']} (module: {c['module_title']})"
        if c.get("timestamp_seconds") is not None:
            t = int(c["timestamp_seconds"])
            where += f" at {t // 60}:{t % 60:02d}"
        if c.get("source_type") == "pdf" and c.get("source_name"):
            where += f", from {c['source_name']}"
        out.append(f"[{i}] {where}\n{c['chunk_text']}")
    return "\n\n".join(out)
