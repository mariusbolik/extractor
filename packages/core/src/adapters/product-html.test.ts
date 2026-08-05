import { describe, expect, it, vi } from 'vitest';
import { extractUrl } from '../extract';
import { toPublicExtractionResult } from '../types';

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

describe('generic server-rendered commerce extraction', () => {
  it('normalizes repeated product cards as a bounded product feed', async () => {
    const fetcher = vi.fn(async () => htmlResponse(`<!doctype html><html lang="de"><head>
      <title>City & Trekking Bikes</title>
    </head><body><main><h1>City & Trekking Bikes</h1><div id="productsContainer">
      <div class="product tile" id="1593" data-pricemin="2999" data-pricemax="4899">
        <a href="/de/bikes-allure-eplus---gen2" data-product-name="Allure E+ | Gen2" data-product-brand="Liv" data-product-category="Bikes/">
          <img src="https://images.example.com/allure.jpg" alt="Allure E+ | Gen2" width="500" height="333">
        </a><span class="currentprice">2.999,00 € - 4.899,00 €</span>
      </div>
      <div class="product tile" id="1594" data-pricemin="1300">
        <a href="/de/bikes-allure-cs-2027" data-product-name="Allure CS" data-product-brand="Liv" data-product-category="Bikes/">
          <img src="https://images.example.com/allure-cs.jpg" alt="Allure CS" width="500" height="333">
        </a><span class="currentprice">1.300,00 €</span>
      </div>
    </div></main></body></html>`)) as unknown as typeof fetch;

    const result = await extractUrl('https://store.example.com/de/bikes/city-und-trekking', { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(result).toMatchObject({ type: 'feed', source: 'web', method: 'product-list-html' });
    expect(result.items).toHaveLength(2);
    expect(result.items![0]).toMatchObject({
      type: 'product',
      title: 'Allure E+ | Gen2',
      url: 'https://store.example.com/de/bikes-allure-eplus---gen2',
      attributes: { brand: 'Liv', category: 'Bikes', price: 299900, currency: 'EUR' },
    });
    expect(result.items![0].media[0]).toMatchObject({ width: 500, height: 333 });
    expect(publicResult.attributes).toMatchObject({ feedType: 'products', resultCount: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('prefers an advertised Product entity and preserves specifications and variants', async () => {
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'DailyTour E+ 3 GTS',
      image: 'https://images.example.com/bike.jpg',
      description: 'A versatile and practical e-bike for daily trips.',
      brand: { '@type': 'Brand', name: 'Giant' },
      offers: [
        {
          '@type': 'Offer', price: '2999.00', priceCurrency: 'EUR', availability: 'https://schema.org/InStock',
          seller: { name: 'Giant Bicycles' },
          itemOffered: { color: 'Rosewood', size: 'S', sku: '2303222194', gtin: '4711291060685' },
        },
        {
          '@type': 'Offer', price: '2999.00', priceCurrency: 'EUR', availability: 'https://schema.org/OutOfStock',
          seller: { name: 'Giant Bicycles' },
          itemOffered: { color: 'Rosewood', size: 'M', sku: '2303222195', gtin: '4711291060692' },
        },
      ],
    };
    const fetcher = vi.fn(async () => htmlResponse(`<!doctype html><html><head>
      <title>DailyTour E+ 3 GTS</title><script type="application/ld+json">${JSON.stringify(product)}</script>
    </head><body><main><h1>DailyTour E+ 3 GTS</h1>
      <p>This practical electric bicycle includes automatic assistance, lights, fenders and a luggage rack for useful everyday journeys.</p>
      <div class="datarow"><span class="label">Motor</span><span class="value">SyncDrive Sport</span></div>
      <table><tr><th>Battery</th><td>EnergyPak 500 Wh</td></tr></table>
      <div class="products"><div class="product"><a href="/related-one"><h3>Related one</h3></a></div><div class="product"><a href="/related-two"><h3>Related two</h3></a></div></div>
    </main></body></html>`)) as unknown as typeof fetch;

    const result = await extractUrl('https://store.example.com/de/dailytour-eplus-3-gts-2022', { fetcher });
    const publicResult = toPublicExtractionResult(result);

    expect(result).toMatchObject({
      type: 'product', source: 'web', method: 'product-jsonld', title: 'DailyTour E+ 3 GTS', author: 'Giant',
      attributes: { seller: 'Giant Bicycles', price: 299900, currency: 'EUR', availability: 'InStock' },
    });
    expect(result.attributes.variants).toHaveLength(2);
    expect(result.attributes.variants?.[0]).toMatchObject({ sku: '2303222194', gtin: '4711291060685', available: true });
    expect(result.attributes.features).toContain('Motor: SyncDrive Sport');
    expect(result.attributes.features).toContain('Battery: EnergyPak 500 Wh');
    expect(result.content).toContain('automatic assistance');
    expect(publicResult.type).toBe('product');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
