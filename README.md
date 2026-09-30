# JDrive Specs

This package contains the MVP specification for JDrive, a lightweight personal file-transfer application hosted on an existing VPS.

## Locked Stack

- Svelte + Vite + TypeScript
- Fastify + TypeScript
- PostgreSQL
- Drizzle ORM / Drizzle Kit
- Filesystem storage
- Argon2id authentication
- Docker Compose
- Caddy

## Default Limits

```env
MAX_FILE_SIZE_MB=1024
MAX_STORAGE_GB=10
SESSION_TTL_DAYS=7
```

## MVP Highlights

- Authenticated-only application
- Drag-and-drop
- Multiple uploads
- Per-file upload progress
- Native browser downloads
- Search by file name
- File deletion
- Storage usage indicator
- SHA-256 checksums
- UUID-based physical storage keys

Start with `00-overview.md`, then use `15-implementation-plan.md` as the execution order for loop engineering.
