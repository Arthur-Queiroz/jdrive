# Database Specification

## Database

Use PostgreSQL through Drizzle ORM.

Recommended database name:

```text
jdrive
```

Recommended application role:

```text
jdrive_app
```

The application role must not receive unnecessary access to unrelated project databases.

## `users`

Suggested fields:

```text
id              UUID PRIMARY KEY
username        TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
created_at      TIMESTAMPTZ NOT NULL
updated_at      TIMESTAMPTZ NOT NULL
```

Notes:

- Username does not need encryption.
- Password must never be stored reversibly.
- Passwords must be hashed with Argon2id.

## `files`

Suggested fields:

```text
id              UUID PRIMARY KEY
original_name   TEXT NOT NULL
storage_key     UUID UNIQUE NOT NULL
mime_type       TEXT
size_bytes      BIGINT NOT NULL
sha256          TEXT NOT NULL
metadata        JSONB NOT NULL DEFAULT '{}'
created_at      TIMESTAMPTZ NOT NULL
```

Optional future fields are not required in MVP:

```text
last_downloaded_at
download_count
expires_at
```

## Sessions

Implementation may use a dedicated `sessions` table.

Suggested structure:

```text
id              UUID PRIMARY KEY
user_id         UUID NOT NULL REFERENCES users(id)
session_token_hash TEXT UNIQUE NOT NULL
expires_at      TIMESTAMPTZ NOT NULL
created_at      TIMESTAMPTZ NOT NULL
```

The browser receives only the session token.

The database should store a hash of the token where practical.

## Indexes

Recommended:

```text
UNIQUE users(username)
UNIQUE files(storage_key)
INDEX files(created_at DESC)
INDEX sessions(expires_at)
```

For MVP search volume, `ILIKE '%term%'` on `original_name` is acceptable.

## Migrations

- All schema changes must use Drizzle Kit migrations.
- Generated migration SQL must be committed to source control.
- Production deployments must run pending migrations in a controlled deployment step.
