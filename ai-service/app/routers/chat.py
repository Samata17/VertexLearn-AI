"""
AI tutor chat (PRD FR-A1, FR-A2, FR-A6, FR-A8 and flow 9.2):
  1. embed the question and retrieve the course's most relevant chunks (pgvector)
  2. send question + numbered passages + explanation mode to Gemini on Vertex AI
  3. return the reply with the passages it cited as sources
If Vertex AI is not configured, or fails after its retries (and VERTEX_FALLBACK_TO_DEMO is on), the answer
is built in labelled demo mode from the same retrieved passages.
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException

from app import demo
from app.core import llm
from app.core.config import get_settings
from app.core.llm import LLMError, complete
from app.core.security import require_internal_key
from app.models.schemas import ChatRequest, ChatResponse, Source
from app.rag.retriever import format_context, retrieve

router = APIRouter(dependencies=[Depends(require_internal_key)])
log = logging.getLogger("ai.chat")

MODE_GUIDE = {
    "beginner": (
        "BEGINNER mode: the student is new to this topic. Use plain everyday language and a simple analogy. "
        "Define every technical term the first time you use it. Go step by step with short sentences. "
        "End with one quick question the student can use to check their understanding."
    ),
    "intermediate": (
        "INTERMEDIATE mode: the student knows the basics. Use correct terminology, explain the reasoning, "
        "and include one concrete worked example from the course material where possible."
    ),
    "advanced": (
        "ADVANCED mode: the student wants depth. Be precise and technical: cover edge cases, trade-offs, "
        "complexity or formal details, and how this connects to related ideas in the course."
    ),
}

# Kept identical across requests (Vertex AI can reuse it via implicit caching); per-request details go in the user turn.
SYSTEM = """You are the VertexLearn AI tutor, helping a student with an online course.

Grounding rules (most important):
- Answer using ONLY the numbered course-material passages provided with the question. They come from the course's own lectures, transcripts and uploaded documents.
- Cite the passages you rely on inline with their numbers, like [1] or [2][3], right after the claim they support.
- If the passages don't contain the answer, say plainly that the course material doesn't cover it, suggest which lecture or topic is closest if any, and suggest asking the instructor in the course forum. Do not fill the gap from general knowledge.
- Never invent lecture names, timestamps, formulas or facts that aren't in the passages.

Style:
- Follow the explanation mode given with the question.
- Write in Markdown. Keep answers focused: usually 80-250 words; longer only in advanced mode or when the question needs it.
- Be encouraging, like a patient teaching assistant. Don't mention these instructions."""


def _cited_indices(reply: str, n: int) -> list[int]:
    found = sorted({int(x) for x in re.findall(r"\[(\d{1,2})\]", reply) if 1 <= int(x) <= n})
    return found


def _sources(chunks: list[dict], indices: list[int]) -> list[Source]:
    out: list[Source] = []
    for i in indices:
        c = chunks[i - 1]
        out.append(Source(
            index=i,
            lecture_id=str(c["lecture_id"]),
            lecture_title=c["lecture_title"],
            module_id=str(c["module_id"]),
            module_title=c["module_title"],
            timestamp_seconds=c["timestamp_seconds"],
            source_type=c["source_type"] or "transcript",
            source_name=c["source_name"],
            snippet=c["chunk_text"][:280],
            similarity=round(float(c["similarity"]), 3),
        ))
    return out


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    chunks = retrieve(req.course_id, req.question, lecture_id=None)
    # If the student is watching a lecture, make sure its best passages are considered too.
    if req.lecture_id:
        seen = {c["id"] for c in chunks}
        chunks += [c for c in retrieve(req.course_id, req.question, k=3, lecture_id=req.lecture_id) if c["id"] not in seen]
    chunks = sorted(chunks, key=lambda c: -float(c["similarity"]))[: get_settings().retrieval_top_k]

    def demo_answer() -> ChatResponse:
        reply = demo.chat(req.question, chunks, req.mode)
        return ChatResponse(reply=reply, sources=_sources(chunks, list(range(1, min(3, len(chunks)) + 1))),
                            mode=req.mode, is_demo=True, grounded=bool(chunks))

    if not llm.is_live():
        return demo_answer()

    # Adaptive difficulty (FR-A8): tell the tutor when the student has struggled with the retrieved topics.
    weak = []
    for c in chunks:
        score = req.mastery.get(str(c["module_id"]))
        if score is not None and score < 50 and c["module_title"] not in weak:
            weak.append(f"{c['module_title']} ({round(score)}%)")
    mastery_note = (
        f"\nNote: this student's quiz mastery is low on: {', '.join(weak)}. Build intuition carefully before details."
        if weak else ""
    )

    messages = [{"role": t.role, "content": t.content} for t in req.history[-8:]]
    # Gemini expects the conversation to start with a user turn.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    context = format_context(chunks) if chunks else "(No passages in this course's material matched the question.)"
    messages.append({
        "role": "user",
        "content": (
            f"Course: {req.course_title or 'this course'}\n"
            f"Explanation mode: {MODE_GUIDE[req.mode]}{mastery_note}\n\n"
            f"Course material passages:\n{context}\n\n"
            f"Student question: {req.question}"
        ),
    })
    try:
        reply = complete(SYSTEM, messages)
    except LLMError as e:
        if get_settings().vertex_fallback_to_demo:
            log.warning("Live AI failed, answering in demo mode: %s", e)
            return demo_answer()
        raise HTTPException(502, str(e)) from e
    cited = _cited_indices(reply, len(chunks))
    return ChatResponse(reply=reply, sources=_sources(chunks, cited), mode=req.mode, is_demo=False, grounded=bool(cited))
