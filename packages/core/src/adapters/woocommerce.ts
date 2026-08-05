import { parseHTML } from 'linkedom';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';

interface WooProduct extends Record<string, unknown> {
  id?: string | number;
  name?: string;
  slug?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  prices?: Record<string, unknown>;
  average_rating?: string | number;
  review_count?: string | number;
  is_in_stock?: boolean;
  images?: unknown[];
  categories?: unknown[];
  brands?: unknown[];
  attributes?: unknown[];
  sku?: string;
  tags?: unknown[];
}

interface WooRoute {
  endpoint: URL;
  kind: 'product' | 'search' | 'category' | 'catalog';
  query: string | null;
}

function isWooCommerceHtml(html: string): boolean {
  // Require multiple common storefront signals instead of treating every
  // WordPress site with a stray WooCommerce link as a product catalog.
  return /(?:wp-content\/plugins\/woocommerce|\bwoocommerce(?:-|_)|\bwc-(?:block|store-api|ajax)|generator["'][^>]*WooCommerce)/i.test(html);
}

function publicHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const { document } = parseHTML(`<html><body>${String(value)}</body></html>`);
  return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function restRoot(document: Document, pageUrl: URL): URL {
  const advertised = publicHttpUrl(
    document.querySelector('link[rel="https://api.w.org/"]')?.getAttribute('href'),
    pageUrl.toString(),
  );
  if (advertised) {
    const root = new URL(advertised);
    // A page controls its HTML. Keep public Store API discovery on the same
    // origin so it cannot turn one extraction into a cross-site fetch chain.
    if (root.origin === pageUrl.origin) {
      if (!root.pathname.endsWith('/')) root.pathname += '/';
      return root;
    }
  }
  return new URL('/wp-json/', pageUrl.origin);
}

function canonicalUrl(document: Document, pageUrl: URL): URL {
  const value = publicHttpUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), pageUrl.toString());
  if (!value) return pageUrl;
  const canonical = new URL(value);
  return canonical.origin === pageUrl.origin ? canonical : pageUrl;
}

function addCollectionLimit(endpoint: URL): void {
  // Fifty matches the existing catalog cap and prevents a large store from
  // filling the 2 MB public response budget with a single query.
  endpoint.searchParams.set('per_page', '50');
}

