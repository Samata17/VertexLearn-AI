"""
Vertex AI integration tests. A fake client stands in for Google's API, but responses and errors are the
SDK's own types, so request building, retries, error mapping, safety handling and structured-output
validation are exercised exactly as in production. No network, credentials or database needed.
"""
from __future__ import annotations

import json

import google.auth
import httpx
import pytest
from fastapi.testclient import TestClient
from google.auth import exceptions as auth_exceptions
from google.genai import errors, types

from app.core import llm, schema_check
from app.core.config import get_settings
from app.main import app
from app.routers import flashcards as flashcards_router
from app.routers import quiz_gen, summarize
from app.routers import chat as chat_router

KEY = {"X-Internal-Key": "dev-internal-ai-key"}
SUMMARY_SCHEMA = summarize.SCHEMA


# ---------------------------------------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------------------------------------
def response(text: str, finish: str = "STOP", thought: str | None = None) -> types.GenerateContentResponse:
    parts = ([types.Part(text=thought, thought=True)] if thought else []) + [types.Part(text=text)]
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts), finish_reason=finish)]
    )


def api_error(code: int, message: str = "error") -> errors.APIError:
    cls = errors.ServerError if code >= 500 else errors.ClientError
    return cls(code, {"error": {"code": code, "message": message, "status": "X"}})


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes):
        self.models = FakeModels(outcomes)


@pytest.fixture
def live(monkeypatch):
    """Vertex AI 'configured with credentials', talking to a FakeClient. Returns a function to load outcomes."""
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    get_settings.cache_clear()
    sleeps: list[float] = []
    llm._sleep = sleeps.append

    def use(*outcomes):
        llm._status = llm.VertexStatus(True, "ok", "", "gemini-test", "us-central1")
        llm._client = FakeClient(outcomes)
        return llm._client.models

    use.sleeps = sleeps
    return use


# ---------------------------------------------------------------------------------------------------------
# Configuration, credentials and mode detection
# ---------------------------------------------------------------------------------------------------------
def test_defaults():
    s = get_settings()
    assert s.vertex_model == "gemini-3.8-flash"
    assert s.google_cloud_location == "global"
    assert not s.vertex_configured


def test_not_configured_runs_demo(monkeypatch):
    called = []
    monkeypatch.setattr(google.auth, "default", lambda **kw: called.append(kw))
    st = llm.status()
    assert (st.live, st.reason) == (False, "not_configured")
    assert not called, "credentials are not looked up when Vertex AI is not configured"


def test_missing_credentials_runs_demo(monkeypatch, tmp_path):
    empty = tmp_path / "gcp.json"
    empty.write_text("")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "p")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(empty))
    get_settings.cache_clear()

    def no_creds(**_):
        raise auth_exceptions.DefaultCredentialsError("Your default credentials were not found.")

    monkeypatch.setattr(google.auth, "default", no_creds)
    st = llm.status()
    assert (st.live, st.reason) == (False, "no_credentials")
    assert "credentials were not found" in st.detail
    import os
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ, "an empty key file is ignored, not fatal"


def test_credentials_found_builds_vertex_client(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "europe-west4")
    monkeypatch.setenv("VERTEX_MODEL", "gemini-custom")
    get_settings.cache_clear()
    creds = object()
    monkeypatch.setattr(google.auth, "default", lambda scopes: (creds, "my-proj"))
    built = {}
    monkeypatch.setattr(llm.genai, "Client", lambda **kw: built.update(kw) or "client")
    st = llm.status()
    assert st.live and st.model == "gemini-custom" and st.location == "europe-west4"
    assert llm.client() == "client"
    assert built == {"vertexai": True, "project": "my-proj", "location": "europe-west4", "credentials": creds}


def test_health_reports_provider_and_demo_reason(monkeypatch):
    import app.main as main

    def no_db(**_):
        raise RuntimeError("no database in unit tests")

    monkeypatch.setattr(main, "get_pool", lambda: type("P", (), {"connection": staticmethod(no_db)})())
    body = TestClient(app).get("/health").json()
    assert body["provider"] == "vertex-ai"
    assert body["mode"] == "demo" and body["model"] is None and body["demo_reason"] == "not_configured"


# ---------------------------------------------------------------------------------------------------------
# Request building
# ---------------------------------------------------------------------------------------------------------
def test_chat_request_shape(live, monkeypatch):
    monkeypatch.setenv("VERTEX_THINKING_BUDGET", "512")
    get_settings.cache_clear()
    models = live(response("Hello [1]", thought="private reasoning"))
    out = llm.complete("SYSTEM", [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"},
                                  {"role": "user", "content": "q2"}], max_tokens=1234)
    assert out == "Hello [1]", "thought parts are never returned to the user"
    call = models.calls[0]
    cfg: types.GenerateContentConfig = call["config"]
    assert call["model"] == get_settings().vertex_model
    assert [c.role for c in call["contents"]] == ["user", "model", "user"]
    assert cfg.system_instruction == "SYSTEM"
    assert cfg.max_output_tokens == 1234
    assert cfg.thinking_config.thinking_budget == 512
    assert cfg.http_options.timeout == int(get_settings().vertex_timeout_seconds * 1000)
    assert cfg.response_mime_type is None


