import { describe, expect, it, vi } from 'vitest';
import { searchImages } from './images';
import { ExtractionResponseSchema } from './schema';
import { toPublicExtractionResult } from './types';

const openverseFixture = {
  result_count: 1,
  results: [{
    id: 'image-1',
    title: 'Coral reef',
    creator: 'Example Photographer',
    creator_url: 'https://example.com/photographer',
    description: '<p>A shallow coral reef.</p>',
    foreign_landing_url: 'https://example.com/coral-reef',
    url: 'https://images.example.com/coral.jpg',
    width: 1600,
    height: 900,
    license: 'cc-by',
    license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    filetype: 'jpg',
    tags: [{ name: 'ocean' }, { name: 'coral' }],
  }],
};

const wikimediaFixture = {
  query: {
    pages: [{
      pageid: 42,
      title: 'File:Coral colony.jpg',
      imageinfo: [{
        thumburl: 'https://upload.wikimedia.org/coral-1600.jpg',
        thumbwidth: 1600,
        thumbheight: 1067,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Coral_colony.jpg',
        extmetadata: {
          Artist: { value: '<a href="/wiki/User:Example">Example</a>' },
          ImageDescription: { value: '<p>Coral in clear water.</p>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        },
      }],
    }],
  },
};

describe('image search', () => {
  it('returns a limited schema-v1 image feed from the primary catalog', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://api.openverse.org/v1/images/');
      expect(url.searchParams.get('q')).toBe('coral reef');
      expect(url.searchParams.get('page_size')).toBe('1');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify(openverseFixture), { headers: { 'Content-Type': 'application/json' } });
    });

    const publicResult = toPublicExtractionResult(await searchImages(' coral  reef ', {
      fetcher,
      limit: 1,
      resultUrl: 'https://extractor.sh/api/images?q=coral+reef&limit=1&format=json',
    }));

    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'image-search',
      attributes: { feedType: 'image-search', query: 'coral reef' },
    });
    expect(publicResult.items?.[0]).toMatchObject({
      type: 'document',
      source: 'image-search',
      author: 'Example Photographer',
      media: [{ type: 'image', url: 'https://images.example.com/coral.jpg', width: 1600, height: 900 }],
      attributes: {
        description: 'A shallow coral reef.',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        creatorUrl: 'https://example.com/photographer',
        fileType: 'jpg',
        tags: ['ocean', 'coral'],
        orientation: 'landscape',
      },
    });
    expect(publicResult).not.toHaveProperty('method');
    expect(JSON.stringify(publicResult)).not.toContain('openverse');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the secondary catalog only when the primary request fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.openverse.org') return new Response('unavailable', { status: 503 });
      expect(url.hostname).toBe('commons.wikimedia.org');
      expect(url.searchParams.get('generator')).toBe('search');
      return new Response(JSON.stringify(wikimediaFixture), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = toPublicExtractionResult(await searchImages('coral', { fetcher }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result.items?.[0]).toMatchObject({
      id: '42',
      title: 'Coral colony.jpg',
      author: 'Example',
      attributes: { license: 'CC BY-SA 4.0' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid limits', async () => {
    await expect(searchImages('coral', { limit: 21 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
  });

  it('maps usage and orientation filters and reports effective settings', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('license_type')).toBe('commercial,modification');
      expect(url.searchParams.get('aspect_ratio')).toBe('wide');
      expect(url.searchParams.get('mature')).toBe('false');
      return new Response(JSON.stringify(openverseFixture), { headers: { 'Content-Type': 'application/json' } });
    });
    const result = toPublicExtractionResult(await searchImages('coral', {
      fetcher,
      usage: 'commercial-and-modify',
      orientation: 'landscape',
    }));
    expect(result.attributes).toMatchObject({ usage: 'commercial-and-modify', orientation: 'landscape', resultCount: 1 });
  });

  it('applies requested filters to fallback results too', async () => {
    const nonCommercial = structuredClone(wikimediaFixture);
    nonCommercial.query.pages[0].imageinfo[0].extmetadata.LicenseShortName.value = 'CC BY-NC 4.0';
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.openverse.org') return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify(nonCommercial), { headers: { 'Content-Type': 'application/json' } });
    });
    const result = await searchImages('coral', { fetcher, usage: 'commercial' });
    expect(result.items).toEqual([]);
    expect(result.attributes.resultCount).toBe(0);
  });
});
