import { describe, expect, it } from 'vitest';
import { fetchGoogleNewsRssWithSocket } from './google-news-transport';

function socketFor(response: string, writes: string[]): {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
} {
  return {
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(response));
        controller.close();
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        writes.push(new TextDecoder().decode(chunk));
      },
    }),
    close() {},
  };
}

describe('Google News socket transport', () => {
  it('sends a bounded RSS GET and returns the response body', async () => {
    const writes: string[] = [];
    const body = '<?xml version="1.0"?><rss><channel><title>AI</title></channel></rss>';
    const response = await fetchGoogleNewsRssWithSocket(
      'https://news.google.com/rss/search?q=AI&hl=en-US',
      undefined,
      () => socketFor([
        'HTTP/1.1 200 OK',
        'Content-Type: application/rss+xml',
        `Content-Length: ${body.length}`,
        '',
        body,
      ].join('\r\n'), writes),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(writes.join('')).toContain('GET /rss/search?q=AI&hl=en-US HTTP/1.1');
    expect(writes.join('')).toContain('Accept-Encoding: identity');
    expect(writes.join('')).toContain('Connection: close');
  });

  it('decodes chunked HTTP responses', async () => {
    const body = '<rss>useful feed</rss>';
    const encoded = `${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`;
    const response = await fetchGoogleNewsRssWithSocket(
      'https://news.google.com/rss',
      undefined,
      () => socketFor([
        'HTTP/1.1 200 OK',
        'Transfer-Encoding: chunked',
        '',
        encoded,
      ].join('\r\n'), []),
    );
    expect(await response.text()).toBe(body);
  });

  it('cannot be repurposed as an arbitrary socket fetcher', async () => {
    await expect(fetchGoogleNewsRssWithSocket(
      'https://example.com/private',
      undefined,
      () => socketFor('', []),
    )).rejects.toThrow('only Google News RSS GET requests');
  });
});
