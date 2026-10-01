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
