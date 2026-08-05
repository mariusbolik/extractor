import { parseHTML } from 'linkedom';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractedMedia, ExtractionDependencies, ExtractionResult, ProductVariant } from '../types';
import { amazonProductAsin, amazonPublicListInfo, amazonSearchQuery } from '../url';

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

function productImages(document: Document, title: string): ExtractedMedia[] {
  const image = document.querySelector('#landingImage');
  const candidates: Array<{ url: string | null | undefined; alt?: string | null; width?: string | null; height?: string | null }> = [
    { url: image?.getAttribute('data-old-hires'), alt: image?.getAttribute('alt'), width: image?.getAttribute('width'), height: image?.getAttribute('height') },
    { url: image?.getAttribute('src'), alt: image?.getAttribute('alt'), width: image?.getAttribute('width'), height: image?.getAttribute('height') },
  ];

  const dynamicImages = image?.getAttribute('data-a-dynamic-image');
  if (dynamicImages) {
    try {
      candidates.push(...Object.keys(JSON.parse(dynamicImages) as Record<string, unknown>).map((url) => ({ url, alt: image?.getAttribute('alt') })));
    } catch {
      // A malformed optional image map must not make otherwise useful product data fail.
    }
  }

  for (const thumbnail of document.querySelectorAll('#altImages img, #imageBlock img')) {
    candidates.push({
      url: thumbnail.getAttribute('data-old-hires') || thumbnail.getAttribute('data-src') || thumbnail.getAttribute('src'),
      alt: thumbnail.getAttribute('alt'),
      width: thumbnail.getAttribute('width'),
      height: thumbnail.getAttribute('height'),
    });
  }
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const url = publicImageUrl(candidate.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    return [{
      type: 'image' as const,
      url,
      alt: normalizedText(candidate.alt) || title,
      ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}),
      ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}),
    }];
  }).slice(0, 12);
}

function productDetails(document: Document): string[] {
  const details: string[] = [];
  const add = (label: string | null | undefined, value: string | null | undefined) => {
    const name = normalizedText(label);
    const content = normalizedText(value);
    if (name && content && name !== content && name.length <= 120 && content.length <= 500) {
      details.push(`${name}: ${content}`);
    }
  };
  for (const row of document.querySelectorAll('#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr')) {
    add(row.querySelector('th')?.textContent, row.querySelector('td')?.textContent);
  }
  for (const item of document.querySelectorAll('#detailBullets_feature_div li')) {
    const label = item.querySelector('.a-text-bold')?.textContent?.replace(/:\s*$/, '');
    const value = item.textContent?.replace(label ?? '', '').replace(/^\s*:\s*/, '');
    add(label, value);
  }
  return [...new Set(details)].slice(0, 40);
}

function productVariants(document: Document): ProductVariant[] {
  const variants: ProductVariant[] = [];
  const seen = new Set<string>();
  for (const node of document.querySelectorAll('#twister [data-asin], [id^="variation_"] [data-asin]')) {
    const asin = normalizedText(node.getAttribute('data-asin')).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;
    const title = normalizedText(node.getAttribute('title') || node.getAttribute('aria-label') || node.textContent);
    if (!title || title.length > 200) continue;
    seen.add(asin);
    variants.push({ id: asin, sku: asin, title });
    if (variants.length === 50) break;
  }
  return variants;
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
  const detailFeatures = productDetails(document as unknown as Document);
  const bullets = [...new Set([...productBullets(document as unknown as Document), ...detailFeatures])].slice(0, 60);
  const images = productImages(document as unknown as Document, title || 'Amazon product');
  const image = images[0]?.url ?? null;
  const category = Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a'))
    .map((item) => normalizedText(item.textContent)).filter(Boolean).at(-1) ?? null;
  const sellerValue = firstText(document as unknown as Document, ['#sellerProfileTriggerId', '#merchant-info']);
  const seller = sellerValue && sellerValue.length <= 300 && !/(?:P\.when|function\s*\()/i.test(sellerValue)
    ? sellerValue
    : null;
  const variants = productVariants(document as unknown as Document);
  const comparison = structuredPrice && priceFromNode(document as unknown as QueryRoot, url.hostname, [
    '.basisPrice .a-price',
    '.a-price.a-text-price',
  ]);
  const compareAt = comparison && comparison.currency === structuredPrice?.currency && comparison.price > structuredPrice.price
    ? comparison
    : null;
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
    seller ? `Seller: ${escapeMarkdown(seller)}` : '',
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
    media: images,
    attributes: {
      productType: 'physical',
      ...(brand ? { brand } : {}),
      ...(seller ? { seller } : {}),
      ...(category ? { category } : {}),
      ...(structuredPrice || {}),
      ...(compareAt ? { compareAtPrice: compareAt.price, compareAtPriceDisplay: compareAt.priceDisplay } : {}),
      ...(availability ? { availability } : {}),
      ...(normalizedRating !== null ? { rating: normalizedRating, ratingScale: 5 } : {}),
      ...(normalizedReviewCount !== null ? { reviewCount: normalizedReviewCount } : {}),
      ...(bullets.length ? { features: bullets } : {}),
      ...(variants.length ? { variants } : {}),
    },
    method: 'amazon-html',
  };
}

