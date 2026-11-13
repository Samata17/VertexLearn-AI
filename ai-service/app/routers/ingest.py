"""
Ingestion (PRD 9.3: "document chunking + embedding generation on new lecture material").
Reads a lecture's transcript and uploaded PDFs/text files, chunks them, embeds each chunk,
and replaces that lecture's rows in document_chunks.
"""
from __future__ import annotations

import io
import logging
import os

import boto3
from fastapi import APIRouter, Depends, HTTPException
from pypdf import PdfReader

from app.core.config import get_settings
from app.core.db import conn, fetch_one
from app.core.security import require_internal_key
from app.models.schemas import IngestRequest
from app.rag.chunking import chunk_text
from app.rag.embeddings import embed_passages

log = logging.getLogger("ai.ingest")
router = APIRouter(dependencies=[Depends(require_internal_key)])


def _s3():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        region_name=s.s3_region,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
    )


def display_name(key: str) -> str:
    base = key.rsplit("/", 1)[-1]
    parts = base.split("-", 2)
    return parts[2] if len(parts) == 3 and parts[0].isdigit() else base


def extract_resource_text(stored: str) -> tuple[str, str] | None:
    """Returns (filename, text) for supported resources, or None."""
    if not stored.startswith("s3://"):
        return None
    key = stored[5:]
    ext = os.path.splitext(key)[1].lower()
    if ext not in (".pdf", ".txt", ".md"):
        return None
    body = _s3().get_object(Bucket=get_settings().s3_bucket, Key=key)["Body"].read()
    name = display_name(key)
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(body))
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
        return name, "\n\n".join(p for p in pages if p)
    return name, body.decode("utf-8", errors="ignore")


def set_status(lecture_id: str, status: str):
    with conn() as c:
        c.execute("UPDATE lectures SET ingest_status = %s WHERE id = %s", (status, lecture_id))


@router.post("/ingest/lecture")
def ingest_lecture(req: IngestRequest):
    s = get_settings()
    lec = fetch_one(
        """SELECT l.id, l.title, l.transcript, l.duration_seconds, l.resource_urls, m.course_id
           FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = %s""",
        (req.lecture_id,),
    )
    if not lec:
        raise HTTPException(404, "Lecture not found")
    set_status(req.lecture_id, "processing")
    try:
        rows: list[dict] = []
        for ch in chunk_text(lec["transcript"] or "", s.chunk_size, s.chunk_overlap, lec["duration_seconds"]):
            rows.append({"text": ch.text, "index": ch.index, "ts": ch.timestamp_seconds, "type": "transcript", "name": None})
        skipped: list[str] = []
        for stored in lec["resource_urls"] or []:
            try:
                res = extract_resource_text(stored)
            except Exception as e:  # noqa: BLE001
                log.warning("Could not read resource %s: %s", stored, e)
                res = None
            if not res:
                skipped.append(display_name(stored))
                continue
            name, text = res
            for ch in chunk_text(text, s.chunk_size, s.chunk_overlap):
                rows.append({"text": ch.text, "index": len(rows), "ts": None, "type": "pdf" if name.lower().endswith(".pdf") else "text", "name": name})

        # Lecture title is prepended for embedding only — helps match questions that name the topic.
        vectors = embed_passages([f"{lec['title']}: {r['text']}" for r in rows])
        with conn() as c:
            with c.transaction():
                c.execute("DELETE FROM document_chunks WHERE lecture_id = %s", (req.lecture_id,))
                with c.cursor() as cur:
                    for r, v in zip(rows, vectors):
                        cur.execute(
                            """INSERT INTO document_chunks (course_id, lecture_id, chunk_index, source_type, source_name,
                                   timestamp_seconds, chunk_text, embedding)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                            (lec["course_id"], req.lecture_id, r["index"], r["type"], r["name"], r["ts"], r["text"], v),
                        )
                c.execute("UPDATE lectures SET ingest_status = 'ready' WHERE id = %s", (req.lecture_id,))
        log.info("Ingested lecture %s: %d chunks", req.lecture_id, len(rows))
        return {"lecture_id": req.lecture_id, "chunks": len(rows), "skipped_files": skipped}
    except Exception:
        set_status(req.lecture_id, "failed")
        raise