def test_attempt_timeout_never_exceeds_overall_deadline(live, monkeypatch):
    monkeypatch.setenv("VERTEX_TOTAL_TIMEOUT_SECONDS", "10")
    get_settings.cache_clear()
    models = live(response("ok"))
    llm.complete("S", [{"role": "user", "content": "q"}])
    assert models.calls[0]["config"].http_options.timeout <= 10_000


# ---------------------------------------------------------------------------------------------------------
# Retries and error handling
# ---------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("failure", [api_error(503), api_error(429), api_error(500), httpx.ReadTimeout("slow"),
                                     httpx.ConnectError("down")])
def test_transient_failures_are_retried(live, failure):
    models = live(failure, response("recovered"))
    assert llm.complete("S", [{"role": "user", "content": "q"}]) == "recovered"
    assert len(models.calls) == 2
    assert len(live.sleeps) == 1 and 0 < live.sleeps[0] <= 8


@pytest.mark.parametrize("code,needle", [(400, "rejected the request"), (403, "credentials"), (404, "not available")])
def test_client_errors_are_not_retried(live, code, needle):
    models = live(api_error(code, "nope"))
    with pytest.raises(llm.LLMError) as e:
        llm.complete("S", [{"role": "user", "content": "q"}])
    assert len(models.calls) == 1 and needle in str(e.value)
    assert "nope" not in str(e.value), "provider details stay in server logs"


def test_gives_up_after_max_attempts(live):
    models = live(api_error(503), api_error(503), api_error(503), response("never reached"))
    with pytest.raises(llm.LLMError) as e:
        llm.complete("S", [{"role": "user", "content": "q"}])
    assert len(models.calls) == get_settings().vertex_max_attempts == 3
    assert e.value.retryable and "temporarily unavailable" in str(e.value)
    assert len(live.sleeps) == 2


def test_expired_credentials_are_not_retried(live):
    models = live(auth_exceptions.RefreshError("invalid_grant"))
    with pytest.raises(llm.LLMError, match="credentials"):
        llm.complete("S", [{"role": "user", "content": "q"}])
    assert len(models.calls) == 1


@pytest.mark.parametrize("finish", ["SAFETY", "PROHIBITED_CONTENT", "RECITATION"])
def test_safety_blocks_raise_and_are_not_retried(live, finish):
    models = live(response("partial", finish=finish))
    with pytest.raises(llm.LLMError, match="declined"):
        llm.complete("S", [{"role": "user", "content": "q"}])
    assert len(models.calls) == 1


def test_blocked_prompt(live):
    blocked = types.GenerateContentResponse(prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason="SAFETY"))
    live(blocked)
    with pytest.raises(llm.LLMError, match="declined"):
        llm.complete("S", [{"role": "user", "content": "q"}])


def test_empty_response(live):
    live(types.GenerateContentResponse(candidates=[]))
    with pytest.raises(llm.LLMError, match="empty"):
        llm.complete("S", [{"role": "user", "content": "q"}])


# ---------------------------------------------------------------------------------------------------------
# Structured output (JSON schema)
# ---------------------------------------------------------------------------------------------------------
GOOD_SUMMARY = {"summary": "s", "key_points": ["a", "b"], "key_terms": [{"term": "t", "definition": "d"}]}


