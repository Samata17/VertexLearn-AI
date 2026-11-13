"""Lecture summarization (PRD FR-A3)."""
import logging

from fastapi import APIRouter, Depends, HTTPException

from app import demo
from app.core import llm
from app.core.config import get_settings
from app.core.llm import LLMError, complete_json
from app.core.security import require_internal_key
from app.models.schemas import LectureRequest
from app.routers.material import lecture_material

router = APIRouter(dependencies=[Depends(require_internal_key)])
log = logging.getLogger("ai.summarize")

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "3-5 sentence overview of the lecture"},
        "key_points": {"type": "array", "items": {"type": "string"}, "description": "5-8 key takeaways"},
        "key_terms": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"term": {"type": "string"}, "definition": {"type": "string"}},
                "required": ["term", "definition"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "key_points", "key_terms"],
    "additionalProperties": False,
}

SYSTEM = (
    "You summarize lecture material for students revising a course. Use only the provided material. "
    "Key points are self-contained sentences a student could revise from. Key terms (3-6) use the lecture's own definitions."
)


@router.post("/summarize")
def summarize(req: LectureRequest):
    lec, text = lecture_material(req.lecture_id)
    if llm.is_live():
        prompt = f"Course: {lec['course_title']}\nModule: {lec['module_title']}\nLecture: {lec['title']}\n\n<material>\n{text}\n</material>\n\nSummarize this lecture."
        try:
            data = complete_json(SYSTEM, prompt, SCHEMA)
            return {**data, "is_demo": False, "lecture_title": lec["title"]}
        except LLMError as e:
            if not get_settings().vertex_fallback_to_demo:
                raise HTTPException(502, str(e)) from e
            log.warning("Live AI failed, summarizing in demo mode: %s", e)
    return {**demo.summarize(text, lec["title"]), "is_demo": True, "lecture_title": lec["title"]}
