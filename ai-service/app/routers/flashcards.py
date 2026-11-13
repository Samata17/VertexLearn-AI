"""Flashcard generation per module (PRD FR-A7).
A live-AI failure returns an error (not demo cards), because the deck is saved and shared with every student."""
from fastapi import APIRouter, Depends, HTTPException

from app import demo
from app.core import llm
from app.core.llm import LLMError, complete_json
from app.core.security import require_internal_key
from app.models.schemas import FlashcardRequest
from app.routers.material import module_material

router = APIRouter(dependencies=[Depends(require_internal_key)])

SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}},
                "required": ["question", "answer"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cards"],
    "additionalProperties": False,
}

SYSTEM = (
    "You create spaced-repetition flashcards from course material. Each card tests one idea. "
    "Questions are specific; answers are 1-3 sentences, accurate to the material, and self-contained. "
    "Cover the module's most important concepts, definitions and procedures. Use only the provided material."
)


@router.post("/flashcards")
def flashcards(req: FlashcardRequest):
    mod, text = module_material(req.module_id)
    if not llm.is_live():
        cards = demo.flashcards(text, req.count)
        return {"cards": cards, "is_demo": True, "module_title": mod["title"]}
    prompt = f"Module: {mod['title']} (course: {mod['course_title']})\nCreate {req.count} flashcards.\n\n<material>\n{text}\n</material>"
    try:
        data = complete_json(SYSTEM, prompt, SCHEMA)
    except LLMError as e:
        raise HTTPException(502, str(e)) from e
    return {"cards": data["cards"][: req.count], "is_demo": False, "module_title": mod["title"]}
