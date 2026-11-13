FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 EMBEDDING_CACHE_DIR=/models
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Download the embedding model at build time so the container starts fast and works offline.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/models')"

COPY app ./app
# Unit tests ship in the image so `docker compose run --rm ai-service pytest` works without a local Python.
COPY tests ./tests

# Git commit SHA of this build (PRD 14.5), reported by /health.
ARG GIT_SHA=dev
LABEL org.opencontainers.image.title="vertexlearn-ai-service" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV APP_VERSION=${GIT_SHA}

# Run as an unprivileged user, never root.
RUN useradd --create-home appuser && chown -R appuser /app /models
USER appuser

EXPOSE 8000
# /health returns 503 when the database is unreachable, which makes urlopen raise → unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "20"]