function routeFor(html: string, pageUrl: URL): WooRoute | null {
  const { document } = parseHTML(html);
  const bodyClasses = document.body?.className ?? '';
  const root = restRoot(document, pageUrl);
  const products = new URL('wc/store/v1/products', root);
  const canonical = canonicalUrl(document, pageUrl);
  const canonicalSegments = canonical.pathname.split('/').filter(Boolean);
  const pageSegments = pageUrl.pathname.split('/').filter(Boolean);

  if (/\bsingle-product\b/i.test(bodyClasses) || pageSegments.includes('product')) {
    const productId = bodyClasses.match(/\bpostid-(\d+)\b/i)?.[1];
    if (productId) {
      return {
        endpoint: new URL(`wc/store/v1/products/${productId}`, root),
        kind: 'product',
        query: null,
      };
    }

    const productIndex = canonicalSegments.lastIndexOf('product');
    const slug = productIndex >= 0 ? canonicalSegments[productIndex + 1] : canonicalSegments.at(-1);
    if (slug) {
      let decodedSlug: string;
      try {
        decodedSlug = decodeURIComponent(slug);
      } catch {
        // A malformed path must stay eligible for generic HTML extraction;
        // it must not make a recognized storefront fail before that fallback.
        return null;
      }
      products.searchParams.set('slug', decodedSlug);
      products.searchParams.set('per_page', '1');
      return { endpoint: products, kind: 'product', query: null };
    }
  }

  const query = (pageUrl.searchParams.get('s') ?? '').replace(/\s+/g, ' ').trim();
  if (query && query.length <= 200) {
    products.searchParams.set('search', query);
    addCollectionLimit(products);
    return { endpoint: products, kind: 'search', query };
  }

  if (/\btax-product_cat\b/i.test(bodyClasses) || pageSegments.includes('product-category')) {
    const categoryId = bodyClasses.match(/\bterm-(\d+)\b/i)?.[1];
    if (!categoryId) return null;
    products.searchParams.set('category', categoryId);
    addCollectionLimit(products);
    return { endpoint: products, kind: 'category', query: null };
  }

  const normalizedPath = pageUrl.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/' || /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop$/i.test(normalizedPath)) {
    addCollectionLimit(products);
    return { endpoint: products, kind: 'catalog', query: null };
  }

  return null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function decimal(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function priceData(prices: Record<string, unknown> | undefined) {
  const price = integer(prices?.price);
  const rawCurrency = text(prices?.currency_code).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  if (price === null) return null;
  const minorUnit = Math.min(6, integer(prices?.currency_minor_unit) ?? 2);
  const amount = (price / (10 ** minorUnit)).toFixed(minorUnit);
  let prefix = text(prices?.currency_prefix);
  const suffix = text(prices?.currency_suffix);
  // Store API responses expose a generic symbol in addition to their chosen
  // prefix/suffix placement. Use the symbol only when neither placement is
  // configured, otherwise suffix currencies such as EUR would render twice.
  if (!prefix && !suffix) prefix = text(prices?.currency_symbol);
  const priceDisplay = prefix || suffix
    ? `${prefix}${amount}${suffix}`.trim()
    : currency ? `${amount} ${currency}` : amount;
  const regularPrice = integer(prices?.regular_price);
  const compareAtPrice = regularPrice !== null && regularPrice > price ? regularPrice : null;
  const compareAtPriceDisplay = compareAtPrice === null
    ? null
    : prefix || suffix
      ? `${prefix}${(compareAtPrice / (10 ** minorUnit)).toFixed(minorUnit)}${suffix}`.trim()
      : currency ? `${(compareAtPrice / (10 ** minorUnit)).toFixed(minorUnit)} ${currency}` : (compareAtPrice / (10 ** minorUnit)).toFixed(minorUnit);
  return { price, currency, priceDisplay, compareAtPrice, compareAtPriceDisplay };
}

function namedValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry && typeof entry === 'object' ? text((entry as Record<string, unknown>).name) : '').filter(Boolean);
}

function features(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const attribute = entry as Record<string, unknown>;
    const name = text(attribute.name);
    const terms = Array.isArray(attribute.terms) ? attribute.terms.map(text).filter(Boolean) : [];
    if (name && terms.length) output.push(`${name}: ${terms.join(', ')}`);
  }
  return output.slice(0, 30);
}

