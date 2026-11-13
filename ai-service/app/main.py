"""VertexLearn AI Tutor Service (FastAPI). Internal service — called only by the Node backend."""
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.core import llm
from app.core.config import get_settings
from app.core.db import get_pool
from app.rag.embeddings import warm_up
from app.routers import chat, flashcards, ingest, quiz_gen, study_plan, summarize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ai")

settings = get_settings()
_problems = settings.production_problems()
if _problems:
    raise RuntimeError("Refusing to start in production: " + "; ".join(_problems))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    st = llm.status()  # checks Vertex AI configuration + credentials once (logs the reason for demo mode)
    log.info("AI service starting in %s mode (provider: Vertex AI, model: %s, location: %s)",
             "LIVE" if st.live else "DEMO", st.model if st.live else "none", st.location)
    threading.Thread(target=warm_up, daemon=True).start()  # load embedding model in the background
    yield


# The interactive API docs are useful locally but are switched off in production.
app = FastAPI(
    title="VertexLearn AI Service",
    version="1.0.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
    lifespan=lifespan,
)

for r in (ingest.router, chat.router, summarize.router, quiz_gen.router, flashcards.router, study_plan.router):
    app.include_router(r)


@app.get("/health")
def health():
    """Readiness: 200 when the database (pgvector) answers, 503 otherwise so Docker marks the container unhealthy."""
    s = get_settings()
    st = llm.status()
    db_ok = True
    try:
        # Short timeout: a health check must never hang waiting for a pool connection.
        with get_pool().connection(timeout=3) as c, c.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception:  # noqa: BLE001
        db_ok = False
    body = {
        "status": "ok" if db_ok else "down",
        "service": "ai-service",
        "version": s.app_version,
        "database": db_ok,
        # mode/model are what the backend's /ai/status forwards to the UI badge (unchanged contract).
        "mode": "live" if st.live else "demo",
        "model": st.model if st.live else None,
        "provider": "vertex-ai",
        "location": st.location,
        "demo_reason": None if st.live else st.reason,  # not_configured | no_credentials
        "embedding_model": s.embedding_model,
    }
    return JSONResponse(body, status_code=200 if db_ok else 503)


@app.get("/health/live")
def live():
    """Liveness: the process is up (no dependency checks)."""
    return {"status": "ok", "service": "ai-service"}
