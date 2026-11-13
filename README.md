# VertexLearn AI

**An AI-powered Learning Management System by Vertexon Learning Technologies Pvt. Ltd.**

VertexLearn combines a full LMS (courses, video lectures, assignments, quizzes, certificates, discussions) with an
**AI tutor that answers only from each course's own material and cites the exact lecture and timestamp** it used.
There are three workspaces: **Student**, **Instructor** and **Admin**.

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Recharts |
| Backend | Node.js, Express, TypeScript, JWT + refresh tokens, bcrypt, zod, BullMQ |
| AI service | Python, FastAPI, Google Cloud Vertex AI (Gemini, Google Gen AI SDK), RAG with pgvector, local embeddings |
| Data | PostgreSQL 16 + pgvector, Redis, S3-compatible object storage |
| Ops | Docker Compose, nginx gateway, GitHub Actions, Vitest, Pytest, Playwright |

Product requirements: [`docs/PRD.docx`](docs/PRD.docx) · Architecture & PRD deviations: [`docs/architecture.md`](docs/architecture.md) · API reference: [`docs/api-spec.yaml`](docs/api-spec.yaml)

---

## 1. Quick start (about 5 minutes)

**You need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. Nothing else.

```powershell
# from the project folder
copy .env.example .env          # macOS/Linux: cp .env.example .env
docker compose up -d --build    # first build takes a few minutes
```

Then open **http://localhost:8080**.

On first start the backend automatically creates the database tables and loads demo data; the worker then indexes
every lecture for the AI tutor (takes ~10 seconds).

### Demo accounts (password for all: `Password123!`)

| Role | Email | What to look at |
|---|---|---|
| Student | `ananya@example.com` | Dashboard, course player, AI tutor, quizzes, certificate |
| Instructor | `rohit@vertexlearn.ai` | Course editor, AI quiz draft waiting for review, grading queue, analytics |
| Admin | `meera@vertexlearn.ai` | Platform metrics, 2 courses awaiting approval, a reported post, user management |

The login page also has one-click buttons for these three accounts.

### Other local tools

| URL | What |
|---|---|
| http://localhost:8080 | The app |
| http://localhost:8025 | **Mailpit** — every email the app sends (password resets, grades, announcements) lands here |
| http://localhost:8000/docs | AI service interactive API docs |
| http://localhost:4000/health | Backend health check |

---

## 2. Turning on real AI (optional)

Without Google Cloud set up, the tutor runs in **Demo mode**: search over the course material still works (citations
are real), but answers are assembled from the matching passages rather than written by an AI model. Everything
produced this way is labelled **"Demo mode · not AI-generated"** in the UI.

The live AI is **Gemini on Google Cloud Vertex AI**. To switch it on:

1. **Google Cloud project** with billing, and the Vertex AI API enabled:
   `gcloud services enable aiplatform.googleapis.com --project <PROJECT_ID>`
2. **Credentials** (Application Default Credentials), either:
   - **your own login** (simplest for development): install the gcloud CLI and run
     `gcloud auth application-default login`. Your account needs the **Vertex AI User** role on the project.
   - **a service account** with the **Vertex AI User** role (`roles/aiplatform.user`), with its JSON key saved
     **outside this project folder**.
3. **`.env`** (copy from `.env.example`):
   ```ini
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=global
   VERTEX_MODEL=gemini-3.8-flash
   # Windows, gcloud login (macOS/Linux: ~/.config/gcloud):
   GCP_CREDENTIALS_DIR=C:/Users/<you>/AppData/Roaming/gcloud
   GCP_CREDENTIALS_FILE=application_default_credentials.json
   # or a service-account key:  GCP_CREDENTIALS_DIR=<folder>  GCP_CREDENTIALS_FILE=<key>.json
   ```
4. Restart the AI service: `docker compose up -d ai-service`
5. Check: `docker compose logs ai-service | Select-String Vertex` should say *Vertex AI ready*, and
   http://localhost:8000/health shows `"mode": "live"`. If it says demo, `demo_reason` tells you why
   (`not_configured` or `no_credentials`).

The badge next to the tutor changes to **Live AI · Gemini**. Credentials are mounted read-only into the `ai-service`
container only — they never reach the backend or the browser. Model and region are configurable (`VERTEX_MODEL`,
`GOOGLE_CLOUD_LOCATION`). Google retires model versions over time; see
[Vertex AI model versions](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions) when changing it.

