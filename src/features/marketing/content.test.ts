import { describe, expect, it } from 'vitest';
import { CURRENT_YEAR, alternativePages, platformArticles } from './content';

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
});
