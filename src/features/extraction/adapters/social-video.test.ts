import { describe, expect, it, vi } from 'vitest';
import { extractUrl } from '../extract';

function response(body: string, contentType: string): Response {
  return new Response(body, { headers: { 'Content-Type': contentType } });
}

function tiktokHydration(scope: Record<string, unknown>): string {
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: scope,
  })}</script></body></html>`;
}

function instagramEmbedContext(media: Record<string, unknown>): string {
  const context = JSON.stringify({ gql_data: { shortcode_media: media } });
  return `<html><body><script>window.__fixture={"contextJSON":${JSON.stringify(context)}};</script></body></html>`;
}

describe('TikTok extraction', () => {
  it('normalizes a public video from page hydration without Browser Rendering', async () => {
    const fetcher = vi.fn(async () => response(tiktokHydration({
      'webapp.video-detail': {
        itemInfo: {
          itemStruct: {
            id: '6718335390845095173',
            desc: 'A useful public TikTok caption #example',
            createTime: '1564234358',
            author: { uniqueId: 'scout2015', nickname: 'Scout & Suki' },
            video: { duration: 10 },
            music: { title: 'Original sound', authorName: 'Scout & Suki' },
            challenges: [{ title: 'example' }],
          },
        },
      },
    }), 'text/html')) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl(
      'https://www.tiktok.com/@scout2015/video/6718335390845095173',
      { fetcher, allowBrowser },
    );

    expect(result).toMatchObject({
      source: 'tiktok',
      type: 'post',
      method: 'tiktok-hydration',
      author: 'Scout & Suki (@scout2015)',
      publishedAt: '2019-07-27T13:32:38.000Z',
    });
    expect(result.content).toContain('A useful public TikTok caption');
    expect(result.content).toContain('Sound: Original sound — Scout & Suki');
    expect(result.content).not.toContain('playAddr');
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('uses official oEmbed when hydration data is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().startsWith('https://www.tiktok.com/oembed')) {
        return response(JSON.stringify({
          type: 'video',
          title: 'Public caption',
          author_name: 'Creator',
          author_url: 'https://www.tiktok.com/@creator',
          html: '<blockquote><section><p>Public caption</p></section></blockquote>',
        }), 'application/json');
      }
      return response('<html><body>Page shell</body></html>', 'text/html');
    }) as unknown as typeof fetch;

    const result = await extractUrl(
      'https://www.tiktok.com/@creator/video/1234567890123456789',
      { fetcher },
    );

    expect(result).toMatchObject({ source: 'tiktok', method: 'tiktok-oembed' });
    expect(result.url).toBe('https://www.tiktok.com/@creator/video/1234567890123456789');
    expect(result.content).toContain('Public caption');
  });
});

describe('Instagram extraction', () => {
  it('normalizes a public post from its embed document', async () => {
    const fetcher = vi.fn(async () => response(instagramEmbedContext({
      __typename: 'GraphSidecar',
      shortcode: 'DbbY9pdm6Q2',
      owner: { username: 'instagram' },
      edge_media_to_caption: { edges: [{ node: { text: 'A useful public Instagram caption.' } }] },
      edge_sidecar_to_children: { edges: [{ node: {} }, { node: {} }] },
    }), 'text/html')) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl('https://www.instagram.com/p/DbbY9pdm6Q2/', {
      fetcher,
      allowBrowser,
    });

    expect(result).toMatchObject({
      source: 'instagram',
      type: 'post',
      method: 'instagram-embed',
      author: '@instagram',
    });
    expect(result.content).toContain('A useful public Instagram caption.');
    expect(result.content).toContain('Media: 2 carousel items');
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('returns a public profile and recent posts as a feed', async () => {
    const profileContext = {
      context: {
        username: 'instagram',
        full_name: 'Instagram',
        followers_count: 100,
        posts_count: 20,
        graphql_media: [{
          shortcode_media: {
            __typename: 'GraphImage',
            shortcode: 'POST123',
            taken_at_timestamp: 1_754_000_000,
            edge_media_to_caption: { edges: [{ node: { text: 'A recent post.\nSecond line.' } }] },
          },
        }],
      },
    };
    const fetcher = vi.fn(async () => response(
      `<html><script>window.__fixture={"contextJSON":${JSON.stringify(JSON.stringify(profileContext))}};</script></html>`,
      'text/html',
    )) as unknown as typeof fetch;

    const result = await extractUrl('https://www.instagram.com/instagram/', { fetcher });

    expect(result).toMatchObject({
      source: 'instagram',
      type: 'profile',
      method: 'instagram-profile',
      author: 'Instagram (@instagram)',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items![0].url).toBe('https://www.instagram.com/p/POST123/');
    expect(result.items![0].content).toContain('A recent post.');
    expect(result.content).toContain('Posts: 20');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to public profile JSON when the embed shape is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString().endsWith('/embed/')) return response('<html>Changed embed</html>', 'text/html');
      expect(new Headers(init?.headers).get('X-IG-App-ID')).toBe('936619743392459');
      return response(JSON.stringify({
        data: {
          user: {
            username: 'instagram',
            full_name: 'Instagram',
            biography: 'Discover what is new.',
            is_private: false,
            edge_followed_by: { count: 100 },
            edge_follow: { count: 5 },
            edge_owner_to_timeline_media: { count: 20, edges: [] },
          },
        },
      }), 'application/json');
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://www.instagram.com/instagram/', { fetcher });
    expect(result).toMatchObject({ source: 'instagram', type: 'profile', method: 'instagram-profile' });
    expect(result.content).toContain('Discover what is new.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
