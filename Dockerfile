# syntax=docker/dockerfile:1.7
# One image, two processes: the Next.js web server (default) and the BullMQ worker
# (override the command with `node worker/worker.mjs`), plus the migration runner
# (`node worker/migrate.mjs`) and the operator command `node worker/admin-create.mjs`.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Browser error reporting is configured at build time (the DSN is public). Source maps are
# uploaded to Sentry only when a `sentry_auth_token` secret is mounted; a secret mount, unlike
# a build arg, is never stored in the image.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN SENTRY_ORG=$SENTRY_ORG SENTRY_PROJECT=$SENTRY_PROJECT
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build && npm run build:worker

# Production dependencies only, for the worker and migration script.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Next.js standalone server (includes its own minimal node_modules)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Worker and migration runner: bundled entry points next to their own production
# node_modules, so ESM resolves dependencies from /app/worker/node_modules.
COPY --from=build --chown=node:node /app/dist ./worker
COPY --from=prod-deps --chown=node:node /app/node_modules ./worker/node_modules
COPY --from=build --chown=node:node /app/src/db/migrations ./worker/migrations
# Local image storage (mount a volume here, or use object storage in production).
ENV UPLOADS_DIR=/app/data/uploads
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
