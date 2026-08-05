import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from './schema';
import { toPublicExtractionResult } from './types';
import { searchVideos } from './videos';

const youtubeFixture = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [{
                videoRenderer: {
                  videoId: 'H7Qe96fqg1M',
                  title: { runs: [{ text: 'Learn Cloudflare Workers 101' }] },
                  ownerText: { runs: [{ text: 'Cloudflare Developers' }] },
                  descriptionSnippet: { runs: [{ text: 'A full course for Workers beginners.' }] },
                  lengthText: { simpleText: '1:00:04' },
                  publishedTimeText: { simpleText: '2 years ago' },
                  viewCountText: { simpleText: '1,234 views' },
                  thumbnail: {
                    thumbnails: [
                      { url: 'https://i.ytimg.com/vi/H7Qe96fqg1M/default.jpg', width: 120, height: 90 },
                      { url: 'https://i.ytimg.com/vi/H7Qe96fqg1M/hqdefault.jpg', width: 480, height: 360 },
                    ],
                  },
                },
              }],
            },
          }],
        },
      },
    },
  },
};

const googleVideoFixture = `)]}'
42;["response"]c;<div>
  <div class="MjjYud">
    <a jsname="UWckNb" href="https://videos.example/watch/cloudflare-workers">
      <h3 class="LC20lb">Cloudflare Workers complete tutorial</h3>
    </a>
    <div class="ITZIwc">Build and deploy a Cloudflare Workers application.</div>
    <div class="WRu9Cd">Example Video Publisher</div>
    <span class="k1U36b">05:23</span>
    <img src="https://videos.example/thumbnails/cloudflare.jpg" />
  </div>
</div>`;

const googleYoutubeFixture = `)]}'
42;["response"]c;<div>
  <div class="MjjYud">
    <a href="/url?q=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DWDhruDqb5nM&amp;sa=U">
      <div role="heading">Cloudflare Workers explained</div>
    </a>
    <div class="ITZIwc">A practical Cloudflare Workers introduction.</div>
    <div class="gqF9jc">Cloudflare Developers</div>
    <span class="k1U36b">5:23</span>
    <div jscontroller="rTuANe" data-vid="WDhruDqb5nM"></div>
    <img src="data:image/jpeg;base64,omitted" />
  </div>
</div>`;

function youtubeResponse(fixture: unknown = youtubeFixture): Response {
  return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
}

