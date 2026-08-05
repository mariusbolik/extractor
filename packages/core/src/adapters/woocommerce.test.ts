import { describe, expect, it, vi } from 'vitest';
import { ExtractionResponseSchema } from '../schema';
import { toPublicExtractionResult } from '../types';
import { extractWooCommerceStorefront } from './woocommerce';

const product = {
  id: 34,
  name: 'WordPress Pennant',
  slug: 'wordpress-pennant',
  permalink: 'https://store.example.com/product/wordpress-pennant/',
  description: '<p>A useful <strong>store product</strong>.</p>',
  sku: 'WP-PENNANT',
  prices: {
    price: '1299',
    regular_price: '1599',
    currency_code: 'USD',
    currency_symbol: '$',
    currency_minor_unit: 2,
  },
  average_rating: '4.5',
  review_count: 12,
  is_in_stock: true,
  images: [{ src: 'https://store.example.com/pennant.jpg', alt: 'Blue pennant', width: 800, height: 800 }],
  categories: [{ name: 'Decor' }],
  tags: [{ name: 'Featured' }, { name: 'Blue' }],
  brands: [{ name: 'Woo' }],
  attributes: [{ name: 'Color', terms: ['Blue'] }],
};

const productHtml = `<!doctype html><html><head>
  <link rel="https://api.w.org/" href="https://store.example.com/wp-json/">
  <link rel="canonical" href="https://store.example.com/product/wordpress-pennant/">
  <script src="/wp-content/plugins/woocommerce/assets/client.js"></script>
</head><body class="single-product postid-34 woocommerce"></body></html>`;

describe('WooCommerce storefront extraction', () => {
  it('uses the public product representation and preserves integer minor-unit prices', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://store.example.com/wp-json/wc/store/v1/products/34');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify(product), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = await extractWooCommerceStorefront(
      productHtml,
      new URL('https://store.example.com/product/wordpress-pennant/'),
      { fetcher },
    );
    expect(result).not.toBeNull();
    const publicResult = toPublicExtractionResult(result!);

    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult).toMatchObject({
      schemaVersion: 1,
      type: 'product',
      source: 'woocommerce',
      id: '34',
      attributes: {
        productType: 'physical',
        brand: 'Woo',
        category: 'Decor',
        sku: 'WP-PENNANT',
        tags: ['Featured', 'Blue'],
        price: 1299,
        compareAtPrice: 1599,
        compareAtPriceDisplay: '$15.99',
        currency: 'USD',
        priceDisplay: '$12.99',
        availability: 'InStock',
        rating: 4.5,
        ratingScale: 5,
        reviewCount: 12,
        features: ['Color: Blue'],
      },
    });
    expect(Number.isInteger(publicResult.attributes.price)).toBe(true);
    expect(publicResult).not.toHaveProperty('method');
  });

  it('turns a storefront product-search URL into a capped product feed', async () => {
    const searchHtml = `<!doctype html><html><head>
      <link rel="https://api.w.org/" href="https://store.example.com/wp-json/">
      <script src="/wp-content/plugins/woocommerce/assets/client.js"></script>
    </head><body class="woocommerce search-results"></body></html>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const endpoint = new URL(String(input));
      expect(endpoint.origin + endpoint.pathname).toBe('https://store.example.com/wp-json/wc/store/v1/products');
      expect(endpoint.searchParams.get('search')).toBe('blue pennant');
      expect(endpoint.searchParams.get('per_page')).toBe('50');
      return new Response(JSON.stringify([product]), { headers: { 'Content-Type': 'application/json' } });
    });

    const result = await extractWooCommerceStorefront(
      searchHtml,
      new URL('https://store.example.com/?s=blue+pennant&post_type=product'),
      { fetcher },
    );
    expect(result).not.toBeNull();
    const publicResult = toPublicExtractionResult(result!);

    expect(ExtractionResponseSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicResult).toMatchObject({
      type: 'feed',
      source: 'woocommerce',
      attributes: { feedType: 'search', query: 'blue pennant' },
    });
    expect(publicResult.items).toHaveLength(1);
  });

  it('does not duplicate the symbol for suffix-formatted currencies', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ...product,
      prices: {
        price: '210000',
        currency_code: 'EUR',
        currency_symbol: '€',
        currency_prefix: '',
        currency_suffix: '€',
        currency_minor_unit: 2,
      },
    }), { headers: { 'Content-Type': 'application/json' } }));

    const result = await extractWooCommerceStorefront(
      productHtml,
      new URL('https://store.example.com/product/wordpress-pennant/'),
      { fetcher },
    );

    expect(toPublicExtractionResult(result!).attributes).toMatchObject({
      price: 210000,
      currency: 'EUR',
      priceDisplay: '2100.00€',
    });
  });

  it('does not probe ordinary WordPress or non-commerce content pages', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(extractWooCommerceStorefront(
      '<html><body class="wordpress"></body></html>',
      new URL('https://store.example.com/'),
      { fetcher },
    )).resolves.toBeNull();
    await expect(extractWooCommerceStorefront(
      productHtml.replace('single-product postid-34', 'page'),
      new URL('https://store.example.com/about/'),
      { fetcher },
    )).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