function productItem(product: WooProduct, storeUrl: URL): ExtractedItem | null {
  const title = text(product.name);
  if (!title) return null;
  const url = publicHttpUrl(product.permalink, storeUrl.toString())
    ?? (typeof product.slug === 'string'
      ? new URL(`/product/${encodeURIComponent(product.slug)}/`, storeUrl.origin).toString()
      : storeUrl.toString());
  const images = (Array.isArray(product.images) ? product.images : []).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const image = value as Record<string, unknown>;
    const imageUrl = publicHttpUrl(image.src, storeUrl.toString());
    if (!imageUrl) return [];
    const width = integer(image.width);
    const height = integer(image.height);
    return [{
      type: 'image' as const,
      url: imageUrl,
      alt: text(image.alt) || title,
      ...(width && width > 0 ? { width } : {}),
      ...(height && height > 0 ? { height } : {}),
    }];
  }).slice(0, 8);
  const descriptionHtml = typeof product.description === 'string'
    ? product.description
    : typeof product.short_description === 'string' ? product.short_description : '';
  const description = htmlFragmentToMarkdown(descriptionHtml, url);
  const price = priceData(product.prices);
  const categoryNames = namedValues(product.categories);
  const brand = namedValues(product.brands)[0] ?? null;
  const rating = decimal(product.average_rating);
  const reviewCount = integer(product.review_count);
  const productFeatures = features(product.attributes);
  const sku = text(product.sku);
  const tags = namedValues(product.tags).slice(0, 50);
  const availability = typeof product.is_in_stock === 'boolean'
    ? product.is_in_stock ? 'InStock' : 'OutOfStock'
    : null;
  const content = [
    `# ${escapeMarkdown(title)}`,
    brand ? `Brand: ${escapeMarkdown(brand)}` : '',
    categoryNames.length ? `Category: ${escapeMarkdown(categoryNames.join(', '))}` : '',
    price ? `Price: ${escapeMarkdown(price.priceDisplay)}` : '',
    availability ? `Availability: ${availability}` : '',
    rating !== null ? `Rating: ${rating}${reviewCount !== null ? ` (${reviewCount} reviews)` : ''}` : '',
    description,
    ...images.map((image) => `![${escapeMarkdown(image.alt ?? title)}](${image.url})`),
    `[View product](${url})`,
  ].filter(Boolean).join('\n\n');

  return {
    type: 'product',
    source: 'woocommerce',
    id: product.id !== undefined ? String(product.id) : typeof product.slug === 'string' ? product.slug : null,
    url,
    title,
    author: brand,
    publishedAt: null,
    content,
    media: images,
    attributes: {
      productType: 'physical',
      ...(brand ? { brand } : {}),
      ...(categoryNames[0] ? { category: categoryNames[0] } : {}),
      ...(sku ? { sku } : {}),
      ...(tags.length ? { tags } : {}),
      ...(price ? {
        price: price.price,
        ...(price.currency ? { currency: price.currency } : {}),
        priceDisplay: price.priceDisplay,
      } : {}),
      ...(price?.compareAtPrice !== null && price?.compareAtPriceDisplay ? {
        compareAtPrice: price.compareAtPrice,
        compareAtPriceDisplay: price.compareAtPriceDisplay,
      } : {}),
      ...(availability ? { availability } : {}),
      ...(rating !== null ? { rating, ratingScale: 5 } : {}),
      ...(reviewCount !== null ? { reviewCount } : {}),
      ...(productFeatures.length ? { features: productFeatures } : {}),
    },
  };
}

function parseProducts(body: string, kind: WooRoute['kind']): WooProduct[] {
  const payload = JSON.parse(body) as unknown;
  if (kind === 'product' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return [payload as WooProduct];
  }
  return Array.isArray(payload) ? payload.filter((item): item is WooProduct => Boolean(item && typeof item === 'object')) : [];
}

/**
 * Prefer public storefront product JSON only after HTML confirms WooCommerce.
 * This keeps arbitrary WordPress pages in the generic reader and avoids API
 * probes against sites that do not advertise the commerce plugin.
 */
export async function extractWooCommerceStorefront(
  html: string,
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult | null> {
  if (!isWooCommerceHtml(html)) return null;
  const route = routeFor(html, url);
  if (!route) return null;

  try {
    const response = await fetchPublicPage(route.endpoint, dependencies.fetcher ?? fetch, 'application/json');
    if (!/application\/json/i.test(response.contentType)) return null;
    const products = parseProducts(response.body, route.kind);
    const items = products.map((product) => productItem(product, url)).filter((item): item is ExtractedItem => item !== null).slice(0, 50);
    if (!items.length) return null;

    if (route.kind === 'product') return { ...items[0], method: 'woocommerce-json' };

    const title = route.kind === 'search' && route.query
      ? `Product results for ${route.query}`
      : route.kind === 'category' ? 'Product category' : 'Store products';
    return {
      type: 'feed',
      source: 'woocommerce',
      id: route.query,
      url: url.toString(),
      title,
      author: null,
      publishedAt: null,
      content: [`# ${escapeMarkdown(title)}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
      media: [],
      attributes: {
        feedType: route.kind,
        ...(route.query ? { query: route.query } : {}),
      },
      items,
      method: 'woocommerce-json',
    };
  } catch (error) {
    // Store owners can disable or protect the public Store API. The already
    // fetched page can still proceed through ordinary content extraction.
    console.warn('WooCommerce storefront JSON unavailable', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
}