def test_json_output_uses_schema_and_validates(live):
    models = live(response(json.dumps(GOOD_SUMMARY)))
    assert llm.complete_json("S", "prompt", SUMMARY_SCHEMA) == GOOD_SUMMARY
    cfg = models.calls[0]["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_json_schema == SUMMARY_SCHEMA
    assert cfg.max_output_tokens == get_settings().vertex_generation_max_tokens


def test_invalid_json_is_retried_once(live):
    models = live(response("{not json"), response(json.dumps(GOOD_SUMMARY)))
    assert llm.complete_json("S", "p", SUMMARY_SCHEMA) == GOOD_SUMMARY
    assert len(models.calls) == 2


def test_schema_violations_are_rejected(live):
    bad = {"summary": "s", "key_points": "not a list", "key_terms": []}
    live(response(json.dumps(bad)), response(json.dumps({**GOOD_SUMMARY, "extra": 1})))
    with pytest.raises(llm.LLMError, match="unexpected format"):
        llm.complete_json("S", "p", SUMMARY_SCHEMA)


def test_truncated_json_is_an_error(live):
    live(response('{"summary": "s", "key_po', finish="MAX_TOKENS"))
    with pytest.raises(llm.LLMError, match="too long"):
        llm.complete_json("S", "p", SUMMARY_SCHEMA)


def test_schema_rejected_by_model_falls_back_to_plain_json(live):
    models = live(api_error(400, "Invalid JSON schema: additionalProperties"), response(json.dumps(GOOD_SUMMARY)))
    assert llm.complete_json("S", "p", SUMMARY_SCHEMA) == GOOD_SUMMARY
    second = models.calls[1]
    assert second["config"].response_json_schema is None
    assert second["config"].response_mime_type == "application/json"
    assert '"key_terms"' in second["contents"][0].parts[0].text, "schema is given in the prompt instead"


def test_schema_check_on_real_feature_schemas():
    q = {"title": "T", "questions": [{"question_text": "Q", "question_type": "mcq", "explanation": "E",
                                      "options": [{"option_text": "a", "is_correct": True}]}]}
    assert schema_check.is_valid(q, quiz_gen.SCHEMA)
    q["questions"][0]["question_type"] = "essay"
    assert any("not one of" in p for p in schema_check.errors(q, quiz_gen.SCHEMA))
    assert schema_check.errors({"cards": [{"question": "q"}]}, flashcards_router.SCHEMA) == ["$.cards[0]: missing required field 'answer'"]
    assert not schema_check.is_valid({"week": True}, {"type": "object", "properties": {"week": {"type": "integer"}}})


# ---------------------------------------------------------------------------------------------------------
# Routers: live answers, citations and the demo fallback
# ---------------------------------------------------------------------------------------------------------
LECTURE = ({"title": "Quicksort", "module_title": "Sorting", "course_title": "DSA"}, "Quicksort picks a pivot element. " * 20)


def test_summarize_live(live, monkeypatch):
    monkeypatch.setattr(summarize, "lecture_material", lambda _id: LECTURE)
    live(response(json.dumps(GOOD_SUMMARY)))
    r = TestClient(app).post("/summarize", json={"lecture_id": "l1"}, headers=KEY)
    assert r.status_code == 200
    assert r.json() == {**GOOD_SUMMARY, "is_demo": False, "lecture_title": "Quicksort"}


def test_summarize_falls_back_to_labelled_demo(live, monkeypatch):
    monkeypatch.setattr(summarize, "lecture_material", lambda _id: LECTURE)
    live(api_error(503), api_error(503), api_error(503))
    r = TestClient(app).post("/summarize", json={"lecture_id": "l1"}, headers=KEY)
    assert r.status_code == 200 and r.json()["is_demo"] is True
    assert "Demo mode" in r.json()["summary"]


def test_summarize_without_fallback_returns_502(live, monkeypatch):
    monkeypatch.setenv("VERTEX_FALLBACK_TO_DEMO", "false")
    get_settings.cache_clear()
    monkeypatch.setattr(summarize, "lecture_material", lambda _id: LECTURE)
    live(api_error(403))
    r = TestClient(app).post("/summarize", json={"lecture_id": "l1"}, headers=KEY)
    assert r.status_code == 502 and "credentials" in r.json()["detail"]


def test_quiz_generation_failure_is_an_error_not_a_demo_draft(live, monkeypatch):
    monkeypatch.setattr(quiz_gen, "lecture_material", lambda _id: LECTURE)
    live(api_error(503), api_error(503), api_error(503))
    r = TestClient(app).post("/generate-quiz", json={"lecture_id": "l1", "num_questions": 3}, headers=KEY)
    assert r.status_code == 502


def test_chat_live_keeps_course_citations(live, monkeypatch):
    chunk = lambda i, sim: {  # noqa: E731
        "id": i, "lecture_id": f"lec{i}", "lecture_title": f"Lecture {i}", "module_id": "m1", "module_title": "Sorting",
        "timestamp_seconds": 60 * i, "source_type": "transcript", "source_name": None,
        "chunk_text": f"Passage {i} about pivots.", "similarity": sim,
    }
    monkeypatch.setattr(chat_router, "retrieve", lambda *a, **k: [chunk(1, 0.9), chunk(2, 0.8)])
    models = live(response("Sorted input gives unbalanced partitions [2]."))
    r = TestClient(app).post("/chat", headers=KEY, json={
        "course_id": "c1", "question": "Why O(n^2)?", "mode": "beginner",
        "history": [{"role": "assistant", "content": "hi"}, {"role": "user", "content": "earlier"},
                    {"role": "assistant", "content": "answer"}],
    })
    body = r.json()
    assert r.status_code == 200 and body["is_demo"] is False and body["grounded"] is True
    assert [s["index"] for s in body["sources"]] == [2] and body["sources"][0]["timestamp_seconds"] == 120
    sent = models.calls[0]["contents"]
    assert [c.role for c in sent] == ["user", "model", "user"], "leading assistant turn dropped; roles mapped"
    assert "[2] " in sent[-1].parts[0].text or "[2]" in sent[-1].parts[0].text
    assert "BEGINNER mode" in sent[-1].parts[0].text


def test_chat_demo_when_not_configured(monkeypatch):
    monkeypatch.setattr(chat_router, "retrieve", lambda *a, **k: [])
    r = TestClient(app).post("/chat", headers=KEY, json={"course_id": "c1", "question": "hi"})
    assert r.status_code == 200 and r.json()["is_demo"] is True and "Demo mode" in r.json()["reply"]
