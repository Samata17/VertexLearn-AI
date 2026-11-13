"""Personalized study plan from quiz history and topic mastery (PRD FR-A4)."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from app import demo
from app.core import llm
from app.core.config import get_settings
from app.core.llm import LLMError, complete_json
from app.core.security import require_internal_key
from app.models.schemas import StudyPlanRequest

router = APIRouter(dependencies=[Depends(require_internal_key)])
log = logging.getLogger("ai.study_plan")

SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "weekly_hours": {"type": "integer"},
        "weeks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "week": {"type": "integer"},
                    "focus": {"type": "string"},
                    "goals": {"type": "array", "items": {"type": "string"}},
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "type": {"type": "string", "enum": ["watch", "review", "quiz", "practice", "ask_tutor"]},
                                "lecture_id": {"type": "string", "description": "id of a lecture from the input, or empty string"},
                                "minutes": {"type": "integer"},
                            },
                            "required": ["title", "type", "lecture_id", "minutes"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["week", "focus", "goals", "tasks"],
                "additionalProperties": False,
            },
        },
        "tips": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["overview", "weekly_hours", "weeks", "tips"],
    "additionalProperties": False,
}

SYSTEM = """You are a learning coach creating a realistic personalized study plan for one course.
- Prioritize modules with low mastery scores and unfinished lectures; revisit weak topics before moving on.
- Keep each week's total task minutes within the student's weekly hours.
- Only reference lecture ids that appear in the input (or use an empty string).
- Speak to the student directly ("you"), warmly and concretely. 3-5 practical tips."""


@router.post("/study-plan")
def study_plan(req: StudyPlanRequest):
    modules = [m.model_dump() for m in req.modules]

    def demo_plan() -> dict:
        return {**demo.study_plan(req.course_title, modules, req.weeks, req.hours_per_week), "is_demo": True}

    if not llm.is_live():
        return demo_plan()
    data = {
        "course": req.course_title,
        "weeks_available": req.weeks,
        "hours_per_week": req.hours_per_week,
        "student_goal": req.goal,
        "modules": modules,
        "recent_quiz_attempts": [a.model_dump() for a in req.attempts[:30]],
    }
    prompt = f"Create a {req.weeks}-week plan from this learner data:\n{json.dumps(data, indent=1)}"
    try:
        plan = complete_json(SYSTEM, prompt, SCHEMA)
    except LLMError as e:
        if get_settings().vertex_fallback_to_demo:
            log.warning("Live AI failed, building a demo plan: %s", e)
            return demo_plan()
        raise HTTPException(502, str(e)) from e
    valid_ids = {l.id for m in req.modules for l in m.lectures}
    for w in plan["weeks"]:
        for t in w["tasks"]:
            if t["lecture_id"] not in valid_ids:
                t["lecture_id"] = ""
    return {**plan, "is_demo": False}
