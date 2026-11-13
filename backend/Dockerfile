# Used for both the API (default command) and the background worker (command: node dist/worker.js).

# ---- build stage: compile TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp -r src/db/migrations dist/db/migrations

# ---- runtime stage: production dependencies + compiled JS only ----
FROM node:22-alpine
# Git commit SHA of this build (PRD 14.5: every image is traceable to a commit; shown in /health).
ARG GIT_SHA=dev
LABEL org.opencontainers.image.title="vertexlearn-backend" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production APP_VERSION=${GIT_SHA}
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Run as the unprivileged "node" user, never root.
USER node
EXPOSE 4000
# Readiness check (database + Redis). start-period covers migrations on first boot.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
