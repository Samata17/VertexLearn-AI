"""
Google Cloud Vertex AI (Gemini) client wrapper — the only module that talks to the AI model.

- Official Google Gen AI SDK (`google-genai`) in Vertex AI mode: project, location and model come from
  GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION / VERTEX_MODEL.
- Authentication: Google Application Default Credentials (service-account key file via
  GOOGLE_APPLICATION_CREDENTIALS, `gcloud auth application-default login`, or the attached service account
  on Google Cloud). Credentials live only in this server-side container.
- Mode is decided once at startup by status():
    live  — project set and credentials found
    demo  — project not set, or no usable credentials (the reason is logged and reported by /health)
- Every call has a per-attempt timeout and an overall deadline, and retries 408/429/5xx, timeouts and
  network errors with exponential backoff + jitter. 4xx errors (bad request, permissions, unknown model)
  and safety blocks are not retried.
- Structured output: the feature's JSON schema is sent as `response_json_schema`, and the reply is still
  validated here (app.core.schema_check) before anything is returned.
"""
from __future__ import annotations

import json
import logging
import os
import random
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

import google.auth
import httpx
from google import genai
from google.auth import exceptions as auth_exceptions
from google.genai import errors, types

from app.core import schema_check
from app.core.config import get_settings

log = logging.getLogger("ai.llm")

SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
BLOCKED_FINISH = {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION", "IMAGE_SAFETY"}
MIN_ATTEMPT_SECONDS = 2.0  # don't start an attempt that would get less time than this


class LLMError(Exception):
    """The model couldn't produce a usable answer. `str(e)` is safe to show to users."""

    def __init__(self, message: str, *, retryable: bool = False, code: int | None = None, detail: str = ""):
        super().__init__(message)
        self.retryable = retryable
        self.code = code
        self.detail = detail  # provider's own message: logged, never sent to the browser


@dataclass(frozen=True)
class VertexStatus:
    live: bool
    reason: str  # "ok" | "not_configured" | "no_credentials"
    detail: str
    model: str
    location: str


_lock = threading.RLock()
_status: VertexStatus | None = None
_credentials: Any = None
_client: Any = None
_sleep: Callable[[float], None] = time.sleep  # swapped out in tests


# ---------------------------------------------------------------------------------------------------------
# Configuration and credentials
# ---------------------------------------------------------------------------------------------------------
def _ignore_unusable_credentials_file() -> None:
    """An empty/missing GOOGLE_APPLICATION_CREDENTIALS file (e.g. an unfilled Docker secret or the default
    dev mount) would make google-auth fail outright. Drop it so the other ADC sources (gcloud login,
    metadata server on Google Cloud) are still tried."""
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if path and (not os.path.isfile(path) or os.path.getsize(path) == 0):
        log.info("GOOGLE_APPLICATION_CREDENTIALS (%s) is missing or empty; trying other credential sources", path)
        os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)


def status() -> VertexStatus:
    """Live or demo, decided once and cached. Never raises."""
    global _status, _credentials
    with _lock:
        if _status is not None:
            return _status
        s = get_settings()
        base = {"model": s.vertex_model, "location": s.google_cloud_location}
        if not s.vertex_configured:
            _status = VertexStatus(False, "not_configured", "GOOGLE_CLOUD_PROJECT is not set", **base)
            log.info("Vertex AI not configured (GOOGLE_CLOUD_PROJECT empty): AI runs in DEMO mode")
            return _status
        try:
            _ignore_unusable_credentials_file()
            _credentials, _ = google.auth.default(scopes=SCOPES)
            _status = VertexStatus(True, "ok", "", **base)
            log.info("Vertex AI ready: project=%s location=%s model=%s",
                     s.google_cloud_project, s.google_cloud_location, s.vertex_model)
        except Exception as e:  # noqa: BLE001 — DefaultCredentialsError, malformed key file, …
            detail = (str(e).splitlines() or [type(e).__name__])[0][:300]
            _status = VertexStatus(False, "no_credentials", detail, **base)
            log.error("Vertex AI credentials not found (%s). AI runs in DEMO mode. Set GOOGLE_APPLICATION_CREDENTIALS "
                      "or run on Google Cloud with a service account that has the 'Vertex AI User' role.", detail)
        return _status


def is_live() -> bool:
    return status().live


def reset() -> None:
    """Forget cached status/client (tests, or after changing configuration)."""
    global _status, _credentials, _client
    with _lock:
        _status = _credentials = _client = None


def client() -> Any:
    global _client
    with _lock:
        if _client is None:
            s = get_settings()
            if not status().live:
                raise LLMError("Live AI is not configured.")
            _client = genai.Client(
                vertexai=True,
                project=s.google_cloud_project,
                location=s.google_cloud_location,
                credentials=_credentials,
            )
        return _client


# ---------------------------------------------------------------------------------------------------------
# Request building
# ---------------------------------------------------------------------------------------------------------
def _contents(messages: list[dict]) -> list[types.Content]:
    """Chat history in Gemini's format: roles are "user" and "model"."""
    return [
        types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])])
        for m in messages
    ]


def _config(system: str, max_tokens: int, timeout_s: float, *, schema: dict | None = None, json_mode: bool = False):
    s = get_settings()
    kw: dict[str, Any] = {
        "system_instruction": system,
        "max_output_tokens": max_tokens,
        "http_options": types.HttpOptions(timeout=int(timeout_s * 1000)),  # milliseconds
    }
    if json_mode or schema is not None:
        kw["response_mime_type"] = "application/json"
    if schema is not None:
        kw["response_json_schema"] = schema
    if s.vertex_thinking_budget is not None:
        kw["thinking_config"] = types.ThinkingConfig(thinking_budget=s.vertex_thinking_budget)
    return types.GenerateContentConfig(**kw)