function amazonListItems(document: Document, origin: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  const candidates = document.querySelectorAll('[data-itemid], [data-asin], .a-carousel-card, .product-card');
  for (const candidate of candidates) {
    const href = candidate.querySelector('a[href*="/dp/"]')?.getAttribute('href') || '';
    const asin = (normalizedText(candidate.getAttribute('data-asin')).toUpperCase()
      || href.match(/\/dp\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase()
      || '');
    if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue;
    const imageNode = candidate.querySelector('img');
    const title = firstText(candidate as unknown as QueryRoot, [
      '[id^="itemName"]',
      'h2',
      'h3',
      '.a-text-bold',
    ]) || normalizedText(imageNode?.getAttribute('alt'));
    if (!title) continue;
    const structuredPrice = priceFromNode(candidate as unknown as QueryRoot, new URL(origin).hostname, ['.a-price']);
    const image = publicImageUrl(imageNode?.getAttribute('data-old-hires') || imageNode?.getAttribute('src'));
    const productUrl = new URL(`/dp/${asin}`, origin).toString();
    const content = [
      structuredPrice ? `Price: ${escapeMarkdown(structuredPrice.priceDisplay)}` : '',
      image ? `![${escapeMarkdown(title)}](${image})` : '',
      `[View on Amazon](${productUrl})`,
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
      content,
      media: image ? [{ type: 'image', url: image, alt: title }] : [],
      attributes: { productType: 'physical', ...(structuredPrice ?? {}) },
    });
    if (items.length === 50) break;
  }
  return items;
}

export async function extractAmazonList(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const info = amazonPublicListInfo(url);
  if (!info) throw new ExtractionError('invalid_url', 'Enter an exact public Amazon list or storefront URL.', 400);
  const canonicalUrl = new URL(url.pathname, url.origin);
  const response = await fetchPublicPage(canonicalUrl, dependencies.fetcher ?? fetch, 'text/html, application/xhtml+xml;q=0.9');
  const { document } = parseHTML(response.body);
  if (amazonVerificationPage(document)) {
    throw new ExtractionError('source_blocked', 'Amazon returned a verification page instead of the public list.', 502);
  }
  const items = amazonListItems(document, url.origin);
  if (!items.length) {
    throw new ExtractionError('extraction_failed', 'Amazon returned the public list, but no usable products were found.', 422);
  }
  const title = firstText(document as unknown as Document, ['#profile-list-name', '#list-name', 'main h1', 'h1'])
    || (info.kind === 'wishlist' ? 'Amazon Wish List' : `Amazon storefront: ${info.id}`);
  const author = firstText(document as unknown as Document, ['.a-profile-name', '[data-testid="storefront-name"]']);
  return {
    type: 'feed',
    source: 'amazon',
    id: info.id,
    url: canonicalUrl.toString(),
    title,
    author,
    publishedAt: null,
    content: [
      `# ${escapeMarkdown(title)}`,
      ...items.map((item, index) => `## ${index + 1}. [${escapeMarkdown(item.title || 'Amazon product')}](${item.url})\n\n${item.content}`),
    ].join('\n\n'),
    media: [],
    attributes: { feedType: info.kind === 'wishlist' ? 'wishlist' : 'storefront', resultCount: items.length },
    items,
    method: 'amazon-list-html',
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