describe('video search', () => {
  it('uses only YouTube when the primary structured search has usable results', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://www.youtube.com/youtubei/v1/search');
      expect(url.searchParams.get('prettyPrint')).toBe('false');
      expect(url.searchParams.has('key')).toBe(false);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('omit');
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
      const payload = JSON.parse(String(init?.body));
      expect(JSON.stringify(payload)).not.toMatch(/apiKey|visitorData|authorization|cookie/i);
      expect(payload).toMatchObject({
        context: { client: { clientName: 'WEB', hl: 'en', gl: 'US', platform: 'DESKTOP' } },
        query: 'cloudflare workers',
        params: 'EgIQAfABAQ==',
      });
      return youtubeResponse();
    });

    const result = toPublicExtractionResult(await searchVideos(' cloudflare  workers ', {
      fetcher,
      limit: 3,
      resultUrl: 'https://extractor.sh/api/videos?q=cloudflare+workers&limit=3&format=json',
    }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'video-search',
      attributes: {
        feedType: 'video-search', query: 'cloudflare workers', language: 'en-US', country: 'US',
        videoPlatform: 'any', videoSort: 'relevance', resultCount: 1,
      },
    });
    expect(result.items?.[0]).toMatchObject({
      id: 'H7Qe96fqg1M',
      url: 'https://www.youtube.com/watch?v=H7Qe96fqg1M',
      title: 'Learn Cloudflare Workers 101',
      author: 'Cloudflare Developers',
      publishedAt: null,
      content: 'A full course for Workers beginners.',
      media: [{ type: 'image', url: 'https://i.ytimg.com/vi/H7Qe96fqg1M/hqdefault.jpg' }],
      attributes: { durationSeconds: 3_604, viewCount: 1_234, publishedAtDisplay: '2 years ago' },
    });
    expect(result.content).toContain('3604s · 1,234 views');
    expect(result).not.toHaveProperty('method');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns ten videos by default without making a fallback request', async () => {
    const contents = Array.from({ length: 12 }, (_, index) => ({
      videoRenderer: {
        videoId: `video${String(index).padStart(6, '0')}`,
        title: { simpleText: `Cloudflare Workers video ${index + 1}` },
      },
    }));
    const fetcher = vi.fn<typeof fetch>(async () => youtubeResponse({ contents }));

    const result = toPublicExtractionResult(await searchVideos('cloudflare workers', { fetcher }));

    expect(result.items).toHaveLength(10);
    expect(result.attributes).toMatchObject({ resultCount: 10 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requests newest-first YouTube results and preserves the displayed upload time', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({ query: 'Taylor Swift', params: 'CAISAhAB8AEB' });
      return youtubeResponse({
        contents: [
          { videoRenderer: {
            videoId: 'older000001',
            title: { simpleText: 'Taylor Swift video from yesterday' },
            ownerText: { simpleText: 'Taylor Swift' },
            publishedTimeText: { simpleText: '1 day ago' },
          } },
          { videoRenderer: {
            videoId: 'latest00001',
            title: { simpleText: 'Taylor Swift latest official video' },
            ownerText: { simpleText: 'Taylor Swift' },
            publishedTimeText: { simpleText: '12 minutes ago' },
          } },
          { videoRenderer: {
            videoId: 'recent00001',
            title: { simpleText: 'Taylor Swift video from today' },
            ownerText: { simpleText: 'Taylor Swift' },
            publishedTimeText: { simpleText: '2 hours ago' },
          } },
        ],
      });
    });

    const result = toPublicExtractionResult(await searchVideos('Taylor Swift', {
      fetcher,
      sort: 'date',
      platform: 'youtube',
      limit: 1,
    }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.attributes).toMatchObject({ videoPlatform: 'youtube', videoSort: 'date', resultCount: 1 });
    expect(result.items?.[0]).toMatchObject({
      title: 'Taylor Swift latest official video',
      author: 'Taylor Swift',
      publishedAt: null,
      attributes: { publishedAtDisplay: '12 minutes ago' },
    });
    expect(result.content).toContain('Taylor Swift · 12 minutes ago');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns the newest upload by an exact creator from one fetched result set', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({ query: 'Taylor Swift', params: 'CAISAhAB8AEB' });
      return youtubeResponse({
        contents: [
          { videoRenderer: {
            videoId: 'fanvideo001',
            title: { simpleText: 'Taylor Swift fan update' },
            ownerText: { simpleText: 'Swifties Daily' },
            publishedTimeText: { simpleText: '2 minutes ago' },
          } },
          { videoRenderer: {
            videoId: 'official001',
            title: { simpleText: 'Taylor Swift official video' },
            ownerText: { simpleText: 'Taylor Swift' },
            publishedTimeText: { simpleText: '1 hour ago' },
          } },
        ],
      });
    });

    const result = toPublicExtractionResult(await searchVideos('Taylor Swift', {
      fetcher,
      creator: '  Taylor   Swift ',
      sort: 'date',
      platform: 'youtube',
      limit: 1,
    }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.attributes).toMatchObject({
      videoCreator: 'Taylor Swift', videoSort: 'date', resultCount: 1,
    });
    expect(result.items?.map((item) => item.author)).toEqual(['Taylor Swift']);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('makes one Google Videos request only after YouTube returns no usable results', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.hostname);
      if (url.hostname === 'www.youtube.com') return youtubeResponse({ contents: {} });

      expect(init?.method).toBe('GET');
      expect(url.origin + url.pathname).toBe('https://www.google.com/search');
      expect(url.searchParams.get('q')).toBe('cloudflare workers');
      expect(url.searchParams.get('tbm')).toBe('vid');
      expect(url.searchParams.get('safe')).toBe('high');
      expect(url.searchParams.has('tbs')).toBe(false);
      expect(url.searchParams.get('hl')).toBe('de');
      expect(url.searchParams.get('lr')).toBe('lang_de');
      expect(url.searchParams.get('cr')).toBe('countryDE');
      expect(url.searchParams.get('asearch')).toBe('arc');
      expect(url.searchParams.get('async')).toMatch(/^arc_id:srp_[A-Za-z0-9_-]{23}_100,use_ac:true,_fmt:prog$/);
      expect(url.searchParams.get('async')).not.toContain('_fmt:json');
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);
      return new Response(googleVideoFixture, { headers: { 'Content-Type': 'text/plain' } });
    });

    const result = await searchVideos('cloudflare workers', {
      fetcher,
      language: 'de-de',
      country: 'de',
    });
    const publicResult = toPublicExtractionResult(result);

    expect(calls).toEqual(['www.youtube.com', 'www.google.com']);
    expect(result.method).toBe('video-search-html');
    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult.items).toHaveLength(1);
    expect(publicResult.items?.[0]).toMatchObject({
      url: 'https://videos.example/watch/cloudflare-workers',
      title: 'Cloudflare Workers complete tutorial',
      author: 'Example Video Publisher',
      content: 'Build and deploy a Cloudflare Workers application.',
      media: [{ type: 'image', url: 'https://videos.example/thumbnails/cloudflare.jpg' }],
      attributes: { durationSeconds: 323 },
    });
  });

  it('restricts the Google fallback to YouTube when platform=youtube', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.youtube.com') return new Response('temporarily unavailable', { status: 503 });
      expect(url.searchParams.get('q')).toBe('site:youtube.com cloudflare workers');
      return new Response(googleYoutubeFixture, { headers: { 'Content-Type': 'text/plain' } });
    });

    const result = toPublicExtractionResult(await searchVideos('cloudflare workers', {
      fetcher,
      platform: 'youtube',
    }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.attributes).toMatchObject({ videoPlatform: 'youtube', resultCount: 1 });
    expect(result.items?.[0]).toMatchObject({
      id: 'WDhruDqb5nM',
      url: 'https://www.youtube.com/watch?v=WDhruDqb5nM',
      title: 'Cloudflare Workers explained',
      attributes: { durationSeconds: 323 },
    });
    expect(result.items?.[0]?.media).toEqual([{
      type: 'image',
      url: 'https://img.youtube.com/vi/WDhruDqb5nM/hqdefault.jpg',
      alt: 'Cloudflare Workers explained',
    }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requests newest-first Google Videos only when the date-sorted primary is empty', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.hostname);
      if (url.hostname === 'www.youtube.com') {
        expect(JSON.parse(String(init?.body)).params).toBe('CAISAhAB8AEB');
        return youtubeResponse({ contents: {} });
      }
      expect(url.searchParams.get('tbs')).toBe('sbd:1');
      return new Response(googleVideoFixture, { headers: { 'Content-Type': 'text/plain' } });
    });

    const result = toPublicExtractionResult(await searchVideos('cloudflare workers', { fetcher, sort: 'date' }));

    expect(calls).toEqual(['www.youtube.com', 'www.google.com']);
    expect(result.attributes).toMatchObject({ videoSort: 'date', resultCount: 1 });
  });

  it('returns an empty valid feed when the primary is empty and the fallback is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.youtube.com') return youtubeResponse({ contents: {} });
      return new Response('temporarily unavailable', { status: 503 });
    });

    const result = toPublicExtractionResult(await searchVideos('an impossible video query', { fetcher }));
    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.items).toEqual([]);
    expect(result.attributes).toMatchObject({ resultCount: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces an upstream error only when both sequential requests fail', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('temporarily unavailable', { status: 503 }));
    await expect(searchVideos('cloudflare workers', { fetcher })).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid known controls before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(searchVideos('videos', { fetcher, limit: 21 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, language: 'not a locale!' })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, country: 'DEU' })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, platform: 'vimeo' as 'youtube' })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, sort: 'popular' as 'date' })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, creator: '  ' })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchVideos('videos', { fetcher, creator: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
