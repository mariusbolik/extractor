const SERVICE_SUBJECT_HEADER = 'X-Extractr-Service-Subject';
const SERVICE_SUBJECT_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

export type ServiceRequestAuth =
  | { kind: 'public' }
  | { kind: 'service'; subject: string; limiterKey: string }
  | { kind: 'invalid'; response: Response };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  return /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] ?? null;
}

async function tokenDigest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function constantTimeTokenEquals(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([tokenDigest(left), tokenDigest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

function unauthorizedServiceResponse(): Response {
  return Response.json({
    error: {
      code: 'invalid_service_credentials',
      message: 'The service credentials are invalid.',
    },
  }, {
    status: 401,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * Identify trusted first-party service traffic without changing the public
 * Bearer-key contract. Merely supplying an Authorization header is not enough:
 * the pseudonymous subject explicitly opts the request into this private lane.
 */
export async function authenticateServiceRequest(
  request: Request,
  expectedToken: string | undefined,
): Promise<ServiceRequestAuth> {
  const subject = request.headers.get(SERVICE_SUBJECT_HEADER)?.trim();
  if (!subject) return { kind: 'public' };

  const suppliedToken = bearerToken(request);
  if (
    !expectedToken
    || !suppliedToken
    || !SERVICE_SUBJECT_PATTERN.test(subject)
    || !await constantTimeTokenEquals(suppliedToken, expectedToken)
  ) {
    return { kind: 'invalid', response: unauthorizedServiceResponse() };
  }

  return {
    kind: 'service',
    subject,
    limiterKey: `service:${subject}`,
  };
}
