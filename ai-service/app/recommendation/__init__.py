"""
Recommendation logic (PRD 10 lists it under the AI service).

The scoring itself runs as SQL in the Node backend
(backend/src/modules/gamification/recommendations.service.ts) because it is a single
pgvector query over embeddings this service already wrote — doing it there avoids an
extra network hop per dashboard load. This package is the extension point if the engine
later needs Python-only models (e.g. collaborative filtering).
"""
