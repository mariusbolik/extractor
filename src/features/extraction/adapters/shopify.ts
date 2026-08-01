import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';

interface ShopifyProduct extends Record<string, unknown> {
  id?: string | number;
  title?: string;
  handle?: string;
  body_html?: string;
  description?: string;
  vendor?: string;
  product_type?: string;
  published_at?: string;
  url?: string;
  images?: unknown[];
  featured_image?: unknown;
  variants?: unknown[];
  price?: string | number;
}

function isShopifyStorefront(html: string, url: URL): boolean {
  return url.hostname.toLowerCase().endsWith('.myshopify.com')
    || /(?:cdn\.shopify\.com|\/cdn\/shop\/|\bShopify\.theme\b|\bshopify-section\b|\bshopify-features\b)/i.test(html);
}

function productPath(url: URL): { root: string; handle: string } | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const productIndex = segments.lastIndexOf('products');
  if (productIndex < 0 || productIndex !== segments.length - 2) return null;
  const locale = productIndex === 1 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0]) ? segments[0] : '';
  try {
    return { root: locale ? `/${locale}/` : '/', handle: decodeURIComponent(segments[productIndex + 1]) };
  } catch {
    return null;
  }
}

function collectionPath(url: URL): { root: string; handle: string } | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const collectionIndex = segments.lastIndexOf('collections');
  if (collectionIndex < 0 || collectionIndex !== segments.length - 2) return null;
  const locale = collectionIndex === 1 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0]) ? segments[0] : '';
  try {
    return { root: locale ? `/${locale}/` : '/', handle: decodeURIComponent(segments[collectionIndex + 1]) };
  } catch {
    return null;
  }
}

function endpointFor(url: URL): { endpoint: URL; exactProduct: boolean } {
  const product = productPath(url);
  if (product) {
    // Shopify documents this locale-aware Ajax endpoint for an exact product.
    return {
      endpoint: new URL(`${product.root}products/${encodeURIComponent(product.handle)}.js`, url.origin),
      exactProduct: true,
    };
  }

  const collection = collectionPath(url);
  const endpoint = collection
    ? new URL(`${collection.root}collections/${encodeURIComponent(collection.handle)}/products.json`, url.origin)
    : new URL('/products.json', url.origin);
  endpoint.searchParams.set('limit', '50');
  return { endpoint, exactProduct: false };
}

