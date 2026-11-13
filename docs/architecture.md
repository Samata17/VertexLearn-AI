# VertexLearn AI — Architecture & Implementation Notes

This document explains how the system is put together, how it maps to the PRD (`docs/PRD.docx`), and every place where
the build deliberately differs from the PRD and why.

## 1. Components

```
 Browser (React SPA)
      │  HTTPS  /api/v1/*  and static files
      ▼
 nginx  (frontend container — PRD 9.1 "API gateway")
      │  serves the built React app, proxies /api → backend, 600 MB upload limit
      ▼
 backend  (Node.js + Express + TypeScript)  ── REST API, auth, RBAC, validation, business logic
      │        │              │                    │
      │        │              │                    └─ HTTP + internal key ─▶ ai-service (Python FastAPI)
      │        │              │                                              ├─ RAG retrieval (pgvector)
      │        │              │                                              ├─ local embeddings (bge-small, 384-d)
      │        │              │                                              └─ Gemini on Google Cloud Vertex AI (google-genai SDK)
      │        │              └─ jobs ─▶ Redis (BullMQ) ─▶ worker (same image, `node dist/worker.js`)
      │        │                                            ├─ ingest: lecture → chunks → embeddings
      │        │                                            ├─ certificate PDFs (pdf-lib)
      │        │                                            ├─ email (SMTP → Mailpit locally)
      │        │                                            └─ cron: streak evaluation, recommendation recalculation
      │        └─ cache + rate-limit counters ─▶ Redis
      ▼
 PostgreSQL 16 + pgvector   (system of record + vector store)
 S3-compatible storage      (videos, PDFs, submissions, certificates, avatars)
```

| Service | Folder | Port (local) |
|---|---|---|
| Frontend + nginx gateway | `frontend/`, `infra/nginx/` | 8080 |
| Backend API | `backend/src/server.ts` | 4000 |
| Background worker | `backend/src/worker.ts` | — |
| AI service | `ai-service/` | 8000 |
| PostgreSQL + pgvector | (image) | 5432 |
| Redis | (image) | 6379 |
| S3 storage (SeaweedFS) | (image) | 8333 |
| Mailpit (fake inbox) | (image) | 8025 (UI) |

## 2. Key request flows

### Sign-in and session (PRD 6, 8.1)
1. `POST /auth/login` → bcrypt check → returns a **15-minute JWT access token** + a **7-day opaque refresh token**
   (only its SHA-256 hash is stored in `refresh_tokens`).
2. The SPA keeps the access token in memory and the refresh token in `localStorage`.
3. On any `401`, the axios interceptor calls `/auth/refresh` once (shared by concurrent requests), which **rotates**
   the refresh token and retries the original request. The replaced token stays usable for 30 s (migration
   `002_refresh_token_grace.sql`) so a page reload mid-refresh or two open tabs don't sign the user out; logout,
   "sign out everywhere" and password resets end that grace window immediately.
4. `requireAuth` also checks a Redis blocklist so a **suspended user is locked out immediately**, not after 15 minutes.
5. Roles: `requireRole(...)` middleware (route level) + ownership checks in services (`courses/access.ts`), as PRD 11 specifies.