If Vertex AI fails after its automatic retries, chat, summaries and study plans answer in labelled demo mode instead of
showing an error (`VERTEX_FALLBACK_TO_DEMO=false` turns this off). AI quiz drafts and flashcard decks show an error
instead, because they are saved.

---

## 3. A guided tour

**As the student (Ananya)**
1. Dashboard → streak, progress, upcoming assignments, quiz trend, recommendations.
2. *Continue learning* → the player resumes where she stopped. Try the **Transcript** tab (click a timestamp),
   add a **Note**, open **AI summary**.
3. Click **AI Tutor** in the player and ask: *"Why does quicksort degrade to O(n²) on sorted input?"* — click a source
   chip to jump to 14:02 in the lecture. Switch between Beginner / Intermediate / Advanced.
4. Quizzes → take *Sorting Algorithms Quiz* → see auto-grading and explanations. Your topic mastery updates.
5. Study plan → generate a 2-week plan built around weak topics. Flashcards → flip through a module deck.
6. Achievements → download the **PDF certificate** for *Python for Data Science*, open its verification link.
7. Assignments → submit a file to *Implement Quicksort with a Randomized Pivot*.

**As the instructor (Rohit)**
1. Dashboard → "Review AI quiz" → edit the AI-generated draft and **Publish**.
2. My courses → *Data Structures & Algorithms* → **Curriculum**: add a lecture with a video/PDF and watch the
   *AI indexed* badge appear. **Quizzes** → *Generate with AI* from any lecture.
3. Grading → score a submission with the rubric (the student is notified by in-app notification + email).
4. Analytics → lecture drop-off, quiz averages, time-on-task, topics students struggle with.
5. Announcements → post one; check Mailpit for the email.

**As the admin (Meera)**
1. Overview → users, DAU/MAU, enrollments, completion rate, revenue, top courses.
2. Course approvals → approve *Advanced Graph Algorithms* (it appears in the catalog) or reject with a comment.
3. Users → change roles, suspend (the user is locked out immediately), soft-delete.
4. Moderation → handle the reported spam post. Notifications → broadcast a message. Audit log → see every action.

> **About the seed videos:** lecture videos in the demo data are public sample clips used as placeholders — they are
> not recordings of these lectures (the transcripts are the real course content). Upload real videos from the course editor.

---

## 4. Developing (hot reload)

Run the infrastructure in Docker and the apps on your machine:

```powershell
docker compose up -d postgres redis s3 mailpit ai-service

# terminal 1 — API (http://localhost:4000)
cd backend
npm install
npm run seed        # creates tables + demo data (wipes demo tables!)
npm run dev

# terminal 2 — background worker (AI indexing, emails, certificates)
cd backend
npm run dev:worker

# terminal 3 — frontend (http://localhost:5173, proxies /api to :4000)
cd frontend
npm install
npm run dev
```

Useful commands

| Command | Where | What |
|---|---|---|
| `npm run migrate` | backend | Apply new SQL files in `src/db/migrations/` |
| `npm run seed` | backend | Reset demo data |
| `docker compose exec backend node dist/db/seeders/seed.js` | root | Reset demo data inside Docker |
| `docker compose logs -f backend worker ai-service` | root | Follow logs |
| `docker compose down` / `down -v` | root | Stop / stop **and delete all data** |

**Database access:** `docker compose exec postgres psql -U vertex vertexlearn` (or connect DBeaver/TablePlus to
`localhost:5432`, user `vertex`, password `vertex`).

---

## 5. Testing

| Suite | Command | Needs |
|---|---|---|
| Backend unit tests (Vitest) | `cd backend && npm test` | nothing |
| AI service unit tests (Pytest, incl. Vertex AI integration with a fake client) | `docker compose run --rm --no-deps ai-service python -m pytest -q` | Docker |
| **API end-to-end** (all roles; exits 1 on any failure) | `cd backend && node scripts/smoke-test.mjs` | stack running + seeded |
| **Browser end-to-end** (Playwright, every screen, 3 roles + mobile) | `cd frontend && npx playwright install chromium && npx playwright test` | stack running + seeded |
| Type checks | `npm run typecheck` in `backend/` and `frontend/` | nothing |

