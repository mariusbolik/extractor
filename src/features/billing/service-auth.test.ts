import { describe, expect, it } from 'vitest';
import { authenticateServiceRequest } from './service-auth';

const SUBJECT = `v1.${'a'.repeat(43)}`;

describe('service request authentication', () => {
  it('leaves ordinary public requests on the public lane', async () => {
    await expect(authenticateServiceRequest(
      new Request('https://extractor.sh/api/search?q=test'),
      'secret',
    )).resolves.toEqual({ kind: 'public' });
  });

  it('accepts a valid token and pseudonymous subject', async () => {
    await expect(authenticateServiceRequest(new Request('https://extractor.sh/api/search?q=test', {
      headers: {
        Authorization: 'Bearer secret',
        'X-Extractr-Service-Subject': SUBJECT,
      },
    }), 'secret')).resolves.toEqual({
      kind: 'service',
      subject: SUBJECT,
      limiterKey: `service:${SUBJECT}`,
    });
  });

  it('rejects malformed subjects and incorrect tokens', async () => {
    for (const [subject, token] of [['raw-user-id', 'secret'], [SUBJECT, 'wrong']]) {
      const result = await authenticateServiceRequest(new Request('https://extractor.sh/api/search?q=test', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Extractr-Service-Subject': subject,
        },
      }), 'secret');
      expect(result.kind).toBe('invalid');
      if (result.kind === 'invalid') expect(result.response.status).toBe(401);
    }
  });
});