function date(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function imageUrl(value: unknown): string | null {
  if (typeof value === 'string') return value.startsWith('//') ? `https:${value}` : value;
  if (!value || typeof value !== 'object') return null;
  const image = value as Record<string, unknown>;
  return imageUrl(image.src || image.url);
}

function storefrontCurrency(html: string): string | null {
  const value = html.match(/Shopify\.currency\s*=\s*\{[^}]*["']active["']\s*:\s*["']([A-Z]{3})["']/i)?.[1]
    ?? html.match(/["']currency(?:Code)?["']\s*:\s*["']([A-Z]{3})["']/i)?.[1]
    ?? html.match(/property=["']product:price:currency["'][^>]*content=["']([A-Z]{3})["']/i)?.[1];
  return value?.toUpperCase() || null;
}

function minorDigits(currency: string | null): number {
  return currency && ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'].includes(currency)
    ? 0
    : 2;
}

function minorPrice(value: unknown, currency: string | null): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const digits = minorDigits(currency);
  const [whole, fraction = ''] = value.trim().split('.');
  const price = Number(whole) * (10 ** digits)
    + Number(fraction.padEnd(digits, '0').slice(0, digits) || 0);
  return Number.isSafeInteger(price) ? price : null;
}

function priceDisplay(price: number, currency: string | null): string {
  const digits = minorDigits(currency);
  const major = (price / (10 ** digits)).toFixed(digits);
  return currency ? `${major} ${currency}` : major;
}

function productUrl(product: ShopifyProduct, storeUrl: URL): string {
  if (typeof product.url === 'string') return new URL(product.url, storeUrl.origin).toString();
  if (typeof product.handle === 'string') {
    return new URL(`/products/${encodeURIComponent(product.handle)}`, storeUrl.origin).toString();
  }
  return storeUrl.toString();
}

function variantSummary(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const variant = value as Record<string, unknown>;
  const price = typeof variant.price === 'number'
    ? (variant.price / 100).toFixed(2)
    : typeof variant.price === 'string' ? variant.price : '';
  const parts = [
    typeof variant.title === 'string' ? variant.title : '',
    price ? `Price: ${price}` : '',
    typeof variant.available === 'boolean' ? (variant.available ? 'Available' : 'Unavailable') : '',
  ].filter(Boolean);
  return parts.length ? `- ${parts.map((part) => escapeMarkdown(String(part))).join(' — ')}` : null;
}

function structuredVariant(value: unknown, currency: string | null) {
  if (!value || typeof value !== 'object') return null;
  const variant = value as Record<string, unknown>;
  const title = typeof variant.title === 'string' ? variant.title.trim() : '';
  if (!title) return null;
  const price = minorPrice(variant.price, currency);
  return {
    ...(variant.id !== undefined ? { id: String(variant.id) } : {}),
    title,
    ...(price !== null ? {
      price,
      ...(currency ? { currency } : {}),
      priceDisplay: priceDisplay(price, currency),
    } : {}),
    ...(typeof variant.available === 'boolean' ? { available: variant.available } : {}),
  };
}

function productMarkdown(product: ShopifyProduct, storeUrl: URL): string {
  const title = typeof product.title === 'string' ? product.title.trim() : 'Product';
  const descriptionHtml = typeof product.body_html === 'string'
    ? product.body_html
    : typeof product.description === 'string' ? product.description : '';
  const description = htmlFragmentToMarkdown(descriptionHtml, storeUrl.toString());
  const metadata = [
    typeof product.vendor === 'string' && product.vendor ? `Vendor: ${escapeMarkdown(product.vendor)}` : '',
    typeof product.product_type === 'string' && product.product_type ? `Type: ${escapeMarkdown(product.product_type)}` : '',
  ].filter(Boolean).join('\n\n');
  const images = [product.featured_image, ...(product.images || [])]
    .map(imageUrl)
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .slice(0, 8)
    .map((src) => `![${escapeMarkdown(title)}](${src})`)
    .join('\n\n');
  const variants = (product.variants || []).map(variantSummary).filter(Boolean).slice(0, 50).join('\n');

  return [
    `# ${escapeMarkdown(title)}`,
    metadata,
    description,
    images,
    variants ? `## Variants\n\n${variants}` : '',
    `[View product](${productUrl(product, storeUrl)})`,
  ].filter(Boolean).join('\n\n');
}

function productItem(product: ShopifyProduct, storeUrl: URL, currency: string | null): ExtractedItem | null {
  const title = typeof product.title === 'string' ? product.title.trim() : '';
  if (!title) return null;
  const images = [product.featured_image, ...(product.images || [])]
    .map(imageUrl)
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .slice(0, 8);
  const variants = (product.variants || [])
    .map((variant) => structuredVariant(variant, currency))
    .filter((variant): variant is NonNullable<typeof variant> => variant !== null)
    .slice(0, 50);
  const directPrice = minorPrice(product.price, currency);
  const firstPrice = directPrice ?? variants.find((variant) => variant.available !== false && variant.price !== undefined)?.price
    ?? variants.find((variant) => variant.price !== undefined)?.price
    ?? null;
  const vendor = typeof product.vendor === 'string' ? product.vendor || null : null;
  return {
    type: 'product',
    source: 'shopify',
    id: product.id !== undefined ? String(product.id) : typeof product.handle === 'string' ? product.handle : null,
    url: productUrl(product, storeUrl),
    title,
    author: vendor,
    publishedAt: date(product.published_at),
    content: productMarkdown(product, storeUrl),
    media: images.map((url) => ({ type: 'image', url, alt: title })),
    attributes: {
      productType: 'physical',
      ...(vendor ? { brand: vendor } : {}),
      ...(typeof product.product_type === 'string' && product.product_type ? { category: product.product_type } : {}),
      ...(firstPrice !== null ? {
        price: firstPrice,
        ...(currency ? { currency } : {}),
        priceDisplay: priceDisplay(firstPrice, currency),
      } : {}),
      ...(variants.length ? { variants } : {}),
    },
  };
}

export async function extractShopifyStorefront(
  html: string,
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult | null> {
  if (!isShopifyStorefront(html, url)) return null;
  const { endpoint, exactProduct } = endpointFor(url);
  const currency = storefrontCurrency(html);

  try {
    const response = await fetchPublicPage(endpoint, dependencies.fetcher ?? fetch, 'application/json');
    const payload = JSON.parse(response.body) as ShopifyProduct | { products?: ShopifyProduct[] };
    const products = exactProduct
      ? [payload as ShopifyProduct]
      : Array.isArray((payload as { products?: ShopifyProduct[] }).products)
        ? (payload as { products: ShopifyProduct[] }).products
        : [];
    const items = products.map((product) => productItem(product, url, currency)).filter((item): item is ExtractedItem => item !== null);
    if (!items.length) return null;

    if (exactProduct) {
      const item = items[0];
      return {
        ...item,
        method: 'shopify-json',
      };
    }

    const title = collectionPath(url) ? 'Shopify collection products' : 'Shopify products';
    return {
      type: 'feed',
      url: url.toString(),
      source: 'shopify',
      id: collectionPath(url)?.handle ?? null,
      title,
      author: null,
      publishedAt: items[0]?.publishedAt ?? null,
      content: [`# ${title}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
      media: [],
      attributes: { feedType: collectionPath(url) ? 'collection' : 'catalog' },
      items,
      method: 'shopify-json',
    };
  } catch (error) {
    // A store may disable or protect its public JSON routes. In that case the
    // submitted page continues through ordinary HTML extraction unchanged.
    console.warn('Shopify storefront JSON unavailable', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
}
