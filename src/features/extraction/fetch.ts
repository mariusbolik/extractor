import { ExtractionError, sourceResponseError } from './errors';
import { validateTargetUrl } from './url';

const MAX_REDIRECTS = 5;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string;
}

async function readTextLimited(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_SOURCE_BYTES) {
    throw new ExtractionError('content_too_large', 'The source is larger than 5 MB.', 413);
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new ExtractionError('content_too_large', 'The source is larger than 5 MB.', 413);
    }
    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

export async function fetchPublicPage(
  initialUrl: URL,
  fetcher: typeof fetch = fetch,
  accept = 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.1',
  additionalHeaders: Record<string, string> = {},
  cf?: RequestInitCfProperties,
): Promise<FetchedPage> {
  let current = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ...(cf ? { cf } : {}),
        headers: {
          Accept: accept,
          'User-Agent': 'extractor.sh/1.0 (+https://extractor.mcb-software.workers.dev)',
          ...additionalHeaders,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ExtractionError('timeout', 'The source did not respond within 10 seconds.', 504);
      }
      throw new ExtractionError('upstream_error', 'The source could not be reached.', 502);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) {
        throw new ExtractionError('upstream_error', 'The source redirected too many times.', 502);
      }
      current = validateTargetUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      throw new ExtractionError('not_found', 'The source was not found.', 404);
    }

    if (!response.ok) {
      throw sourceResponseError(response.status);
    }

    return {
      url: response.url || current.toString(),
      contentType: response.headers.get('content-type')?.toLowerCase() || '',
      body: await readTextLimited(response),
    };
  }

  throw new ExtractionError('upstream_error', 'The source redirected too many times.', 502);
}
