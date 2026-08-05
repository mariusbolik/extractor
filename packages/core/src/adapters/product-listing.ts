import { parseHTML } from 'linkedom';
import { escapeMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionResult } from '../types';

interface ListingPrice {
  price: number;
  currency?: string;
  priceDisplay: string;
}

interface QueryRoot {
  querySelector(selector: string): QueryNode | null;
}

interface QueryNode extends QueryRoot {
  textContent: string | null;
  getAttribute(name: string): string | null;
}

const CARD_SELECTOR = [
  '[itemtype="https://schema.org/Product"]',
  '[itemtype="http://schema.org/Product"]',
  '.products .product',
  '.product.tile',
  'li.product',
  '.product-card',
  '[data-product-id]',
].join(',');

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function firstText(root: QueryRoot, selectors: string[]): string {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const value = clean(node?.getAttribute('content') || node?.textContent);
    if (value) return value;
  }
  return '';
}

function publicUrl(value: string | null | undefined, pageUrl: URL, sameOrigin = true): string | null {
  if (!value || /^(?:javascript:|#)/i.test(value.trim())) return null;
  try {
    const url = new URL(value, pageUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && (!sameOrigin || url.origin === pageUrl.origin)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function currencyFrom(value: string, root: QueryRoot): string | null {
  const advertised = clean(root.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content')
    || root.querySelector('[itemprop="priceCurrency"]')?.textContent).toUpperCase();
  if (/^[A-Z]{3}$/.test(advertised)) return advertised;
  if (/\bEUR\b|€/.test(value)) return 'EUR';
  if (/\bGBP\b|£/.test(value)) return 'GBP';
  if (/\bJPY\b|¥/.test(value)) return 'JPY';
  if (/\bCHF\b/.test(value)) return 'CHF';
  if (/\bCAD\b|C\$/.test(value)) return 'CAD';
  if (/\bAUD\b|A\$/.test(value)) return 'AUD';
  if (/\bUSD\b|\$/.test(value)) return 'USD';
  return null;
}

function decimalAmount(value: string): number | null {
  const match = value.match(/\d[\d\s.,'’]*/)?.[0]?.replace(/[\s'’]/g, '') ?? '';
  if (!match) return null;
  const comma = match.lastIndexOf(',');
  const dot = match.lastIndexOf('.');
  const separator = Math.max(comma, dot);
  const decimalDigits = separator >= 0 ? match.length - separator - 1 : 0;
  const normalized = separator >= 0 && decimalDigits > 0 && decimalDigits <= 2
    ? `${match.slice(0, separator).replace(/[.,]/g, '')}.${match.slice(separator + 1)}`
    : match.replace(/[.,]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function listingPrice(card: Element): ListingPrice | null {
  const display = firstText(card, [
    '[itemprop="price"]',
    '.currentprice',
    '.price',
    '[class*="price"]',
  ]);
  const currency = currencyFrom(display, card);
  const minorDigits = currency === 'JPY' ? 0 : 2;
  const advertisedMinimum = card.getAttribute('data-pricemin');
  const major = advertisedMinimum && /^\d+(?:\.\d+)?$/.test(advertisedMinimum)
    ? Number(advertisedMinimum)
    : decimalAmount(display);
  if (major === null || !Number.isFinite(major)) return null;
  const price = Math.round(major * (10 ** minorDigits));
  return Number.isSafeInteger(price)
    ? { price, ...(currency ? { currency } : {}), priceDisplay: display || String(major) }
    : null;
}

function itemFromCard(card: Element, pageUrl: URL): ExtractedItem | null {
  const namedLink = card.querySelector('a[data-product-name][href]');
  const href = card.querySelector('[itemprop="url"]')?.getAttribute('content')
    || card.querySelector('[itemprop="url"]')?.getAttribute('href')
    || namedLink?.getAttribute('href')
    || card.querySelector('a[href]')?.getAttribute('href');
  const url = publicUrl(href, pageUrl);
  if (!url) return null;

  const imageNode = [...card.querySelectorAll('img')].find((image) => {
    const src = image.getAttribute('src') || image.getAttribute('data-src');
    return Boolean(src && !/\.svg(?:\?|$)/i.test(src));
  });
  const title = clean(namedLink?.getAttribute('data-product-name')) || firstText(card, [
    '[itemprop="name"]',
    '.product-title',
    '.product-name',
    '.h3',
    'h2',
    'h3',
  ]) || clean(imageNode?.getAttribute('alt'));
  if (!title) return null;

  const imageUrl = publicUrl(imageNode?.getAttribute('src') || imageNode?.getAttribute('data-src'), pageUrl, false);
  const width = Number(imageNode?.getAttribute('width'));
  const height = Number(imageNode?.getAttribute('height'));
  const brand = clean(namedLink?.getAttribute('data-product-brand')) || firstText(card, ['[itemprop="brand"]']);
  const category = clean(namedLink?.getAttribute('data-product-category')).replace(/\/+$/, '');
  const price = listingPrice(card);
  const id = clean(card.getAttribute('data-product-id') || card.getAttribute('data-asin') || card.id)
    || new URL(url).pathname.split('/').filter(Boolean).at(-1)
    || null;
  const media = imageUrl ? [{
    type: 'image' as const,
    url: imageUrl,
    alt: clean(imageNode?.getAttribute('alt')) || title,
    ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}),
    ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}),
  }] : [];
  const content = [
    `# ${escapeMarkdown(title)}`,
    brand ? `Brand: ${escapeMarkdown(brand)}` : '',
    category ? `Category: ${escapeMarkdown(category)}` : '',
    price ? `Price: ${escapeMarkdown(price.priceDisplay)}` : '',
    imageUrl ? `![${escapeMarkdown(title)}](${imageUrl})` : '',
    `[View product](${url})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'product',
    source: 'web',
    id,
    url,
    title,
    author: brand || null,
    publishedAt: null,
    content,
    media,
    attributes: {
      productType: 'physical',
      ...(brand ? { brand } : {}),
      ...(category ? { category } : {}),
      ...(price ? price : {}),
    },
  };
}

/** Normalize repeated, server-rendered product cards without another request. */
export function extractProductListingFromHtml(html: string, pageUrl: URL): ExtractionResult | null {
  const { document } = parseHTML(html);
  const seen = new Set<string>();
  const items: ExtractedItem[] = [];

  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    const item = itemFromCard(card, pageUrl);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
    if (items.length === 50) break;
  }
  // Requiring multiple unique products prevents a product detail page from
  // being reclassified merely because its theme uses a generic product class.
  if (items.length < 2) return null;

  const title = firstText(document, ['main h1', 'h1']) || clean(document.title) || 'Products';
  return {
    type: 'feed',
    source: 'web',
    id: null,
    url: pageUrl.toString(),
    title,
    author: null,
    publishedAt: null,
    content: [`# ${escapeMarkdown(title)}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
    media: [],
    attributes: { feedType: 'products', resultCount: items.length },
    items,
    method: 'product-list-html',
  };
}
