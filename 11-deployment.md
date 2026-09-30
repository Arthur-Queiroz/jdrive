# Deployment Specification

## Environment

Target:

- Hostinger KVM2 VPS
- Existing VPS infrastructure conventions
- Existing PostgreSQL instance

## Containers

Recommended services:

```text
jdrive-app
caddy (existing/shared infrastructure when applicable)
```

No dedicated PostgreSQL container should be added if the application can securely reach the existing PostgreSQL service.

## Persistent Storage

Host:

```text
/opt/jdrive/data/files
/opt/jdrive/data/tmp
```

Must be mounted into the application container.

## Caddy

Caddy responsibilities:

- HTTPS
- TLS certificate automation
- Reverse proxy to Fastify
- Serve the static Svelte build directly or proxy static delivery through the application, depending on existing VPS conventions

Prefer consistency with the current `vps-infra` repository.

## Environment Variables

Minimum expected configuration:

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://...

MAX_FILE_SIZE_MB=1024
MAX_STORAGE_GB=10
SESSION_TTL_DAYS=7

FILES_DIR=/app/data/files
TMP_DIR=/app/data/tmp

SESSION_SECRET=...
```

Actual password bootstrap strategy should be documented in deployment scripts or setup instructions.

## Startup

Deployment should:

1. Ensure persistent directories exist.
2. Run pending database migrations.
3. Start the application.
4. Expose it only through Caddy in production.

## Backups

MVP does not require an automated backup subsystem.

However, the design must keep backups straightforward:

- PostgreSQL metadata can be dumped independently.
- `/opt/jdrive/data/files` can be archived independently.
