# Google Cloud credentials for local development

This folder is mounted **read-only** into the `ai-service` container at `/gcp` (see `docker-compose.override.yml`).
It is the default when `GCP_CREDENTIALS_DIR` is not set, and it holds no credentials, so the AI runs in
**demo mode** until you configure Vertex AI.

**Don't put key files in this folder.** The project lives in a synced folder (OneDrive) and keys must never
be committed. `*.json` here is git-ignored as a safety net, but point `GCP_CREDENTIALS_DIR` at a folder outside the
project instead:

| Option | `.env` settings |
|---|---|
| Your own Google login (simplest): run `gcloud auth application-default login` once | `GCP_CREDENTIALS_DIR=C:/Users/<you>/AppData/Roaming/gcloud` (Windows) or `~/.config/gcloud` (macOS/Linux) · `GCP_CREDENTIALS_FILE=application_default_credentials.json` |
| A service-account key (`roles/aiplatform.user`) | `GCP_CREDENTIALS_DIR=<folder with the key>` · `GCP_CREDENTIALS_FILE=<key file name>.json` |

Both also need `GOOGLE_CLOUD_PROJECT=<your project id>`. See README → "Turning on real AI".