Notes
- Point the smoke test at the gateway with `API_URL=http://localhost:8080` (PowerShell: `$env:API_URL='http://localhost:8080'`).
- `SMOKE_SKIP_AI=1` skips (and reports) the AI steps when the AI service isn't running; any other failure still fails.
- The auth rate limit is 10 requests/minute/IP (PRD 8.9). If you run the test suites back-to-back and see
  `429 RATE_LIMITED`, wait a minute.
- Save Playwright screenshots of every page with `SCREENSHOT_DIR=<folder>`.

---

## 6. Deployment

The images are production-ready (multi-stage builds, non-root users, health checks).

**Single VM / staging (simplest)**
1. Install Docker on the server and copy the repository.
2. Create `.env` with **new secrets** (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_URL_SECRET`, `AI_SERVICE_KEY`,
   `POSTGRES_PASSWORD` — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`),
   set `NODE_ENV=production`, `APP_URL=https://your-domain`, `CORS_ORIGINS=https://your-domain`, and for live AI
   `GOOGLE_CLOUD_PROJECT` + credentials (see section 2). With `docker-compose.prod.yml`, the service-account key goes in
   `secrets/gcp_service_account.json` (leave it empty on Google Cloud, where the attached service account is used).
   Upgrading an existing server: run `node scripts/generate-secrets.mjs` once to create that new (empty) file.
3. `docker compose up -d --build`, then put HTTPS in front (Caddy, Traefik, or a cloud load balancer → port 8080).
4. For real email, set `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM` for the backend and worker.

**Managed production (PRD 14.1/14.3)**
- Database: managed PostgreSQL 15+ with the `vector` extension (AWS RDS, Supabase, Neon, Cloud SQL) → `DATABASE_URL`.
- Redis: managed Redis → `REDIS_URL`.
- Files: an S3 bucket → `S3_ENDPOINT=https://s3.<region>.amazonaws.com`, `S3_REGION`, `S3_BUCKET`, keys, `S3_FORCE_PATH_STYLE=false`.
- Run `backend` (API), `worker` and `ai-service` as separate services (ECS, Render, Railway, Kubernetes). The API and AI
  service are stateless and scale horizontally; run migrations once per deploy with `node dist/db/migrate.js`.
- Store secrets in the platform's secret manager, never in the repo.

**CI/CD** (`.github/workflows/`)
- `ci.yml` — on every PR and push to `main`: type-checks, unit tests (Vitest, Pytest), builds, an API smoke test
  against Postgres+Redis (AI steps explicitly skipped), and a **full-stack job** that builds every Docker image, starts
  the whole stack and runs the complete smoke test, AI steps included (demo mode). Any failure fails the run.
- `deploy.yml` — runs only after `ci.yml` **succeeded** on `main`: build images tagged with the commit SHA → GitHub
  Container Registry → staging deploy hook.
  On a `v*` tag: retag the tested images for production (rollback = redeploy a previous tag, PRD 14.5).
  Set `STAGING_DEPLOY_HOOK` / `PRODUCTION_DEPLOY_HOOK` secrets for your hosting platform.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `docker: command not found` | Start Docker Desktop and open a new terminal. |
| Port already in use (5432, 6379, 8080…) | Stop the other program, or change the left side of the port mapping in `docker-compose.yml`. |
| AI tutor says "unavailable" | `docker compose ps` — `ai-service` must be healthy. `docker compose logs ai-service`. |
| Still "Demo mode" after setting up Vertex AI | Open http://localhost:8000/health: `demo_reason` is `not_configured` (no `GOOGLE_CLOUD_PROJECT`) or `no_credentials` (check `GCP_CREDENTIALS_DIR` / `GCP_CREDENTIALS_FILE`). Restart with `docker compose up -d ai-service`. |
| AI errors mentioning credentials / "not available in location" | The account needs the **Vertex AI User** role; check `VERTEX_MODEL` exists in `GOOGLE_CLOUD_LOCATION` (try `global`). Details are in `docker compose logs ai-service`. |
| Tutor answers "couldn't find anything" for a new lecture | The lecture needs a transcript or PDF; check the *AI indexed* badge in the editor, or click *Re-index*. |
| `429 Too many requests` | Rate limit — wait a minute. |
| Want a clean slate | `docker compose down -v && docker compose up -d --build` |

---

## 8. Project structure

See [`docs/architecture.md`](docs/architecture.md#7-folder-structure) for the full tree and an explanation of each part.
