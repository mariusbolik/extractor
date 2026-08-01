import { describe, expect, it, vi } from 'vitest';
import { extractUrl } from '../extract';

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

describe('official media oEmbed adapters', () => {
  it('extracts Vimeo metadata without Browser Rendering', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toContain('https://vimeo.com/api/oembed.json?');
      return json({
        type: 'video',
        title: 'My video',
        author_name: 'Marc Campbell',
        description: 'This is my video.',
        duration: 23,
        upload_date: '2018-08-27 10:57:40',
        thumbnail_url: 'https://i.vimeocdn.com/video/example.jpg',
        html: '<iframe src="https://player.vimeo.com/video/286898202"></iframe>',
      });
    }) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);
    const result = await extractUrl('https://vimeo.com/286898202', { fetcher, allowBrowser });

    expect(result).toMatchObject({ source: 'vimeo', method: 'vimeo-oembed', title: 'My video', author: 'Marc Campbell' });
    expect(result.content).toContain('Duration: 23 seconds');
    expect(result.content).not.toContain('<iframe');
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('extracts a SoundCloud description as inert Markdown', async () => {
    const fetcher = vi.fn(async () => json({
      type: 'rich',
      title: 'Flickermood by Forss',
      author_name: 'Forss',
      description: 'From the <strong>Soulhack</strong> album.',
      html: '<iframe src="https://w.soundcloud.com/player"></iframe>',
    })) as unknown as typeof fetch;
    const result = await extractUrl('https://soundcloud.com/forss/flickermood', { fetcher });

    expect(result).toMatchObject({ source: 'soundcloud', method: 'soundcloud-oembed', author: 'Forss' });
    expect(result.content).toContain('From the **Soulhack** album.');
    expect(result.content).not.toContain('<iframe');
  });

  it('extracts Spotify metadata', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toContain('https://open.spotify.com/oembed?');
      return json({
        type: 'rich',
        title: 'My Path to Spotify: Women in Engineering',
        thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/example',
        html: '<iframe src="https://open.spotify.com/embed/episode/example"></iframe>',
      });
    }) as unknown as typeof fetch;
    const result = await extractUrl('https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5', { fetcher });

    expect(result).toMatchObject({ source: 'spotify', method: 'spotify-oembed' });
    expect(result.content).toContain('My Path to Spotify');
  });

  it('enriches a validated Mastodon status with its public status data', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/oembed?')) {
        return json({ type: 'rich', author_name: 'infinite love', html: '<blockquote>View on Mastodon</blockquote>' });
      }
      expect(url).toBe('https://mastodon.social/api/v1/statuses/99664077509711321');
      return json({
        url: 'https://mastodon.social/@trwnh/99664077509711321',
        created_at: '2018-03-11T07:25:35.905Z',
        content: '<p>A useful public post with <a href="https://example.com">a source</a>.</p>',
        spoiler_text: '',
        account: { display_name: 'infinite love', acct: 'trwnh' },
        media_attachments: [{ description: 'A useful image description.' }],
      });
    }) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);
    const result = await extractUrl('https://mastodon.social/@trwnh/99664077509711321', { fetcher, allowBrowser });

    expect(result).toMatchObject({ source: 'mastodon', method: 'mastodon-oembed', publishedAt: '2018-03-11T07:25:35.905Z' });
    expect(result.content).toContain('A useful public post');
    expect(result.content).toContain('A useful image description.');
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('returns status-shaped URLs on non-Mastodon hosts to webpage extraction', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().includes('/api/oembed?')) return new Response('Not found', { status: 404 });
      return new Response('<html><head><title>Ordinary page</title></head><body><main><h1>Ordinary page</h1><p>This is ordinary public article content with enough meaningful words to be extracted as a normal web document instead of a Mastodon status.</p></main></body></html>', { headers: { 'Content-Type': 'text/html' } });
    }) as unknown as typeof fetch;
    const result = await extractUrl('https://example.com/@author/123456789', { fetcher });

    expect(result.source).toBe('web');
    expect(result.method).toBe('linkedom');
  });
});
