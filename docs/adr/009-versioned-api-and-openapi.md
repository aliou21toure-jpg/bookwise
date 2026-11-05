# ADR-009: Versioned REST API with generated OpenAPI

- Status: Accepted (2026-11-04)

## Decision
Public endpoints live under `/api/v1`. Request and response schemas are Zod schemas; the
OpenAPI 3.1 document is generated from them, so documentation cannot drift from validation.
Better Auth's own endpoints stay under `/api/auth`; the `/api/v1/auth/*` routes wrap them.
