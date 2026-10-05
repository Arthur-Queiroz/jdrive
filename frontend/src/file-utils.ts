export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function uploadProgress(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round(loaded / total * 100)));
}

export function createLatestRequest() {
  let sequence = 0;
  return {
    begin: () => ++sequence,
    current: () => sequence,
    isCurrent: (request: number) => request === sequence,
  };
}

export function fileSearchURL(query: string): string {
  const term = query.trim();
  return term ? `/files?search=${encodeURIComponent(term)}` : '/files';
}

/** Cloudflare Free caps proxied request bodies at 100 MB; stay well below it. */
export const SINGLE_REQUEST_UPLOAD_LIMIT = 90 * 1024 * 1024;

/** Full-file chunk size for chunked uploads (backend accepts any size ≤ edge limit). */
export const CHUNK_SIZE = 8 * 1024 * 1024;

export function shouldChunkUpload(sizeBytes: number): boolean {
  return sizeBytes > SINGLE_REQUEST_UPLOAD_LIMIT;
}

export function chunkCount(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / CHUNK_SIZE));
}

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
