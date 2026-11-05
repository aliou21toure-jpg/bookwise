# ADR-005: Worker hosting

- Status: Accepted (2026-11-04)

## Context
Vercel functions are short-lived and cannot run a BullMQ worker.

## Decision
The worker runs as a long-lived container on Render or Railway (free tier), built from the
same Docker image as the web app (`node worker/worker.mjs`). Locally it runs in Docker
Compose or with `npm run worker:dev`.

## Consequences
- A second deployment target to configure in Phase 10.
- Hold expiry does not depend on the worker for correctness: expired holds are also released
  inside the next booking transaction on the same slot and by a periodic sweep.
