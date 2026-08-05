import { describe, expect, it } from 'vitest';
import { platformFaq, platformPageList, platformPageSchema, platformPages } from './platform-pages';

describe('platform landing page content', () => {
  it('keeps every route unique, search-focused, and immediately testable', () => {
    expect(platformPageList).toHaveLength(17);
    expect(new Set(platformPageList.map((page) => page.slug)).size).toBe(platformPageList.length);
    expect(new Set(platformPageList.map((page) => page.title)).size).toBe(platformPageList.length);

    for (const page of platformPageList) {
      expect(page.title).toMatch(/\bFree\b/);
      expect(page.headline).toMatch(/Scraper - Extract/);
      expect(page.description.length).toBeGreaterThan(90);
      expect(page.keywords.some((keyword) => /scraper api/i.test(keyword))).toBe(true);
      expect(page.capabilities.length).toBeGreaterThan(0);
      expect(page.capabilities.some((capability) => capability.exampleUrl)).toBe(true);
      expect(page.includes.length).toBeGreaterThanOrEqual(4);
      expect(page.limitations.length).toBeGreaterThanOrEqual(3);

      for (const capability of page.capabilities) {
        if (!capability.exampleUrl) continue;
        const example = new URL(capability.exampleUrl);
        expect(['http:', 'https:']).toContain(example.protocol);
      }
      for (const related of page.related) {
        expect(related).not.toBe(page.slug);
        expect(platformPages[related]).toBeDefined();
      }
    }
  });

  it('generates matching visible FAQs and search structured data', () => {
    for (const page of platformPageList) {
      const faq = platformFaq(page);
      expect(faq).toHaveLength(3);
      expect(faq.every((item) => item.question.includes(page.platform))).toBe(true);

      const schema = platformPageSchema(page);
      const graph = schema['@graph'];
      expect(graph.map((item) => item['@type'])).toEqual([
        'WebPage', 'SoftwareApplication', 'HowTo', 'FAQPage', 'BreadcrumbList',
      ]);
      expect(graph.find((item) => item['@type'] === 'FAQPage')?.mainEntity).toHaveLength(faq.length);
    }
  });
});
