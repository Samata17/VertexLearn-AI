"""Helpers that load the source text for summaries, quizzes and flashcards."""
from __future__ import annotations

from fastapi import HTTPException

from app.core.db import fetch_all, fetch_one

MAX_CHARS = 400_000  # far below the model's context window; guards against pathological uploads


def lecture_material(lecture_id: str) -> tuple[dict, str]:
    lec = fetch_one(
        """SELECT l.id, l.title, l.transcript, m.title AS module_title, c.title AS course_title
           FROM lectures l JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id WHERE l.id = %s""",
        (lecture_id,),
    )
    if not lec:
        raise HTTPException(404, "Lecture not found")
    text = (lec["transcript"] or "").strip()
    # Include uploaded document text (already extracted into chunks during ingestion).
    docs = fetch_all(
        "SELECT chunk_text FROM document_chunks WHERE lecture_id = %s AND source_type <> 'transcript' ORDER BY chunk_index",
        (lecture_id,),
    )
    if docs:
        text += "\n\n" + "\n".join(d["chunk_text"] for d in docs)
    text = text.strip()
    if not text:
        raise HTTPException(422, "This lecture has no transcript or readable documents yet. Add a transcript or a PDF first.")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"This lecture's material is too long to process at once ({len(text):,} characters).")
    return lec, text


def module_material(module_id: str) -> tuple[dict, str]:
    mod = fetch_one(
        "SELECT m.id, m.title, c.title AS course_title FROM modules m JOIN courses c ON c.id = m.course_id WHERE m.id = %s",
        (module_id,),
    )
    if not mod:
        raise HTTPException(404, "Module not found")
    lectures = fetch_all("SELECT id, title, transcript FROM lectures WHERE module_id = %s ORDER BY order_index", (module_id,))
    parts = []
    for l in lectures:
        body = (l["transcript"] or "").strip()
        if not body:
            rows = fetch_all("SELECT chunk_text FROM document_chunks WHERE lecture_id = %s ORDER BY chunk_index", (l["id"],))
            body = "\n".join(r["chunk_text"] for r in rows)
        if body:
            parts.append(f"## Lecture: {l['title']}\n{body}")
    text = "\n\n".join(parts).strip()
    if not text:
        raise HTTPException(422, "This module has no lecture transcripts or documents yet.")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"This module's material is too long to process at once ({len(text):,} characters).")
    return mod, text
