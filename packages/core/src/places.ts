import { ExtractionError } from './errors';
import { fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeChoice, normalizeCoordinate, normalizeCountryCode, normalizeLanguageTag } from './options';
import { normalizeSearchQuery } from './search';
import type { ExtractedItem, ExtractionResult, PlaceSearchDependencies, PlaceType } from './types';

const MAX_RESULTS = 10;
const ATTRIBUTION = '© OpenStreetMap contributors';
const PLACE_TYPES = ['any', 'house', 'street', 'locality', 'city', 'county', 'state', 'country', 'other'] as const;
const GERMAN_CATEGORY_QUERIES = new Map<string, string>([
  ['bakery', 'Bäcker'],
  ['bakeries', 'Bäcker'],
  ['baker', 'Bäcker'],
  ['pharmacy', 'Apotheke'],
  ['pharmacies', 'Apotheke'],
  ['drugstore', 'Drogerie'],
  ['grocery store', 'Supermarkt'],
  ['supermarket', 'Supermarkt'],
  ['coffee shop', 'Café'],
  ['gas station', 'Tankstelle'],
  ['petrol station', 'Tankstelle'],
  ['hospital', 'Krankenhaus'],
]);

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 5;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new ExtractionError('invalid_request', `Limit must be an integer from 1 to ${MAX_RESULTS}.`, 400);
  }
  return value;
}

function publicHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : '';
}

