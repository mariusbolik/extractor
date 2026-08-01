import { describe, expect, it, vi } from 'vitest';
import { extractUrl } from '../extract';
import { ExtractionResponseSchema } from '../schema';
import { toPublicExtractionResult } from '../types';

describe('app marketplace adapters', () => {
  it('extracts an App Store URL through Apple numeric lookup', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe('https://itunes.apple.com/lookup?id=6448311069&country=us&entity=software');
      return new Response(JSON.stringify({
        resultCount: 1,
        results: [{
          trackId: 6448311069,
          trackName: 'ChatGPT',
          trackViewUrl: 'https://apps.apple.com/us/app/chatgpt/id6448311069?uo=4',
          artistName: 'OpenAI',
          artistViewUrl: 'https://apps.apple.com/us/developer/openai/id1681130765',
          bundleId: 'com.openai.chat',
          description: 'The official ChatGPT app provides useful AI assistance.',
          releaseNotes: 'Improvements and bug fixes.',
          artworkUrl512: 'https://is1-ssl.mzstatic.com/image/icon.png',
          screenshotUrls: ['https://is1-ssl.mzstatic.com/image/screenshot-1.png'],
          price: 0,
          formattedPrice: 'Free',
          currency: 'USD',
          averageUserRating: 4.8,
          userRatingCount: 123456,
          version: '1.2026.204',
          minimumOsVersion: '17.0',
          contentAdvisoryRating: '12+',
          primaryGenreName: 'Productivity',
          releaseDate: '2023-05-25T07:00:00Z',
        }],
      }), { headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl('https://apps.apple.com/us/app/chatgpt/id6448311069', { fetcher, allowBrowser });

    expect(result).toMatchObject({
      source: 'app-store',
      type: 'product',
      id: '6448311069',
      url: 'https://apps.apple.com/us/app/chatgpt/id6448311069',
      title: 'ChatGPT',
      author: 'OpenAI',
      method: 'app-store-lookup',
      attributes: {
        productType: 'software',
        price: 0,
        currency: 'USD',
        priceDisplay: 'Free',
        softwareVersion: '1.2026.204',
        operatingSystem: 'iOS 17.0 or later',
        contentRating: '12+',
      },
    });
    expect(result.media).toHaveLength(2);
    expect(result.content).toContain("## What's new");
    expect(ExtractionResponseSchema.safeParse(toPublicExtractionResult(result)).success).toBe(true);
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('falls back to Apple search when lookup is blocked for a localized App Store URL', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('user-agent')).toContain('Safari/605.1.15');

      if (input.toString() === 'https://itunes.apple.com/lookup?id=1600917142&country=at&entity=software') {
        return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
      }

      expect(input.toString()).toBe('https://itunes.apple.com/search?term=btc+echo+bitcoin+krypto+news&entity=software&country=at&limit=25');
      return new Response(JSON.stringify({
        resultCount: 1,
        results: [{
          trackId: 1600917142,
          trackName: 'BTC-ECHO Bitcoin & Krypto News',
          trackViewUrl: 'https://apps.apple.com/at/app/btc-echo-bitcoin-krypto-news/id1600917142?uo=4',
          artistName: 'BTC-ECHO GmbH',
          bundleId: 'de.btcecho.app',
          description: 'Bitcoin and crypto news.',
          artworkUrl512: 'https://is1-ssl.mzstatic.com/image/icon.png',
          price: 0,
          formattedPrice: 'Gratis',
          currency: 'EUR',
          version: '3.0.0',
          primaryGenreName: 'News',
        }],
      }), { headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl(
      'https://apps.apple.com/at/app/btc-echo-bitcoin-krypto-news/id1600917142',
      { fetcher, allowBrowser },
    );

    expect(result).toMatchObject({
      source: 'app-store',
      type: 'product',
      id: '1600917142',
      title: 'BTC-ECHO Bitcoin & Krypto News',
      author: 'BTC-ECHO GmbH',
      method: 'app-store-lookup',
      attributes: {
        productType: 'software',
        price: 0,
        currency: 'EUR',
        priceDisplay: 'Gratis',
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ExtractionResponseSchema.safeParse(toPublicExtractionResult(result)).success).toBe(true);
    expect(allowBrowser).not.toHaveBeenCalled();
  });

  it('extracts a Google Play app from public structured metadata', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe('https://play.google.com/store/apps/details?id=com.openai.chatgpt&hl=en&gl=US');
      return new Response(`<!doctype html><html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'ChatGPT',
          description: 'Your AI assistant.',
          operatingSystem: 'ANDROID',
          applicationCategory: 'PRODUCTIVITY',
          image: 'https://play-lh.googleusercontent.com/icon',
          contentRating: 'Teen',
          author: { '@type': 'Organization', name: 'OpenAI', url: 'https://help.openai.com/' },
          aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.76', ratingCount: '51143470' },
          offers: [{ '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }],
        })}</script>
      </head><body>
        <a href="/store/apps/dev?id=5700313618786177705">OpenAI</a>
        <div data-g-id="description"><p>Your AI assistant for everyday tasks.</p><p>Ask questions and create content.</p></div>
        <img alt="Screenshot image" src="https://play-lh.googleusercontent.com/screenshot-1">
        <img alt="Screenshot image" src="https://play-lh.googleusercontent.com/screenshot-1">
      </body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;
    const allowBrowser = vi.fn(async () => true);

    const result = await extractUrl(
      'https://play.google.com/store/apps/details?id=com.openai.chatgpt&hl=en&gl=US&utm_source=test',
      { fetcher, allowBrowser },
    );

    expect(result).toMatchObject({
      source: 'google-play',
      type: 'product',
      id: 'com.openai.chatgpt',
      url: 'https://play.google.com/store/apps/details?id=com.openai.chatgpt',
      title: 'ChatGPT',
      author: 'OpenAI',
      method: 'google-play-html',
      attributes: {
        productType: 'software',
        price: 0,
        currency: 'USD',
        priceDisplay: 'Free',
        rating: 4.76,
        ratingScale: 5,
        reviewCount: 51143470,
        operatingSystem: 'ANDROID',
        contentRating: 'Teen',
        developerUrl: 'https://play.google.com/store/apps/dev?id=5700313618786177705',
      },
    });
    expect(result.content).toContain('Ask questions and create content.');
    expect(result.media).toHaveLength(2);
    expect(ExtractionResponseSchema.safeParse(toPublicExtractionResult(result)).success).toBe(true);
    expect(allowBrowser).not.toHaveBeenCalled();
  });
});
