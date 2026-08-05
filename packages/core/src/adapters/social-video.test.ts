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
  it('returns a public creator profile with up to ten recent posts in one request', async () => {
    const state = {
      source: {
        data: {
          '/embed/@scout2015?lang=en-US': {
            userInfo: {
              id: '123', uniqueId: 'scout2015', nickname: 'Scout & Suki', signature: 'Three good dogs.',
              avatarThumbUrl: 'https://images.example.com/scout.jpg', verified: true,
              followerCount: 1000, followingCount: 25, heartCount: 5000, videoCount: 120,
            },
            videoList: [{
              id: '6718335390845095173', desc: 'A recent public video', coverUrl: 'https://images.example.com/cover.jpg',
              width: 720, height: 1280, playCount: 1234, playAddr: 'https://media.example.com/private-shape.mp4',
            }],
          },
        },
      },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe('https://www.tiktok.com/embed/@scout2015?lang=en-US');
      return response(`<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script></html>`, 'text/html');
    }) as unknown as typeof fetch;

    const result = await extractUrl('https://www.tiktok.com/@scout2015', { fetcher });

    expect(result).toMatchObject({
      source: 'tiktok', type: 'profile', method: 'tiktok-profile-embed',
      attributes: { verified: true, followerCount: 1000, followingCount: 25, totalLikeCount: 5000, postCount: 120 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items![0]).toMatchObject({
      type: 'post', id: '6718335390845095173', attributes: { viewCount: 1234 },
      media: [{ width: 720, height: 1280 }],
    });
    expect(result.content).not.toContain('playAddr');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

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
            stats: { diggCount: 42, commentCount: 7, shareCount: 3, playCount: 1_234 },
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
      attributes: {
        hashtags: ['example'],
        likeCount: 42,
        replyCount: 7,
        shareCount: 3,
        viewCount: 1_234,
      },
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
      owner: { username: 'instagram', is_verified: true },
      edge_media_to_caption: { edges: [{ node: { text: 'A useful public Instagram caption. #public' } }] },
      edge_media_preview_like: { count: 250 },
      edge_media_to_comment: { count: 12 },
      video_view_count: -1,
      is_paid_partnership: true,
      coauthor_producers: [{ username: 'creator' }],
      location: { name: 'Berlin' },
      edge_sidecar_to_children: { edges: [
        { node: { display_url: 'https://images.example.com/one.jpg', dimensions: { width: 1080, height: 1350 }, accessibility_caption: 'First image' } },
        { node: { display_url: 'https://images.example.com/two.jpg', dimensions: { width: 1080, height: 1080 }, accessibility_caption: 'Second image' } },
      ] },
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
      attributes: {
        verified: true,
        hashtags: ['public'],
        coauthors: ['@creator'],
        locationName: 'Berlin',
        sponsored: true,
        likeCount: 250,
        replyCount: 12,
      },
    });
    expect(result.attributes).not.toHaveProperty('viewCount');
    expect(result.content).toContain('A useful public Instagram caption.');
    expect(result.content).toContain('Media: 2 carousel items');
    expect(result.media).toHaveLength(2);
    expect(result.media[0]).toMatchObject({ alt: 'First image', width: 1080, height: 1350 });
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('returns a public profile and recent posts as a feed', async () => {
    const profileContext = {
      context: {
        username: 'instagram',
        full_name: 'Instagram',
        followers_count: 100,
        posts_count: 20,
        verified: true,
        pronouns: ['they/them'],
        profile_pic_url: 'https://images.example.com/profile.jpg',
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
      attributes: { verified: true, pronouns: ['they/them'] },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items![0].url).toBe('https://www.instagram.com/p/POST123/');
    expect(result.items![0].content).toContain('A recent post.');
    expect(result.content).toContain('Posts: 20');
    expect(result.media[0]?.url).toBe('https://images.example.com/profile.jpg');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not use copied app credentials when a profile cannot be embedded', async () => {
    const fetcher = vi.fn(async () => response('<html>Changed embed</html>', 'text/html')) as unknown as typeof fetch;

    await expect(extractUrl('https://www.instagram.com/instagram/', { fetcher })).rejects.toMatchObject({
      code: 'not_found', status: 404,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
