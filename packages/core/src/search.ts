import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { ExtractionError } from './errors';
import { fetchPublicPage } from './fetch';
import { escapeMarkdown } from './markdown';
import { normalizeCountryCode, normalizeLanguageTag } from './options';
import type { ExtractedItem, ExtractionResult, SearchDependencies } from './types';

// Query length is intentionally much smaller than the extraction URL limit.
// It bounds cache-key size and avoids turning a search request into an
// accidental document-upload surface.
const MAX_QUERY_LENGTH = 200;

// The cheap XML representation exposes one useful result page and ignores its
// ordinary pagination parameters. Advertising a larger limit would imply a
// reliability guarantee the upstream representation does not provide.
const MAX_RESULTS = 10;

// These words carry little ranking value by themselves. Removing them keeps a
// natural-language query such as "what is llmbase" anchored to "llmbase"
// instead of accepting a result merely because its snippet contains "is".
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'or',
  'the', 'to', 'what', 'where', 'who', 'why', 'with',
  'das', 'der', 'die', 'ein', 'eine', 'ist', 'und', 'von', 'was', 'wer', 'wie',
  'wo', 'zu',
]);

const LEADING_ARTICLES = new Set([
  'a', 'an', 'the',
  'das', 'der', 'die',
  'el', 'la', 'las', 'los',
  'le', 'les',
]);

const parser = new XMLParser({
  // Attributes are irrelevant to RSS search items. Ignoring them keeps the
  // accepted shape narrow and prevents upstream markup becoming public data.
  ignoreAttributes: true,
  processEntities: true,
  trimValues: true,
});

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