# ---------------------------------------------------------------------------------------------------------
# Calling the model: timeouts, retries, error mapping
# ---------------------------------------------------------------------------------------------------------
def _from_api_error(e: errors.APIError) -> LLMError:
    s = get_settings()
    code = int(getattr(e, "code", 0) or 0)
    detail = str(getattr(e, "message", "") or e)[:500]
    if code == 429:
        return LLMError("The AI is receiving too many requests right now. Please try again shortly.",
                        retryable=True, code=code, detail=detail)
    if code in RETRYABLE_STATUS:
        return LLMError("The AI provider is temporarily unavailable. Please try again.", retryable=True, code=code, detail=detail)
    if code in (401, 403):
        return LLMError("The AI provider rejected this server's credentials.", code=code, detail=detail)
    if code == 404:
        return LLMError(f"AI model '{s.vertex_model}' is not available in location '{s.google_cloud_location}'.",
                        code=code, detail=detail)
    return LLMError(f"The AI provider rejected the request ({code}).", code=code, detail=detail)


def _call(contents: list, build_config: Callable[[float], Any], deadline: float) -> Any:
    s = get_settings()
    attempts = max(1, s.vertex_max_attempts)
    last: LLMError | None = None
    for attempt in range(1, attempts + 1):
        remaining = deadline - time.monotonic()
        if remaining < MIN_ATTEMPT_SECONDS:
            break
        timeout = min(s.vertex_timeout_seconds, remaining)
        try:
            return client().models.generate_content(model=s.vertex_model, contents=contents, config=build_config(timeout))
        except errors.APIError as e:
            last = _from_api_error(e)
        except httpx.TimeoutException as e:
            last = LLMError("The AI took too long to respond. Please try again.", retryable=True, detail=repr(e))
        except (httpx.TransportError, auth_exceptions.TransportError) as e:
            last = LLMError("Could not reach the AI provider.", retryable=True, detail=repr(e))
        except auth_exceptions.RefreshError as e:
            last = LLMError("The AI provider rejected this server's credentials.", detail=repr(e))
        log.warning("Vertex AI attempt %d/%d failed (code=%s): %s", attempt, attempts, last.code, last.detail or last)
        if not last.retryable or attempt == attempts:
            break
        delay = min(8.0, 2.0 ** (attempt - 1)) * random.uniform(0.5, 1.0)  # ~1 s, ~2 s, ~4 s … with jitter
        if time.monotonic() + delay + MIN_ATTEMPT_SECONDS >= deadline:
            break
        _sleep(delay)
    raise last or LLMError("The AI took too long to respond. Please try again.", retryable=True)


def _text(resp: Any, *, allow_truncated: bool) -> str:
    feedback = getattr(resp, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None):
        raise LLMError("The AI declined this request.", detail=f"prompt blocked: {feedback.block_reason}")
    candidates = getattr(resp, "candidates", None) or []
    if not candidates:
        raise LLMError("The AI returned an empty response.")
    cand = candidates[0]
    finish = getattr(cand.finish_reason, "name", cand.finish_reason)
    if finish in BLOCKED_FINISH:
        raise LLMError("The AI declined to answer this request.", detail=f"finish_reason={finish}")
    parts = (cand.content.parts if cand.content and cand.content.parts else []) or []
    text = "".join(p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False)).strip()
    if finish == "MAX_TOKENS" and not allow_truncated:
        raise LLMError("The AI's answer was too long and got cut off. Please try again.", detail="finish_reason=MAX_TOKENS")
    if not text:
        raise LLMError("The AI returned an empty response.", detail=f"finish_reason={finish}")
    return text


# ---------------------------------------------------------------------------------------------------------
# Public API used by the routers
# ---------------------------------------------------------------------------------------------------------
def complete(system: str, messages: list[dict], *, max_tokens: int | None = None) -> str:
    """Plain-text (Markdown) answer for a conversation. `messages` use roles "user" / "assistant"."""
    s = get_settings()
    tokens = max_tokens or s.vertex_chat_max_tokens
    deadline = time.monotonic() + s.vertex_total_timeout_seconds
    resp = _call(_contents(messages), lambda t: _config(system, tokens, t), deadline)
    return _text(resp, allow_truncated=True)


def complete_json(system: str, prompt: str, schema: dict, *, max_tokens: int | None = None) -> dict:
    """Structured output matching `schema` (JSON Schema). Validated before it is returned."""
    s = get_settings()
    tokens = max_tokens or s.vertex_generation_max_tokens
    deadline = time.monotonic() + s.vertex_total_timeout_seconds
    use_schema = True
    for attempt in (1, 2):
        text_prompt = prompt if use_schema else (
            f"{prompt}\n\nRespond with JSON only. It must match this JSON Schema exactly:\n{json.dumps(schema)}"
        )
        try:
            resp = _call(
                _contents([{"role": "user", "content": text_prompt}]),
                lambda t, u=use_schema: _config(system, tokens, t, schema=schema if u else None, json_mode=True),
                deadline,
            )
        except LLMError as e:
            # If this model/location rejects the schema itself, ask for plain JSON and validate it here.
            if use_schema and e.code == 400 and "schema" in e.detail.lower():
                log.warning("Vertex AI rejected response_json_schema (%s); retrying in plain JSON mode", e.detail)
                use_schema = False
                continue
            raise
        try:
            data = json.loads(_text(resp, allow_truncated=False))
            problems = schema_check.errors(data, schema)
        except json.JSONDecodeError:
            problems = ["response is not valid JSON"]
        if not problems:
            return data
        log.warning("Vertex AI structured output invalid (attempt %d): %s", attempt, problems[:5])
    raise LLMError("The AI returned data in an unexpected format. Please try again.")
