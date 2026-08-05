import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alternativePages, platformArticles } from '../marketing/content';
import { platformPageList } from '../marketing/platform-pages';
import { getSiteMarkdown } from './site-markdown';

describe('agent-readable site Markdown', () => {
  it('returns concise Markdown for every public page', () => {
    for (const path of [
      '/',
      ...platformPageList.map((page) => `/${page.slug}/`),
      '/docs/',
      '/docs/quickstart/',
      '/docs/search/',
      '/docs/news/',
      '/docs/images/',
      '/docs/videos/',
      '/docs/places/',
      '/docs/finance/',
      '/docs/mcp/',
      '/docs/api/',
      '/docs/authentication/',
      '/docs/billing/',
      '/docs/schema/',
      '/docs/sources/',
      '/docs/limits/',
      '/docs/limitations/',
      '/pricing/',
      '/contact/',
      '/alternatives/',
      '/blog/',
      ...alternativePages.map((page) => `/alternatives/${page.slug}/`),
      ...platformArticles.map((article) => `/blog/${article.slug}/`),
    ]) {
      const markdown = getSiteMarkdown(path);
      expect(markdown).toMatch(/^# /);
      expect(markdown).toMatch(/\/(?:api\/(?:extract|search|news|images|videos|places|finance)|mcp)/);
    }
  });

  it('normalizes missing trailing slashes', () => {
    expect(getSiteMarkdown('/reddit')).toBe(getSiteMarkdown('/reddit/'));
  });

  it('does not claim Markdown representations for unknown paths', () => {
    expect(getSiteMarkdown('/missing')).toBeNull();
  });

  it('does not expose noindex legal pages through content negotiation', () => {
    expect(getSiteMarkdown('/legal/')).toBeNull();
    expect(getSiteMarkdown('/privacy/')).toBeNull();
    expect(getSiteMarkdown('/terms/')).toBeNull();
    expect(getSiteMarkdown('/login/')).toBeNull();
    expect(getSiteMarkdown('/dashboard/')).toBeNull();
  });

  it('keeps private retrieval mechanisms out of public documentation', () => {
    const publicDocuments = [
      '../../pages/index.astro',
      '../../pages/docs/api.astro',
      '../../pages/docs/authentication.astro',
      '../../pages/docs/billing.astro',
      '../../pages/docs/limits.astro',
      '../../pages/docs/mcp.astro',
      '../../pages/docs/search.astro',
      '../../pages/docs/news.astro',
      '../../pages/docs/images.astro',
      '../../pages/docs/videos.astro',
      '../../pages/docs/places.astro',
      '../../pages/docs/finance.astro',
      '../../pages/docs/schema.astro',
      '../../pages/docs/sources.astro',
      '../marketing/platform-pages.ts',
      '../../../public/llms-full.txt',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

    const agentMarkdown = [
      '/',
      '/docs/mcp/',
      '/docs/search/',
      '/docs/news/',
      '/docs/images/',
      '/docs/videos/',
      '/docs/places/',
      '/docs/finance/',
      '/docs/api/',
      '/docs/schema/',
      '/docs/sources/',
      '/docs/limits/',
    ].map((path) => getSiteMarkdown(path) ?? '');

    const privateTerms = [
      /\boembed\b/i,
      /\brss\b/i,
      /\batom\b/i,
      /react-tweet/i,
      /linkedom/i,
      /readability/i,
      /turndown/i,
      /browser[- ](?:run|rendering|heavy)/i,
      /structured post/i,
      /json endpoint/i,
      /compact (?:product page|search representation)/i,
      /page hydration/i,
      /lookup service/i,
      /\bappview\b/i,
      /openverse/i,
      /wikimedia/i,
      /dailymotion/i,
      /sepiasearch/i,
      /peertube/i,
      /brave videos/i,
      /bing videos/i,
      /photon/i,
      /komoot/i,
    ];

    for (const document of [...publicDocuments, ...agentMarkdown]) {
      for (const privateTerm of privateTerms) expect(document).not.toMatch(privateTerm);
    }
  });
});
