import type { ExtractionDependencies, ExtractionResult } from '../types';
import { fetchOembed, oembedDocument } from './oembed';

export async function extractSpotify(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const endpoint = new URL(url.hostname === 'spotify.link'
    ? 'https://spotify.link/oembed'
    : 'https://open.spotify.com/oembed');
  endpoint.searchParams.set('url', url.toString());
  const data = await fetchOembed(endpoint, fetcher, 'Spotify');
  return oembedDocument({ data, url, provider: 'Spotify', source: 'spotify', method: 'spotify-oembed', fallbackTitle: 'Spotify content' });
}
