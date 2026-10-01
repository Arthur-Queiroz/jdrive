export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorResponse(statusCode: number, code: string, message: string) {
  return { statusCode, body: { error: { code, message } } };
}
