"""
Embeddings: text → 384 numbers that capture meaning. Similar meaning → nearby vectors.

We use BAAI/bge-small-en-v1.5 through `fastembed` (ONNX runtime, CPU-only, ~130 MB).
It runs locally inside this container — no API key, no per-request cost.
bge models work best when *queries* get a short instruction prefix and passages don't.
"""
from __future__ import annotations

import logging
import threading

import numpy as np

from app.core.config import get_settings

log = logging.getLogger("ai.embeddings")
_model = None
_lock = threading.Lock()
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                s = get_settings()
                log.info("Loading embedding model %s", s.embedding_model)
                _model = TextEmbedding(model_name=s.embedding_model, cache_dir=s.embedding_cache_dir)
    return _model


def embed_passages(texts: list[str]) -> list[np.ndarray]:
    if not texts:
        return []
    return [np.asarray(v, dtype=np.float32) for v in _get_model().embed(texts, batch_size=32)]


def embed_query(text: str) -> np.ndarray:
    return np.asarray(next(iter(_get_model().embed([QUERY_PREFIX + text]))), dtype=np.float32)


def warm_up() -> None:
    try:
        embed_query("warm up")
    except Exception as e:  # noqa: BLE001 - startup should not crash if the model is slow to load
        log.warning("Embedding warm-up failed: %s", e)
