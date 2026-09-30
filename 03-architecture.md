# Architecture

## High-Level Architecture

```text
Browser
  |
  | HTTPS
  v
Caddy
  |
  +----------------------+
  |                      |
  v                      v
Static Svelte SPA     Fastify API
                         |
              +----------+----------+
              |                     |
              v                     v
         PostgreSQL             Filesystem
         metadata/auth          file bytes
```

## Components

### Frontend

- Svelte
- Vite
- TypeScript
- Static SPA build
- No SSR
- No separate frontend runtime in production

Responsibilities:

- Login UI
- File list
- Search
- Drag and drop
- File picker
- Per-file upload progress
- Storage usage display
- Delete confirmation
- Error feedback

### Backend

- Fastify
- TypeScript

Responsibilities:

- Authentication
- Session management
- Upload validation
- Streamed file persistence
- SHA-256 calculation
- Metadata persistence
- Search
- Streaming downloads
- File deletion
- Storage usage reporting

### Database

- Existing PostgreSQL instance
- Drizzle ORM
- Drizzle Kit migrations

PostgreSQL stores:

- Users
- Sessions if database-backed sessions are selected
- File metadata

PostgreSQL does not store file contents.

### File Storage

Binary files are stored directly on the VPS filesystem.

Recommended host location:

```text
/opt/jdrive/data/files
```

Temporary uploads:

```text
/opt/jdrive/data/tmp
```

Database records store a storage key, not an absolute path.

## Architecture Constraints

- No Redis in MVP.
- No MongoDB in MVP.
- No object storage in MVP.
- No file blobs inside PostgreSQL.
- No frontend SSR.
- No microservices.
- No background queue required for MVP.
