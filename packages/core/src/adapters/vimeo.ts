import type { ExtractionDependencies, ExtractionResult } from '../types';
import { fetchOembed, oembedDocument } from './oembed';

export async function extractVimeo(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const sourceUrl = url.hostname === 'player.vimeo.com'
    ? new URL(`https://vimeo.com/${url.pathname.match(/\/video\/(\d+)/)?.[1]}`)
    : url;
  const unlistedHash = url.searchParams.get('h');
  if (unlistedHash) sourceUrl.searchParams.set('h', unlistedHash);
  const endpoint = new URL('https://vimeo.com/api/oembed.json');
  endpoint.searchParams.set('url', sourceUrl.toString());
  const data = await fetchOembed(endpoint, fetcher, 'Vimeo');
  return oembedDocument({
    data,
    url: sourceUrl,
    provider: 'Vimeo',
    source: 'vimeo',
    method: 'vimeo-oembed',
    fallbackTitle: 'Vimeo video',
    type: 'video',
    id: sourceUrl.pathname.match(/\/(\d+)/)?.[1] ?? null,
  });
}
