/**
 * Every failed API call becomes one of these, so UI code handles errors in one way.
 * Kept in its own module (no Zod, no schemas) so the app entry can use it without
 * pulling the whole validated API client into the first download.
 */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
}
