import { describe, expect, it, vi } from 'vitest';
import { searchPlaces } from './places';
import { ExtractionResponseSchema } from './schema';
import { toPublicExtractionResult } from './types';

const fixture = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {
      osm_type: 'W',
      osm_id: 518071791,
      osm_key: 'tourism',
      osm_value: 'attraction',
      name: 'Brandenburg Gate',
      street: 'Pariser Platz',
      housenumber: '1',
      postcode: '10117',
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      countrycode: 'DE',
      extent: [13.37, 52.52, 13.38, 52.51],
      extra: {
        website: 'https://www.visitberlin.de/en/brandenburg-gate',
        phone: '+49 30 123456',
        opening_hours: '24/7',
      },
    },
    geometry: { type: 'Point', coordinates: [13.3777, 52.5163] },
  }],
};

describe('place search', () => {
  it('returns provider-neutral place documents with coordinates and attribution', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
      expect(url.searchParams.get('q')).toBe('Brandenburg Gate Berlin');
      expect(url.searchParams.get('limit')).toBe('3');
      expect(url.searchParams.get('lang')).toBe('en');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = toPublicExtractionResult(await searchPlaces('Brandenburg Gate Berlin', {
      fetcher,
      limit: 3,
      resultUrl: 'https://extractor.sh/api/places?q=Brandenburg+Gate+Berlin&limit=3&format=json',
    }));

    expect(ExtractionResponseSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      schemaVersion: 1,
      type: 'feed',
      source: 'place-search',
      attributes: {
        feedType: 'place-search',
        query: 'Brandenburg Gate Berlin',
        attribution: '© OpenStreetMap contributors',
      },
    });
    expect(result.items?.[0]).toMatchObject({
      type: 'document',
      url: 'https://www.openstreetmap.org/way/518071791',
      title: 'Brandenburg Gate',
      attributes: {
        latitude: 52.5163,
        longitude: 13.3777,
        address: 'Pariser Platz 1, 10117 Berlin, Germany',
        category: 'tourism:attraction',
        countryCode: 'DE',
        street: 'Pariser Platz',
        houseNumber: '1',
        postalCode: '10117',
        locality: 'Berlin',
        region: 'Berlin',
        country: 'Germany',
        boundingBox: [13.37, 52.51, 13.38, 52.52],
        website: 'https://www.visitberlin.de/en/brandenburg-gate',
        phoneNumber: '+49 30 123456',
        openingHours: '24/7',
      },
    });
    expect(result).not.toHaveProperty('method');
    expect(JSON.stringify(result)).not.toContain('photon');
  });

  it('rejects invalid limits and malformed upstream data', async () => {
    await expect(searchPlaces('Berlin', { limit: 11 })).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    await expect(searchPlaces('Berlin', {
      fetcher: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    })).rejects.toMatchObject({ code: 'upstream_error', status: 502 });
  });

  it('forwards localization, country, paired bias, and place type controls', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('lang')).toBe('de-DE');
      expect(url.searchParams.get('countrycode')).toBe('de');
      expect(url.searchParams.get('lat')).toBe('52.52');
      expect(url.searchParams.get('lon')).toBe('13.405');
      expect(url.searchParams.get('layer')).toBe('city');
      return new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } });
    });
    const result = toPublicExtractionResult(await searchPlaces('Berlin', {
      fetcher,
      language: 'de-de',
      country: 'de',
      latitude: 52.52,
      longitude: 13.405,
      type: 'city',
    }));
    expect(result.attributes).toMatchObject({
      language: 'de-DE', country: 'DE', latitude: 52.52, longitude: 13.405,
      placeType: 'city', resultCount: 1,
    });
  });

  it('requires coordinates as a valid pair', async () => {
    await expect(searchPlaces('Berlin', { latitude: 52.52 })).rejects.toMatchObject({ status: 400 });
    await expect(searchPlaces('Berlin', { latitude: -91, longitude: 13 })).rejects.toMatchObject({ status: 400 });
  });

  it('localizes common German categories and orders biased results by distance', async () => {
    const far = fixture.features[0]!;
    const close = {
      ...far,
      properties: { ...far.properties, osm_id: 2, name: 'Nearby bakery' },
      geometry: { type: 'Point', coordinates: [7.831, 50.434] },
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('q')).toBe('Bäcker');
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [far, close] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = toPublicExtractionResult(await searchPlaces('bakery', {
      fetcher,
      country: 'DE',
      latitude: 50.437,
      longitude: 7.825,
    }));

    expect(result.attributes.query).toBe('bakery');
    expect(result.items?.map((item) => item.title)).toEqual(['Nearby bakery', 'Brandenburg Gate']);
  });
});
