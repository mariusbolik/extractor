import { describe, expect, it, vi } from 'vitest';
import { ContactError, submitContact } from './contact';

function bindings({ allowed = true, sendFails = false } = {}) {
  const send = sendFails
    ? vi.fn().mockRejectedValue(new Error('provider failure'))
    : vi.fn().mockResolvedValue({ messageId: 'test' });
  return {
    send,
    value: {
      email: { send } as unknown as SendEmail,
      rateLimiter: {
        limit: vi.fn().mockResolvedValue({ success: allowed }),
      } as unknown as RateLimit,
    },
  };
}

const valid = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  topic: 'extraction',
  message: 'Could you help me evaluate this public product page?',
  website: '',
};

describe('contact submissions', () => {
  it('sends plain text to the fixed address with the visitor as reply-to', async () => {
    const mock = bindings();
    await expect(submitContact(valid, '198.51.100.1', mock.value)).resolves.toEqual({ accepted: true, sent: true });

    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({
      to: { name: 'extractor.sh', email: 'marius@eyloo.com' },
      from: { name: 'extractor.sh contact', email: 'contact@extractor.eyloo.com' },
      replyTo: { name: 'Ada Lovelace', email: 'ada@example.com' },
      subject: '[extractor.sh] Extraction help',
    }));
    expect(mock.send.mock.calls[0][0].text).toContain(valid.message);
    expect(mock.value.rateLimiter.limit).toHaveBeenCalledWith({ key: 'contact:198.51.100.1' });
  });

  it.each([
    { ...valid, email: 'not-an-email' },
    { ...valid, message: 'Too short' },
    { ...valid, topic: 'custom-subject' },
    { ...valid, name: 'Header\r\nInjection' },
  ])('rejects invalid fields without sending', async (submission) => {
    const mock = bindings();
    await expect(submitContact(submission, 'client', mock.value)).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    });
    expect(mock.send).not.toHaveBeenCalled();
  });

  it('silently accepts a filled honeypot without sending', async () => {
    const mock = bindings();
    await expect(submitContact({ ...valid, website: 'https://spam.example' }, 'client', mock.value))
      .resolves.toEqual({ accepted: true, sent: false });
    expect(mock.send).not.toHaveBeenCalled();
  });

  it('rate-limits before sending', async () => {
    const mock = bindings({ allowed: false });
    await expect(submitContact(valid, 'client', mock.value)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(mock.send).not.toHaveBeenCalled();
  });

  it('normalizes provider failures without exposing details', async () => {
    const mock = bindings({ sendFails: true });
    await expect(submitContact(valid, 'client', mock.value)).rejects.toEqual(
      new ContactError('send_failed', 'The message could not be sent. Please try again later.', 502),
    );
  });
});
