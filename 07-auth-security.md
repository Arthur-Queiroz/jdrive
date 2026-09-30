# Authentication and Security

## Access Policy

The entire application is private.

Only the following should be publicly accessible without a session:

- Login page
- Login API endpoint
- Required static frontend assets

All file operations require authentication.

## Credentials

User record:

```text
username
password_hash
```

Password handling:

- Use Argon2id.
- Never store plaintext passwords.
- Never store reversible encrypted passwords.
- Never log passwords.

## Session

Default:

```env
SESSION_TTL_DAYS=7
```

Cookie requirements in production:

- `HttpOnly`
- `Secure`
- Appropriate `SameSite` value
- Explicit expiration aligned with session TTL

## Login Protection

Add a lightweight rate limit to the login endpoint.

The MVP does not require Redis-backed rate limiting.

An in-process limiter is acceptable for a single-instance personal application.

## File Security

- Files must not live in Caddy's public static directory.
- Downloads must go through authenticated backend endpoints.
- Original file names must never determine physical paths.
- Prevent path traversal.
- Avoid executing uploaded files.
- Serve downloads with attachment-oriented response headers.
- Set the original filename safely in `Content-Disposition`.

## Upload Validation

Validate:

- Authenticated session
- File size
- Remaining storage
- Multipart request structure

MIME type is informational in the MVP and must not be considered a security guarantee.

## HTTPS

Production traffic must use HTTPS through Caddy.
