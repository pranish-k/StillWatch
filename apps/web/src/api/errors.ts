/** The collector answered with an error status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The collector could not be reached at all. */
export class UnreachableError extends Error {
  constructor(message = 'The Stillwatch collector is not reachable.') {
    super(message);
    this.name = 'UnreachableError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Plain message for an error shown inside a page. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'This item no longer exists. It may have been deleted.';
    return error.message || `The collector returned an error (${error.status}).`;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
