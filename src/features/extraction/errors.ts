export type ExtractionErrorCode =
  | 'invalid_request'
  | 'invalid_url'
  | 'unsafe_url'
  | 'not_found'
  | 'unsupported_content_type'
  | 'content_too_large'
  | 'rate_limited'
  | 'source_blocked'
  | 'extraction_failed'
  | 'upstream_error'
  | 'timeout';

export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export function sourceResponseError(status: number): ExtractionError {
  if (status === 401) {
    return new ExtractionError(
      'source_blocked',
      'The source requires authentication (HTTP 401). Only public pages can be extracted.',
      502,
    );
  }

  if (status === 403) {
    return new ExtractionError(
      'source_blocked',
      'The source denied access (HTTP 403 Forbidden), likely because of bot protection or access rules.',
      502,
    );
  }

  if (status === 429) {
    return new ExtractionError(
      'upstream_error',
      'The source rate-limited the request (HTTP 429 Too Many Requests). Try again later.',
      502,
    );
  }

  if (status === 451) {
    return new ExtractionError(
      'source_blocked',
      'The source is unavailable for legal reasons (HTTP 451).',
      502,
    );
  }

  if (status >= 500) {
    return new ExtractionError(
      'upstream_error',
      `The source returned HTTP ${status}, so it is currently unavailable.`,
      502,
    );
  }

  return new ExtractionError(
    'upstream_error',
    `The source returned HTTP ${status} and could not be extracted.`,
    502,
  );
}

export function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new ExtractionError('timeout', 'The source took too long to respond.', 504);
  }

  return new ExtractionError('extraction_failed', 'The page could not be extracted.', 422);
}