### AI tutor question (PRD 9.2)
1. `POST /ai/chat/sessions/:id/messages` → backend checks the user may use this course's tutor, saves the question.
2. Backend calls `ai-service /chat` with the question, explanation mode, last 8 turns and the student's topic-mastery map.
3. AI service embeds the question and runs a cosine-similarity search on `document_chunks` **filtered by course_id**.
4. Top passages are numbered `[1]…[n]` and sent to Gemini (Vertex AI) with grounding rules (answer only from passages, cite them,
   say so when the material doesn't cover it). Weak topics (mastery < 50%) add an instruction to build intuition first.
5. Reply + cited sources (lecture, timestamp, snippet) are stored in `ai_chat_messages`; `topic_mastery.questions_asked`
   is incremented for the cited modules (step 5 of PRD 9.2) and the "Curious Mind" badge is checked.
6. The UI renders citations as chips that jump the video to that timestamp.

### Lecture upload → AI index (PRD 9.3)
Instructor uploads video/PDFs (multipart) → files stored in S3 → `lectures.ingest_status = queued` → BullMQ `ingest` job →
worker calls `ai-service /ingest/lecture` → transcript + PDF/TXT/MD text are chunked (~900 chars, sentence-aware, with
`[mm:ss]` timestamps preserved) → embedded → replace that lecture's rows in `document_chunks` → status `ready`.
The editor polls and shows the status badge.

### Course completion → certificate (FR-S8)
Progress updates mark a lecture complete at 90% watched → when every lecture is complete the enrollment gets
`completed_at`, the "Course Conqueror" badge, a notification + email, and a `certificate` job renders the PDF (pdf-lib)
into S3. `GET /certificates/verify/:code` is a public verification endpoint.

## 3. Vertex AI integration (ai-service/app/core/llm.py)
- Official **Google Gen AI SDK** (`google-genai`) in Vertex AI mode: `genai.Client(vertexai=True, project, location, credentials)`.
- Configuration: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (default `global`), `VERTEX_MODEL`
  (default `gemini-3.8-flash`, Google's stable replacement for the retired `gemini-2.5-flash`), optional
  `VERTEX_THINKING_BUDGET`.
- **Authentication = Application Default Credentials**, resolved once at startup with `google.auth.default()`:
  `GOOGLE_APPLICATION_CREDENTIALS` (service-account key or `gcloud auth application-default login` file, mounted
  read-only into the AI container only) or the attached service account on Google Cloud. An empty/missing key
  file is ignored so the metadata server can still be used. Credentials never reach the backend or the browser.
- **Mode**: `live` when the project is set and credentials load; otherwise **demo**, with the reason
  (`not_configured` / `no_credentials`) logged and reported by `GET /health` (`demo_reason`).
- **Timeouts and retries**: per-attempt timeout (`VERTEX_TIMEOUT_SECONDS`, 45 s) inside an overall deadline
  (`VERTEX_TOTAL_TIMEOUT_SECONDS`, 100 s — below the backend's 120 s). 408/429/5xx, timeouts and network errors are
  retried up to `VERTEX_MAX_ATTEMPTS` (3) with exponential backoff + jitter. 400/401/403/404 and expired
  credentials are not retried.
- **Structured outputs**: each feature's JSON schema is sent as `response_json_schema` (JSON mode), and the reply is
  **validated again** by `app/core/schema_check.py` before use; invalid JSON is re-requested once. If a model rejects
  the schema itself (400), the call falls back to plain JSON mode with the schema in the prompt — still validated.
- **Safety**: blocked prompts and `SAFETY` / `PROHIBITED_CONTENT` / `RECITATION`… finish reasons become a clear
  "declined" message; `thought` parts are never shown to users. Provider error details stay in server logs.
- **Demo mode** (`app/demo.py`): retrieval is still real, and outputs are assembled from the retrieved course
  text with simple text analysis. Every demo output carries `is_demo: true` and the UI labels it
  "Demo mode · not AI-generated". Demo output is never presented as AI output. When live AI fails after its retries,
  chat, summaries and study plans fall back to labelled demo output (`VERTEX_FALLBACK_TO_DEMO`, default on); quiz
  drafts and flashcard decks return an error instead, because they are saved permanently. Demo summaries are not cached.

## 4. Security checklist (PRD 6, section 14 of the brief)
| Requirement | Implementation |
|---|---|
| Password hashing | bcrypt, cost 12 (`auth.service.ts`); constant-time path for unknown emails |
| JWT + refresh tokens | 15-min access JWT; rotating, hashed, revocable refresh tokens; logout revokes |
| RBAC | `requireRole()` + service-level ownership checks; admin can't remove own admin role or suspend self |
| Input validation | zod schemas on every body/query; unknown fields stripped; PRD 8.8 error format |
| Rate limiting | Redis-backed: 10/min/IP credentials, 60/min session, 20/min/user AI, 100/min/user API; nginx burst limit |
| Secure uploads | in-memory, size-limited, extension **and** MIME allow-lists, random key prefix, sanitised names |
| Private files | HMAC-signed expiring URLs (`/files/stream`), Range support for video |
| Secrets | env vars only (`.env.example`); backend refuses to start in production with dev JWT secrets |
| Headers / CORS | helmet, explicit CORS allow-list, nginx security headers |
| SQL injection | parameterised queries everywhere (`$1, $2…`) |
| Audit | `audit_logs` for approvals, role changes, suspensions, deletions, moderation, broadcasts |
| Account deletion | soft delete + anonymisation (keeps payment/audit integrity), sessions revoked, instantly blocked |

## 5. Deviations from the PRD (and why)

| PRD | Built | Reason |
|---|---|---|
| `VECTOR(1536)` embeddings | `VECTOR(384)` with local **BAAI/bge-small-en-v1.5** (fastembed/ONNX) | A local model needs no credentials or per-call cost, and works in demo mode. Kept when moving generation to Vertex AI: switching to Vertex embeddings would need a migration that re-embeds every chunk. Change `embedding_dim` + migration to swap models. |
| `ivfflat` index | `hnsw` index | ivfflat must be trained on existing data; HNSW works on an empty, growing table. |
| MinIO for local S3 | **SeaweedFS** (S3-compatible) | MinIO stopped publishing free container images. Code uses the standard AWS S3 SDK, so AWS S3 works unchanged. |
| `infra/docker-compose.yml` | `docker-compose.yml` at the repo root | One-command start (`docker compose up`) for beginners. `infra/` holds the nginx gateway config. |
| HLS via CDN | Progressive MP4 streaming with HTTP Range | HLS needs a transcoding pipeline; Range streaming gives seek/resume today. The storage layer is the extension point. |
| Whisper transcription | Instructor pastes/edits the transcript; PDFs/TXT/MD are text-extracted | Self-hosted speech-to-text is heavy; the ingest job is the place to add it. |
| Payment gateway | **Demo checkout** recording `payments` rows, clearly labelled | Out of scope per PRD 3.2; keeps the revenue dashboard meaningful. |
| Recommendation engine in ai-service | SQL in the backend (`recommendations.service.ts`) using pgvector `AVG(embedding)` similarity | One query, no extra network hop. `ai-service/app/recommendation/` documents the extension point. |
| Jest | **Vitest** (Jest-compatible API) + Playwright + Pytest | Vitest runs TypeScript/ESM without extra config. |
| Celery | BullMQ only | All background jobs are Node-side; the AI service is called synchronously by the worker. |

### Schema additions (all marked `ADDED:` in `backend/src/db/migrations/001_init.sql`)
`refresh_tokens`, `password_reset_tokens` (logout + reset flow) · `course_reviews` (FR-S3 rating filter) ·
`user_activity_days` (DAU, streaks, heatmap) · `topic_mastery` (FR-A8) · extra columns such as
`lecture_progress.max_watched_seconds / time_spent_seconds` (drop-off and time-on-task, FR-I5),
`discussion_posts.parent_post_id / is_hidden / flag_reason` (threading + moderation), `quizzes.status` (AI draft review),
`ai_chat_messages.sources / is_demo`, `certificates.certificate_code`, `users.deleted_at` (soft delete).

## 6. Implementation plan & PRD coverage

| Phase | Scope | PRD refs | Status |
|---|---|---|---|
| 1 Foundation | Docker stack, schema + migrations, seed data | 7, 10, 14.1 | ✅ |
| 2 Auth & RBAC | Register/login/refresh/logout/me, forgot/reset password, role guards | FR-S1, 8.1, 11 | ✅ |
| 3 Courses | Catalog (search, category, difficulty, rating, price, sort), detail, authoring, uploads, approval | FR-S3, FR-I1–2, FR-AD1, 8.2 | ✅ |
| 4 Learning | Enrollment, player with resume + speed, progress, notes, bookmarks | FR-S2, S4, S5, 8.3 | ✅ |
| 5 Assessment | Assignments (rubric, deadline, upload, grading), quizzes (MCQ, multi-select, short answer, auto-grading, history) | FR-S6, S7, I3, I4, 8.4 | ✅ |
| 6 AI tutor | RAG chat with citations, 3 explanation modes, summaries, quiz generation → draft review, flashcards, study plans, mastery | FR-A1–A8, 8.5, 9.2 | ✅ |
| 7 Gamification | Streaks, badges, certificates (PDF + public verify), leaderboards, recommendations | FR-S8–S10, 8.6 | ✅ |
| 8 Community | Threaded forums, reporting, moderation, announcements, in-app + email notifications | FR-I6, FR-AD5 | ✅ |
| 9 Dashboards | Student, instructor (drop-off, quiz avg, time-on-task, topic struggle), admin (DAU, enrollments, completion, revenue) | FR-I5, FR-AD2–4 | ✅ |
| 10 Ops | Health checks, structured logs + request IDs, caching, rate limits, CI/CD, docs | 6, 9.4, 14 | ✅ |

## 7. Folder structure

```
Vertexlearn AI/
├─ docker-compose.yml          one-command local stack
├─ .env.example                every configurable variable
├─ frontend/                   React 18 + TS + Vite + Tailwind + TanStack Query + Zustand
│  ├─ src/components/{common,ai-tutor}/   design system, charts, chat panel
│  ├─ src/pages/{auth,dashboard,course-catalog,course-player,ai-tutor,quizzes,student,discussions,instructor,admin-panel,shared}/
│  ├─ src/{services,store,hooks,layouts,routes,utils,styles}/
│  ├─ e2e/                     Playwright end-to-end tests
│  └─ Dockerfile               build → nginx
├─ backend/                    Node + Express + TS
│  ├─ src/modules/{auth,users,courses,enrollments,assignments,quizzes,gamification,discussions,notifications,admin,ai,dashboard,files}/
│  ├─ src/{middleware,jobs,lib,config,utils}/
│  ├─ src/db/{migrations,seeders}/
│  ├─ src/server.ts · src/worker.ts
│  ├─ tests/ (Vitest) · scripts/smoke-test.mjs (API end-to-end)
│  └─ Dockerfile
├─ ai-service/                 Python + FastAPI
│  ├─ app/routers/{chat,summarize,quiz_gen,flashcards,study_plan,ingest}.py
│  ├─ app/rag/{chunking,embeddings,retriever}.py · app/core/{config,llm,db,security}.py · app/demo.py
│  └─ tests/ (Pytest) · Dockerfile
├─ infra/nginx/default.conf    API gateway config
├─ .github/workflows/{ci,deploy}.yml
└─ docs/{PRD.docx, api-spec.yaml, architecture.md}
```
