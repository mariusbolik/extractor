import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedItem, ExtractionDependencies, ExtractionResult } from '../types';

interface ShopifyProduct extends Record<string, unknown> {
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

function productItem(product: ShopifyProduct, storeUrl: URL): ExtractedItem | null {
  const title = typeof product.title === 'string' ? product.title.trim() : '';
  if (!title) return null;
  return {
    url: productUrl(product, storeUrl),
    title,
    author: typeof product.vendor === 'string' ? product.vendor || null : null,
    publishedAt: date(product.published_at),
    content: productMarkdown(product, storeUrl),
  };
}

export async function extractShopifyStorefront(
  html: string,
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult | null> {
  if (!isShopifyStorefront(html, url)) return null;
  const { endpoint, exactProduct } = endpointFor(url);

  try {
    const response = await fetchPublicPage(endpoint, dependencies.fetcher ?? fetch, 'application/json');
    const payload = JSON.parse(response.body) as ShopifyProduct | { products?: ShopifyProduct[] };
    const products = exactProduct
      ? [payload as ShopifyProduct]
      : Array.isArray((payload as { products?: ShopifyProduct[] }).products)
        ? (payload as { products: ShopifyProduct[] }).products
        : [];
    const items = products.map((product) => productItem(product, url)).filter((item): item is ExtractedItem => item !== null);
    if (!items.length) return null;

    if (exactProduct) {
      const item = items[0];
      return {
        ...item,
        source: 'shopify',
        kind: 'document',
        items: [],
        method: 'shopify-json',
      };
    }

    const title = collectionPath(url) ? 'Shopify collection products' : 'Shopify products';
    return {
      url: url.toString(),
      source: 'shopify',
      kind: 'feed',
      title,
      author: null,
      publishedAt: items[0]?.publishedAt ?? null,
      content: [`# ${title}`, ...items.map((item) => item.content)].join('\n\n---\n\n'),
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
