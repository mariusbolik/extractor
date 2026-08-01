import type { ExtractionDependencies, ExtractionResult } from '../types';
import { fetchOembed, oembedDocument } from './oembed';

export async function extractSoundCloud(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const endpoint = new URL('https://soundcloud.com/oembed');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('url', url.toString());
  const data = await fetchOembed(endpoint, fetcher, 'SoundCloud');
  return oembedDocument({ data, url, provider: 'SoundCloud', source: 'soundcloud', method: 'soundcloud-oembed', fallbackTitle: 'SoundCloud audio' });
}