function endpointFor(
  query: string,
  limit: number,
  language: string,
  country: string | undefined,
  latitude: number | undefined,
  longitude: number | undefined,
  type: PlaceType,
): URL {
  const endpoint = new URL('https://photon.komoot.io/api/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('lang', language);
  if (country) endpoint.searchParams.set('countrycode', country.toLowerCase());
  if (latitude !== undefined && longitude !== undefined) {
    endpoint.searchParams.set('lat', String(latitude));
    endpoint.searchParams.set('lon', String(longitude));
  }
  if (type !== 'any') endpoint.searchParams.set('layer', type);
  return endpoint;
}

function upstreamQuery(query: string, country: string | undefined): string {
  if (country !== 'DE') return query;
  return GERMAN_CATEGORY_QUERIES.get(query.toLocaleLowerCase('en-US')) ?? query;
}

function distanceSquared(latitude: number, longitude: number, item: ExtractedItem): number {
  const itemLatitude = item.attributes.latitude;
  const itemLongitude = item.attributes.longitude;
  if (typeof itemLatitude !== 'number' || typeof itemLongitude !== 'number') return Number.POSITIVE_INFINITY;
  const latitudeScale = Math.cos(latitude * Math.PI / 180);
  const deltaLatitude = itemLatitude - latitude;
  const deltaLongitude = (itemLongitude - longitude) * latitudeScale;
  return deltaLatitude ** 2 + deltaLongitude ** 2;
}

function coordinate(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function distinct(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase('en-US');
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addressFrom(properties: Record<string, unknown>, title: string): string {
  const street = text(properties.street);
  const houseNumber = text(properties.housenumber);
  const postcode = text(properties.postcode);
  const city = text(properties.city) || text(properties.locality) || text(properties.district);
  const state = text(properties.state);
  const streetLine = [street, houseNumber].filter(Boolean).join(' ');
  const cityLine = [postcode, city].filter(Boolean).join(' ');
  return distinct([
    streetLine,
    cityLine,
    text(properties.county),
    state.toLocaleLowerCase('en-US') === city.toLocaleLowerCase('en-US') ? '' : state,
    text(properties.country),
  ]).filter((part) => part.toLocaleLowerCase('en-US') !== title.toLocaleLowerCase('en-US')).join(', ');
}

function osmUrl(properties: Record<string, unknown>, latitude: number, longitude: number): string {
  const type = { N: 'node', W: 'way', R: 'relation' }[text(properties.osm_type).toUpperCase()];
  const id = Number(properties.osm_id);
  if (type && Number.isSafeInteger(id) && id > 0) {
    return `https://www.openstreetmap.org/${type}/${id}`;
  }
  const map = new URL('https://www.openstreetmap.org/');
  map.searchParams.set('mlat', String(latitude));
  map.searchParams.set('mlon', String(longitude));
  map.hash = `map=16/${latitude}/${longitude}`;
  return map.toString();
}

function boundingBox(feature: Record<string, unknown>, properties: Record<string, unknown>): [number, number, number, number] | null {
  const direct = Array.isArray(feature.bbox) ? feature.bbox : null;
  if (direct?.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = direct.map(Number);
    if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)
      && minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90
      && minLon <= maxLon && minLat <= maxLat) {
      return [minLon, minLat, maxLon, maxLat];
    }
  }

  // Photon commonly returns an extent as west, north, east, south. Normalize
  // that already-fetched value to standard GeoJSON bbox order.
  const extent = Array.isArray(properties.extent) ? properties.extent.map(Number) : null;
  if (extent?.length === 4) {
    const [west, north, east, south] = extent;
    if ([west, north, east, south].every(Number.isFinite)
      && west >= -180 && east <= 180 && south >= -90 && north <= 90
      && west <= east && south <= north) {
      return [west, south, east, north];
    }
  }
  return null;
}

function parseItems(body: string): ExtractedItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new ExtractionError('upstream_error', 'Place search returned malformed data.', 502);
  }

  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    throw new ExtractionError('upstream_error', 'Place search returned an unexpected response.', 502);
  }

  const items: ExtractedItem[] = [];
  for (const value of features) {
    if (!value || typeof value !== 'object') continue;
    const feature = value as Record<string, unknown>;
    const properties = feature.properties && typeof feature.properties === 'object'
      ? feature.properties as Record<string, unknown>
      : null;
    const extra = properties?.extra && typeof properties.extra === 'object'
      ? properties.extra as Record<string, unknown>
      : {};
    const geometry = feature.geometry && typeof feature.geometry === 'object'
      ? feature.geometry as Record<string, unknown>
      : null;
    const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const longitude = coordinate(coordinates[0], -180, 180);
    const latitude = coordinate(coordinates[1], -90, 90);
    if (!properties || longitude === null || latitude === null) continue;

    const title = text(properties.name)
      || text(properties.street)
      || text(properties.city)
      || text(properties.country);
    if (!title) continue;
    const address = addressFrom(properties, title);
    const street = text(properties.street);
    const houseNumber = text(properties.housenumber);
    const postalCode = text(properties.postcode);
    const locality = text(properties.city) || text(properties.locality) || text(properties.district);
    const region = text(properties.state);
    const country = text(properties.country);
    const bounds = boundingBox(feature, properties);
    const categoryParts = [text(properties.osm_key), text(properties.osm_value)].filter(Boolean);
    const category = categoryParts.join(':');
    const website = publicHttpUrl(extra.website) ?? publicHttpUrl(extra['contact:website']);
    const phoneNumber = text(extra.phone) || text(extra['contact:phone']);
    const openingHours = text(extra.opening_hours);
    const countryCode = /^[A-Za-z]{2}$/.test(text(properties.countrycode))
      ? text(properties.countrycode).toUpperCase()
      : '';
    const url = osmUrl(properties, latitude, longitude);
    const content = [
      `## ${escapeMarkdown(title)}`,
      address ? escapeMarkdown(address) : '',
      category ? `Category: ${escapeMarkdown(category)}` : '',
      phoneNumber ? `Phone: ${escapeMarkdown(phoneNumber)}` : '',
      openingHours ? `Opening hours: ${escapeMarkdown(openingHours)}` : '',
      website ? `[Website](${website})` : '',
      `Coordinates: ${latitude}, ${longitude}`,
      `[View place](${url})`,
    ].filter(Boolean).join('\n\n');

    items.push({
      type: 'document',
      source: 'place-search',
      id: properties.osm_id !== undefined ? `${text(properties.osm_type)}${text(properties.osm_id)}` : null,
      url,
      title,
      author: null,
      publishedAt: null,
      content,
      media: [],
      attributes: {
        latitude,
        longitude,
        ...(address ? { address, description: address } : {}),
        ...(street ? { street } : {}),
        ...(houseNumber ? { houseNumber } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(locality ? { locality } : {}),
        ...(region ? { region } : {}),
        ...(country ? { country } : {}),
        ...(bounds ? { boundingBox: bounds } : {}),
        ...(category ? { category } : {}),
        ...(website ? { website } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(openingHours ? { openingHours } : {}),
        ...(countryCode ? { countryCode } : {}),
      },
    });
  }
  return items;
}

/**
 * Resolve named public places and addresses through one browser-free GET.
 * This is intentionally a submitted search action, not autocomplete: one
 * cache miss produces one upstream request and at most ten small GeoJSON rows.
 */
export async function searchPlaces(
  rawQuery: string,
  dependencies: PlaceSearchDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const language = normalizeLanguageTag(dependencies.language, 'en');
  const country = normalizeCountryCode(dependencies.country);
  const latitude = normalizeCoordinate(dependencies.latitude, -90, 90, 'Latitude');
  const longitude = normalizeCoordinate(dependencies.longitude, -180, 180, 'Longitude');
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new ExtractionError('invalid_request', 'Latitude and longitude must be provided together.', 400);
  }
  const type = normalizeChoice(dependencies.type, PLACE_TYPES, 'any', 'Type');
  const response = await fetchPublicPage(
    endpointFor(upstreamQuery(query, country), limit, language, country, latitude, longitude, type),
    dependencies.fetcher,
    'application/json',
  );
  if (!/application\/json/i.test(response.contentType)) {
    throw new ExtractionError('upstream_error', 'Place search returned an unexpected response.', 502);
  }
  const parsedItems = parseItems(response.body);
  if (latitude !== undefined && longitude !== undefined) {
    parsedItems.sort((left, right) => (
      distanceSquared(latitude, longitude, left) - distanceSquared(latitude, longitude, right)
    ));
  }
  const items = parsedItems.slice(0, limit);
  const resultUrl = publicHttpUrl(dependencies.resultUrl)
    ?? `https://extractor.sh/api/places?q=${encodeURIComponent(query)}`;
  const title = `Place results for ${query}`;

  return {
    type: 'feed',
    source: 'place-search',
    id: query,
    url: resultUrl,
    title,
    author: null,
    publishedAt: null,
    content: [
      `# ${escapeMarkdown(title)}`,
      ...items.map((item) => item.content),
      '[Data © OpenStreetMap contributors](https://www.openstreetmap.org/copyright)',
    ].join('\n\n---\n\n'),
    media: [],
    attributes: {
      feedType: 'place-search',
      query,
      language,
      ...(country ? { country } : {}),
      ...(latitude !== undefined ? { latitude, longitude } : {}),
      placeType: type,
      resultCount: items.length,
      attribution: ATTRIBUTION,
    },
    items,
    method: 'place-search-photon',
  };
}
