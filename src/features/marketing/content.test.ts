import { describe, expect, it } from 'vitest';
import { CURRENT_YEAR, alternativePages, platformArticles } from './content';
import { platformPageList } from './platform-pages';

describe('marketing content', () => {
  it('uses the current UTC year in platform articles', () => {
    expect(CURRENT_YEAR).toBe(new Date().getUTCFullYear());
    for (const article of platformArticles) {
      expect(article.description).toContain(String(CURRENT_YEAR));
      expect(article.keywords.some((keyword) => /AI|RAG|LLM/i.test(keyword))).toBe(true);
    }
  });

  it('keeps generated route slugs unique', () => {
    expect(new Set(platformArticles.map((article) => article.slug)).size).toBe(platformArticles.length);
    expect(new Set(alternativePages.map((page) => page.slug)).size).toBe(alternativePages.length);
  });

  it('covers every supported platform and the main search and agent use cases', () => {
    expect(platformArticles.length).toBeGreaterThanOrEqual(26);
    for (const platform of platformPageList) {
      expect(platformArticles.some((article) => article.slug === `scrape-${platform.slug}-data`)).toBe(true);
    }
    expect(platformArticles.map((article) => article.slug)).toEqual(expect.arrayContaining([
      'scrape-woocommerce-data',
      'scrape-yahoo-finance-data',
      'web-search-api-for-ai-agents',
      'news-search-api-for-ai-agents',
      'image-search-api-for-ai-agents',
      'place-search-api-for-ai-agents',
      'url-to-markdown-api',
      'webpage-to-json-api',
      'mcp-web-search-server',
    ]));
  });

  it('covers current extraction and AI-search competitors', () => {
    expect(alternativePages.length).toBeGreaterThanOrEqual(13);
    expect(alternativePages.map((page) => page.slug)).toEqual(expect.arrayContaining([
      'context-dev',
      'tavily',
      'exa',
      'jina-ai-reader',
      'bright-data',
      'crawl4ai',
      'scrapegraphai',
    ]));
  });
});
