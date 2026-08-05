import { z } from 'zod';

const CONTACT_DESTINATION = 'marius@eyloo.com';
const CONTACT_SENDER = 'contact@extractor.eyloo.com';

const singleLine = z.string().trim().refine(
  (value) => !/[\r\n\u0000]/.test(value),
  'Must be a single line.',
);

export const contactTopics = ['general', 'extraction', 'pricing', 'partnership'] as const;

export const contactSubmissionSchema = z.object({
  name: singleLine.max(100).optional().default(''),
  email: singleLine.max(254).pipe(z.email()),
  topic: z.enum(contactTopics),
  message: z.string().trim().min(20).max(4_000).refine(
    (value) => !value.includes('\u0000'),
    'Contains an invalid character.',
  ),
  website: z.string().max(200).optional().default(''),
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;

const topicLabels: Record<ContactSubmission['topic'], string> = {
  general: 'General question',
  extraction: 'Extraction help',
  pricing: 'Pricing question',
  partnership: 'Partnership',
};

export class ContactError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'rate_limited' | 'send_failed',
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ContactError';
  }
}

interface ContactBindings {
  email: SendEmail;
  rateLimiter: RateLimit;
}

export interface ContactResult {
  accepted: true;
  sent: boolean;
}

/**
 * Validates and sends one contact request without allowing the caller to
 * control mail headers or recipients. The honeypot deliberately returns the
 * same success shape as a real submission so automated spam gets no signal.
 */
export async function submitContact(
  rawSubmission: unknown,
  clientKey: string,
  bindings: ContactBindings,
): Promise<ContactResult> {
  const limit = await bindings.rateLimiter.limit({ key: `contact:${clientKey}` });
  if (!limit.success) {
    throw new ContactError('rate_limited', 'Too many messages. Please wait a minute and try again.', 429);
  }

  const honeypot = rawSubmission && typeof rawSubmission === 'object'
    ? Reflect.get(rawSubmission, 'website')
    : undefined;
  if (typeof honeypot === 'string' && honeypot.trim()) return { accepted: true, sent: false };

  const parsed = contactSubmissionSchema.safeParse(rawSubmission);
  if (!parsed.success) {
    throw new ContactError('invalid_request', 'Check the form fields and try again.', 400);
  }

  const submission = parsed.data;
  const label = topicLabels[submission.topic];
  const text = [
    `Name: ${submission.name || 'Not provided'}`,
    `Email: ${submission.email}`,
    `Topic: ${label}`,
    '',
    submission.message,
  ].join('\n');

  try {
    await bindings.email.send({
      to: { name: 'extractor.sh', email: CONTACT_DESTINATION },
      from: { name: 'extractor.sh contact', email: CONTACT_SENDER },
      replyTo: { name: submission.name || submission.email, email: submission.email },
      subject: `[extractor.sh] ${label}`,
      text,
    });
  } catch {
    throw new ContactError('send_failed', 'The message could not be sent. Please try again later.', 502);
  }

  return { accepted: true, sent: true };
}
