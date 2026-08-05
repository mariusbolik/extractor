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
  const segments = url.pathname.split('/').filter(Boolean);
  const profile = segments.length === 1;
  return oembedDocument({
    data,
    url,
    provider: 'SoundCloud',
    source: 'soundcloud',
    method: 'soundcloud-oembed',
    fallbackTitle: profile ? 'SoundCloud profile' : 'SoundCloud audio',
    type: profile ? 'profile' : 'audio',
    id: segments.at(-1) ?? null,
    attributes: profile && segments[0] ? { handle: segments[0] } : {},
  });
}