function plainText(value: unknown): string {
  const raw = scalar(value);
  if (!raw) return '';
  // Search snippets can contain encoded emphasis tags. LinkeDOM turns them
  // into inert text without carrying provider markup into the public schema.
  const { document } = parseHTML(`<html><body>${raw}</body></html>`);
  return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function publicResultUrl(value: unknown): string | null {
  // Search indexes are untrusted input too. Only absolute web links can enter
  // the schema; javascript:, data:, malformed, and relative links are skipped.
  const candidate = scalar(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeSearchQuery(value: string): string {
  // Normalize before building either the upstream URL or cache key so visually
  // identical queries reuse the same public result.
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query) {
    throw new ExtractionError('invalid_request', 'The q query parameter is required.', 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new ExtractionError('invalid_request', `The search query must be ${MAX_QUERY_LENGTH} characters or fewer.`, 400);
  }
  return query;
}

export function normalizeSearchSite(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const candidate = value.trim().toLowerCase().replace(/\.$/, '');
  if (!candidate || candidate.length > 253 || candidate.includes('/') || candidate.includes(':') || /\s/.test(candidate)) {
    throw new ExtractionError('invalid_request', 'Site must be a hostname such as example.com.', 400);
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}`).hostname.toLowerCase();
  } catch {
    throw new ExtractionError('invalid_request', 'Site must be a hostname such as example.com.', 400);
  }
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !/^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new ExtractionError('invalid_request', 'Site must be a hostname such as example.com.', 400);
  }
  return hostname;
}

function matchesSite(item: ExtractedItem, site: string | undefined): boolean {
  if (!site) return true;
  try {
    const hostname = new URL(item.url).hostname.toLowerCase();
    return hostname === site || hostname.endsWith(`.${site}`);
  } catch {
    return false;
  }
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return MAX_RESULTS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new ExtractionError('invalid_request', `Limit must be an integer from 1 to ${MAX_RESULTS}.`, 400);
  }
  return value;
}

function searchEndpoint(query: string, language: string, country: string): URL {
  // Keep the provider-specific URL private to the portable core. Callers pass
  // and receive provider-neutral URLs, so this backend can be replaced without
  // changing /api/search, MCP inputs, or schema version 1.
  const endpoint = new URL('https://www.bing.com/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'rss');
  endpoint.searchParams.set('setlang', language);
  endpoint.searchParams.set('cc', country);
  // The public API is intended for agent research, not an adult-content search
  // surface. Strict filtering also prevents an upstream relevance failure from
  // filling an innocent brand query with explicit results.
  endpoint.searchParams.set('adlt', 'strict');
  return endpoint;
}

function googleSearchEndpoint(query: string, language: string, country: string): URL {
  const baseLanguage = language.split('-')[0]!;
  const endpoint = new URL('https://www.google.com/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('hl', baseLanguage);
  endpoint.searchParams.set('lr', `lang_${baseLanguage}`);
  endpoint.searchParams.set('cr', `country${country}`);
  endpoint.searchParams.set('ie', 'utf8');
  endpoint.searchParams.set('oe', 'utf8');
  endpoint.searchParams.set('filter', '0');
  endpoint.searchParams.set('start', '0');
  endpoint.searchParams.set('safe', 'high');
  return endpoint;
}

function braveSearchEndpoint(query: string, language: string, country: string): URL {
  const endpoint = new URL('https://search.brave.com/search');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('source', 'web');
  endpoint.searchParams.set('spellcheck', '0');
  endpoint.searchParams.set('country', country.toLowerCase());
  endpoint.searchParams.set('ui_lang', language);
  endpoint.searchParams.set('safesearch', 'strict');
  return endpoint;
}

function queryTerms(query: string, language: string): string[] {
  const words = query.toLocaleLowerCase(language).match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = words.filter((word) => !QUERY_STOP_WORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : words)];
}

function upstreamDiscoveryQuery(query: string, language: string, country: string): string {
  const tokens = query.split(/\s+/);
  let firstMeaningful = 0;
  // Some indexes treat a leading article or question word as the dominant
  // term. Remove only the leading run, keep internal grammar intact, and
  // always retain at least one token for stop-word-only searches.
  while (firstMeaningful < tokens.length - 1) {
    const word = tokens[firstMeaningful]
      ?.toLocaleLowerCase(language)
      .match(/[\p{L}\p{N}]+/u)?.[0];
    if (!word || !QUERY_STOP_WORDS.has(word)) break;
    firstMeaningful += 1;
  }
  const discovery = tokens.slice(firstMeaningful).join(' ');
  const leadingWord = tokens[0]
    ?.toLocaleLowerCase(language)
    .match(/[\p{L}\p{N}]+/u)?.[0];

  // A short name introduced by an article is commonly a landmark,
  // institution, publication, or other named entity. Some regional search
  // edges collapse these phrases to a single navigational result. Add the
  // caller's existing country control as disambiguating context in the same
  // request; the public query and relevance checks remain unchanged.
  if (leadingWord && LEADING_ARTICLES.has(leadingWord) && tokens.length >= 3 && tokens.length <= 5) {
    try {
      const countryName = new Intl.DisplayNames([language], { type: 'region' }).of(country);
      if (countryName) return `${countryName.toLocaleLowerCase(language)} ${discovery}`;
    } catch {
      return `${country.toLocaleLowerCase(language)} ${discovery}`;
    }
  }
  return discovery;
}

function isRelevant(item: ExtractedItem, query: string, language: string): boolean {
  const terms = queryTerms(query, language);
  if (terms.length === 0) return false;
  // Compare complete words instead of substrings: the query term "ai" must not
  // match arbitrary words such as "said" or an Italian URL path.
  const words = `${item.title ?? ''} ${item.url} ${item.content}`
    .toLocaleLowerCase(language)
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const haystack = new Set(words);
  const matched = terms.filter((term) => haystack.has(term)).length;

  // One-term brand searches must contain that brand. Longer searches require
  // a majority of their meaningful terms, which rejects wholly unrelated RSS
  // pages while preserving normal phrase searches and spelling variations.
  return matched >= Math.floor(terms.length / 2) + 1;
}

function parseItems(xml: string, query: string, language: string): ExtractedItem[] {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    throw new ExtractionError('upstream_error', 'The search index returned malformed data.', 502);
  }

  const channel = (document as { rss?: { channel?: { item?: unknown } } })?.rss?.channel;
  if (!channel) {
    throw new ExtractionError('upstream_error', 'The search index returned an unexpected response.', 502);
  }

  const seen = new Set<string>();
  const items: ExtractedItem[] = [];
  for (const raw of list(channel.item as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const url = publicResultUrl(raw?.link);
    if (!url || seen.has(url)) continue;
    const title = plainText(raw?.title) || new URL(url).hostname.replace(/^www\./, '');
    const snippet = plainText(raw?.description);

    seen.add(url);
    items.push({
      type: 'document',
      source: 'web-search',
      id: null,
      url,
      title,
      author: null,
      // RSS pubDate values here describe search-index activity inconsistently,
      // not a trustworthy page publication date. Null is more honest and keeps
      // agents from treating an index timestamp as source metadata.
      publishedAt: null,
      content: snippet,
      media: [],
      attributes: {},
    });
  }
  return items.filter((item) => isRelevant(item, query, language));
}

function googleResultUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith('/url?')) {
    const redirect = new URL(value, 'https://www.google.com');
    return publicResultUrl(redirect.searchParams.get('q'));
  }
  return publicResultUrl(value);
}

function parseGoogleItems(html: string, query: string, language: string): ExtractedItem[] {
  const { document } = parseHTML(html);
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  // Google currently exposes both desktop result blocks and a compact layout
  // whose result anchor itself carries data-ved. Parse either representation
  // without reading hydration state or launching a browser.
  const candidates = [
    ...document.querySelectorAll('.MjjYud'),
    ...document.querySelectorAll('a[data-ved]:not([class])'),
  ];
  for (const result of candidates) {
    const isAnchor = result.tagName.toLowerCase() === 'a';
    const anchor = isAnchor ? result : result.querySelector('a[jsname="UWckNb"][href], a[href^="/url?q="]');
    const url = googleResultUrl(anchor?.getAttribute('href') ?? null);
    if (!url || seen.has(url)) continue;
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'google.com' || hostname.endsWith('.google.com')) continue;
    const title = plainText(result.querySelector('h3, [role="heading"], div[style]')?.textContent)
      || plainText(anchor?.getAttribute('aria-label'));
    if (!title) continue;
    const container = isAnchor ? result.parentElement?.parentElement ?? result : result;
    const snippet = plainText(
      container.querySelector('.VwiC3b, .ITZIwc, [data-sncf*="1"], .ilUpNd')?.textContent,
    );
    const item: ExtractedItem = {
      type: 'document',
      source: 'web-search',
      id: null,
      url,
      title,
      author: null,
      publishedAt: null,
      content: snippet,
      media: [],
      attributes: {},
    };
    if (!isRelevant(item, query, language)) continue;
    seen.add(url);
    items.push(item);
  }
  return items;
}

function parseBraveItems(html: string, query: string, language: string): ExtractedItem[] {
  const { document } = parseHTML(html);
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  for (const result of document.querySelectorAll('[data-type="web"]')) {
    const anchor = result.querySelector('a[href]');
    const url = publicResultUrl(anchor?.getAttribute('href'));
    if (!url || seen.has(url)) continue;
    const title = plainText(result.querySelector('.title')?.textContent)
      || plainText(anchor?.getAttribute('title'))
      || new URL(url).hostname.replace(/^www\./, '');
    const snippet = plainText(
      result.querySelector('.generic-snippet, .snippet-description')?.textContent,
    );
    const item: ExtractedItem = {
      type: 'document',
      source: 'web-search',
      id: null,
      url,
      title,
      author: null,
      publishedAt: null,
      content: snippet,
      media: [],
      attributes: {},
    };
    if (!isRelevant(item, query, language)) continue;
    seen.add(url);
    items.push(item);
  }
  return items;
}

async function braveSearch(
  query: string,
  fetcher: typeof fetch | undefined,
  language: string,
  country: string,
  relevanceQuery = query,
): Promise<ExtractedItem[]> {
  const response = await fetchPublicPage(
    braveSearchEndpoint(query, language, country),
    fetcher,
    'text/html, application/xhtml+xml;q=0.9',
    {
      'Accept-Language': language,
      'User-Agent': 'Mozilla/5.0 (compatible; extractor.sh/1.0; +https://extractor.sh)',
    },
  );
  if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType)) {
    throw new ExtractionError('upstream_error', 'The search index did not return search results.', 502);
  }
  return parseBraveItems(response.body, relevanceQuery, language);
}

async function googleSearch(
  query: string,
  fetcher: typeof fetch | undefined,
  language: string,
  country: string,
  relevanceQuery = query,
): Promise<ExtractedItem[]> {
  const response = await fetchPublicPage(
    googleSearchEndpoint(query, language, country),
    fetcher,
    'text/html, application/xhtml+xml;q=0.9',
    {
      'Accept-Language': `${language},${language.split('-')[0]};q=0.9`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0',
    },
  );
  if (new URL(response.url).hostname === 'sorry.google.com'
    || (response.body.length < 5_000 && response.body.includes('/sorry/'))) {
    throw new ExtractionError('upstream_error', 'The search index is temporarily unavailable.', 502);
  }
  if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.contentType)) {
    throw new ExtractionError('upstream_error', 'The search index did not return search results.', 502);
  }
  return parseGoogleItems(response.body, relevanceQuery, language);
}

function markdown(query: string, items: ExtractedItem[]): string {
  // Array order is the relevance rank. Avoid duplicating that rank in schema
  // attributes, where it could drift when results are filtered or truncated.
  const results = items.map((item, index) => {
    const title = escapeMarkdown(item.title ?? new URL(item.url).hostname);
    const snippet = item.content ? `\n\n   ${escapeMarkdown(item.content)}` : '';
    return `${index + 1}. [${title}](${item.url})${snippet}`;
  });
  return [`# Search results for ${escapeMarkdown(query)}`, ...results].join('\n\n');
}

/**
 * Search the public web through a cheap XML representation.
 *
 * This function belongs to the portable core and depends only on an injected
 * Fetch implementation. It never launches a browser and never accepts an
 * arbitrary upstream URL. The provider is intentionally isolated here: HTTP
 * and MCP callers expose only the stable `web-search` feed contract and can
 * switch backends without changing schema version 1.
 *
 * Successful responses contain snippets for discovery, not extracted page
 * bodies. Callers should pass a selected item's URL back to `extractUrl` when
 * full content is required.
 */
export async function searchWeb(
  rawQuery: string,
  dependencies: SearchDependencies = {},
): Promise<ExtractionResult> {
  const query = normalizeSearchQuery(rawQuery);
  const limit = normalizedLimit(dependencies.limit);
  const language = normalizeLanguageTag(dependencies.language, 'en-US');
  const country = normalizeCountryCode(dependencies.country, 'US')!;
  const site = normalizeSearchSite(dependencies.site);
  const upstreamQuery = upstreamDiscoveryQuery(query, language, country);
  const discoveryQuery = site ? `${upstreamQuery} site:${site}` : upstreamQuery;
  const endpoint = searchEndpoint(discoveryQuery, language, country);
  let rssWasValid = false;
  let rssFailure: unknown;
  let fallbackWasValid = false;
  let finalFallbackWasValid = false;
  let items: ExtractedItem[] = [];
  let method: 'web-search-rss' | 'web-search-html' = 'web-search-rss';
  try {
    const response = await fetchPublicPage(
      endpoint,
      dependencies.fetcher,
      'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
    );
    if (!/(?:rss|xml)/i.test(response.contentType)) {
      throw new ExtractionError('upstream_error', 'The search index did not return search results.', 502);
    }
    rssWasValid = true;
    items = parseItems(response.body, query, language).filter((item) => matchesSite(item, site));
  } catch (error) {
    rssFailure = error;
  }

  // Stop after the first usable result set. Each next request is reached only
  // when every cheaper path before it failed or yielded no relevant items.
  if (items.length === 0) {
    try {
      const htmlItems = (await braveSearch(discoveryQuery, dependencies.fetcher, language, country, query))
        .filter((item) => matchesSite(item, site));
      fallbackWasValid = true;
      if (htmlItems.length > 0) {
        items = htmlItems;
        method = 'web-search-html';
      }
    } catch {
      // A valid empty RSS page is still an honest zero-result search. If RSS
      // itself failed, the original error below remains the useful response.
    }
  }
  if (items.length === 0) {
    try {
      const htmlItems = (await googleSearch(discoveryQuery, dependencies.fetcher, language, country, query))
        .filter((item) => matchesSite(item, site));
      finalFallbackWasValid = true;
      if (htmlItems.length > 0) {
        items = htmlItems;
        method = 'web-search-html';
      }
    } catch {
      // A valid empty result from an earlier source remains an honest search.
    }
  }
  if (!rssWasValid && !fallbackWasValid && !finalFallbackWasValid && items.length === 0) {
    throw rssFailure instanceof Error
      ? rssFailure
      : new ExtractionError('upstream_error', 'The search index did not return search results.', 502);
  }
  items = items.slice(0, limit);
  // resultUrl represents extractor.sh's public request, never the private
  // upstream endpoint. This prevents implementation details leaking in JSON.
  const resultUrl = publicResultUrl(dependencies.resultUrl)
    ?? `https://extractor.sh/api/search?q=${encodeURIComponent(query)}`;
  const title = `Search results for ${query}`;

  return {
    type: 'feed',
    source: 'web-search',
    id: query,
    url: resultUrl,
    title,
    author: null,
    publishedAt: null,
    content: markdown(query, items),
    media: [],
    attributes: {
      feedType: 'web-search', query, language, country,
      ...(site ? { site } : {}),
      resultCount: items.length,
    },
    items,
    method,
  };
}
