# Implementation Plan

## Phase 1 — Project Bootstrap

- Create repository structure.
- Configure TypeScript.
- Create Fastify backend.
- Create Svelte + Vite frontend.
- Configure shared environment handling.
- Add Docker configuration.

## Phase 2 — Database

- Configure Drizzle.
- Define users schema.
- Define files schema.
- Define sessions schema if database-backed sessions are used.
- Generate initial migration.
- Verify connection to existing PostgreSQL.

## Phase 3 — Authentication

- Add Argon2id password hashing.
- Implement login.
- Implement session creation.
- Add authenticated route guard.
- Implement logout.
- Add login rate limit.
- Build login UI.

## Phase 4 — Storage Layer

- Add storage configuration.
- Create files and temporary directories.
- Implement UUID storage keys.
- Implement safe path resolution.
- Implement storage usage calculation.
- Implement SHA-256 streaming helper.

## Phase 5 — Upload

- Add multipart support.
- Validate per-file size.
- Validate total storage capacity.
- Stream upload to temporary file.
- Calculate SHA-256.
- Move completed file to permanent storage.
- Persist metadata.
- Clean partial files on failure.

## Phase 6 — Frontend Upload UX

- Add file picker.
- Add drag and drop.
- Add upload queue.
- Add per-file states.
- Add detailed progress bars.
- Add success/failure feedback.
- Add limited upload concurrency.

## Phase 7 — File Listing and Search

- Implement list API.
- Order newest-first.
- Implement case-insensitive partial name search.
- Build responsive file list.
- Add storage usage UI.

## Phase 8 — Download

- Implement authenticated streamed download.
- Add safe `Content-Disposition`.
- Use native browser download behavior.

## Phase 9 — Delete

- Implement delete endpoint.
- Add UI confirmation.
- Remove physical file and metadata.
- Refresh storage usage.

## Phase 10 — Production Deployment

- Add production Docker image.
- Configure persistent mounts.
- Add migration deployment step.
- Add Caddy routing using `vps-infra` conventions.
- Configure HTTPS.
- Validate restart persistence.

## Phase 11 — Final Verification

Run acceptance criteria against:

- Desktop browser
- Mobile browser
- Large file near the configured limit
- Multiple simultaneous uploads
- Failed/interrupted upload
- Full-storage scenario
- Container restart
- Invalid session
