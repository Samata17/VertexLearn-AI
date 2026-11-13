"""Configuration from environment variables (never hard-code secrets).

Secrets can also be supplied as files (Docker/Kubernetes secrets): set NAME_FILE=/run/secrets/name
instead of NAME, e.g. DATABASE_URL_FILE. The file's contents are used, so the secret never
appears in `docker inspect`.

Vertex AI authentication uses Google Application Default Credentials (ADC), read by the google-auth
library — never by the browser or the Node backend:
  - GOOGLE_APPLICATION_CREDENTIALS=/path/to/key-or-adc.json (service account key or `gcloud auth
    application-default login` file), or
  - the attached service account when running on Google Cloud (Cloud Run, GKE, Compute Engine).
"""
import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # env_ignore_empty: a blank variable (e.g. VERTEX_THINKING_BUDGET= from docker compose) means "use the default".
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    # "development" or "production". Production refuses dev secrets and hides the /docs page.
    environment: str = "development"
    app_version: str = "dev"  # Git commit SHA, set at image build time (PRD 14.5)

    database_url: str = "postgresql://vertex:vertex@localhost:5432/vertexlearn"

    # Google Cloud Vertex AI (Gemini). Leave GOOGLE_CLOUD_PROJECT empty for clearly-labelled DEMO mode.
    google_cloud_project: str = ""
    google_cloud_location: str = "global"  # or a region, e.g. us-central1 / europe-west4 / asia-south1
    vertex_model: str = "gemini-3.8-flash"
    vertex_timeout_seconds: float = 45.0  # one attempt
    vertex_total_timeout_seconds: float = 100.0  # all attempts together; the backend waits up to 120 s
    vertex_max_attempts: int = 3  # retries on 429 / 5xx / timeouts / network errors
    vertex_thinking_budget: int | None = None  # tokens the model may spend thinking; empty = model default
    vertex_chat_max_tokens: int = 8192
    vertex_generation_max_tokens: int = 16384
    # When live AI fails after all retries, answer chat / summaries / study plans in labelled demo mode
    # instead of an error. Quiz drafts and flashcard decks are saved permanently, so those return an error.
    vertex_fallback_to_demo: bool = True

    # Shared secret: only the Node backend may call this service.
    ai_service_key: str = "dev-internal-ai-key"

    # Local embedding model (runs inside this container, no API key needed).
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    embedding_cache_dir: str = "/models"

    # Object storage (to read uploaded PDFs during ingestion)
    s3_endpoint: str = "http://localhost:8333"
    s3_region: str = "us-east-1"
    s3_bucket: str = "vertexlearn"
    s3_access_key: str = "vertexlearn"
    s3_secret_key: str = "vertexlearn-secret"

    retrieval_top_k: int = 6
    chunk_size: int = 900
    chunk_overlap: int = 150

    @property
    def vertex_configured(self) -> bool:
        """Vertex AI was switched on. Whether credentials actually work is checked by app.core.llm.status()."""
        return bool(self.google_cloud_project.strip())

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def production_problems(self) -> list[str]:
        """Production must never run with the development defaults published in this repository."""
        if not self.is_production:
            return []
        problems = []
        if self.ai_service_key.startswith("dev-") or len(self.ai_service_key) < 32:
            problems.append("AI_SERVICE_KEY is the development default or shorter than 32 characters")
        if ":vertex@" in self.database_url:
            problems.append("DATABASE_URL uses the development database password")
        if self.s3_secret_key == "vertexlearn-secret":
            problems.append("S3_SECRET_KEY is still the development default")
        return problems


def load_secret_files() -> None:
    """Copy NAME_FILE contents into NAME for every known setting (only if NAME itself is not set)."""
    for field in Settings.model_fields:
        name = field.upper()
        path = os.environ.get(f"{name}_FILE")
        if path and not os.environ.get(name):
            os.environ[name] = Path(path).read_text(encoding="utf-8").strip()


@lru_cache
def get_settings() -> Settings:
    load_secret_files()
    return Settings()
