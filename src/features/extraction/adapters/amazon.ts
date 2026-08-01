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

interface QueryNode extends QueryRoot {
  textContent: string | null;
}

const AMAZON_CURRENCIES: Record<string, { code: string; minorDigits: number }> = {
  'amazon.ae': { code: 'AED', minorDigits: 2 },
  'amazon.ca': { code: 'CAD', minorDigits: 2 },
  'amazon.cn': { code: 'CNY', minorDigits: 2 },
  'amazon.co.jp': { code: 'JPY', minorDigits: 0 },
  'amazon.co.uk': { code: 'GBP', minorDigits: 2 },
  'amazon.com': { code: 'USD', minorDigits: 2 },
  'amazon.com.au': { code: 'AUD', minorDigits: 2 },
  'amazon.com.be': { code: 'EUR', minorDigits: 2 },
  'amazon.com.br': { code: 'BRL', minorDigits: 2 },
  'amazon.com.mx': { code: 'MXN', minorDigits: 2 },
  'amazon.com.tr': { code: 'TRY', minorDigits: 2 },
  'amazon.de': { code: 'EUR', minorDigits: 2 },
  'amazon.eg': { code: 'EGP', minorDigits: 2 },
  'amazon.es': { code: 'EUR', minorDigits: 2 },
  'amazon.fr': { code: 'EUR', minorDigits: 2 },
  'amazon.ie': { code: 'EUR', minorDigits: 2 },
  'amazon.in': { code: 'INR', minorDigits: 2 },
  'amazon.it': { code: 'EUR', minorDigits: 2 },
  'amazon.nl': { code: 'EUR', minorDigits: 2 },
  'amazon.pl': { code: 'PLN', minorDigits: 2 },
  'amazon.sa': { code: 'SAR', minorDigits: 2 },
  'amazon.se': { code: 'SEK', minorDigits: 2 },
  'amazon.sg': { code: 'SGD', minorDigits: 2 },
};

interface StructuredPrice {
  price: number;
  currency: string;
  priceDisplay: string;
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

function numericValue(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function integerCount(value: string | null): number | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const count = Number(digits);
  return Number.isSafeInteger(count) ? count : null;
}

function priceFromNode(root: QueryRoot, hostname: string, selectors: string[]): StructuredPrice | null {
  const market = AMAZON_CURRENCIES[hostname.toLowerCase().replace(/^www\./, '')];
  if (!market) return null;

  for (const selector of selectors) {
    const node = root.querySelector(selector) as unknown as QueryNode | null;
    if (!node) continue;
    const display = firstText(node, ['.a-offscreen']) || normalizedText(node.textContent);
    const wholeText = firstText(node, ['.a-price-whole']);
    const fractionText = firstText(node, ['.a-price-fraction']);
    let price: number | null = null;

    if (wholeText) {
      const wholeDigits = wholeText.replace(/\D/g, '');
      const fractionDigits = (fractionText || '').replace(/\D/g, '');
      if (wholeDigits) {
        const major = Number(wholeDigits);
        const fraction = market.minorDigits
          ? Number(fractionDigits.padEnd(market.minorDigits, '0').slice(0, market.minorDigits) || 0)
          : 0;
        const combined = major * (10 ** market.minorDigits) + fraction;
        if (Number.isSafeInteger(combined)) price = combined;
      }
    }

    if (price === null && display) {
      const numeric = display.match(/[\d][\d\s.,'’]*/)?.[0]?.trim() || '';
      const digits = numeric.replace(/\D/g, '');
      if (digits) {
        const separatorMatch = market.minorDigits
          ? numeric.match(new RegExp(`[.,](\\d{${market.minorDigits}})\\D*$`))
          : null;
        const majorDigits = separatorMatch
          ? numeric.slice(0, separatorMatch.index).replace(/\D/g, '')
          : digits;
        const fractionDigits = separatorMatch?.[1] || '';
        const combined = Number(majorDigits || 0) * (10 ** market.minorDigits)
          + Number(fractionDigits || 0);
        if (Number.isSafeInteger(combined)) price = combined;
      }
    }

    if (price !== null && display) {
      return { price, currency: market.code, priceDisplay: display };
    }
  }
  return null;
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

    const structuredPrice = priceFromNode(element, new URL(origin).hostname, ['.a-price']);
    const price = structuredPrice?.priceDisplay || firstText(element, ['.a-price .a-offscreen']);
    const ratingText = firstText(element, ['.a-icon-alt', '[aria-label*="stars"]']);
    const reviewCountText = firstText(element, [
      '[data-cy="reviews-block"] .s-underline-text',
      '.s-link-style .s-underline-text',
    ]);
    const image = publicImageUrl(element.querySelector('img.s-image')?.getAttribute('src'));
    const productUrl = new URL(`/dp/${asin}`, origin).toString();
    const normalizedRating = numericValue(ratingText);
    const normalizedReviewCount = integerCount(reviewCountText);
    const details = [
      price ? `Price: ${escapeMarkdown(price)}` : '',
      ratingText ? `Rating: ${escapeMarkdown(ratingText)}` : '',
      reviewCountText ? `Review count: ${escapeMarkdown(reviewCountText)}` : '',
      image ? `![${escapeMarkdown(title)}](${image})` : '',
    ].filter(Boolean).join('\n\n');

    seen.add(asin);
    items.push({
      type: 'product',
      source: 'amazon',
      id: asin,
      url: productUrl,
      title,
      author: null,
      publishedAt: null,
      content: details,
      media: image ? [{ type: 'image', url: image, alt: title }] : [],
      attributes: {
        productType: 'physical',
        ...(structuredPrice || {}),
        ...(normalizedRating !== null ? { rating: normalizedRating, ratingScale: 5 } : {}),
        ...(normalizedReviewCount !== null ? { reviewCount: normalizedReviewCount } : {}),
      },
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
  const structuredPrice = priceFromNode(document as unknown as QueryRoot, url.hostname, [
    '#corePrice_feature_div .a-price',
    '#corePriceDisplay_desktop_feature_div .a-price',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#price_inside_buybox',
    '.a-price',
  ]);
  const price = structuredPrice?.priceDisplay || firstText(document as unknown as Document, [
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
  const normalizedRating = numericValue(ratingAttribute || rating);
  const normalizedReviewCount = integerCount(reviewCount);

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
    type: 'product',
    url: canonicalUrl,
    source: 'amazon',
    id: asin,
    title,
    author: brand,
    publishedAt: null,
    content,
    media: image ? [{ type: 'image', url: image, alt: title }] : [],
    attributes: {
      productType: 'physical',
      ...(brand ? { brand } : {}),
      ...(structuredPrice || {}),
      ...(availability ? { availability } : {}),
      ...(normalizedRating !== null ? { rating: normalizedRating, ratingScale: 5 } : {}),
      ...(normalizedReviewCount !== null ? { reviewCount: normalizedReviewCount } : {}),
      ...(bullets.length ? { features: bullets } : {}),
    },
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
    type: 'feed',
    url: canonicalUrl.toString(),
    source: 'amazon',
    id: null,
    title,
    author: null,
    publishedAt: null,
    content,
    media: [],
    attributes: { feedType: 'search', query },
    items,
    method: 'amazon-search-html',
  };
}
