# API Specification

Base prefix:

```text
/api
```

## Authentication

### `POST /api/auth/login`

Request:

```json
{
  "username": "arthur",
  "password": "secret"
}
```

Success:

```text
200 OK
```

Creates authenticated session cookie.

Errors:

```text
400 invalid request
401 invalid credentials
429 too many attempts
```

### `POST /api/auth/logout`

Requires authentication.

Success:

```text
204 No Content
```

### `GET /api/auth/me`

Requires authentication.

Returns minimal authenticated user information.

## Files

### `GET /api/files`

Query parameters:

```text
search
```

Example:

```text
GET /api/files?search=curriculo
```

Returns newest-first matching files.

### `POST /api/files`

Requires multipart form data.

Supports one or multiple files according to frontend implementation.

The backend must enforce:

- Per-file size limit
- Total storage limit

Returns stored metadata for successful uploads.

### Upload Chunks (files above the Cloudflare edge limit)

Cloudflare Free proxies the public hostname and caps request bodies at
100 MB. Files above this limit are uploaded as ordered chunk sequences:

- `POST /api/files/chunks/init`
  Body (JSON): `{ "name": "proposal.zip", "size": 966367641, "mimeType": "application/zip" }`
  Response: `{ "uploadId": "<uuid>" }`
- `PUT /api/files/chunks/:uploadId/:index` (0-based, strict order)
  Body: raw chunk bytes, `Content-Type: application/octet-stream`.
  Response: `{ "offset": <bytes stored so far> }`
- `POST /api/files/chunks/:uploadId/finish`
  Body (JSON): `{ "sha256": "<client-computed digest>" }`
  Response: stored file record (same shape as `POST /api/files`), 201.

Rules:

- Chunks land in a dedicated scratch directory, streamed to disk.
- `finish` concatenates (on same filesystem), verifies the client SHA-256,
  enforces the per-file and storage limits, then records metadata once.
- Abandoned sessions are garbage collected after `CHUNK_TTL_HOURS` (24h default).
- Quota is re-verified before every part and before `finish` succeeds.

### `GET /api/files/:id/download`

Requires authentication.

Streams the file with appropriate download headers.

### `DELETE /api/files/:id`

Requires authentication.

Deletes filesystem object and database metadata.

Success:

```text
204 No Content
```

## Storage

### `GET /api/storage`

Example response:

```json
{
  "usedBytes": 123456789,
  "maxBytes": 10737418240,
  "percentage": 1.15
}
```

## Error Shape

Use a consistent structure:

```json
{
  "error": {
    "code": "STORAGE_LIMIT_EXCEEDED",
    "message": "Storage limit exceeded"
  }
}
```

Do not return stack traces to clients in production.
