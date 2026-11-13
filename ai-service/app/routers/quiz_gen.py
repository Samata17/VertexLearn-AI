"""
Automatic quiz generation (PRD FR-A5). Output is a *draft* the instructor reviews and edits
before publishing (FR-I4) — the backend saves it with status = 'draft'.
A live-AI failure returns an error (not a demo quiz), because the draft is saved permanently.
"""
from fastapi import APIRouter, Depends, HTTPException

from app import demo
from app.core import llm
from app.core.llm import LLMError, complete_json
from app.core.security import require_internal_key
from app.models.schemas import QuizRequest
from app.routers.material import lecture_material

router = APIRouter(dependencies=[Depends(require_internal_key)])

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_text": {"type": "string"},
                    "question_type": {"type": "string", "enum": ["mcq", "multi_select", "short_answer"]},
                    "explanation": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"option_text": {"type": "string"}, "is_correct": {"type": "boolean"}},
                            "required": ["option_text", "is_correct"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["question_text", "question_type", "explanation", "options"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "questions"],
    "additionalProperties": False,
}

SYSTEM = """You write assessment questions for an online course, based only on the lecture material given.

Rules for each question type:
- mcq: exactly 4 options, exactly 1 correct. Distractors must be plausible misconceptions, not jokes.
- multi_select: 4-5 options, 2-3 correct. Say "Select all that apply." in the question.
- short_answer: the answer is a single word, number or short phrase (max 4 words). Put 1-3 accepted spellings/variants in options, all with is_correct true.

Mix: mostly mcq, at least one multi_select and one short_answer when there are 5 or more questions.
Test understanding, not trivia about the speaker. The explanation says why the answer is right, citing the lecture's reasoning."""


def _valid(q: dict) -> bool:
    correct = sum(1 for o in q["options"] if o["is_correct"])
    if q["question_type"] == "short_answer":
        return correct >= 1
    if len(q["options"]) < 2:
        return False
    return correct == 1 if q["question_type"] == "mcq" else correct >= 1


@router.post("/generate-quiz")
def generate_quiz(req: QuizRequest):
    lec, text = lecture_material(req.lecture_id)
    if not llm.is_live():
        qs = demo.quiz(text, req.num_questions)
        if len(qs) < 2:
            raise HTTPException(422, "Not enough lecture material to build a demo quiz. Add a longer transcript.")
        return {"title": f"[Demo] Quiz: {lec['title']}", "questions": qs, "is_demo": True}
    prompt = (
        f"Lecture: {lec['title']} (module: {lec['module_title']}, course: {lec['course_title']})\n"
        f"Write {req.num_questions} questions at {req.difficulty} difficulty.\n\n<material>\n{text}\n</material>"
    )
    try:
        data = complete_json(SYSTEM, prompt, SCHEMA)
    except LLMError as e:
        raise HTTPException(502, str(e)) from e
    questions = [q for q in data["questions"] if _valid(q)][: req.num_questions]
    if not questions:
        raise HTTPException(502, "The AI did not return usable questions. Please try again.")
    return {"title": data["title"] or f"Quiz: {lec['title']}", "questions": questions, "is_demo": False}
