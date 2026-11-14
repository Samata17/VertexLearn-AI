
"""Configuration from environment variables (never hard-code secrets).

Secrets can also be supplied as files: set NAME_FILE=/run/secrets/name.
Vertex AI authentication uses Google Application Default Credentials (ADC).
"""

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def load_secret_files() -> None:
    """Load Google credentials and other secrets supplied as files."""

    # Load Google service account JSON from Railway.
    google_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")

    if google_json:
        credentials_path = Path("/tmp/google-application-credentials.json")
        credentials_path.write_text(google_json, encoding="utf-8")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(credentials_path)

    # Load other secrets supplied as files.
    for field in Settings.model_fields:
        name = field.upper()
        path = os.environ.get(f"{name}_FILE")

        if path and not os.environ.get(name):
            os.environ[name] = Path(path).read_text(encoding="utf-8").strip()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        env_ignore_empty=True,
    )

    environment: str = "development"
    app_version: str = "dev"

    database_url: str = "postgresql://vertex:vertex@localhost:5432/vertexlearn"

    # Google Cloud Vertex AI
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    vertex_model: str = "gemini-3.8-flash"
    vertex_timeout_seconds: float = 45.0
    vertex_total_timeout_seconds: float = 100.0
    vertex_max_attempts: int = 3
    vertex_thinking_budget: int | None = None
    vertex_chat_max_tokens: int = 8192
    vertex_generation_max_tokens: int = 16384
    vertex_fallback_to_demo: bool = True

    # Shared secret: only the Node backend may call this service.
    ai_service_key: str = "dev-internal-ai-key"

    # Local embedding model
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384
    embedding_cache_dir: str = "/models"

    # Object storage
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
        """Check whether a Google Cloud project is configured."""
        return bool(self.google_cloud_project.strip())

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def production_problems(self) -> list[str]:
        """Check that production does not use development secrets."""
        if not self.is_production:
            return []

        problems = []

        if self.ai_service_key.startswith("dev-") or len(self.ai_service_key) < 32:
            problems.append(
                "AI_SERVICE_KEY is the development default or shorter than 32 characters"
            )

        if ":vertex@" in self.database_url:
            problems.append(
                "DATABASE_URL uses the development database password"
            )

        if self.s3_secret_key == "vertexlearn-secret":
            problems.append(
                "S3_SECRET_KEY is still the development default"
            )

        return problems


@lru_cache
def get_settings() -> Settings:
    load_secret_files()
    return Settings()
