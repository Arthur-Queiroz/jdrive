export function shouldApplyRefreshError(requests: { isCurrent(request: number): boolean }, requestId: number): boolean {
  return requests.isCurrent(requestId);
}
