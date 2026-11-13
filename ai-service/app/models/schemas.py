"""Request/response models (Pydantic validates every request automatically)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal["beginner", "intermediate", "advanced"]


class IngestRequest(BaseModel):
    lecture_id: str


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)


class ChatRequest(BaseModel):
    course_id: str
    course_title: str = ""
    question: str = Field(min_length=1, max_length=4000)
    mode: Mode = "intermediate"
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    lecture_id: str | None = None  # optional: focus on the lecture being watched
    mastery: dict[str, float] = Field(default_factory=dict)  # module_id -> 0..100


class Source(BaseModel):
    index: int
    lecture_id: str
    lecture_title: str
    module_id: str
    module_title: str
    timestamp_seconds: int | None
    source_type: str
    source_name: str | None
    snippet: str
    similarity: float


class ChatResponse(BaseModel):
    reply: str
    sources: list[Source]
    mode: Mode
    is_demo: bool
    grounded: bool


class LectureRequest(BaseModel):
    lecture_id: str


class QuizRequest(BaseModel):
    lecture_id: str
    num_questions: int = Field(default=6, ge=3, le=10)  # PRD FR-A5: 5-10
    difficulty: Mode = "intermediate"


class FlashcardRequest(BaseModel):
    module_id: str
    count: int = Field(default=10, ge=3, le=25)


class PlanLecture(BaseModel):
    id: str
    title: str
    completed: bool = False
    duration_seconds: int | None = None


class PlanModule(BaseModel):
    id: str
    title: str
    mastery: float | None = None
    lectures: list[PlanLecture] = Field(default_factory=list)


class PlanAttempt(BaseModel):
    quiz_title: str
    module_title: str
    score: float
    submitted_at: str | None = None


class StudyPlanRequest(BaseModel):
    course_title: str
    modules: list[PlanModule]
    attempts: list[PlanAttempt] = Field(default_factory=list)
    weeks: int = Field(default=2, ge=1, le=12)
    hours_per_week: int = Field(default=5, ge=1, le=40)
    goal: str | None = Field(default=None, max_length=500)
