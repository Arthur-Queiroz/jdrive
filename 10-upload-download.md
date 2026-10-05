# Upload and Download Behavior

## Upload

### Client

Use a browser API that exposes upload progress reliably.

`XMLHttpRequest` is acceptable for the MVP because it provides `upload.onprogress`.

Per-file progress should be computed as:

```text
loaded / total * 100
```

### Multiple Files

The UI may upload files:

- Sequentially, or
- With limited parallelism

Recommended MVP behavior:

- Limit concurrency to a small number such as 2 or 3 simultaneous uploads.
- Keep remaining files queued.

This avoids excessive simultaneous disk and network activity on the VPS.

### Backend

Uploads must be streamed.

The backend must not buffer a full 1 GB file into process memory.

### Failure

On failure:

- Mark only the affected file as failed.
- Other queued/uploading files should continue when possible.
- Remove incomplete temporary files.

## Download

Downloads use the browser's native mechanism.

Expected behavior:

1. User presses Download.
2. Browser navigates or requests the authenticated download endpoint.
3. Backend streams the file.
4. Browser shows native download progress.

No in-app download percentage is required for MVP.

## Cloudflare Limits

The public hostname is proxied by Cloudflare on the Free plan.

- Free-plan request-body limit: 100 MB. Larger uploads fail at the edge
  (HTTP 413 from Cloudflare) and never reach the backend.
- Uploads larger than the Cloudflare body limit must be sent as a sequence
  of chunked part uploads, each below the edge limit.


Downloads should provide:

- `Content-Type` when known
- `Content-Length` when known
- Safe `Content-Disposition: attachment`
