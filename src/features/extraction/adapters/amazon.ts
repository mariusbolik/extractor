import { parseHTML } from 'linkedom';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';
import { amazonProductAsin, amazonSearchQuery } from '../url';

const AMAZON_VERIFICATION_PATTERNS = [
  /enter the characters you see below/i,
  /sorry, we just need to make sure (?:you're|you are) not a robot/i,
  /to discuss automated access to amazon data/i,
];

function normalizedText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

interface QueryRoot {
  querySelector(selector: string): { textContent: string | null } | null;
}

function firstText(document: QueryRoot, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = normalizedText(document.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return null;
}

function publicImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function productBrand(document: Document): string | null {
  const value = firstText(document, ['#bylineInfo', '#brand', '.po-brand .po-break-word']);
  if (!value) return null;

  const withoutLabel = value.replace(
    /^(?:brand|marke|marque|marca|marchio|merk|märke)\s*:\s*/i,
    '',
  );
  const storeMatch = withoutLabel.match(/^(?:visit the|besuche den)\s+(.+?)(?:[- ]store)?$/i);
  return normalizedText(storeMatch?.[1] || withoutLabel) || null;
}

function productBullets(document: Document): string[] {
  const bullets = Array.from(document.querySelectorAll('#feature-bullets li .a-list-item'))
    .map((element) => normalizedText(element.textContent))
    .filter((value) => value.length > 2 && !/^see more$/i.test(value));
  return [...new Set(bullets)].slice(0, 20);
}

function productImage(document: Document): string | null {
  const image = document.querySelector('#landingImage');
  const candidates = [image?.getAttribute('data-old-hires'), image?.getAttribute('src')];

  const dynamicImages = image?.getAttribute('data-a-dynamic-image');
  if (dynamicImages) {
    try {
      candidates.push(...Object.keys(JSON.parse(dynamicImages) as Record<string, unknown>));
    } catch {
      // A malformed optional image map must not make otherwise useful product data fail.
    }
  }

  for (const candidate of candidates) {
    const url = publicImageUrl(candidate);
    if (url) return url;
  }
  return null;
}

function amazonVerificationPage(document: Document): boolean {
  const pageText = normalizedText(document.body?.textContent).slice(0, 30_000);
  return AMAZON_VERIFICATION_PATTERNS.some((pattern) => pattern.test(pageText));
}

function amazonSearchItems(document: ParentNode, origin: string): ExtractedItem[] {
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  for (const element of document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')) {
    const asin = normalizedText(element.getAttribute('data-asin')).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;

    const title = firstText(element, ['h2', '[data-cy="title-recipe"]']);
    if (!title) continue;

    const price = firstText(element, ['.a-price .a-offscreen']);
    const rating = firstText(element, ['.a-icon-alt', '[aria-label*="stars"]']);
    const reviewCount = firstText(element, [
      '[data-cy="reviews-block"] .s-underline-text',
      '.s-link-style .s-underline-text',
    ]);
    const image = publicImageUrl(element.querySelector('img.s-image')?.getAttribute('src'));
    const productUrl = new URL(`/dp/${asin}`, origin).toString();
    const details = [
      price ? `Price: ${escapeMarkdown(price)}` : '',
      rating ? `Rating: ${escapeMarkdown(rating)}` : '',
      reviewCount ? `Review count: ${escapeMarkdown(reviewCount)}` : '',
      image ? `![${escapeMarkdown(title)}](${image})` : '',
    ].filter(Boolean).join('\n\n');

    seen.add(asin);
    items.push({
      url: productUrl,
      title,
      author: null,
      publishedAt: null,
      content: details,
    });
    if (items.length === 20) break;
  }

  return items;
}

function cleanAvailability(document: Document): string | null {
  const value = firstText(document, [
    '#availability .a-color-success',
    '#availability .a-color-price',
    '#availability > span',
  ]);
  return value && value.length <= 160 && !/[{}]/.test(value) ? value : null;
}

export async function extractAmazonProduct(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const asin = amazonProductAsin(url);
  if (!asin) {
    throw new ExtractionError('invalid_url', 'Enter a complete Amazon product URL.', 400);
  }

  // Amazon's official mobile product path is substantially smaller and more
  // stable than the standard product page. Fetching it directly also keeps this
  // recognized-source adapter out of the costly Browser Rendering fallback.
  const endpoint = new URL(`/gp/aw/d/${asin}`, url.origin);
  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'text/html, application/xhtml+xml;q=0.9',
  );
  const { document } = parseHTML(response.body);

  if (amazonVerificationPage(document)) {
    throw new ExtractionError(
      'source_blocked',
      'Amazon returned a verification page instead of the requested product.',
      502,
    );
  }

  const title = firstText(document as unknown as Document, ['#productTitle'])
    || normalizedText(document.querySelector('meta[property="og:title"]')?.getAttribute('content'))
    || null;
  const brand = productBrand(document as unknown as Document);
  const price = firstText(document as unknown as Document, [
    '#corePrice_feature_div .a-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#price_inside_buybox',
    '.a-price .a-offscreen',
  ]);
  const rating = firstText(document as unknown as Document, [
    '#acrPopover[title]',
    '#averageCustomerReviews #acrPopover',
  ]);
  const ratingAttribute = normalizedText(
    document.querySelector('#acrPopover')?.getAttribute('title')
      || document.querySelector('#acrPopover')?.getAttribute('aria-label'),
  );
  const reviewCount = firstText(document as unknown as Document, ['#acrCustomerReviewText']);
  const availability = cleanAvailability(document as unknown as Document);
  const bullets = productBullets(document as unknown as Document);
  const image = productImage(document as unknown as Document);
  const canonicalUrl = new URL(`/dp/${asin}`, url.origin).toString();

  if (!title || (!brand && !price && !bullets.length)) {
    throw new ExtractionError(
      'extraction_failed',
      'Amazon returned the product page, but no usable product details were found.',
      422,
    );
  }

  const details = [
    brand ? `Brand: ${escapeMarkdown(brand)}` : '',
    price ? `Price: ${escapeMarkdown(price)}` : '',
    ratingAttribute || rating
      ? `Rating: ${escapeMarkdown(ratingAttribute || rating || '')}${reviewCount ? ` — ${escapeMarkdown(reviewCount)}` : ''}`
      : reviewCount ? `Reviews: ${escapeMarkdown(reviewCount)}` : '',
    availability ? `Availability: ${escapeMarkdown(availability)}` : '',
  ].filter(Boolean).join('\n\n');
  const content = [
    `# ${escapeMarkdown(title)}`,
    details,
    image ? `![${escapeMarkdown(title)}](${image})` : '',
    bullets.length ? `## About this product\n\n${bullets.map((bullet) => `- ${escapeMarkdown(bullet)}`).join('\n')}` : '',
    `[View on Amazon](${canonicalUrl})`,
  ].filter(Boolean).join('\n\n');

  return {
    url: canonicalUrl,
    source: 'amazon',
    kind: 'document',
    title,
    author: brand,
    publishedAt: null,
    content,
    items: [],
    method: 'amazon-html',
  };
}

export async function extractAmazonSearch(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const query = amazonSearchQuery(url);
  if (!query) {
    throw new ExtractionError('invalid_url', 'Enter an Amazon search results URL containing a search query.', 400);
  }

  // The compact Amazon-owned search route provides the same public result
  // cards with less storefront navigation. Search stays server-rendered and
  // never escalates to Browser Rendering when Amazon declines automated access.
  const endpoint = new URL('/gp/aw/s', url.origin);
  endpoint.searchParams.set('k', query);
  const response = await fetchPublicPage(
    endpoint,
    dependencies.fetcher ?? fetch,
    'text/html, application/xhtml+xml;q=0.9',
  );
  const { document } = parseHTML(response.body);

  if (amazonVerificationPage(document)) {
    throw new ExtractionError(
      'source_blocked',
      'Amazon returned a verification page instead of search results.',
      502,
    );
  }

  const items = amazonSearchItems(document, url.origin);
  if (!items.length) {
    throw new ExtractionError(
      'extraction_failed',
      'Amazon returned the search page, but no usable product results were found.',
      422,
    );
  }

  const canonicalUrl = new URL('/s', url.origin);
  canonicalUrl.searchParams.set('k', query);
  const title = `Amazon search: ${query}`;
  const content = [
    `# ${escapeMarkdown(title)}`,
    ...items.map((item, index) => [
      `## ${index + 1}. [${escapeMarkdown(item.title || 'Amazon product')}](${item.url})`,
      item.content,
    ].filter(Boolean).join('\n\n')),
  ].join('\n\n');

  return {
    url: canonicalUrl.toString(),
    source: 'amazon',
    kind: 'feed',
    title,
    author: null,
    publishedAt: null,
    content,
    items,
    method: 'amazon-search-html',
  };
}
