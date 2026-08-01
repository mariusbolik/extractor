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
  const segments = url.pathname.split('/').filter(Boolean);
  const resourceIndex = segments[0]?.startsWith('intl-') ? 1 : 0;
  const resource = segments[resourceIndex];
  const id = segments[resourceIndex + 1] ?? null;
  return oembedDocument({
    data,
    url,
    provider: 'Spotify',
    source: 'spotify',
    method: 'spotify-oembed',
    fallbackTitle: resource === 'artist' ? 'Spotify artist' : 'Spotify audio',
    type: resource === 'artist' ? 'profile' : 'audio',
    id,
  });
}
