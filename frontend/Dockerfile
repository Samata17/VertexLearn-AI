# Build context is the repository root (see docker-compose.yml) so the nginx config in infra/ is available.
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# nginx-unprivileged runs as a non-root user and listens on 8080 (not 80).
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG GIT_SHA=dev
LABEL org.opencontainers.image.title="vertexlearn-frontend" \
      org.opencontainers.image.revision="${GIT_SHA}"
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# /nginx-health is answered by nginx itself, so the gateway is "healthy" even while the API restarts.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
