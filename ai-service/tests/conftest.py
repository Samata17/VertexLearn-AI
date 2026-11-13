"""Shared test setup: every test starts with fresh settings and no Vertex AI configuration."""
import pytest

from app.core import llm
from app.core.config import get_settings

VERTEX_ENV = [
    "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "VERTEX_MODEL", "GOOGLE_APPLICATION_CREDENTIALS",
    "VERTEX_TIMEOUT_SECONDS", "VERTEX_TOTAL_TIMEOUT_SECONDS", "VERTEX_MAX_ATTEMPTS", "VERTEX_THINKING_BUDGET",
    "VERTEX_FALLBACK_TO_DEMO",
]


@pytest.fixture(autouse=True)
def clean_ai_config(monkeypatch):
    for name in VERTEX_ENV:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    llm.reset()
    yield
    get_settings.cache_clear()
    llm.reset()
    llm._sleep = __import__("time").sleep
