import { describe, expect, it } from 'vitest';
import { sourceResponseError } from './errors';

describe('sourceResponseError', () => {
  it('identifies authentication and bot-protection failures', () => {
    expect(sourceResponseError(401)).toMatchObject({
      code: 'source_blocked',
      status: 502,
      message: expect.stringContaining('HTTP 401'),
    });
    expect(sourceResponseError(403)).toMatchObject({
      code: 'source_blocked',
      status: 502,
      message: expect.stringContaining('bot protection'),
    });
  });

  it('identifies upstream rate limiting', () => {
    expect(sourceResponseError(429)).toMatchObject({
      code: 'upstream_error',
      status: 502,
      message: expect.stringContaining('Too Many Requests'),
    });
  });

  it('describes upstream server failures with their exact status', () => {
    expect(sourceResponseError(503)).toMatchObject({
      code: 'upstream_error',
      status: 502,
      message: 'The source returned HTTP 503, so it is currently unavailable.',
    });
  });
});
